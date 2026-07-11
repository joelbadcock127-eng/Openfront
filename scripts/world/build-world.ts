/**
 * World map build pipeline.
 *
 * Converts Natural Earth 10m vector data (public domain) into the game's
 * streamed world: an Equal Earth–projected, chunked, multi-LOD terrain
 * pyramid plus a playable high-detail window (Bass Strait region) emitted in
 * the standard OpenFront map format.
 *
 * Run:  npx tsx scripts/world/build-world.ts
 * Requires the datasets in map-generator/world-data/ (see docs/GEOGRAPHIC_DATA.md).
 *
 * Outputs:
 *   resources/world/world-index.json      chunk index + grid config
 *   resources/world/world-l{k}.pack       concatenated gzipped chunks per LOD
 *   resources/maps/worldwindow/           OpenFront-format playable window
 *   map-generator/world-data/diagnostics/ PNG previews (not committed)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  CHUNK_SIZE,
  TERRAIN_LAND_BIT,
  TERRAIN_OCEAN_BIT,
  WorldGrid,
} from "../../src/core/world/WorldGrid";
import { encodePng } from "./png";
import { Grid, rasterizeFeatures } from "./rasterize";
import {
  computeShoreAndMagnitude,
  downsampleLand,
  floodOcean,
  isLand,
  paintLine,
  TerrainGrid,
  waterConnected,
} from "./terrain";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const dataDir = path.join(repoRoot, "map-generator", "world-data");
const outDir = path.join(repoRoot, "resources", "world");
const diagDir = path.join(dataDir, "diagnostics");
const windowMapDir = path.join(repoRoot, "resources", "maps", "worldwindow");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** LOD-0 world dimensions (cells). 65536×32768 ⇒ every LOD ≤ 6 chunks evenly. */
const W0 = 65536;
const H0 = 32768;
/** Global coverage is generated at this LOD (16384×8192). Finer LODs exist
 * only inside detail regions until Stage 3 generates them worldwide. */
const GLOBAL_BASE_LOD = 2;
const MAX_LOD = 6;
const FORMAT_VERSION = 1;

const grid = new WorldGrid({ w0: W0, h0: H0, maxLod: MAX_LOD });

/**
 * Strategic straits that must never silt shut, and land corridors that must
 * never flood open, at any LOD (the plan's chokepoint list). Water straits
 * are re-carved after every downsample; corridors are re-filled.
 * Coordinates are (lon, lat) endpoints of a line through the feature.
 */
const STRAITS: Array<{
  name: string;
  from: [number, number];
  to: [number, number];
  land?: boolean;
}> = [
  { name: "Strait of Gibraltar", from: [-5.9, 35.95], to: [-5.15, 36.0] },
  { name: "Bosporus", from: [29.05, 41.35], to: [29.05, 40.85] },
  { name: "Dardanelles", from: [26.15, 40.0], to: [26.75, 40.45] },
  { name: "Øresund", from: [12.6, 56.1], to: [12.85, 55.35] },
  { name: "Great Belt", from: [10.85, 55.75], to: [10.75, 55.05] },
  { name: "Strait of Messina", from: [15.55, 38.3], to: [15.65, 37.95] },
  { name: "Strait of Dover", from: [1.2, 51.1], to: [1.85, 50.75] },
  { name: "Bab-el-Mandeb", from: [43.2, 12.75], to: [43.5, 12.4] },
  { name: "Strait of Hormuz", from: [56.4, 26.8], to: [56.7, 26.3] },
  { name: "Singapore Strait", from: [103.5, 1.15], to: [104.4, 1.2] },
  { name: "Bering Strait", from: [-169.7, 65.7], to: [-168.7, 65.9] },
  { name: "Suez isthmus", from: [32.4, 31.1], to: [32.5, 29.9], land: true },
  { name: "Panama isthmus", from: [-80.1, 9.3], to: [-79.5, 8.9], land: true },
];

/** Islands that must be recognisable at the global base LOD. Verified after
 * rasterisation; a missing island fails the build (documented in the plan). */
