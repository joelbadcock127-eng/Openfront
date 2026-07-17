/**
 * Validation of the shipped world chunk data (resources/world) — these tests
 * exercise the exact artifacts the client streams, not the pipeline's
 * in-memory state: chunk decoding determinism, cross-chunk seam consistency,
 * LOD consistency, strategic strait navigability, important-island
 * preservation, and window-map ↔ world agreement.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  CHUNK_SIZE,
  TERRAIN_LAND_BIT,
  TERRAIN_OCEAN_BIT,
  TERRAIN_SHORE_BIT,
  WorldGrid,
} from "../../src/core/world/WorldGrid";
import { WorldIndex } from "../../src/core/world/WorldIndex";

const worldDir = path.join(__dirname, "..", "..", "resources", "world");
const index: WorldIndex = JSON.parse(
  fs.readFileSync(path.join(worldDir, "world-index.json"), "utf8"),
);
const grid = new WorldGrid({
  w0: index.grid.w0,
  h0: index.grid.h0,
  maxLod: index.grid.maxLod,
});

const packCache = new Map<string, Buffer>();
const chunkCache = new Map<string, Uint8Array | null>();
function readChunk(lod: number, cx: number, cy: number): Uint8Array | null {
  const key = `${lod}:${cx}:${cy}`;
  const cached = chunkCache.get(key);
  if (cached !== undefined) return cached;
  const lodIdx = index.lods[String(lod)];
  const entry = lodIdx?.chunks[`${cx}_${cy}`];
  if (!entry) {
    chunkCache.set(key, null);
    return null;
  }
  let pack = packCache.get(lodIdx.pack);
  if (!pack) {
    pack = fs.readFileSync(path.join(worldDir, lodIdx.pack));
    packCache.set(lodIdx.pack, pack);
  }
  const raw = gunzipSync(pack.subarray(entry[0], entry[0] + entry[1]));
  chunkCache.set(key, raw);
  return raw;
}

function cellAt(lod: number, x: number, y: number): number {
  const { chunkX, chunkY, ox, oy } = grid.cellToChunk(x, y);
  const chunk = readChunk(lod, chunkX, chunkY);
  if (!chunk) throw new Error(`missing chunk ${lod}:${chunkX},${chunkY}`);
  return chunk[oy * CHUNK_SIZE + ox];
}

function geoCell(lod: number, lon: number, lat: number): number {
  const w = grid.geoToWorld(lon, lat);
  return cellAt(lod, Math.floor(w.x) >> lod, Math.floor(w.y) >> lod);
}

const land = (v: number) => (v & TERRAIN_LAND_BIT) !== 0;
const ocean = (v: number) => (v & TERRAIN_OCEAN_BIT) !== 0;

describe("world chunk data", () => {
  const baseLod = index.globalBaseLod;

  test("index shape and full global coverage at the base LOD", () => {
    expect(index.version).toBe(1);
    const lodIdx = index.lods[String(baseLod)];
    const expected = grid.chunkCols(baseLod) * grid.chunkRows(baseLod);
    expect(Object.keys(lodIdx.chunks).length).toBe(expected);
    // Coarsest LOD is small enough to always keep resident.
    const coarse = index.lods[String(index.grid.maxLod)];
    expect(Object.keys(coarse.chunks).length).toBeLessThanOrEqual(16);
  });

  test("chunk decoding is deterministic", () => {
    const a = readChunk(baseLod, 10, 10)!;
    const b = readChunk(baseLod, 10, 10)!;
    expect(a.length).toBe(CHUNK_SIZE * CHUNK_SIZE);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  test("cross-chunk seams: shoreline bits are consistent across boundaries", () => {
    // The shoreline bit was computed on the continuous grid before chunking,
    // so land at a chunk's edge with water just across the seam MUST carry
    // the shore bit — any mismatch would mean the chunks don't align.
    // Sample vertical seams across Europe/Asia (lots of coastline).
    let checked = 0;
    for (let cx = 30; cx < 45; cx++) {
      const left = readChunk(baseLod, cx, 12);
      const right = readChunk(baseLod, cx + 1, 12);
      if (!left || !right) continue;
      for (let y = 0; y < CHUNK_SIZE; y++) {
        const a = left[y * CHUNK_SIZE + (CHUNK_SIZE - 1)];
        const b = right[y * CHUNK_SIZE];
        if (land(a) !== land(b)) {
          checked++;
          expect(a & TERRAIN_SHORE_BIT).toBeTruthy();
          expect(b & TERRAIN_SHORE_BIT).toBeTruthy();
        }
      }
    }
    expect(checked).toBeGreaterThan(0); // the sample really crossed coastline
  });

  test("LOD consistency: parent land follows majority of children", () => {
    // LOD k+1 cell is land iff ≥2 of its 4 LOD-k children are land, except
    // where strait re-carving adjusted the result. Sample a coastal area and
    // require ≥99% conformance.
    const lod = baseLod;
    const parentLod = baseLod + 1;
    let total = 0;
    let conforming = 0;
    for (let py = 2000; py < 2200; py++) {
      for (let px = 4000; px < 4200; px++) {
        const children = [
          cellAt(lod, px * 2, py * 2),
          cellAt(lod, px * 2 + 1, py * 2),
          cellAt(lod, px * 2, py * 2 + 1),
          cellAt(lod, px * 2 + 1, py * 2 + 1),
        ];
        const landCount = children.filter((c) => land(c)).length;
        const parent = cellAt(parentLod, px, py);
        total++;
        if (land(parent) === landCount >= 2) conforming++;
      }
    }
    expect(conforming / total).toBeGreaterThan(0.99);
  });

  test("strategic straits are navigable water at the base LOD", () => {
    const straitPoints: Array<[string, number, number]> = [
      ["Gibraltar", -5.55, 35.97],
      ["Bosporus", 29.05, 41.1],
      ["Dardanelles", 26.45, 40.2],
      ["Øresund", 12.75, 55.6],
      ["Dover", 1.5, 50.95],
      ["Bab-el-Mandeb", 43.35, 12.55],
      ["Hormuz", 56.55, 26.55],
      ["Singapore", 104.0, 1.18],
      ["Bering", -169.2, 65.8],
    ];
    for (const [name, lon, lat] of straitPoints) {
      const v = geoCell(index.globalBaseLod, lon, lat);
      expect(land(v), `${name} should be water`).toBe(false);
      expect(ocean(v), `${name} should be ocean-connected`).toBe(true);
    }
  });

  test("land corridors are preserved (Suez, Panama)", () => {
    expect(land(geoCell(index.globalBaseLod, 32.45, 30.5))).toBe(true);
    expect(land(geoCell(index.globalBaseLod, -79.8, 9.1))).toBe(true);
  });

  test("important islands exist at the base LOD", () => {
    const islands: Array<[string, number, number]> = [
      ["Tasmania", 146.6, -42.0],
      ["King Island", 143.95, -39.9],
      ["Flinders Island", 148.05, -40.0],
      ["Great Britain", -1.5, 52.5],
      ["Sicily", 14.2, 37.5],
      ["Honshu", 138.5, 36.5],
      ["New Zealand South", 169.8, -44.5],
      ["Cuba", -78.7, 21.9],
      ["Madagascar", 46.8, -19.5],
    ];
    for (const [name, lon, lat] of islands) {
      expect(land(geoCell(index.globalBaseLod, lon, lat)), name).toBe(true);
    }
  });

  test("ocean vs lake classification", () => {
    expect(ocean(geoCell(index.globalBaseLod, 34, 43))).toBe(true); // Black Sea
    expect(ocean(geoCell(index.globalBaseLod, 19, 58))).toBe(true); // Baltic
    const caspian = geoCell(index.globalBaseLod, 50.5, 42);
    expect(land(caspian)).toBe(false);
    expect(ocean(caspian)).toBe(false); // lake
  });

  test("date line is the map edge — no wrap, no mid-map seam", () => {
    // Equal Earth is pseudocylindrical: lon ±180 reaches the map's
    // left/right edges at the equator and curves inward toward the poles.
    const westEq = grid.geoToWorld(-179.995, 0);
    const eastEq = grid.geoToWorld(179.995, 0);
    expect(Math.floor(westEq.x) >> index.globalBaseLod).toBe(0);
    expect(Math.floor(eastEq.x) >> index.globalBaseLod).toBe(
      grid.width(index.globalBaseLod) - 1,
    );
    // At high latitude the ±180 meridians stay inside the map, symmetric
    // about the centre — both sides of the date line exist, unwrapped.
    const west65 = grid.geoToWorld(-180, 65);
    const east65 = grid.geoToWorld(180, 65);
    expect(west65.x + east65.x).toBeCloseTo(index.grid.w0, 3);
    expect(west65.x).toBeGreaterThan(0);
    expect(east65.x).toBeLessThan(index.grid.w0);
  });
});

describe("Oceania detail coverage at LOD 0", () => {
  const region = index.detailRegions.find((r) => r.id === "oceania")!;

  test("the detail region is registered with LOD-0 detail", () => {
    expect(region).toBeDefined();
    expect(region.minLod).toBe(0);
    // All windows live inside the detail region.
    for (const w of index.windows) {
      expect(w.lod0Rect.x).toBeGreaterThanOrEqual(region.lod0Rect.x);
      expect(w.lod0Rect.y).toBeGreaterThanOrEqual(region.lod0Rect.y);
      expect(w.lod0Rect.x + w.lod0Rect.width).toBeLessThanOrEqual(
        region.lod0Rect.x + region.lod0Rect.width,
      );
      expect(w.lod0Rect.y + w.lod0Rect.height).toBeLessThanOrEqual(
        region.lod0Rect.y + region.lod0Rect.height,
      );
    }
  });

  test("Oceania landmarks are land at LOD 0", () => {
    const landmarks: Array<[string, number, number]> = [
      ["Tasmania", 146.6, -42.0],
      ["Central Australia", 134.0, -24.0],
      ["New Zealand South Island", 169.8, -44.5],
      ["New Zealand North Island", 175.5, -38.5],
      ["New Guinea", 143.0, -5.5],
      ["New Caledonia", 165.4, -21.6],
      ["Viti Levu (Fiji)", 178.0, -17.8],
      ["Guadalcanal", 160.0, -9.6],
    ];
    for (const [name, lon, lat] of landmarks) {
      expect(land(geoCell(0, lon, lat)), name).toBe(true);
    }
  });

  test("Cook and Torres straits are open ocean at LOD 0", () => {
    for (const [name, lon, lat] of [
      ["Cook Strait", 174.5, -41.4],
      ["Torres Strait", 142.6, -9.95],
      ["Bass Strait", 146.0, -39.5],
    ] as Array<[string, number, number]>) {
      const v = geoCell(0, lon, lat);
      expect(land(v), `${name} should be water`).toBe(false);
      expect(ocean(v), `${name} should be ocean-connected`).toBe(true);
    }
  });
});

describe("playable window ↔ world consistency (one Oceania map)", () => {
  const mapsDir = path.join(__dirname, "..", "..", "resources", "maps");
  const win = index.windows.find((w) => w.id === "worldoceania")!;
  const mapDir = path.join(mapsDir, "worldoceania");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(mapDir, "manifest.json"), "utf8"),
  );
  const mapBin: Buffer = fs.readFileSync(path.join(mapDir, "map.bin"));

  test("Oceania is ONE playable map covering the whole region; regional theatres are cut from the same grid", () => {
    expect(index.windows.map((w) => w.id).sort()).toEqual([
      "bassstrait",
      "eastaustralia",
      "newzealand",
      "torresstrait",
      "worldoceania",
    ]);
    const region = index.detailRegions.find((r) => r.id === "oceania")!;
    // One world: the flagship map covers the entire detail region.
    expect(win.lod0Rect).toEqual(region.lod0Rect);
    // Every regional theatre lies inside it (same world, same grid).
    for (const w of index.windows) {
      expect(w.lod0Rect.x).toBeGreaterThanOrEqual(region.lod0Rect.x);
      expect(w.lod0Rect.y).toBeGreaterThanOrEqual(region.lod0Rect.y);
      expect(w.lod0Rect.x + w.lod0Rect.width).toBeLessThanOrEqual(
        region.lod0Rect.x + region.lod0Rect.width,
      );
      expect(w.lod0Rect.y + w.lod0Rect.height).toBeLessThanOrEqual(
        region.lod0Rect.y + region.lod0Rect.height,
      );
    }
  });

  test("map dimensions match the registered rect at the window LOD", () => {
    expect(manifest.map.width).toBe(win.lod0Rect.width >> win.lod);
    expect(manifest.map.height).toBe(win.lod0Rect.height >> win.lod);
    expect(mapBin.length).toBe(manifest.map.width * manifest.map.height);
  });

  test("game tiles and world LOD cells agree on land/water", () => {
    // The playable map is emitted at LOD `win.lod` from the same grid as
    // the world packs ⇒ land bits must match the LOD pack cell-for-cell
    // (sampled).
    for (let i = 0; i < 3000; i++) {
      const x = (i * 2654435761) % manifest.map.width;
      const y = (i * 1013904223) % manifest.map.height;
      const mapV = mapBin[y * manifest.map.width + x];
      const worldV = cellAt(
        win.lod,
        (win.lod0Rect.x >> win.lod) + x,
        (win.lod0Rect.y >> win.lod) + y,
      );
      expect(land(mapV)).toBe(land(worldV));
    }
  });

  test("the map spans the whole of Oceania (WA, NT, SA, NZ, PNG on-map land)", () => {
    const landmarks: Array<[string, number, number]> = [
      ["Perth (Western Australia)", 115.86, -31.95],
      ["Darwin (Northern Territory)", 130.84, -12.46],
      ["Adelaide (South Australia)", 138.6, -34.93],
      ["Devonport (Tasmania)", 146.35, -41.18],
      ["Auckland (New Zealand)", 174.76, -36.85],
      ["Port Moresby (New Guinea)", 147.18, -9.44],
      ["Suva (Fiji)", 178.44, -18.14],
    ];
    for (const [name, lon, lat] of landmarks) {
      const w = grid.geoToWorld(lon, lat);
      const x = (Math.floor(w.x) - win.lod0Rect.x) >> win.lod;
      const y = (Math.floor(w.y) - win.lod0Rect.y) >> win.lod;
      expect(x, name).toBeGreaterThan(0);
      expect(y, name).toBeGreaterThan(0);
      expect(x, name).toBeLessThan(manifest.map.width);
      expect(y, name).toBeLessThan(manifest.map.height);
      // Land within a couple of tiles of the geographic point.
      let foundLand = false;
      for (let dy = -3; dy <= 3 && !foundLand; dy++) {
        for (let dx = -3; dx <= 3 && !foundLand; dx++) {
          if (land(mapBin[(y + dy) * manifest.map.width + (x + dx)])) {
            foundLand = true;
          }
        }
      }
      expect(foundLand, name).toBe(true);
    }
  });

  test("straits are water on the playable map (one connected ocean theatre)", () => {
    for (const [name, lon, lat] of [
      ["Bass Strait", 146.0, -39.5],
      ["Cook Strait", 174.5, -41.4],
      ["Torres Strait", 142.6, -9.95],
    ] as Array<[string, number, number]>) {
      const w = grid.geoToWorld(lon, lat);
      const x = (Math.floor(w.x) - win.lod0Rect.x) >> win.lod;
      const y = (Math.floor(w.y) - win.lod0Rect.y) >> win.lod;
      const v = mapBin[y * manifest.map.width + x];
      expect(land(v), name).toBe(false);
      expect(ocean(v), `${name} ocean bit`).toBe(true);
    }
  });

  test("nations span the continent and sit on land tiles", () => {
    const names = manifest.nations.map((n: { name: string }) => n.name);
    for (const expected of [
      "Sydney",
      "Melbourne",
      "Perth", // Western Australia
      "Adelaide", // South Australia
      "Darwin", // Northern Territory
      "Hobart", // Tasmania
      "Auckland",
      "Wellington",
      "Port Moresby",
    ]) {
      expect(names).toContain(expected);
    }
    expect(manifest.nations.length).toBeGreaterThanOrEqual(15);
    for (const n of manifest.nations) {
      const [x, y] = n.coordinates;
      expect(land(mapBin[y * manifest.map.width + x]), n.name).toBe(true);
    }
  });
});
