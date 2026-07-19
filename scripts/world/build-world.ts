/**
 * World map build pipeline.
 *
 * Converts Natural Earth 10m vector data (public domain) into the game's
 * streamed world: an Equal Earth–projected, chunked, multi-LOD terrain
 * pyramid with LOD0/LOD1 detail across all of Oceania, plus the playable
 * one-world Oceania map (all of Oceania as ONE map at ~1.2 km/tile)
 * emitted in the standard OpenFront map format.
 *
 * Run:  npx tsx scripts/world/build-world.ts
 * Requires the datasets in map-generator/world-data/ (see docs/GEOGRAPHIC_DATA.md).
 *
 * Outputs:
 *   resources/world/world-index.json      chunk index + grid config
 *   resources/world/world-l{k}.pack       concatenated gzipped chunks per LOD
 *   resources/maps/<window-id>/           OpenFront-format playable windows
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
import {
  buildWorldElevation,
  landMagnitudeFromElevation,
  waterMagnitudeFromDepth,
  WorldElevation,
} from "./elevation";
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
const flagsDir = path.join(repoRoot, "resources", "flags");

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
  { name: "Cook Strait", from: [174.35, -41.55], to: [174.7, -41.25] },
  { name: "Torres Strait", from: [141.8, -10.05], to: [143.4, -9.9] },
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
  { name: "New Guinea", lon: 143.0, lat: -5.5 },
  { name: "New Britain", lon: 151.0, lat: -5.5 },
  { name: "New Caledonia", lon: 165.4, lat: -21.6 },
  { name: "Viti Levu (Fiji)", lon: 178.0, lat: -17.8 },
  { name: "Espiritu Santo (Vanuatu)", lon: 166.9, lat: -15.4 },
  { name: "Guadalcanal", lon: 160.0, lat: -9.6 },
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
  { name: "Cook Strait", lon: 174.5, lat: -41.4, ocean: true },
  { name: "Torres Strait", lon: 142.6, lat: -9.95, ocean: true },
  { name: "Coral Sea", lon: 152.0, lat: -18.0, ocean: true },
  { name: "Tasman Sea", lon: 160.0, lat: -38.0, ocean: true },
  { name: "Caspian Sea", lon: 50.5, lat: 42.0, ocean: false },
  { name: "Lake Superior", lon: -87.5, lat: 47.6, ocean: false },
];

/**
 * High-detail region generated at LOD0/LOD1: all of Oceania (Western
 * Australia through New Zealand/Fiji, Tasmania up to Micronesia). Everywhere
 * inside this box the world has full ~0.61 km cells; Stage 3 extends the
 * same treatment worldwide.
 */
const DETAIL_REGION = {
  id: "oceania",
  lonMin: 110,
  lonMax: 180,
  latMin: -48.5,
  latMax: 8,
};

/**
 * Playable windows: OpenFront-format maps cut from the detail region's grid.
 * One window = one continuous match. `lod` is the resolution the game map is
 * emitted at: a game tile covers 2^lod LOD-0 world cells (lod 1 ⇒ ~1.2 km
 * tiles). The whole of Oceania is ONE map — a single world, a single
 * territorial state — at the highest resolution that measurably runs
 * lag-free (a LOD-0 Oceania map would be 235M tiles, ~28× the engine's
 * proven ceiling; see docs/WORLD_PERFORMANCE.md for the measurements).
 * `id` must equal the GameMapType key lowercased (the map loader derives
 * the resources/maps/<id>/ directory from the key). `gameMap` is the
 * GameMapType key recorded in world-index.json.
 */
