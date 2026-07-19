/**
 * Map overlay for real-geography gameplay markers:
 *
 *  - RESOURCE SITES as obvious "buildings": a plaque with a per-type glyph
 *    (gold mine, oil derrick, gas flare, …), named at closer zooms.
 *  - STRAIT CHOKEPOINTS as control rings: the capture zone circle plus a
 *    live readout of who holds the shoreline and how close they are to
 *    the 60% control threshold.
 *  - The player's CAPITAL crowned, so the seat of power is unmistakable.
 *
 * Drawn on a Canvas2D layer above the game's WebGL canvas (pointer-events
 * off, HUD above). Markers live in game-tile coordinates and follow the
 * shared camera (TransformHandler), fading in with zoom.
 */
import { Chokepoint, ResourceSite } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { TransformHandler } from "../TransformHandler";
import { GameView } from "../view";

const SITE_GLYPHS: Record<string, string> = {
  gold: "⛏️",
  silver: "🪙",
  iron: "⚙️",
  coal: "🪨",
  copper: "🔶",
  oil: "🛢️",
  gas: "🔥",
  bauxite: "🧱",
};

const SITE_COLORS: Record<string, string> = {
  gold: "#b8860b",
  silver: "#64748b",
  iron: "#7c3f10",
  coal: "#1f2937",
  copper: "#c2410c",
  oil: "#111827",
  gas: "#0369a1",
  bauxite: "#991b1b",
};

/** Shore ownership share required to control a strait (mirror of core). */
const CONTROL_SHARE = 0.6;
/** Recompute strait control shares this often (ms). */
const CONTROL_REFRESH_MS = 2000;

interface StraitState {
  shoreTiles: TileRef[];
  leaderName: string | null;
  leaderShare: number;
  leaderColor: string;
}

