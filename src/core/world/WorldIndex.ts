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
  /** GameMapType name of the playable window emitted for this region. */
  gameMap?: string;
}

export interface WorldIndex {
  version: number;
  grid: { w0: number; h0: number; maxLod: number; chunkSize: number };
  /** LOD with full global coverage; finer LODs exist only in detail regions. */
  globalBaseLod: number;
  projection: "equal-earth";
  detailRegions: WorldDetailRegion[];
  lods: Record<string, WorldLodIndex>;
}