const WINDOWS: Array<{
  id: string;
  gameMap: string;
  lod: number;
  maxNations: number;
  /** Per-country ceiling so one country can't fill every nation slot. */
  maxNationsPerCountry: number;
  /** ISO a2 codes eligible for named nations (other land stays wilderness). */
  nationIsos?: string[];
  /** City names always included as nations when present (geo anchors). */
  pinnedNations?: string[];
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}> = [
  {
    id: "worldoceania",
    gameMap: "WorldOceania",
    lod: 1,
    maxNations: 24,
    maxNationsPerCountry: 12,
    // The bounding box necessarily includes maritime Southeast Asia (Java,
    // Borneo, the southern Philippines) — that land is playable wilderness,
    // but the named AI nations are Oceania's.
    nationIsos: ["au", "nz", "pg", "fj", "sb", "vu", "nc"],
    pinnedNations: ["Darwin", "Hobart", "Wellington", "Port Moresby", "Suva"],
    lonMin: DETAIL_REGION.lonMin,
    lonMax: DETAIL_REGION.lonMax,
    latMin: DETAIL_REGION.latMin,
    latMax: DETAIL_REGION.latMax,
  },
  // Regional theatres — smaller matches at maximum detail, cut from the
  // same grid and living in the same continuous world.
  {
    id: "bassstrait",
    gameMap: "BassStrait",
    lod: 0, // ~0.61 km/tile — the drilled-down theatre
    maxNations: 10,
    maxNationsPerCountry: 10,
    nationIsos: ["au"],
    pinnedNations: ["Hobart", "Launceston", "Melbourne", "Geelong"],
    lonMin: 142.4,
    lonMax: 150.6,
    latMin: -44.8,
    latMax: -36.6,
  },
  {
    id: "newzealand",
    gameMap: "NewZealand",
    lod: 1, // whole country in one map (~1.2 km/tile)
    maxNations: 12,
    maxNationsPerCountry: 12,
    nationIsos: ["nz"],
    pinnedNations: ["Auckland", "Wellington", "Christchurch", "Dunedin"],
    lonMin: 165.5,
    lonMax: 179.4,
    latMin: -47.6,
    latMax: -33.8,
  },
  {
    id: "torresstrait",
    gameMap: "TorresStrait",
    lod: 0,
    maxNations: 10,
    maxNationsPerCountry: 10,
    nationIsos: ["au", "pg", "id"],
    pinnedNations: ["Port Moresby", "Merauke"],
    lonMin: 140.0,
    lonMax: 150.8,
    latMin: -12.6,
    latMax: -2.6,
  },
  {
    id: "eastaustralia",
    gameMap: "EastAustralia",
    lod: 0,
    maxNations: 10,
    maxNationsPerCountry: 10,
    nationIsos: ["au"],
    pinnedNations: ["Sydney", "Brisbane", "Canberra"],
    lonMin: 147.8,
    lonMax: 154.4,
    latMin: -35.8,
    latMax: -24.4,
  },
];

/** Ocean flood seed (single seed proves world-ocean connectivity). */
const OCEAN_SEED: [number, number] = [-30, 0]; // mid-Atlantic

/**
 * Rivers are painted as navigable ESTUARIES only: the lower reaches nearest
 * the sea become a 2-cell-wide water channel connected to the ocean (so
 * ships can sail upriver), and everything upstream stays plain land — rivers
 * never obstruct land expansion and never draw thin broken water lines
 * across the interior. Selected from Natural Earth 10m rivers by scalerank,
 * plus a few hand-added lines (e.g. the Yarra into Melbourne).
 */
const RIVER_MAX_SCALERANK = 5;
/** Paint at most this many km of river inland from its mouth. */
const RIVER_ESTUARY_KM = 75;

/**
 * Real resource deposits on their actual locations (approximate mine/field
 * coordinates). Owning the site in-game grants an economy bonus; sites are
 * emitted into each window's manifest (snapped to land).
 */
const RESOURCE_SITES: Array<{
  name: string;
  type: string;
  lon: number;
  lat: number;
}> = [
  { name: "Pilbara Iron", type: "iron", lon: 119.7, lat: -23.4 },
  { name: "Middleback Iron", type: "iron", lon: 137.1, lat: -33.0 },
  { name: "Kalgoorlie Gold", type: "gold", lon: 121.47, lat: -30.75 },
  { name: "Bendigo Gold", type: "gold", lon: 144.28, lat: -36.76 },
  { name: "Porgera Gold", type: "gold", lon: 143.13, lat: -5.47 },
  { name: "Lihir Gold", type: "gold", lon: 152.64, lat: -3.12 },
  { name: "Waihi Gold", type: "gold", lon: 175.84, lat: -37.39 },
  { name: "Vatukoula Gold", type: "gold", lon: 177.85, lat: -17.5 },
  { name: "Hunter Valley Coal", type: "coal", lon: 151.05, lat: -32.57 },
  { name: "Bowen Basin Coal", type: "coal", lon: 148.2, lat: -22.5 },
  { name: "Collie Coal", type: "coal", lon: 116.15, lat: -33.36 },
  { name: "North West Shelf Gas", type: "gas", lon: 116.85, lat: -20.74 },
  { name: "Gippsland Gas", type: "gas", lon: 147.1, lat: -38.24 },
  { name: "Moomba Gas", type: "gas", lon: 140.2, lat: -28.1 },
  { name: "Timor Sea Oil", type: "oil", lon: 130.85, lat: -12.47 },
  { name: "Taranaki Oil", type: "oil", lon: 174.08, lat: -39.06 },
  { name: "Olympic Dam Copper", type: "copper", lon: 136.89, lat: -30.44 },
  { name: "Mount Isa Copper", type: "copper", lon: 139.49, lat: -20.73 },
  { name: "Ok Tedi Copper", type: "copper", lon: 141.14, lat: -5.22 },
  { name: "Grasberg Copper", type: "copper", lon: 137.11, lat: -4.06 },
  { name: "Weipa Bauxite", type: "bauxite", lon: 141.87, lat: -12.68 },
  { name: "Gove Bauxite", type: "bauxite", lon: 136.82, lat: -12.27 },
  { name: "Broken Hill Silver", type: "silver", lon: 141.47, lat: -31.96 },
  { name: "Cadia Gold", type: "gold", lon: 148.99, lat: -33.46 },
];

