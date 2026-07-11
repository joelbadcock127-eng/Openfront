/**
 * Continuous-world backdrop renderer.
 *
 * Draws the streamed, chunked Earth around the active playable window so a
 * match is one continuous world: the player can zoom from a local tactical
 * view out to the full globe with no loading screen or match transition.
 *
 * Rendering strategy (scale-dependent, no blank areas):
 *  - The camera transform is shared with the game (TransformHandler); world
 *    LOD-0 cells and game tiles are the same units, offset by the window's
 *    origin, so the window and the world can never disagree about position.
 *  - Every frame draws up to three passes, coarse → fine: the coarsest LOD
 *    (fully resident, 8 chunks) guarantees the whole visible world is always
 *    covered even during fast pans; the appropriate LOD for the current zoom
 *    refines on top as its chunks stream in; below the global base LOD, the
 *    detail-region chunks refine further.
 *  - Chunks are colorized with the game's own terrain palette
 *    (encodeTerrainTile) so backdrop and playable window match visually.
 *  - The playable window's screen rect is cleared each frame so the game's
 *    WebGL canvas (which sits below this canvas) shows through — ownership,
 *    borders, units and structures inside the window are rendered by the
 *    unmodified game renderer at every zoom level.
 *
 * A small overlay shows the current camera scale (km across the screen);
 * `localStorage.worldDebug = "1"` adds chunk/fetch/decode/draw statistics.
 */
import { CHUNK_SIZE, WorldGrid } from "../../core/world/WorldGrid";
import { encodeTerrainTile } from "../render/gl/utils/ColorUtils";
import { TransformHandler } from "../TransformHandler";
import { WorldChunk, WorldChunkStore } from "./WorldChunkStore";

export interface WorldBackdropStats {
  drawnChunks: number;
  drawMs: number;
  lod: number;
}

export class WorldBackdrop {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private disposed = false;
  private needsRedraw = true;
  private lastCamera = { scale: 0, x: 0, y: 0, w: 0, h: 0 };
  private lastOffset = { x: 0, y: 0 };
  private velocity = { x: 0, y: 0 };
  private grid: WorldGrid;
  private stats: WorldBackdropStats = { drawnChunks: 0, drawMs: 0, lod: 0 };
  private debug = false;

