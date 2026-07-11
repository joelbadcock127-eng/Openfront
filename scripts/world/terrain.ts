/**
 * Terrain post-processing for the world build pipeline: ocean flood fill,
 * shoreline marking, magnitude (distance-to-coast) and LOD downsampling.
 *
 * Input/output grids are 1 byte per cell using the engine's terrain layout
 * (src/core/game/GameMap.ts): bit 7 land, bit 6 shoreline, bit 5 ocean,
 * bits 0–4 magnitude. Land magnitude is capped at 30 because 31 marks
 * impassable terrain in the engine.
 */
import {
  TERRAIN_LAND_BIT,
  TERRAIN_OCEAN_BIT,
  TERRAIN_SHORE_BIT,
} from "../../src/core/world/WorldGrid";

export interface TerrainGrid {
  width: number;
  height: number;
  /** Terrain bytes (see layout above). */
  data: Uint8Array;
}

export function isLand(v: number): boolean {
  return (v & TERRAIN_LAND_BIT) !== 0;
}

/**
 * Flood-fill the ocean bit over all water reachable (4-neighbour) from the
 * seed cells. Unreached water remains lake (water, non-ocean).
 */
export function floodOcean(
  grid: TerrainGrid,
  seeds: Array<[number, number]>,
): void {
  const { width, height, data } = grid;
  let frontier: number[] = [];
  for (const [x, y] of seeds) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const i = y * width + x;
    if (isLand(data[i]) || (data[i] & TERRAIN_OCEAN_BIT) !== 0) continue;
    data[i] |= TERRAIN_OCEAN_BIT;
    frontier.push(i);
  }
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width;
      // 4-neighbourhood, matching engine adjacency.
      if (x > 0) visit(i - 1, next, data);
      if (x < width - 1) visit(i + 1, next, data);
      if (i >= width) visit(i - width, next, data);
      if (i < (height - 1) * width) visit(i + width, next, data);
    }
    frontier = next;
  }
}

function visit(i: number, next: number[], data: Uint8Array): void {
  const v = data[i];
  if (isLand(v) || (v & TERRAIN_OCEAN_BIT) !== 0) return;
  data[i] = v | TERRAIN_OCEAN_BIT;
  next.push(i);
}

/**
 * Mark shoreline bits and write magnitude from BFS distance to the coast.
 *
 * Water magnitude is the distance in cells (capped 31) — the renderer's
 * depth shading. Land magnitude maps distance-in-KILOMETRES to the engine's
 * terrain bands (plains < 10, highland 10–19, mountain 20+), so coastal
 * strips are plains, interiors rise to highland and only deep continental
 * interiors (Central Australia, Tibet, Antarctica…) read as mountains.
 * Using kilometres keeps the bands visually consistent across LODs, whose
 * cell sizes differ. Without elevation data this doubles as a gameplay
 * proxy: the engine slows attacks on higher terrain, so pushing deep inland
 * is slower than fighting along coasts — a supply-distance flavour.
 *
 * `cellKm` is the ground size of one cell at this grid's resolution.
 */