/**
 * Strategic strait chokepoints: holding the shores in-game yields a naval
 * toll. Emitted into window manifests (centre + control radius).
 */
const CHOKEPOINT_SITES: Array<{
  name: string;
  lon: number;
  lat: number;
  radiusKm: number;
}> = [
  { name: "Bass Strait", lon: 145.8, lat: -39.8, radiusKm: 140 },
  { name: "Cook Strait", lon: 174.5, lat: -41.4, radiusKm: 80 },
  { name: "Torres Strait", lon: 142.6, lat: -9.95, radiusKm: 100 },
  { name: "Lombok Strait", lon: 115.7, lat: -8.7, radiusKm: 80 },
  { name: "Makassar Strait", lon: 117.5, lat: -2.0, radiusKm: 140 },
  { name: "Vitiaz Strait", lon: 147.8, lat: -5.9, radiusKm: 80 },
  { name: "Foveaux Strait", lon: 168.2, lat: -46.7, radiusKm: 70 },
];

/** Monsoon belt: wet-season slowdown applies north (equatorward) of this. */
const MONSOON_SOUTH_LAT = -20;

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

/** Real-elevation magnitude sampler for a grid at `lodAbs` whose local
 * (0,0) sits at `originX/originY` in lodAbs cells. Undefined when the DEM
 * dataset is absent (callers fall back to distance-based magnitude). */
let worldElev: WorldElevation | null = null;
function elevSamplerFor(
  lodAbs: number,
  originX = 0,
  originY = 0,
):
  | ((x: number, y: number) => { landMag: number; waterMag: number })
  | undefined {
  const e = worldElev;
  if (!e) return undefined;
  return (x: number, y: number) => {
    const m = e.at(lodAbs, originX + x, originY + y);
    return {
      landMag: landMagnitudeFromElevation(m),
      waterMag: waterMagnitudeFromDepth(m),
    };
  };
}

function finishTerrain(g: TerrainGrid, lod: number): void {
  const [sx, sy] = geoToCell(OCEAN_SEED[0], OCEAN_SEED[1], lod);
  floodOcean(g, [[sx, sy]]);
  computeShoreAndMagnitude(g, cellKmAt(lod), elevSamplerFor(lod));
}

/** River polylines (lon/lat vertex lists) selected for gameplay painting. */
let riverLines: Array<Array<[number, number]>> = [];

/**
 * Hand-added rivers missing from the Natural Earth selection, ordered
 * source → mouth. The Yarra connects Melbourne to Port Phillip Bay.
 */
const EXTRA_RIVER_LINES: Array<Array<[number, number]>> = [
  [
    [145.12, -37.73], // upper Yarra (Templestowe bend)
    [145.05, -37.76],
    [144.99, -37.8],
    [144.96, -37.818], // Melbourne CBD
    [144.94, -37.83],
    [144.92, -37.845],
    [144.91, -37.86], // Hobsons Bay mouth
  ],
];

