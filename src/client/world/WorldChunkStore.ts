/**
 * Streaming terrain-chunk store for the continuous world map.
 *
 * Chunks are gzipped 256×256 terrain-byte tiles concatenated into one pack
 * file per LOD (see scripts/world/build-world.ts). The store fetches
 * individual chunks with HTTP Range requests so the world never has to be
 * fully loaded into memory; servers that ignore Range (rare) fall back to a
 * single full-pack download that is then sliced locally.
 *
 * Decoded chunks are cached in an LRU keyed by (lod, chunkX, chunkY);
 * distant chunks are evicted once the cache exceeds its budget. All loading
 * is asynchronous — callers get null for not-yet-loaded chunks and re-render
 * when the load completes.
 */
import { assetUrl } from "../../core/AssetUrls";
import { CHUNK_SIZE } from "../../core/world/WorldGrid";
import { WorldIndex } from "../../core/world/WorldIndex";

export interface WorldChunk {
  lod: number;
  chunkX: number;
  chunkY: number;
  /** CHUNK_SIZE² terrain bytes (engine bit layout). */
  terrain: Uint8Array;
  /** Colorized pixels for rendering, created lazily by the backdrop. */
  bitmap?: ImageBitmap;
  /** Bitmap build in flight (backdrop-internal). */
  building?: boolean;
}

export interface WorldStoreStats {
  loadedChunks: number;
  pendingChunks: number;
  fetches: number;
  rangeSupported: boolean | null;
  totalFetchMs: number;
  totalDecodeMs: number;
  /** Rough decoded-terrain memory in bytes (excludes bitmaps). */
  memoryBytes: number;
}

const CACHE_BUDGET_CHUNKS = 512; // ×64 KiB terrain ≈ 32 MiB + bitmaps

export class WorldChunkStore {
  private cache = new Map<string, WorldChunk>(); // insertion order = LRU
  private pending = new Map<string, Promise<WorldChunk | null>>();
  private fullPacks = new Map<string, Promise<ArrayBuffer>>();
  private stats: WorldStoreStats = {
    loadedChunks: 0,
    pendingChunks: 0,
    fetches: 0,
    rangeSupported: null,
    totalFetchMs: 0,
    totalDecodeMs: 0,
    memoryBytes: 0,
  };

  private constructor(
    readonly index: WorldIndex,
    private onChunkLoaded: () => void,
  ) {}

  /** Load the world index and create a store. */
  static async load(onChunkLoaded: () => void): Promise<WorldChunkStore> {
    const url = assetUrl("world/world-index.json");
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`world index fetch failed: ${resp.status}`);
    }
    const index = (await resp.json()) as WorldIndex;
    return new WorldChunkStore(index, onChunkLoaded);
  }

  getStats(): WorldStoreStats {
    this.stats.loadedChunks = this.cache.size;
    this.stats.pendingChunks = this.pending.size;
    this.stats.memoryBytes = this.cache.size * CHUNK_SIZE * CHUNK_SIZE;
    return { ...this.stats };
  }

  /** Whether a chunk exists in the generated data (LOD coverage is partial
   * below the global base LOD). */
  has(lod: number, chunkX: number, chunkY: number): boolean {
    return (
      this.index.lods[String(lod)]?.chunks[`${chunkX}_${chunkY}`] !== undefined
    );
  }

  /** Synchronous cache lookup; touches LRU order. */
  get(lod: number, chunkX: number, chunkY: number): WorldChunk | null {
    const key = `${lod}:${chunkX}:${chunkY}`;
    const hit = this.cache.get(key);
    if (hit) {
      // refresh LRU position
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    return null;
  }

  /** Request an async load (deduped). Resolves null for chunks that don't
   * exist at this LOD. */
  request(lod: number, chunkX: number, chunkY: number): void {
    const key = `${lod}:${chunkX}:${chunkY}`;
    if (this.cache.has(key) || this.pending.has(key)) return;
    const lodIndex = this.index.lods[String(lod)];
    const entry = lodIndex?.chunks[`${chunkX}_${chunkY}`];
    if (!entry) return;

    const p = this.fetchChunk(lodIndex, entry)
      .then((terrain) => {
        if (!terrain) return null;
        const chunk: WorldChunk = { lod, chunkX, chunkY, terrain };
        this.cache.set(key, chunk);
        this.evictIfNeeded();
        this.onChunkLoaded();
        return chunk;
      })
      .catch((err) => {
        // A missing/corrupt chunk must not kill the render loop; the area
        // simply keeps its coarser-LOD fallback and we log for diagnosis.
        console.error(`world chunk ${key} failed to load`, err);
        return null;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, p);
  }

  private evictIfNeeded(): void {
    while (this.cache.size > CACHE_BUDGET_CHUNKS) {
      // Oldest (least recently used) entry first.
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      const chunk = this.cache.get(oldestKey);
      chunk?.bitmap?.close();
      this.cache.delete(oldestKey);
    }
  }

  private async fetchChunk(
    lodIndex: { pack: string },
    [offset, length]: [number, number],
  ): Promise<Uint8Array | null> {
    const url = assetUrl(`world/${lodIndex.pack}`);
    const t0 = performance.now();
    let gz: ArrayBuffer;

    if (this.stats.rangeSupported === false) {
      gz = await this.slicePack(url, offset, length);
    } else {
      const resp = await fetch(url, {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      });
      if (resp.status === 206) {
        this.stats.rangeSupported = true;
        gz = await resp.arrayBuffer();
      } else if (resp.ok) {
        // Server ignored the Range header; fall back to caching whole packs.
        this.stats.rangeSupported = false;
        const full = await resp.arrayBuffer();
        this.fullPacks.set(url, Promise.resolve(full));
        gz = full.slice(offset, offset + length);
      } else {
        throw new Error(`pack fetch failed: ${resp.status}`);
      }
    }
    this.stats.fetches++;
    this.stats.totalFetchMs += performance.now() - t0;

    const t1 = performance.now();
    const terrain = await gunzip(gz);
    this.stats.totalDecodeMs += performance.now() - t1;
    if (terrain.length !== CHUNK_SIZE * CHUNK_SIZE) {
      throw new Error(`bad chunk size ${terrain.length}`);
    }
    return terrain;
  }

  private async slicePack(
    url: string,
    offset: number,
    length: number,
  ): Promise<ArrayBuffer> {
    let packP = this.fullPacks.get(url);
    if (!packP) {
      packP = fetch(url).then((r) => {
        if (!r.ok) throw new Error(`pack fetch failed: ${r.status}`);
        return r.arrayBuffer();
      });
      this.fullPacks.set(url, packP);
    }
    const pack = await packP;
    return pack.slice(offset, offset + length);
  }

  dispose(): void {
    for (const chunk of this.cache.values()) {
      chunk.bitmap?.close();
    }
    this.cache.clear();
    this.fullPacks.clear();
  }
}

async function gunzip(gz: ArrayBuffer): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([gz]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