const ISLAND_CHECKS: Array<{ name: string; lon: number; lat: number }> = [
  { name: "Tasmania", lon: 146.6, lat: -42.0 },
  { name: "King Island", lon: 143.95, lat: -39.9 },
  { name: "Flinders Island", lon: 148.05, lat: -40.0 },
  { name: "Great Britain", lon: -1.5, lat: 52.5 },
  { name: "Ireland", lon: -8.0, lat: 53.2 },
  { name: "Iceland", lon: -18.7, lat: 64.9 },
  { name: "Sicily", lon: 14.2, lat: 37.5 },
  { name: "Sardinia", lon: 9.0, lat: 40.0 },
  { name: "Corsica", lon: 9.1, lat: 42.2 },
  { name: "Crete", lon: 24.9, lat: 35.3 },
  { name: "Cyprus", lon: 33.2, lat: 35.1 },
  { name: "Honshu", lon: 138.5, lat: 36.5 },
  { name: "Hokkaido", lon: 142.8, lat: 43.5 },
  { name: "Luzon", lon: 121.0, lat: 16.0 },
  { name: "Java", lon: 110.0, lat: -7.4 },
  { name: "Sumatra", lon: 101.5, lat: -0.5 },
  { name: "Borneo", lon: 114.0, lat: 0.5 },
  { name: "New Zealand South", lon: 169.8, lat: -44.5 },
  { name: "New Zealand North", lon: 175.5, lat: -38.5 },
  { name: "Sri Lanka", lon: 80.7, lat: 7.9 },
  { name: "Taiwan", lon: 121.0, lat: 23.7 },
  { name: "Cuba", lon: -78.7, lat: 21.9 },
  { name: "Hispaniola", lon: -70.5, lat: 19.0 },
  { name: "Madagascar", lon: 46.8, lat: -19.5 },
  { name: "Hawaii (Big Island)", lon: -155.5, lat: 19.6 },
  { name: "Denmark (Jutland)", lon: 9.2, lat: 56.2 },
];

/** Water bodies whose ocean/lake classification is asserted. */
const WATER_CHECKS: Array<{
  name: string;
  lon: number;
  lat: number;
  ocean: boolean;
}> = [
  { name: "Mediterranean", lon: 5.0, lat: 38.0, ocean: true },
  { name: "Black Sea", lon: 34.0, lat: 43.0, ocean: true },
  { name: "Baltic Sea", lon: 19.0, lat: 58.0, ocean: true },
  { name: "Red Sea", lon: 38.0, lat: 20.0, ocean: true },
  { name: "Persian Gulf", lon: 51.0, lat: 27.0, ocean: true },
  { name: "Sea of Japan", lon: 135.0, lat: 40.0, ocean: true },
  { name: "Hudson Bay", lon: -85.0, lat: 60.0, ocean: true },
  { name: "Bass Strait", lon: 146.0, lat: -39.5, ocean: true },
  { name: "Caspian Sea", lon: 50.5, lat: 42.0, ocean: false },
  { name: "Lake Superior", lon: -87.5, lat: 47.6, ocean: false },
];

/** First playable detail region: Bass Strait (Tasmania + southern Victoria). */
const DETAIL_REGION = {
  id: "bassstrait",
  lonMin: 142.4,
  lonMax: 150.6,
  latMin: -44.8,
  latMax: -36.6,
};

/** Ocean flood seed (single seed proves world-ocean connectivity). */
const OCEAN_SEED: [number, number] = [-30, 0]; // mid-Atlantic

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[world] ${msg}`);
}

function loadGeojson(name: string): {
  features: Array<{
    geometry: { type: string; coordinates: unknown };
    properties?: Record<string, unknown>;
  }>;
} {
  const p = path.join(dataDir, name);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Missing dataset ${name}. Download Natural Earth data first — see docs/GEOGRAPHIC_DATA.md`,
    );
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Projection into a specific LOD's cell space. */
function projectorForLod(lod: number) {
  const scale = 1 / (1 << lod);
  return (lon: number, lat: number) => {
    const w = grid.geoToWorld(lon, lat);
    return { x: w.x * scale, y: w.y * scale };
  };
}

function geoToCell(lon: number, lat: number, lod: number): [number, number] {
  const p = projectorForLod(lod)(lon, lat);
  return [Math.floor(p.x), Math.floor(p.y)];
}

function cellKmAt(lod: number): number {
  return (40075 / W0) * (1 << lod);
}

function carveStraits(g: TerrainGrid, lod: number, halfWidth: number): void {
  const proj = projectorForLod(lod);
  for (const s of STRAITS) {
    const a = proj(s.from[0], s.from[1]);
    const b = proj(s.to[0], s.to[1]);
    paintLine(
      g,
      Math.round(a.x),
      Math.round(a.y),
      Math.round(b.x),
      Math.round(b.y),
      s.land === true,
      halfWidth,
    );
  }
}