function loadRivers(): void {
  const rivers = loadGeojson("ne_10m_rivers_lake_centerlines.geojson");
  riverLines = [];
  for (const f of rivers.features) {
    const rank = Number(f.properties?.scalerank ?? 99);
    if (rank > RIVER_MAX_SCALERANK) continue;
    const geom = f.geometry;
    const lines =
      geom.type === "LineString"
        ? [geom.coordinates as Array<[number, number]>]
        : geom.type === "MultiLineString"
          ? (geom.coordinates as Array<Array<[number, number]>>)
          : [];
    for (const line of lines) {
      // Keep only lines that touch the detail region (cheap bbox test).
      const touches = line.some(
        ([lon, lat]) =>
          lon >= DETAIL_REGION.lonMin &&
          lon <= DETAIL_REGION.lonMax &&
          lat >= DETAIL_REGION.latMin &&
          lat <= DETAIL_REGION.latMax,
      );
      if (touches) riverLines.push(line);
    }
  }
  riverLines.push(...EXTRA_RIVER_LINES);
  log(`rivers: ${riverLines.length} major river lines in region`);
}

/**
 * Paint each river's ESTUARY: starting from the mouth (the end of the line
 * that reaches existing water), walk inland up to RIVER_ESTUARY_KM painting
 * a 2-cell-wide water channel. The channel touches the sea, so the ocean
 * flood makes it navigable; everything further upstream is left as land and
 * never obstructs expansion. Must run on raw land grids BEFORE ocean flood
 * / shore / magnitude.
 */
function paintRivers(
  g: TerrainGrid,
  lodAbs: number,
  originX: number,
  originY: number,
): void {
  const proj = projectorForLod(lodAbs);
  const maxCells = Math.max(4, Math.round(RIVER_ESTUARY_KM / cellKmAt(lodAbs)));
  const isWaterAt = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= g.width || y >= g.height) return false;
    return !isLand(g.data[y * g.width + x]);
  };
  // The mouth end sits in (or within a few cells of) pre-existing water.
  const nearWater = (x: number, y: number): boolean => {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (isWaterAt(x + dx, y + dy)) return true;
      }
    }
    return false;
  };
  for (const line of riverLines) {
    if (line.length < 2) continue;
    const cells = line.map(([lon, lat]) => {
      const p = proj(lon, lat);
      return [Math.round(p.x) - originX, Math.round(p.y) - originY] as const;
    });
    const first = cells[0];
    const last = cells[cells.length - 1];
    // Natural Earth digitizes source → mouth; verify against the grid and
    // flip when the data disagrees. Skip rivers whose mouth isn't in this
    // window (nothing to connect, nothing to obstruct).
    let ordered: Array<readonly [number, number]> = cells;
    if (nearWater(last[0], last[1])) {
      ordered = [...cells].reverse();
    } else if (!nearWater(first[0], first[1])) {
      continue;
    }
    // Bridge the mouth vertex to the actual water cell so the channel is
    // guaranteed to touch the sea (rasterization can leave a 1–3 cell gap).
    const m0 = ordered[0];
    if (!isWaterAt(m0[0], m0[1])) {
      let bridge: [number, number] | null = null;
      for (let r = 1; r <= 3 && bridge === null; r++) {
        for (let dy = -r; dy <= r && bridge === null; dy++) {
          for (let dx = -r; dx <= r && bridge === null; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (isWaterAt(m0[0] + dx, m0[1] + dy)) {
              bridge = [m0[0] + dx, m0[1] + dy];
            }
          }
        }
      }
      if (bridge !== null) ordered = [bridge, ...ordered];
    }
    let painted = 0;
    let prev: readonly [number, number] | null = null;
    outer: for (const [cx, cy] of ordered) {
      if (prev) {
        const steps = Math.max(
          Math.abs(cx - prev[0]),
          Math.abs(cy - prev[1]),
          1,
        );
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const x = Math.round(prev[0] + (cx - prev[0]) * t);
          const y = Math.round(prev[1] + (cy - prev[1]) * t);
          // 2-cell-wide channel so the estuary is boat-navigable.
          for (const [ox, oy] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ]) {
            const px = x + ox;
            const py = y + oy;
            if (px < 0 || py < 0 || px >= g.width || py >= g.height) continue;
            g.data[py * g.width + px] = 0; // water
          }
          if (++painted >= maxCells) break outer;
        }
      }
      prev = [cx, cy];
    }
  }
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
      c = shore
        ? PALETTE.shoreLand
        : mag > 12
          ? PALETTE.highland
          : PALETTE.land;
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
  // Use all four corners: Equal Earth is pseudocylindrical, so x depends on
  // latitude too — two opposite corners can nearly coincide in x.
  const corners = [
    geoToCell(lonMin, latMax, lod),
    geoToCell(lonMax, latMax, lod),
    geoToCell(lonMin, latMin, lod),
    geoToCell(lonMax, latMin, lod),
  ];
  const x0 = Math.min(...corners.map((c) => c[0]));
  const y0 = Math.min(...corners.map((c) => c[1]));
  const w = Math.max(1, Math.max(...corners.map((c) => c[0])) - x0);
  const h = Math.max(1, Math.max(...corners.map((c) => c[1])) - y0);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    out.set(
      g.data.subarray((y0 + y) * g.width + x0, (y0 + y) * g.width + x0 + w),
      y * w,
    );
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