export class ResourceOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private disposed = false;
  private last = { scale: 0, x: 0, y: 0, w: 0, h: 0, t: 0 };
  private straitStates: StraitState[] = [];
  private lastControlRefresh = 0;

  constructor(
    private transform: TransformHandler,
    private mapWidth: number,
    private mapHeight: number,
    private resources: ResourceSite[],
    private chokepoints: Chokepoint[],
    private gameView: GameView,
    /** The player's capital tile (their chosen spawn), if known. */
    private capitalTile: () => { x: number; y: number } | null,
    anchor: HTMLElement,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "resource-overlay-canvas";
    this.canvas.style.position = "fixed";
    this.canvas.style.inset = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "none";
    anchor.insertAdjacentElement("afterend", this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("resource overlay: no 2d context");
    this.ctx = ctx;
    this.initStraits();
    const loop = () => {
      if (this.disposed) return;
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Precompute each strait's shoreline tiles (one-time cost). */
  private initStraits(): void {
    for (const cp of this.chokepoints) {
      const shoreTiles: TileRef[] = [];
      const r = cp.radius;
      const r2 = r * r;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const x = cp.x + dx;
          const y = cp.y + dy;
          if (!this.gameView.isValidCoord(x, y)) continue;
          const ref = this.gameView.ref(x, y);
          if (this.gameView.isLand(ref) && this.gameView.isShore(ref)) {
            shoreTiles.push(ref);
          }
        }
      }
      this.straitStates.push({
        shoreTiles,
        leaderName: null,
        leaderShare: 0,
        leaderColor: "#93c5fd",
      });
    }
  }

  private refreshControl(): void {
    for (let i = 0; i < this.chokepoints.length; i++) {
      const st = this.straitStates[i];
      if (st.shoreTiles.length === 0) continue;
      const counts = new Map<number, number>();
      for (const t of st.shoreTiles) {
        const owner = this.gameView.owner(t);
        if (owner.isPlayer()) {
          const id = owner.smallID();
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      let bestID = -1;
      let bestN = 0;
      for (const [id, n] of counts) {
        if (n > bestN) {
          bestN = n;
          bestID = id;
        }
      }
      if (bestID < 0) {
        st.leaderName = null;
        st.leaderShare = 0;
        continue;
      }
      const leader = this.gameView.playerBySmallID(bestID);
      st.leaderShare = bestN / st.shoreTiles.length;
      st.leaderName =
        leader !== null && leader.isPlayer() ? leader.name() : null;
    }
  }

  private gameToCanvas(gx: number, gy: number): { x: number; y: number } {
    const t = this.transform;
    return {
      x: (gx - this.mapWidth / 2 - t.offsetX) * t.scale + this.mapWidth / 2,
      y: (gy - this.mapHeight / 2 - t.offsetY) * t.scale + this.mapHeight / 2,
    };
  }

  private frame(): void {
    const t = this.transform;
    const rect = t.boundingRect();
    const now = performance.now();
    const cam = {
      scale: t.scale,
      x: t.offsetX,
      y: t.offsetY,
      w: rect.width,
      h: rect.height,
      t: 0,
    };
    const moved =
      cam.scale !== this.last.scale ||
      cam.x !== this.last.x ||
      cam.y !== this.last.y ||
      cam.w !== this.last.w ||
      cam.h !== this.last.h;
    const controlStale = now - this.lastControlRefresh > CONTROL_REFRESH_MS;
    if (!moved && !controlStale) return;
    if (controlStale) {
      this.lastControlRefresh = now;
      this.refreshControl();
    }
    this.last = cam;
    this.draw(rect.width, rect.height);
  }

  private draw(viewW: number, viewH: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxW = Math.round(viewW * dpr);
    const pxH = Math.round(viewH * dpr);
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);

    const scale = this.transform.scale;
    // Markers clutter the far-out view; fade in from regional zoom.
    if (scale < 0.3) return;
    const alpha = Math.min(1, (scale - 0.3) / 0.25);
    const showNames = scale > 0.9;

    this.drawStraits(ctx, viewW, viewH, alpha, showNames);
    this.drawSites(ctx, viewW, viewH, alpha, showNames);
    this.drawCapital(ctx, viewW, viewH, alpha);
    ctx.globalAlpha = 1;
  }

  private drawSites(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    alpha: number,
    showNames: boolean,
  ): void {
    ctx.textAlign = "center";
    for (const site of this.resources) {
      const p = this.gameToCanvas(site.x, site.y);
      if (p.x < -60 || p.y < -60 || p.x > viewW + 60 || p.y > viewH + 60) {
        continue;
      }
      const color = SITE_COLORS[site.type] ?? "#374151";
      const glyph = SITE_GLYPHS[site.type] ?? "⛏️";
      ctx.globalAlpha = alpha;
      // Building plaque: a little "structure" with a roof line + glyph.
      const w = 26;
      const h = 22;
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(p.x - w / 2, p.y - h / 2, w, h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(p.x - w / 2, p.y - h / 2, w, 5);
      ctx.font = "13px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph, p.x, p.y + 2);
      if (showNames) {
        ctx.font = "bold 10px sans-serif";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 2.5;
        ctx.strokeText(site.name, p.x, p.y + h / 2 + 3);
        ctx.fillText(site.name, p.x, p.y + h / 2 + 3);
      }
    }
  }

  private drawStraits(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    alpha: number,
    showNames: boolean,
  ): void {
    const scale = this.transform.scale;
    for (let i = 0; i < this.chokepoints.length; i++) {
      const cp = this.chokepoints[i];
      const st = this.straitStates[i];
      const p = this.gameToCanvas(cp.x, cp.y);
      const rPx = cp.radius * scale;
      if (
        p.x + rPx < 0 ||
        p.y + rPx < 0 ||
        p.x - rPx > viewW ||
        p.y - rPx > viewH
      ) {
        continue;
      }
      const controlled = st.leaderShare >= CONTROL_SHARE;
      ctx.globalAlpha = alpha * 0.85;
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = controlled ? 2.5 : 1.5;
      ctx.strokeStyle = controlled
        ? "rgba(74,222,128,0.9)"
        : "rgba(147,197,253,0.8)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, rPx, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);

      if (showNames) {
        const label =
          st.leaderName === null
            ? `⚓ ${cp.name} — unclaimed`
            : `⚓ ${cp.name} — ${st.leaderName} ${Math.round(
                st.leaderShare * 100,
              )}%/${Math.round(CONTROL_SHARE * 100)}%`;
        ctx.font = "italic 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = controlled
          ? "rgba(187,247,208,0.95)"
          : "rgba(219,234,254,0.95)";
        ctx.strokeStyle = "rgba(0,20,40,0.85)";
        ctx.lineWidth = 3;
        ctx.strokeText(label, p.x, p.y);
        ctx.fillText(label, p.x, p.y);
      }
    }
  }

  private drawCapital(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    alpha: number,
  ): void {
    const cap = this.capitalTile();
    if (cap === null) return;
    const p = this.gameToCanvas(cap.x, cap.y);
    if (p.x < -40 || p.y < -40 || p.x > viewW + 40 || p.y > viewH + 40) {
      return;
    }
    ctx.globalAlpha = alpha;
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 3;
    ctx.strokeText("👑", p.x, p.y - 6);
    ctx.fillText("👑", p.x, p.y - 6);
    if (this.transform.scale > 0.9) {
      ctx.font = "bold 9px sans-serif";
      ctx.fillStyle = "rgba(253,224,71,0.95)";
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.lineWidth = 2.5;
      ctx.strokeText("CAPITAL", p.x, p.y - 24);
      ctx.fillText("CAPITAL", p.x, p.y - 24);
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }
}