function finishTerrain(g: TerrainGrid, lod: number): void {
  const [sx, sy] = geoToCell(OCEAN_SEED[0], OCEAN_SEED[1], lod);
  floodOcean(g, [[sx, sy]]);
  computeShoreAndMagnitude(g, cellKmAt(lod));
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

const PALETTE = {
  ocean: [24, 60, 110],
  lake: [50, 110, 160],
  shoreWater: [70, 130, 180],
  land: [110, 150, 90],
  shoreLand: [160, 170, 120],
  highland: [150, 140, 100],
} as const;

function terrainToRgb(g: TerrainGrid): Uint8Array {
  const rgb = new Uint8Array(g.width * g.height * 3);
  for (let i = 0; i < g.width * g.height; i++) {
    const v = g.data[i];
    const land = (v & TERRAIN_LAND_BIT) !== 0;
    const shore = (v & 0x40) !== 0;
    const ocean = (v & TERRAIN_OCEAN_BIT) !== 0;
    const mag = v & 0x1f;
    let c: readonly number[];
    if (land) {
      c = shore ? PALETTE.shoreLand : mag > 12 ? PALETTE.highland : PALETTE.land;
    } else {
      c = shore ? PALETTE.shoreWater : ocean ? PALETTE.ocean : PALETTE.lake;
    }
    rgb[i * 3] = c[0];
    rgb[i * 3 + 1] = c[1];
    rgb[i * 3 + 2] = c[2];
  }
  return rgb;
}

function writeDiag(name: string, g: TerrainGrid): void {
  fs.mkdirSync(diagDir, { recursive: true });
  fs.writeFileSync(
    path.join(diagDir, `${name}.png`),
    encodePng(g.width, g.height, terrainToRgb(g)),
  );
  log(`diagnostic written: ${name}.png (${g.width}x${g.height})`);
}

function cropView(
  g: TerrainGrid,
  lod: number,
  lonMin: number,
  latMax: number,
  lonMax: number,
  latMin: number,
): TerrainGrid {
  const [x0, y0] = geoToCell(lonMin, latMax, lod);
  const [x1, y1] = geoToCell(lonMax, latMin, lod);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    out.set(g.data.subarray((y0 + y) * g.width + x0, (y0 + y) * g.width + x0 + w), y * w);
  }
  return { width: w, height: h, data: out };
}

// ---------------------------------------------------------------------------
// Chunk packing
// ---------------------------------------------------------------------------

interface PackedLod {
  pack: string;
  chunks: Record<string, [number, number]>; // "x_y" -> [offset, byteLength]
}

/**
 * Slice a terrain grid into CHUNK_SIZE² chunks (bottom rows zero-padded when
 * the grid height is not a chunk multiple), gzip each, and concatenate into
 * one pack file. Only chunks inside `bounds` (cell coords) are emitted when
 * bounds are given (partial-coverage LODs).
 */
function packLod(
  g: TerrainGrid,
  lod: number,
  bounds?: { x0: number; y0: number; x1: number; y1: number },
  originCellX = 0,
  originCellY = 0,
): { file: Buffer; index: PackedLod } {
  const parts: Buffer[] = [];
  const chunks: Record<string, [number, number]> = {};
  let offset = 0;
  const cols = Math.ceil(g.width / CHUNK_SIZE);
  const rows = Math.ceil(g.height / CHUNK_SIZE);
  const raw = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const worldChunkX = cx + originCellX / CHUNK_SIZE;
      const worldChunkY = cy + originCellY / CHUNK_SIZE;
      if (bounds) {
        const px = worldChunkX * CHUNK_SIZE;
        const py = worldChunkY * CHUNK_SIZE;
        if (
          px + CHUNK_SIZE <= bounds.x0 ||
          px >= bounds.x1 ||
          py + CHUNK_SIZE <= bounds.y0 ||
          py >= bounds.y1
        ) {
          continue;
        }
      }
      raw.fill(0);
      const x0 = cx * CHUNK_SIZE;
      const y0 = cy * CHUNK_SIZE;
      const w = Math.min(CHUNK_SIZE, g.width - x0);
      const h = Math.min(CHUNK_SIZE, g.height - y0);
      for (let y = 0; y < h; y++) {
        raw.set(
          g.data.subarray((y0 + y) * g.width + x0, (y0 + y) * g.width + x0 + w),
          y * CHUNK_SIZE,
        );
      }
      const gz = gzipSync(raw, { level: 9 });
      // Determinism check: decoded chunk must equal the source slice.
      const back = gunzipSync(gz);
      for (let i = 0; i < raw.length; i++) {
        if (back[i] !== raw[i]) {
          throw new Error(`chunk roundtrip mismatch at lod ${lod} ${cx},${cy}`);
        }
      }
      chunks[`${worldChunkX}_${worldChunkY}`] = [offset, gz.length];
      parts.push(gz);
      offset += gz.length;
    }
  }
  return {
    file: Buffer.concat(parts),
    index: { pack: `world-l${lod}.pack`, chunks },
  };
}