/** Cut a sub-rectangle out of a terrain grid (cell coordinates). */
function sliceGrid(
  g: TerrainGrid,
  x0: number,
  y0: number,
  w: number,
  h: number,
): TerrainGrid {
  if (x0 < 0 || y0 < 0 || x0 + w > g.width || y0 + h > g.height) {
    throw new Error(
      `slice ${x0},${y0} ${w}x${h} outside ${g.width}x${g.height}`,
    );
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    out.set(
      g.data.subarray((y0 + y) * g.width + x0, (y0 + y) * g.width + x0 + w),
      y * w,
    );
  }
  return { width: w, height: h, data: out };
}

function emitWindowMap(
  win: (typeof WINDOWS)[number],
  detail: TerrainGrid,
  originLod0X: number,
  originLod0Y: number,
): void {
  const windowMapDir = path.join(repoRoot, "resources", "maps", win.id);
  fs.mkdirSync(windowMapDir, { recursive: true });

  const countLand = (g: TerrainGrid) => {
    let n = 0;
    for (let i = 0; i < g.data.length; i++) if (isLand(g.data[i])) n++;
    return n;
  };

  // Mini maps: engine's map4x halves each axis; map16x quarters each axis.
  const toFinished = (land: TerrainGrid, lod: number): TerrainGrid => {
    const g = {
      width: land.width,
      height: land.height,
      data: land.data.slice(),
    };
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
      if (
        (globalBase.data[wy * globalBase.width + wx] & TERRAIN_OCEAN_BIT) !==
        0
      ) {
        seeds.push([x, y]);
      }
    }
    floodOcean(g, seeds);
    computeShoreAndMagnitude(
      g,
      cellKmAt(lod),
      elevSamplerFor(lod, originLod0X >> lod, originLod0Y >> lod),
    );
    return g;
  };

  // The game map is emitted at win.lod (one tile = 2^lod LOD-0 cells);
  // map4x/map16x are the engine's half/quarter-per-axis mini variants.
  let base = detail;
  for (let k = 0; k < win.lod; k++) base = downsampleLand(base);
  paintRivers(base, win.lod, originLod0X >> win.lod, originLod0Y >> win.lod);
  const full = toFinished(base, win.lod);
  const half = toFinished(downsampleLand(base), win.lod + 1);
  const quarter = toFinished(downsampleLand(downsampleLand(base)), win.lod + 2);

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
      iso: String(f.properties?.iso_a2 ?? "").toLowerCase(),
    }))
    .filter(
      (p) =>
        p.name &&
        p.lon >= win.lonMin &&
        p.lon <= win.lonMax &&
        p.lat >= win.latMin &&
        p.lat <= win.latMax &&
        (!win.nationIsos || win.nationIsos.includes(p.iso)),
    )
    .sort((a, b) => b.pop - a.pop);

  const usedNames = new Set<string>();
  const perCountry = new Map<string, number>();
  const addNation = (c: (typeof candidates)[number]): void => {
    if (nations.length >= win.maxNations || usedNames.has(c.name)) return;
    if ((perCountry.get(c.iso) ?? 0) >= win.maxNationsPerCountry) return;
    const w = grid.geoToWorld(c.lon, c.lat);
    let x = (Math.floor(w.x) - originLod0X) >> win.lod;
    let y = (Math.floor(w.y) - originLod0Y) >> win.lod;
    // Snap to nearest land cell within a small radius (coastal cities can
    // project a cell or two into water).
    const snapped = snapToLand(full, x, y, 20);
    if (!snapped) return;
    [x, y] = snapped;
    // Country flag from the place's ISO code when the asset exists.
    const flag =
      /^[a-z]{2}$/.test(c.iso) &&
      fs.existsSync(path.join(flagsDir, `${c.iso}.svg`))
        ? c.iso
        : "au";
    usedNames.add(c.name);
    perCountry.set(c.iso, (perCountry.get(c.iso) ?? 0) + 1);
    nations.push({ coordinates: [x, y], flag, name: c.name });
  };

  // Pinned geographic anchors first, then each country's largest city, then
  // fill remaining slots by population.
  for (const pin of win.pinnedNations ?? []) {
    const c = candidates.find((p) => p.name === pin);
    if (c) addNation(c);
  }
  const seenCountry = new Set<string>();
  for (const c of candidates) {
    if (!seenCountry.has(c.iso)) {
      seenCountry.add(c.iso);
      addNation(c);
    }
  }
  for (const c of candidates) addNation(c);
  log(
    `window ${win.id} nations: ${nations.map((n) => n.name).join(", ") || "(none found)"}`,
  );

  // Real resource sites inside this window, snapped to land.
  const resources: Array<{
    name: string;
    type: string;
    x: number;
    y: number;
  }> = [];
  for (const site of RESOURCE_SITES) {
    if (
      site.lon < win.lonMin ||
      site.lon > win.lonMax ||
      site.lat < win.latMin ||
      site.lat > win.latMax
    ) {
      continue;
    }
    const w = grid.geoToWorld(site.lon, site.lat);
    const x = (Math.floor(w.x) - originLod0X) >> win.lod;
    const y = (Math.floor(w.y) - originLod0Y) >> win.lod;
    // Offshore fields snap to their coastal terminal.
    const snapped = snapToLand(full, x, y, 40);
    if (!snapped) continue;
    resources.push({
      name: site.name,
      type: site.type,
      x: snapped[0],
      y: snapped[1],
    });
  }

  // Strait chokepoints inside this window (centre stays in water; the game
  // checks shore ownership within the radius).
  const chokepoints: Array<{
    name: string;
    x: number;
    y: number;
    radius: number;
  }> = [];
  for (const cp of CHOKEPOINT_SITES) {
    if (
      cp.lon < win.lonMin ||
      cp.lon > win.lonMax ||
      cp.lat < win.latMin ||
      cp.lat > win.latMax
    ) {
      continue;
    }
    const w = grid.geoToWorld(cp.lon, cp.lat);
    chokepoints.push({
      name: cp.name,
      x: (Math.floor(w.x) - originLod0X) >> win.lod,
      y: (Math.floor(w.y) - originLod0Y) >> win.lod,
      radius: Math.max(4, Math.round(cp.radiusKm / cellKmAt(win.lod))),
    });
  }

  // Monsoon belt: rows north (equatorward) of MONSOON_SOUTH_LAT.
  const monsoonW = grid.geoToWorld(
    (win.lonMin + win.lonMax) / 2,
    MONSOON_SOUTH_LAT,
  );
  const climate = {
    monsoonMaxY: Math.max(
      0,
      Math.min(
        full.height,
        Math.round((monsoonW.y - originLod0Y) / (1 << win.lod)),
      ),
    ),
  };

  const manifest = {
    name: win.gameMap,
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
    resources,
    chokepoints,
    climate,
  };
  fs.writeFileSync(
    path.join(windowMapDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeDiag(`window-${win.id}`, full);
  log(
    `window map ${win.id}: ${full.width}x${full.height}, ${manifest.map.num_land_tiles} land tiles`,
  );
}

function snapToLand(
  g: TerrainGrid,
  x: number,
  y: number,
  radius: number,
): [number, number] | null {
  if (
    x >= 0 &&
    y >= 0 &&
    x < g.width &&
    y < g.height &&
    isLand(g.data[y * g.width + x])
  ) {
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
  loadRivers();
  log("building world elevation raster from ETOPO1…");
  worldElev = buildWorldElevation(
    grid,
    GLOBAL_BASE_LOD,
    path.join(dataDir, "etopo1_ice_g_i2.bin"),
  );
  log(
    worldElev
      ? "elevation: real DEM magnitude enabled (ETOPO1)"
      : "elevation: ETOPO1 missing — falling back to distance-to-coast magnitude",
  );
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
  const straitProbes: Array<{
    name: string;
    a: [number, number];
    b: [number, number];
  }> = [
    { name: "Gibraltar", a: [-6.5, 35.9], b: [-4.5, 36.2] },
    { name: "Bosporus chain", a: [28.0, 43.0], b: [25.0, 39.0] },
    { name: "Øresund/Belts", a: [11.0, 56.5], b: [19.0, 58.0] },
    { name: "Bering", a: [-171.0, 64.0], b: [-168.0, 67.5] },
    { name: "Cook Strait", a: [172.0, -40.5], b: [175.6, -41.6] },
    { name: "Torres Strait", a: [139.5, -10.5], b: [144.5, -11.5] },
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
    throw new Error(
      `world build validation failed (${failures.length} issues)`,
    );
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
  // Snap rects to 1024 LOD-0 cells so chunk grids align at LOD0/1/2.
  const snapRect = (b: {
    lonMin: number;
    lonMax: number;
    latMin: number;
    latMax: number;
  }) => {
    const corners = [
      grid.geoToWorld(b.lonMin, b.latMax),
      grid.geoToWorld(b.lonMax, b.latMax),
      grid.geoToWorld(b.lonMin, b.latMin),
      grid.geoToWorld(b.lonMax, b.latMin),
    ];
    const ALIGN = 1024;
    const x0 = Math.floor(Math.min(...corners.map((c) => c.x)) / ALIGN) * ALIGN;
    const y0 = Math.floor(Math.min(...corners.map((c) => c.y)) / ALIGN) * ALIGN;
    const x1 = Math.ceil(Math.max(...corners.map((c) => c.x)) / ALIGN) * ALIGN;
    const y1 = Math.ceil(Math.max(...corners.map((c) => c.y)) / ALIGN) * ALIGN;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };
  const regionRect = snapRect(DETAIL_REGION);
  const rx0 = regionRect.x;
  const ry0 = regionRect.y;
  const rw = regionRect.width;
  const rh = regionRect.height;
  log(
    `detail region ${DETAIL_REGION.id}: LOD0 rect ${rw}x${rh} at (${rx0},${ry0})`,
  );

  const detail: Grid = { width: rw, height: rh, data: new Uint8Array(rw * rh) };
  const proj0 = projectorForLod(0);
  const projRegion = (lon: number, lat: number) => {
    const p = proj0(lon, lat);
    return { x: p.x - rx0, y: p.y - ry0 };
  };
  log("rasterizing detail region at LOD0…");
  rasterizeFeatures(detail, land.features, projRegion, TERRAIN_LAND_BIT);
  rasterizeFeatures(
    detail,
    minorIslands.features,
    projRegion,
    TERRAIN_LAND_BIT,
  );
  rasterizeFeatures(detail, lakes.features, projRegion, 0);
  paintRivers(detail, 0, rx0, ry0);

  // Finished detail terrain for the world layer (ocean seeded from region
  // border cells that are ocean at the global base).
  const detailFinished: TerrainGrid = {
    width: rw,
    height: rh,
    data: detail.data.slice(),
  };
  {
    const seeds: Array<[number, number]> = [];
    const pushIfOcean = (x: number, y: number) => {
      if (isLand(detailFinished.data[y * rw + x])) return;
      const wx = (rx0 + x) >> GLOBAL_BASE_LOD;
      const wy = (ry0 + y) >> GLOBAL_BASE_LOD;
      if ((base.data[wy * base.width + wx] & TERRAIN_OCEAN_BIT) !== 0)
        seeds.push([x, y]);
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
    computeShoreAndMagnitude(
      detailFinished,
      cellKmAt(0),
      elevSamplerFor(0, rx0, ry0),
    );
  }

  const detail1Land = downsampleLand({
    width: rw,
    height: rh,
    data: detail.data,
  });
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
        const wx = (((rx0 >> 1) + x) << 1) >> GLOBAL_BASE_LOD;
        const wy = (((ry0 >> 1) + y) << 1) >> GLOBAL_BASE_LOD;
        if ((base.data[wy * base.width + wx] & TERRAIN_OCEAN_BIT) !== 0)
          seeds.push([x, y]);
      }
    }
    for (let y = 0; y < detail1.height; y++) {
      for (const x of [0, detail1.width - 1]) {
        if (isLand(detail1.data[y * detail1.width + x])) continue;
        const wx = (((rx0 >> 1) + x) << 1) >> GLOBAL_BASE_LOD;
        const wy = (((ry0 >> 1) + y) << 1) >> GLOBAL_BASE_LOD;
        if ((base.data[wy * base.width + wx] & TERRAIN_OCEAN_BIT) !== 0)
          seeds.push([x, y]);
      }
    }
    floodOcean(detail1, seeds);
    computeShoreAndMagnitude(
      detail1,
      cellKmAt(1),
      elevSamplerFor(1, rx0 >> 1, ry0 >> 1),
    );
  }

  // --- Pack chunks ---------------------------------------------------------
  log("packing chunks…");
  const indexLods: Record<string, PackedLod> = {};
  for (let k = GLOBAL_BASE_LOD; k <= MAX_LOD; k++) {
    const g = lods.get(k)!;
    const { file, index } = packLod(g, k);
    fs.writeFileSync(path.join(outDir, index.pack), file);
    indexLods[String(k)] = index;
    log(
      `LOD${k}: ${Object.keys(index.chunks).length} chunks, ${(file.length / 1024).toFixed(0)} KiB`,
    );
  }
  {
    const { file, index } = packLod(detailFinished, 0, undefined, rx0, ry0);
    fs.writeFileSync(path.join(outDir, index.pack), file);
    indexLods["0"] = index;
    log(
      `LOD0 (detail): ${Object.keys(index.chunks).length} chunks, ${(file.length / 1024).toFixed(0)} KiB`,
    );
  }
  {
    const { file, index } = packLod(detail1, 1, undefined, rx0 >> 1, ry0 >> 1);
    fs.writeFileSync(path.join(outDir, index.pack), file);
    indexLods["1"] = index;
    log(
      `LOD1 (detail): ${Object.keys(index.chunks).length} chunks, ${(file.length / 1024).toFixed(0)} KiB`,
    );
  }

  // --- Playable window maps ------------------------------------------------
  const windowRefs: Array<{
    id: string;
    gameMap: string;
    lod: number;
    lod0Rect: { x: number; y: number; width: number; height: number };
  }> = [];
  for (const win of WINDOWS) {
    const r = snapRect(win);
    log(
      `emitting window ${win.id}: ${r.width >> win.lod}x${r.height >> win.lod} game tiles at LOD${win.lod} (LOD0 rect ${r.width}x${r.height} at ${r.x},${r.y})…`,
    );
    const slice = sliceGrid(
      { width: rw, height: rh, data: detail.data },
      r.x - rx0,
      r.y - ry0,
      r.width,
      r.height,
    );
    emitWindowMap(win, slice, r.x, r.y);
    windowRefs.push({
      id: win.id,
      gameMap: win.gameMap,
      lod: win.lod,
      lod0Rect: r,
    });
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
      },
    ],
    windows: windowRefs,
    lods: indexLods,
  };
  fs.writeFileSync(
    path.join(outDir, "world-index.json"),
    JSON.stringify(worldIndex),
  );

  // --- Diagnostics ----------------------------------------------------------
  writeDiag("world-lod5", lods.get(5)!);
  writeDiag(
    "tasmania-bassstrait",
    cropView(base, GLOBAL_BASE_LOD, 141, -36, 151, -45),
  );
  writeDiag(
    "italy-mediterranean",
    cropView(base, GLOBAL_BASE_LOD, 5, 48, 20, 35),
  );
  writeDiag("britain-channel", cropView(base, GLOBAL_BASE_LOD, -11, 61, 3, 49));
  writeDiag("japan", cropView(base, GLOBAL_BASE_LOD, 128, 46, 146, 30));
  writeDiag(
    "indonesia-malacca",
    cropView(base, GLOBAL_BASE_LOD, 94, 8, 120, -9),
  );
  writeDiag("panama", cropView(base, GLOBAL_BASE_LOD, -84, 11, -76, 6));
  writeDiag("bosporus", cropView(base, GLOBAL_BASE_LOD, 25, 42.5, 30.5, 39.5));
  writeDiag(
    "bering-dateline",
    cropView(base, GLOBAL_BASE_LOD, -180, 68, -160, 60),
  );
  writeDiag("dateline-west", cropView(base, GLOBAL_BASE_LOD, 170, 68, 180, 60));
  writeDiag(
    "newzealand",
    cropView(base, GLOBAL_BASE_LOD, 165, -33, 179.5, -48),
  );
  writeDiag(
    "newguinea-torres",
    cropView(base, GLOBAL_BASE_LOD, 139, -1, 152, -13),
  );

  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
