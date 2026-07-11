/**
 * World coordinate system for the continuous global map.
 *
 * - The authoritative gameplay grid is LOD 0: every base terrain cell has a
 *   stable integer (x, y) world coordinate, independent of screen
 *   resolution, camera or chunk layout.
 * - LOD k halves resolution per axis per level: cell (x, y) at LOD k covers
 *   LOD-0 cells [x·2^k, (x+1)·2^k) × [y·2^k, (y+1)·2^k). Parent→child
 *   references are therefore pure index arithmetic — lower-resolution levels
 *   are rendering/query accelerators, never separate gameplay maps.
 * - Chunks are CHUNK_SIZE × CHUNK_SIZE cells at every LOD, addressed by
 *   integer chunk coordinates. Adjacent chunks share edges exactly (they are
 *   cut from one continuous grid), so territory, attacks and naval movement
 *   cross chunk boundaries with no seams by construction.
 * - Longitude wrapping: the projection maps lon ∈ [-180, 180] onto
 *   x ∈ [0, w0). The world does not wrap horizontally — the camera clamps to
 *   world bounds (the plan allows "world bounds or controlled wrapping").
 *   The international date line is the map edge; there is no mid-map seam.
 *
 * Terrain byte layout matches the game engine (src/core/game/GameMap.ts):
 * bit 7 land, bit 6 shoreline, bit 5 ocean, bits 0–4 magnitude.
 */
import { equalEarthExtent, equalEarthForward, equalEarthInvert } from "./EqualEarth";

export const CHUNK_SIZE = 256;

/** Terrain bit masks (mirrors GameMapImpl). */
export const TERRAIN_LAND_BIT = 1 << 7;
export const TERRAIN_SHORE_BIT = 1 << 6;
export const TERRAIN_OCEAN_BIT = 1 << 5;
export const TERRAIN_MAGNITUDE_MASK = 0x1f;

export interface WorldGridConfig {
  /** LOD-0 world width in cells (multiple of CHUNK_SIZE·2^maxLod). */
  w0: number;
  /** LOD-0 world height in cells (multiple of CHUNK_SIZE·2^maxLod). */
  h0: number;
  /** Coarsest LOD level present (e.g. 6). */
  maxLod: number;
}

export class WorldGrid {
  /** Projected Equal Earth extent [maxX, maxY] for the unit sphere. */
  private readonly ex: number;
  private readonly ey: number;
  /** World cells per projected unit (same for x and y — square cells). */
  private readonly cellsPerUnit: number;

  constructor(readonly config: WorldGridConfig) {
    [this.ex, this.ey] = equalEarthExtent();
    this.cellsPerUnit = config.w0 / (2 * this.ex);
  }

  /** Width in cells at the given LOD. */
  width(lod: number): number {
    return this.config.w0 >> lod;
  }

  /** Height in cells at the given LOD. */
  height(lod: number): number {
    return this.config.h0 >> lod;
  }

  /** Number of chunk columns/rows at the given LOD. */
  chunkCols(lod: number): number {
    return Math.ceil(this.width(lod) / CHUNK_SIZE);
  }
  chunkRows(lod: number): number {
    return Math.ceil(this.height(lod) / CHUNK_SIZE);
  }

  /**
   * Geographic point → LOD-0 world cell (floating point; callers floor for
   * a cell index). y grows south (screen convention).
   */
  geoToWorld(lonDeg: number, latDeg: number): { x: number; y: number } {
    const [px, py] = equalEarthForward(lonDeg, latDeg);
    return {
      x: (px + this.ex) * this.cellsPerUnit,
      y: (this.ey - py) * this.cellsPerUnit,
    };
  }

  /** LOD-0 world coordinate (cell center ok) → geographic lon/lat degrees. */
  worldToGeo(x: number, y: number): { lon: number; lat: number } {
    const px = x / this.cellsPerUnit - this.ex;
    const py = this.ey - y / this.cellsPerUnit;
    const [lon, lat] = equalEarthInvert(px, py);
    return { lon, lat };
  }

  /**
   * Approximate kilometres per LOD-0 cell. Equal Earth is equal-area, so
   * cell *area* is uniform; this is the square-root scale used for the
   * on-screen scale indicator.
   */
  kmPerCell(): number {
    // Earth surface area 510.07e6 km²; the projected map area (ellipse-ish)
    // equals the sphere area under an equal-area projection at matching
    // scale. Total LOD-0 map cells cover the projected bounding box; oceans
    // beyond lon/lat range don't exist, so use area ratio of the projected
    // Earth (which is w0·h0 · π/4-ish). Simpler and accurate enough for a
    // UI indicator: circumference-based estimate.
    return 40075 / this.config.w0;
  }

  /** LOD-0 cell → containing cell index at LOD k. */
  toLod(x: number, y: number, lod: number): { x: number; y: number } {
    return { x: x >> lod, y: y >> lod };
  }

  /** Cell index (at LOD k) → chunk coordinate + offset within chunk. */
  cellToChunk(
    cx: number,
    cy: number,
  ): { chunkX: number; chunkY: number; ox: number; oy: number } {
    return {
      chunkX: Math.floor(cx / CHUNK_SIZE),
      chunkY: Math.floor(cy / CHUNK_SIZE),
      ox: ((cx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
      oy: ((cy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    };
  }

  /** Stable string key for a chunk at a LOD. */
  static chunkKey(lod: number, chunkX: number, chunkY: number): string {
    return `${lod}:${chunkX}:${chunkY}`;
  }
}