// ---------------------------------------------------------------------------
// Playable window map (OpenFront format)
// ---------------------------------------------------------------------------

function emitWindowMap(
  detail: TerrainGrid,
  originLod0X: number,
  originLod0Y: number,
): void {
  fs.mkdirSync(windowMapDir, { recursive: true });

  const countLand = (g: TerrainGrid) => {
    let n = 0;
    for (let i = 0; i < g.data.length; i++) if (isLand(g.data[i])) n++;
    return n;
  };

  // Mini maps: engine's map4x halves each axis; map16x quarters each axis.
  const toFinished = (land: TerrainGrid, lod: number): TerrainGrid => {
    const g = { width: land.width, height: land.height, data: land.data.slice() };
    // Ocean: seed from every border water cell whose world LOD2 cell is ocean.
    const seeds: Array<[number, number]> = [];
    const worldFromLocal = (x: number, y: number): [number, number] => [
      (originLod0X + (x << lod)) >> GLOBAL_BASE_LOD,
      (originLod0Y + (y << lod)) >> GLOBAL_BASE_LOD,
    ];
    const border: Array<[number, number]> = [];
    for (let x = 0; x < g.width; x++) border.push([x, 0], [x, g.height - 1]);
    for (let y = 0; y < g.height; y++) border.push([0, y], [g.width - 1, y]);
    for (const [x, y] of border) {
      if (isLand(g.data[y * g.width + x])) continue;
      const [wx, wy] = worldFromLocal(x, y);
      if ((globalBase.data[wy * globalBase.width + wx] & TERRAIN_OCEAN_BIT) !== 0) {
        seeds.push([x, y]);
      }
    }
    floodOcean(g, seeds);
    computeShoreAndMagnitude(g, cellKmAt(lod));
    return g;
  };

  const full = toFinished(detail, 0);
  const half = toFinished(downsampleLand(detail), 1);
  const quarter = toFinished(downsampleLand(downsampleLand(detail)), 2);

  fs.writeFileSync(path.join(windowMapDir, "map.bin"), full.data);
  fs.writeFileSync(path.join(windowMapDir, "map4x.bin"), half.data);
  fs.writeFileSync(path.join(windowMapDir, "map16x.bin"), quarter.data);

  // Nations from Natural Earth populated places inside the region.
  const places = loadGeojson("ne_10m_populated_places_simple.geojson");
  const nations: Array<{
    coordinates: [number, number];
    flag: string;
    name: string;
  }> = [];
  const candidates = places.features
    .map((f) => ({
      name: String(f.properties?.name ?? ""),
      pop: Number(f.properties?.pop_max ?? 0),
      lon: Number(f.properties?.longitude ?? NaN),
      lat: Number(f.properties?.latitude ?? NaN),
    }))
    .filter(
      (p) =>
        p.name &&
        p.lon >= DETAIL_REGION.lonMin &&
        p.lon <= DETAIL_REGION.lonMax &&
        p.lat >= DETAIL_REGION.latMin &&
        p.lat <= DETAIL_REGION.latMax,
    )
    .sort((a, b) => b.pop - a.pop);
  for (const c of candidates) {
    if (nations.length >= 10) break;
    const w = grid.geoToWorld(c.lon, c.lat);
    let x = Math.floor(w.x) - originLod0X;
    let y = Math.floor(w.y) - originLod0Y;
    // Snap to nearest land cell within a small radius (coastal cities can
    // project a cell or two into water).
    const snapped = snapToLand(full, x, y, 20);
    if (!snapped) continue;
    [x, y] = snapped;
    nations.push({ coordinates: [x, y], flag: "au", name: c.name });
  }
  log(
    `window nations: ${nations.map((n) => n.name).join(", ") || "(none found)"}`,
  );

  const manifest = {
    name: "WorldWindow",
    map: {
      width: full.width,
      height: full.height,
      num_land_tiles: countLand(full),
    },
    map4x: {
      width: half.width,
      height: half.height,
      num_land_tiles: countLand(half),
    },
    map16x: {
      width: quarter.width,
      height: quarter.height,
      num_land_tiles: countLand(quarter),
    },
    nations,
  };
  fs.writeFileSync(
    path.join(windowMapDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeDiag("window-bassstrait", full);
  log(
    `window map: ${full.width}x${full.height}, ${manifest.map.num_land_tiles} land tiles`,
  );
}

function snapToLand(
  g: TerrainGrid,
  x: number,
  y: number,
  radius: number,
): [number, number] | null {
  if (x >= 0 && y >= 0 && x < g.width && y < g.height && isLand(g.data[y * g.width + x])) {
    return [x, y];
  }
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.width || ny >= g.height) continue;
        if (isLand(g.data[ny * g.width + nx])) return [nx, ny];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main build
// ---------------------------------------------------------------------------

let globalBase: TerrainGrid; // LOD2 finished terrain, used by window ocean seeding

function main(): void {
  const t0 = Date.now();
  fs.mkdirSync(outDir, { recursive: true });

  log("loading Natural Earth datasets…");
  const land = loadGeojson("ne_10m_land.geojson");
  const minorIslands = loadGeojson("ne_10m_minor_islands.geojson");
  const lakes = loadGeojson("ne_10m_lakes.geojson");

  // --- Global base (LOD2) -------------------------------------------------
  const w2 = grid.width(GLOBAL_BASE_LOD);
  const h2 = grid.height(GLOBAL_BASE_LOD);
  log(`rasterizing global base LOD${GLOBAL_BASE_LOD} (${w2}x${h2})…`);
  const base: Grid = { width: w2, height: h2, data: new Uint8Array(w2 * h2) };
  const proj2 = projectorForLod(GLOBAL_BASE_LOD);
  rasterizeFeatures(base, land.features, proj2, TERRAIN_LAND_BIT);
  rasterizeFeatures(base, minorIslands.features, proj2, TERRAIN_LAND_BIT);
  rasterizeFeatures(base, lakes.features, proj2, 0);
  carveStraits(base, GLOBAL_BASE_LOD, 1);
  log("computing ocean/shore/magnitude at global base…");
  finishTerrain(base, GLOBAL_BASE_LOD);
  globalBase = base;

  // Island + water-classification validation at the global base.
  const failures: string[] = [];
  for (const isl of ISLAND_CHECKS) {
    const [x, y] = geoToCell(isl.lon, isl.lat, GLOBAL_BASE_LOD);
    if (!isLand(base.data[y * base.width + x])) {
      failures.push(`island missing at LOD${GLOBAL_BASE_LOD}: ${isl.name}`);
    }
  }
  for (const w of WATER_CHECKS) {
    const [x, y] = geoToCell(w.lon, w.lat, GLOBAL_BASE_LOD);
    const v = base.data[y * base.width + x];
    if (isLand(v)) {
      failures.push(`expected water at ${w.name}`);
    } else if (((v & TERRAIN_OCEAN_BIT) !== 0) !== w.ocean) {
      failures.push(
        `${w.name}: expected ${w.ocean ? "ocean" : "lake"}, got ${(v & TERRAIN_OCEAN_BIT) !== 0 ? "ocean" : "lake"}`,
      );
    }
  }
  // Direct strait navigability probes (BFS through the carved strait).
  const straitProbes: Array<{ name: string; a: [number, number]; b: [number, number] }> = [
    { name: "Gibraltar", a: [-6.5, 35.9], b: [-4.5, 36.2] },
    { name: "Bosporus chain", a: [28.0, 43.0], b: [25.0, 39.0] },
    { name: "Øresund/Belts", a: [11.0, 56.5], b: [19.0, 58.0] },
    { name: "Bering", a: [-171.0, 64.0], b: [-168.0, 67.5] },
  ];
  for (const p of straitProbes) {
    const a = geoToCell(p.a[0], p.a[1], GLOBAL_BASE_LOD);
    const b = geoToCell(p.b[0], p.b[1], GLOBAL_BASE_LOD);
    if (!waterConnected(base, a, b)) {
      failures.push(`strait not navigable: ${p.name}`);
    }
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(`[world] VALIDATION FAILED: ${f}`);
    throw new Error(`world build validation failed (${failures.length} issues)`);
  }
  log("global validations passed (islands, water bodies, straits)");

  // --- LOD pyramid LOD3..MAX_LOD ------------------------------------------
  const lods = new Map<number, TerrainGrid>();
  lods.set(GLOBAL_BASE_LOD, base);
  let prev: TerrainGrid = base;
  for (let k = GLOBAL_BASE_LOD + 1; k <= MAX_LOD; k++) {
    const g = downsampleLand(prev);
    carveStraits(g, k, 1);
    finishTerrain(g, k);
    lods.set(k, g);
    prev = g;
    log(`built LOD${k} (${g.width}x${g.height})`);
  }

  // --- Detail region (LOD0 + LOD1) ----------------------------------------
  // Snap region to 1024 LOD-0 cells so chunk grids align at LOD0/1/2.
  const corners = [
    grid.geoToWorld(DETAIL_REGION.lonMin, DETAIL_REGION.latMax),
    grid.geoToWorld(DETAIL_REGION.lonMax, DETAIL_REGION.latMax),
    grid.geoToWorld(DETAIL_REGION.lonMin, DETAIL_REGION.latMin),
    grid.geoToWorld(DETAIL_REGION.lonMax, DETAIL_REGION.latMin),
  ];
  const ALIGN = 1024;
  const rx0 = Math.floor(Math.min(...corners.map((c) => c.x)) / ALIGN) * ALIGN;
  const ry0 = Math.floor(Math.min(...corners.map((c) => c.y)) / ALIGN) * ALIGN;
  const rx1 = Math.ceil(Math.max(...corners.map((c) => c.x)) / ALIGN) * ALIGN;
  const ry1 = Math.ceil(Math.max(...corners.map((c) => c.y)) / ALIGN) * ALIGN;
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  log(`detail region ${DETAIL_REGION.id}: LOD0 rect ${rw}x${rh} at (${rx0},${ry0})`);

  const detail: Grid = { width: rw, height: rh, data: new Uint8Array(rw * rh) };
  const proj0 = projectorForLod(0);
  const projRegion = (lon: number, lat: number) => {
    const p = proj0(lon, lat);
    return { x: p.x - rx0, y: p.y - ry0 };
  };
  log("rasterizing detail region at LOD0…");
  rasterizeFeatures(detail, land.features, projRegion, TERRAIN_LAND_BIT);
  rasterizeFeatures(detail, minorIslands.features, projRegion, TERRAIN_LAND_BIT);
  rasterizeFeatures(detail, lakes.features, projRegion, 0);

  // Finished detail terrain for the world layer (ocean seeded from region
  // border cells that are ocean at the global base).
  const detailFinished: TerrainGrid = { width: rw, height: rh, data: detail.data.slice() };
  {
    const seeds: Array<[number, number]> = [];
    const pushIfOcean = (x: number, y: number) => {
      if (isLand(detailFinished.data[y * rw + x])) return;
      const wx = (rx0 + x) >> GLOBAL_BASE_LOD;
      const wy = (ry0 + y) >> GLOBAL_BASE_LOD;
      if ((base.data[wy * base.width + wx] & TERRAIN_OCEAN_BIT) !== 0) seeds.push([x, y]);
    };
    for (let x = 0; x < rw; x++) {
      pushIfOcean(x, 0);
      pushIfOcean(x, rh - 1);
    }
    for (let y = 0; y < rh; y++) {
      pushIfOcean(0, y);
      pushIfOcean(rw - 1, y);
    }
    floodOcean(detailFinished, seeds);
    computeShoreAndMagnitude(detailFinished, cellKmAt(0));
  }

  const detail1Land = downsampleLand({ width: rw, height: rh, data: detail.data });
  const detail1: TerrainGrid = {
    width: detail1Land.width,
    height: detail1Land.height,
    data: detail1Land.data,
  };
  {
    const seeds: Array<[number, number]> = [];
    for (let x = 0; x < detail1.width; x++) {
      for (const y of [0, detail1.height - 1]) {
        if (isLand(detail1.data[y * detail1.width + x])) continue;
        const wx = ((rx0 >> 1) + x) << 1 >> GLOBAL_BASE_LOD;
        const wy = ((ry0 >> 1) + y) << 1 >> GLOBAL_BASE_LOD;
        if ((base.data[wy * base.width + wx] & TERRAIN_OCEAN_BIT) !== 0) seeds.push([x, y]);
      }
    }
    for (let y = 0; y < detail1.height; y++) {
      for (const x of [0, detail1.width - 1]) {
        if (isLand(detail1.data[y * detail1.width + x])) continue;
        const wx = ((rx0 >> 1) + x) << 1 >> GLOBAL_BASE_LOD;
        const wy = ((ry0 >> 1) + y) << 1 >> GLOBAL_BASE_LOD;
        if ((base.data[wy * base.width + wx] & TERRAIN_OCEAN_BIT) !== 0) seeds.push([x, y]);
      }
    }
    floodOcean(detail1, seeds);
    computeShoreAndMagnitude(detail1, cellKmAt(1));
  }

  // --- Pack chunks ---------------------------------------------------------
  log("packing chunks…");
  const indexLods: Record<string, PackedLod> = {};
  for (let k = GLOBAL_BASE_LOD; k <= MAX_LOD; k++) {
    const g = lods.get(k)!;
    const { file, index } = packLod(g, k);
    fs.writeFileSync(path.join(outDir, index.pack), file);
    indexLods[String(k)] = index;
    log(`LOD${k}: ${Object.keys(index.chunks).length} chunks, ${(file.length / 1024).toFixed(0)} KiB`);
  }
  {
    const { file, index } = packLod(detailFinished, 0, undefined, rx0, ry0);
    fs.writeFileSync(path.join(outDir, index.pack), file);
    indexLods["0"] = index;
    log(`LOD0 (detail): ${Object.keys(index.chunks).length} chunks, ${(file.length / 1024).toFixed(0)} KiB`);
  }
  {
    const { file, index } = packLod(detail1, 1, undefined, rx0 >> 1, ry0 >> 1);
    fs.writeFileSync(path.join(outDir, index.pack), file);
    indexLods["1"] = index;
    log(`LOD1 (detail): ${Object.keys(index.chunks).length} chunks, ${(file.length / 1024).toFixed(0)} KiB`);
  }

  const worldIndex = {
    version: FORMAT_VERSION,
    grid: { w0: W0, h0: H0, maxLod: MAX_LOD, chunkSize: CHUNK_SIZE },
    globalBaseLod: GLOBAL_BASE_LOD,
    projection: "equal-earth",
    detailRegions: [
      {
        id: DETAIL_REGION.id,
        minLod: 0,
        lod0Rect: { x: rx0, y: ry0, width: rw, height: rh },
        gameMap: "WorldWindow",
      },
    ],
    lods: indexLods,
  };
  fs.writeFileSync(
    path.join(outDir, "world-index.json"),
    JSON.stringify(worldIndex),
  );

  // --- Playable window map -------------------------------------------------
  log("emitting playable window map (OpenFront format)…");
  emitWindowMap({ width: rw, height: rh, data: detail.data }, rx0, ry0);

  // --- Diagnostics ----------------------------------------------------------
  writeDiag("world-lod5", lods.get(5)!);
  writeDiag("tasmania-bassstrait", cropView(base, GLOBAL_BASE_LOD, 141, -36, 151, -45));
  writeDiag("italy-mediterranean", cropView(base, GLOBAL_BASE_LOD, 5, 48, 20, 35));
  writeDiag("britain-channel", cropView(base, GLOBAL_BASE_LOD, -11, 61, 3, 49));
  writeDiag("japan", cropView(base, GLOBAL_BASE_LOD, 128, 46, 146, 30));
  writeDiag("indonesia-malacca", cropView(base, GLOBAL_BASE_LOD, 94, 8, 120, -9));
  writeDiag("panama", cropView(base, GLOBAL_BASE_LOD, -84, 11, -76, 6));
  writeDiag("bosporus", cropView(base, GLOBAL_BASE_LOD, 25, 42.5, 30.5, 39.5));
  writeDiag("bering-dateline", cropView(base, GLOBAL_BASE_LOD, -180, 68, -160, 60));
  writeDiag("dateline-west", cropView(base, GLOBAL_BASE_LOD, 170, 68, 180, 60));

  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