  constructor(
    private store: WorldChunkStore,
    private transform: TransformHandler,
    /** Playable window dimensions in game tiles (= LOD-0 cells). */
    private mapWidth: number,
    private mapHeight: number,
    /** Window origin in LOD-0 world cells. */
    private originX: number,
    private originY: number,
    /** Element the canvas is inserted after (the game's WebGL canvas). */
    anchor: HTMLElement,
  ) {
    this.grid = new WorldGrid({
      w0: store.index.grid.w0,
      h0: store.index.grid.h0,
      maxLod: store.index.grid.maxLod,
    });
    this.canvas = document.createElement("canvas");
    this.canvas.id = "world-backdrop-canvas";
    this.canvas.style.position = "fixed";
    this.canvas.style.inset = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "none";
    anchor.insertAdjacentElement("afterend", this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("world backdrop: no 2d context");
    this.ctx = ctx;
    try {
      this.debug = localStorage.getItem("worldDebug") === "1";
    } catch {
      // ignore
    }

    // Preload the coarsest LOD so the full world is drawable immediately.
    const maxLod = this.store.index.grid.maxLod;
    for (let cy = 0; cy < this.grid.chunkRows(maxLod); cy++) {
      for (let cx = 0; cx < this.grid.chunkCols(maxLod); cx++) {
        this.store.request(maxLod, cx, cy);
      }
    }

    const loop = () => {
      if (this.disposed) return;
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Called by the chunk store when an async load completes. */
  onChunkLoaded = (): void => {
    this.needsRedraw = true;
  };

  getStats(): WorldBackdropStats {
    return { ...this.stats };
  }

  private frame(): void {
    const t = this.transform;
    const rect = t.boundingRect();
    const cam = {
      scale: t.scale,
      x: t.offsetX,
      y: t.offsetY,
      w: rect.width,
      h: rect.height,
    };
    const moved =
      cam.scale !== this.lastCamera.scale ||
      cam.x !== this.lastCamera.x ||
      cam.y !== this.lastCamera.y ||
      cam.w !== this.lastCamera.w ||
      cam.h !== this.lastCamera.h;
    this.velocity = {
      x: cam.x - this.lastOffset.x,
      y: cam.y - this.lastOffset.y,
    };
    this.lastOffset = { x: cam.x, y: cam.y };
    if (!moved && !this.needsRedraw) return;
    this.lastCamera = cam;
    this.needsRedraw = false;
    this.draw(rect.width, rect.height);
  }

  /** Game coords (tiles) → canvas px, mirroring TransformHandler math. */
  private gameToCanvas(gx: number, gy: number): { x: number; y: number } {
    const t = this.transform;
    return {
      x: (gx - this.mapWidth / 2 - t.offsetX) * t.scale + this.mapWidth / 2,
      y: (gy - this.mapHeight / 2 - t.offsetY) * t.scale + this.mapHeight / 2,
    };
  }

  private draw(viewW: number, viewH: number): void {
    const t0 = performance.now();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxW = Math.round(viewW * dpr);
    const pxH = Math.round(viewH * dpr);
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Outside-the-world background matches the game's out-of-map clear color.
    ctx.fillStyle = "rgb(60,60,60)";
    ctx.fillRect(0, 0, viewW, viewH);

    const scale = this.transform.scale;
    // Finest LOD whose cells are ≥ ~1 screen px.
    const idealLod = Math.max(
      0,
      Math.min(this.store.index.grid.maxLod, Math.ceil(Math.log2(1 / scale))),
    );
    this.stats.lod = idealLod;

    const maxLod = this.store.index.grid.maxLod;
    const baseLod = this.store.index.globalBaseLod;
    const passes: number[] = [maxLod];
    const mid = Math.max(idealLod, baseLod);
    if (mid < maxLod) passes.push(mid);
    if (idealLod < baseLod) passes.push(idealLod);

    // Crisp pixels when zoomed in; smooth when the world is far out.
    ctx.imageSmoothingEnabled = scale < 1;

    let drawn = 0;
    for (const lod of passes) {
      drawn += this.drawLodPass(lod, viewW, viewH);
    }

    // Punch the playable window's rect so the game canvas below shows
    // through — the game renders the window at every zoom level itself.
    const tl = this.gameToCanvas(0, 0);
    const br = this.gameToCanvas(this.mapWidth, this.mapHeight);
    ctx.clearRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

    this.drawOverlay(viewW, viewH);

    this.stats.drawnChunks = drawn;
    this.stats.drawMs = performance.now() - t0;
  }

  private drawLodPass(lod: number, viewW: number, viewH: number): number {
    const ctx = this.ctx;
    const t = this.transform;
    const cellsPerLod0 = 1 << lod;
    const chunkSpanLod0 = CHUNK_SIZE * cellsPerLod0;

    // Visible world rect in LOD-0 cells (world = game + origin).
    const worldLeft =
      (0 - this.mapWidth / 2) / t.scale + t.offsetX + this.mapWidth / 2 + this.originX;
    const worldTop =
      (0 - this.mapHeight / 2) / t.scale + t.offsetY + this.mapHeight / 2 + this.originY;
    const worldRight = worldLeft + viewW / t.scale;
    const worldBottom = worldTop + viewH / t.scale;

    // Prefetch margin: one chunk all around plus one more chunk in the
    // direction of camera motion (predictive loading).
    const margin = chunkSpanLod0;
    const velX = this.velocity.x > 0 ? margin : this.velocity.x < 0 ? -margin : 0;
    const velY = this.velocity.y > 0 ? margin : this.velocity.y < 0 ? -margin : 0;

    const c0x = Math.floor((worldLeft - margin + Math.min(0, velX)) / chunkSpanLod0);
    const c0y = Math.floor((worldTop - margin + Math.min(0, velY)) / chunkSpanLod0);
    const c1x = Math.floor((worldRight + margin + Math.max(0, velX)) / chunkSpanLod0);
    const c1y = Math.floor((worldBottom + margin + Math.max(0, velY)) / chunkSpanLod0);

    const maxCx = this.grid.chunkCols(lod) - 1;
    const maxCy = this.grid.chunkRows(lod) - 1;

    let drawn = 0;
    for (let cy = Math.max(0, c0y); cy <= Math.min(maxCy, c1y); cy++) {
      for (let cx = Math.max(0, c0x); cx <= Math.min(maxCx, c1x); cx++) {
        if (!this.store.has(lod, cx, cy)) continue;
        const chunk = this.store.get(lod, cx, cy);
        if (!chunk) {
          this.store.request(lod, cx, cy);
          continue;
        }
        if (!chunk.bitmap) {
          this.buildBitmap(chunk);
          continue; // drawn on a later frame; coarser pass covers meanwhile
        }
        // Skip chunks fully outside the viewport (prefetch ring).
        const wx = cx * chunkSpanLod0;
        const wy = cy * chunkSpanLod0;
        if (
          wx > worldRight ||
          wy > worldBottom ||
          wx + chunkSpanLod0 < worldLeft ||
          wy + chunkSpanLod0 < worldTop
        ) {
          continue;
        }
        const p = this.gameToCanvas(wx - this.originX, wy - this.originY);
        const size = chunkSpanLod0 * t.scale;
        ctx.drawImage(chunk.bitmap, p.x, p.y, size, size);
        drawn++;
      }
    }
    return drawn;
  }

  private buildBitmap(chunk: WorldChunk): void {
    if (chunk.building) return;
    chunk.building = true;
    const rgba = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
    for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
      encodeTerrainTile(chunk.terrain[i], rgba, i * 4);
    }
    const imageData = new ImageData(
      new Uint8ClampedArray(rgba.buffer),
      CHUNK_SIZE,
      CHUNK_SIZE,
    );
    createImageBitmap(imageData).then((bmp) => {
      chunk.bitmap = bmp;
      this.needsRedraw = true;
    });
  }

  private drawOverlay(viewW: number, viewH: number): void {
    const ctx = this.ctx;
    const kmAcross = (viewW / this.transform.scale) * this.grid.kmPerCell();
    const label =
      kmAcross >= 100
        ? `≈ ${Math.round(kmAcross).toLocaleString()} km across`
        : `≈ ${kmAcross.toFixed(1)} km across`;
    ctx.font = "11px monospace";
    ctx.textBaseline = "top";
    const pad = 4;
    const width = ctx.measureText(label).width + pad * 2;
    const x = 8;
    const y = viewH - 60;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(x, y, width, 18);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(label, x + pad, y + 4);

    if (this.debug) {
      const s = this.store.getStats();
      const lines = [
        `lod ${this.stats.lod}  chunks drawn ${this.stats.drawnChunks}  draw ${this.stats.drawMs.toFixed(1)}ms`,
        `cached ${s.loadedChunks}  pending ${s.pendingChunks}  fetches ${s.fetches}`,
        `fetch ${s.totalFetchMs.toFixed(0)}ms  decode ${s.totalDecodeMs.toFixed(0)}ms  mem ${(s.memoryBytes / 1048576).toFixed(1)}MB`,
        `range ${String(s.rangeSupported ?? "?")}`,
      ];
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(x, y - 16 * lines.length - 4, 340, 16 * lines.length + 2);
      ctx.fillStyle = "rgba(160,220,255,0.9)";
      lines.forEach((l, i) => ctx.fillText(l, x + pad, y - 16 * (lines.length - i) - 1));
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
    this.store.dispose();
  }
}
