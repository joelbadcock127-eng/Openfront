/**
 * Map overlay for real-geography gameplay markers:
 *
 *  - RESOURCE SITES as obvious "buildings": a plaque with a per-type glyph
 *    (gold mine, oil derrick, gas flare, …), named at closer zooms.
 *  - STRAIT CHOKEPOINTS as control rings: the capture zone circle plus a
 *    live readout of who holds the shoreline and how close they are to
 *    the 60% control threshold.
 *  - CAPITALS as imposing drawn castles for every player — the local
 *    player's is bigger, golden and labelled.
 *  - REBELLION / SHATTER pulses: expanding ripples in the new owner's
 *    colour when territory defects, so the recolour is impossible to miss.
 *
 * Drawn on a Canvas2D layer above the game's WebGL canvas (pointer-events
 * off, HUD above). Markers live in game-tile coordinates and follow the
 * shared camera (TransformHandler), fading in with zoom.
 */
import { Chokepoint, MessageType, ResourceSite } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { GameUpdateType } from "../../core/game/GameUpdates";
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

/** Expanding ripple shown where territory just changed hands en masse. */
interface Pulse {
  x: number;
  y: number;
  color: string;
  start: number;
}

/** Pulse lifetime in ms. */
const PULSE_MS = 3000;

export class ResourceOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private disposed = false;
  private last = { scale: 0, x: 0, y: 0, w: 0, h: 0, t: 0 };
  private straitStates: StraitState[] = [];
  private lastControlRefresh = 0;
  private pulses: Pulse[] = [];
  private lastPulseTick = -1;

  constructor(
    private transform: TransformHandler,
    private mapWidth: number,
    private mapHeight: number,
    private resources: ResourceSite[],
    private chokepoints: Chokepoint[],
    private gameView: GameView,
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

  /** Watch the tick's display events for mass-defection markers. */
  private collectPulses(): void {
    const tick = this.gameView.ticks();
    if (tick === this.lastPulseTick) return;
    this.lastPulseTick = tick;
    const updates = this.gameView.updatesSinceLastTick();
    if (!updates) return;
    for (const e of updates[GameUpdateType.DisplayEvent] ?? []) {
      const px = e.params?.x;
      const py = e.params?.y;
      if (typeof px !== "number" || typeof py !== "number") continue;
      if (e.messageType === MessageType.UNREST) {
        const rebel = e.params?.rebel;
        let color = "#f8fafc";
        if (typeof rebel === "number") {
          const p = this.gameView.playerBySmallID(rebel);
          if (p !== null && p.isPlayer()) {
            color = p.territoryColor().toHex();
          }
        }
        this.pulses.push({ x: px, y: py, color, start: performance.now() });
      } else if (e.messageType === MessageType.EMPIRE_SHATTERED) {
        this.pulses.push({
          x: px,
          y: py,
          color: "#ef4444",
          start: performance.now(),
        });
      }
    }
  }

  private frame(): void {
    const t = this.transform;
    const rect = t.boundingRect();
    const now = performance.now();
    this.collectPulses();
    this.pulses = this.pulses.filter((p) => now - p.start < PULSE_MS);
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
    // Pulses animate every frame; capitals can change owner/state, so
    // refresh the static layer on the control cadence too.
    if (!moved && !controlStale && this.pulses.length === 0) return;
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
    // Defection ripples are visible at any zoom.
    this.drawPulses(ctx, viewW, viewH);
    // Other markers clutter the far-out view; fade in from regional zoom.
    if (scale >= 0.3) {
      const alpha = Math.min(1, (scale - 0.3) / 0.25);
      const showNames = scale > 0.9;
      this.drawStraits(ctx, viewW, viewH, alpha, showNames);
      this.drawSites(ctx, viewW, viewH, alpha, showNames);
      this.drawCapitals(ctx, viewW, viewH, alpha);
    }
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

  /**
   * Every living player's capital as an imposing stone castle — two
   * crenellated towers, gate and a banner in the owner's colour. The local
   * player's castle is larger, gold-trimmed and labelled CAPITAL.
   */
  private drawCapitals(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    alpha: number,
  ): void {
    const me = this.gameView.myPlayer();
    // Hundreds of AI castles blanket the continent view — fade them in
    // from mid-regional zoom. The local player's castle always shows.
    const showOthers = this.transform.scale >= 0.55;
    for (const p of this.gameView.playerViews()) {
      if (!p.isAlive()) continue;
      if (!showOthers && p !== me) continue;
      const spawn = p.state.spawnTile;
      if (spawn === undefined) continue;
      const gx = this.gameView.x(spawn);
      const gy = this.gameView.y(spawn);
      const c = this.gameToCanvas(gx, gy);
      if (c.x < -50 || c.y < -50 || c.x > viewW + 50 || c.y > viewH + 50) {
        continue;
      }
      const mine = me !== null && p === me;
      this.drawCastle(
        ctx,
        c.x,
        c.y,
        mine ? 1.5 : 1,
        p.territoryColor().toHex(),
        mine,
        alpha,
      );
    }
  }

  /** A little fortress drawn with plain canvas shapes (no emoji fonts). */
  private drawCastle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    banner: string,
    highlight: boolean,
    alpha: number,
  ): void {
    ctx.globalAlpha = alpha;
    const w = 26 * s; // keep width even for crisp crenellations
    const h = 16 * s;
    const towerW = 7 * s;
    const towerH = 22 * s;
    const baseY = y + h / 2;
    const stone = highlight ? "#8b8fa3" : "#7c8291";
    const stoneDark = "rgba(15,20,30,0.9)";
    ctx.lineWidth = Math.max(1.5, 1.5 * s);
    ctx.strokeStyle = stoneDark;
    ctx.fillStyle = stone;
    // Main keep.
    ctx.beginPath();
    ctx.rect(x - w / 2, baseY - h, w, h);
    ctx.fill();
    ctx.stroke();
    // Towers flanking the keep.
    for (const tx of [x - w / 2 - towerW / 2, x + w / 2 + towerW / 2]) {
      ctx.beginPath();
      ctx.rect(tx - towerW / 2, baseY - towerH, towerW, towerH);
      ctx.fill();
      ctx.stroke();
      // Tower crenellations.
      ctx.beginPath();
      for (let i = -1; i <= 1; i += 2) {
        ctx.rect(
          tx + (i * towerW) / 4 - towerW / 8,
          baseY - towerH - 3 * s,
          towerW / 4,
          3 * s,
        );
      }
      ctx.fill();
      ctx.stroke();
    }
    // Keep crenellations.
    ctx.beginPath();
    const merlons = 3;
    for (let i = 0; i < merlons; i++) {
      const mx = x - w / 2 + ((i + 0.5) * w) / merlons;
      ctx.rect(mx - (2.2 * s) / 1, baseY - h - 3 * s, 4.4 * s, 3 * s);
    }
    ctx.fill();
    ctx.stroke();
    // Gate.
    ctx.fillStyle = stoneDark;
    ctx.beginPath();
    ctx.arc(x, baseY, 4 * s, Math.PI, 0);
    ctx.rect(x - 4 * s, baseY - 0.5, 8 * s, 0.5);
    ctx.fill();
    // Banner in the owner's colour on the keep face.
    ctx.fillStyle = banner;
    ctx.strokeStyle = stoneDark;
    ctx.beginPath();
    ctx.rect(x - 3 * s, baseY - h + 2 * s, 6 * s, 7 * s);
    ctx.fill();
    ctx.stroke();
    // Flag on a pole above the keep.
    ctx.strokeStyle = stoneDark;
    ctx.beginPath();
    ctx.moveTo(x, baseY - h - 3 * s);
    ctx.lineTo(x, baseY - h - 11 * s);
    ctx.stroke();
    ctx.fillStyle = banner;
    ctx.beginPath();
    ctx.moveTo(x, baseY - h - 11 * s);
    ctx.lineTo(x + 8 * s, baseY - h - 9 * s);
    ctx.lineTo(x, baseY - h - 7 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (highlight) {
      // Gold trim + CAPITAL label for the local player.
      ctx.strokeStyle = "rgba(253,224,71,0.95)";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        x - w / 2 - towerW - 3,
        baseY - towerH - 14 * s,
        w + 2 * towerW + 6,
        towerH + 14 * s + 3,
      );
      ctx.font = `bold ${Math.round(9 * s)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(253,224,71,0.95)";
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.lineWidth = 2.5;
      ctx.strokeText("CAPITAL", x, baseY - towerH - 16 * s);
      ctx.fillText("CAPITAL", x, baseY - towerH - 16 * s);
    }
  }

  /** Expanding ripples where territory just defected to a new owner. */
  private drawPulses(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
  ): void {
    const now = performance.now();
    for (const pulse of this.pulses) {
      const t = (now - pulse.start) / PULSE_MS;
      if (t >= 1) continue;
      const p = this.gameToCanvas(pulse.x, pulse.y);
      if (p.x < -160 || p.y < -160 || p.x > viewW + 160 || p.y > viewH + 160) {
        continue;
      }
      // Two staggered rings plus a fading tint disc in the new colour.
      for (const lag of [0, 0.25]) {
        const tt = t - lag;
        if (tt < 0) continue;
        const r = 10 + 110 * tt;
        ctx.globalAlpha = 0.85 * (1 - tt);
        ctx.strokeStyle = pulse.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.25 * (1 - t);
      ctx.fillStyle = pulse.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10 + 110 * t, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }
}
