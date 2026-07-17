/**
 * Types for the generated world chunk index (resources/world/world-index.json),
 * produced by scripts/world/build-world.ts.
 */

export interface WorldLodIndex {
  /** Pack file name containing this LOD's gzipped chunks, e.g. "world-l2.pack". */
  pack: string;
  /** "chunkX_chunkY" → [byteOffset, byteLength] within the pack. */
  chunks: Record<string, [number, number]>;
}

export interface WorldDetailRegion {
  id: string;
  /** Finest LOD generated for this region (0 = maximum local detail). */
  minLod: number;
  /** Region rectangle in LOD-0 world cells. */
  lod0Rect: { x: number; y: number; width: number; height: number };
}

/** A playable OpenFront map cut from the detail region's grid. */
export interface WorldWindowRef {
  id: string;
  /** GameMapType key of the playable window map (e.g. "WorldOceania"). */
  gameMap: string;
  /**
   * Resolution the game map was emitted at: one game tile covers
   * 2^lod LOD-0 world cells (0 = full detail).
   */
  lod: number;
  /** Window rectangle in LOD-0 world cells (its origin in the world). */
  lod0Rect: { x: number; y: number; width: number; height: number };
}

export interface WorldIndex {
  version: number;
  grid: { w0: number; h0: number; maxLod: number; chunkSize: number };
  /** LOD with full global coverage; finer LODs exist only in detail regions. */
  globalBaseLod: number;
  projection: "equal-earth";
  detailRegions: WorldDetailRegion[];
  windows: WorldWindowRef[];
  lods: Record<string, WorldLodIndex>;
}