export function computeShoreAndMagnitude(
  grid: TerrainGrid,
  cellKm: number,
): void {
  const { width, height, data } = grid;
  const size = width * height;

  // Land magnitude thresholds in km (chosen for upstream-like visuals).
  const PLAINS_KM = 16;
  const HIGHLAND_KM = 160;
  const UPPER_KM = 500;
  const maxRounds = Math.min(
    2048,
    Math.ceil(UPPER_KM / cellKm) + 40, // beyond this everything is mountain
  );

  // Shoreline: land next to water, or water next to land (4-neighbour).
  let frontier: number[] = [];
  const dist = new Uint16Array(size); // 0 = unvisited (shore cells get 1)
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const land = isLand(data[i]);
      const leftDiff = x > 0 && isLand(data[i - 1]) !== land;
      const rightDiff = x < width - 1 && isLand(data[i + 1]) !== land;
      const upDiff = y > 0 && isLand(data[i - width]) !== land;
      const downDiff = y < height - 1 && isLand(data[i + width]) !== land;
      if (leftDiff || rightDiff || upDiff || downDiff) {
        data[i] |= TERRAIN_SHORE_BIT;
        dist[i] = 1;
        frontier.push(i);
      }
    }
  }

  // Multi-source BFS outward from the shore.
  let d = 1;
  while (frontier.length > 0 && d < maxRounds) {
    d++;
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width;
      if (x > 0) growTo(i - 1, d, dist, next);
      if (x < width - 1) growTo(i + 1, d, dist, next);
      if (i >= width) growTo(i - width, d, dist, next);
      if (i < size - width) growTo(i + width, d, dist, next);
    }
    frontier = next;
  }

  for (let i = 0; i < size; i++) {
    const land = isLand(data[i]);
    const raw = dist[i] === 0 ? maxRounds : dist[i] - 1;
    let mag: number;
    if (!land) {
      mag = Math.min(raw, 31);
    } else {
      const km = raw * cellKm;
      if (km <= PLAINS_KM) {
        mag = Math.max(1, Math.round((km / PLAINS_KM) * 9));
      } else if (km <= HIGHLAND_KM) {
        mag =
          10 + Math.floor(((km - PLAINS_KM) / (HIGHLAND_KM - PLAINS_KM)) * 6);
      } else if (km <= UPPER_KM) {
        mag =
          16 + Math.floor(((km - HIGHLAND_KM) / (UPPER_KM - HIGHLAND_KM)) * 4);
      } else {
        // Mountain band, but never 31 (impassable in the engine).
        mag = Math.min(24, 20 + Math.floor((km - UPPER_KM) / 400));
      }
    }
    data[i] = (data[i] & ~0x1f) | mag;
  }
}

function growTo(i: number, d: number, dist: Uint16Array, next: number[]): void {
  if (dist[i] !== 0) return;
  dist[i] = d;
  next.push(i);
}

/**
 * Downsample a land/water grid by 2× per axis. A parent cell is land when
 * ≥2 of its 4 children are land — biased toward retaining islands and thin
 * coastlines; strategic straits are explicitly re-carved after downsampling
 * (see build-world.ts) so they cannot silt shut.
 *
 * Only the land bit is meaningful in the result; shoreline/ocean/magnitude
 * must be recomputed at the new resolution.
 */
export function downsampleLand(grid: TerrainGrid): TerrainGrid {
  const w = grid.width >> 1;
  const h = grid.height >> 1;
  const out = new Uint8Array(w * h);
  const { data, width } = grid;
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * width;
    const r1 = r0 + width;
    const ro = y * w;
    for (let x = 0; x < w; x++) {
      const c =
        (isLand(data[r0 + 2 * x]) ? 1 : 0) +
        (isLand(data[r0 + 2 * x + 1]) ? 1 : 0) +
        (isLand(data[r1 + 2 * x]) ? 1 : 0) +
        (isLand(data[r1 + 2 * x + 1]) ? 1 : 0);
      out[ro + x] = c >= 2 ? TERRAIN_LAND_BIT : 0;
    }
  }
  return { width: w, height: h, data: out };
}

/** Draw a straight line of cells with the given value (used for strait carving). */
export function paintLine(
  grid: TerrainGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  land: boolean,
  halfWidth: number,
): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = Math.round(x0 + (x1 - x0) * t);
    const cy = Math.round(y0 + (y1 - y0) * t);
    for (let dy = -halfWidth; dy <= halfWidth; dy++) {
      for (let dx = -halfWidth; dx <= halfWidth; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
        grid.data[y * grid.width + x] = land ? TERRAIN_LAND_BIT : 0;
      }
    }
  }
}

/** BFS reachability between two water cells (4-neighbour), for strait tests. */
export function waterConnected(
  grid: TerrainGrid,
  from: [number, number],
  to: [number, number],
  maxSteps = 50_000_000,
): boolean {
  const { width, height, data } = grid;
  const start = from[1] * width + from[0];
  const goal = to[1] * width + to[0];
  if (isLand(data[start]) || isLand(data[goal])) return false;
  const seen = new Uint8Array(width * height);
  seen[start] = 1;
  let frontier = [start];
  let steps = 0;
  while (frontier.length > 0 && steps < maxSteps) {
    const next: number[] = [];
    for (const i of frontier) {
      if (i === goal) return true;
      steps++;
      const x = i % width;
      const cands = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        i - width,
        i + width,
      ];
      for (const c of cands) {
        if (c < 0 || c >= seen.length || seen[c] || isLand(data[c])) continue;
        seen[c] = 1;
        next.push(c);
      }
    }
    frontier = next;
  }
  return false;
}
