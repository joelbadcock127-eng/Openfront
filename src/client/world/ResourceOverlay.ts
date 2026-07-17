/**
 * Map overlay for real-geography markers: resource deposits (◆ + name) and
 * strait chokepoints (labels), drawn on a Canvas2D layer above the game's
 * WebGL canvas (pointer-events off, HUD stays above).
 *
 * Markers live in game-tile coordinates and follow the shared camera
 * (TransformHandler), fading in with zoom so the world view stays clean.
 */
import { Chokepoint, ResourceSite } from "../../core/game/Game";
import { TransformHandler } from "../TransformHandler";

const RESOURCE_COLORS: Record<string, string> = {
  gold: "#facc15",
  silver: "#cbd5e1",
  iron: "#b45309",
  coal: "#334155",
  copper: "#ea580c",
  oil: "#111827",
  gas: "#0ea5e9",
  bauxite: "#dc2626",
};

export class ResourceOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private disposed = false;
  private last = { scale: 0, x: 0, y: 0, w: 0, h: 0 };

  constructor(
    private transform: TransformHandler,
    private mapWidth: number,
    private mapHeight: number,
    private resources: ResourceSite[],
    private chokepoints: Chokepoint[],
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
    const loop = () => {
      if (this.disposed) return;
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
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
    const cam = {
      scale: t.scale,
      x: t.offsetX,
      y: t.offsetY,
      w: rect.width,
      h: rect.height,
    };
    if (
      cam.scale === this.last.scale &&
      cam.x === this.last.x &&
      cam.y === this.last.y &&
      cam.w === this.last.w &&
      cam.h === this.last.h
    ) {
      return;
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
    if (scale < 0.35) return;
    const alpha = Math.min(1, (scale - 0.35) / 0.3);
    const showNames = scale > 1.2;

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const site of this.resources) {
      const p = this.gameToCanvas(site.x, site.y);
      if (p.x < -40 || p.y < -40 || p.x > viewW + 40 || p.y > viewH + 40) {
        continue;
      }
      const color = RESOURCE_COLORS[site.type] ?? "#e5e7eb";
      const s = 5;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - s);
      ctx.lineTo(p.x + s, p.y);
      ctx.lineTo(p.x, p.y + s);
      ctx.lineTo(p.x - s, p.y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (showNames) {
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.lineWidth = 2.5;
        ctx.strokeText(site.name, p.x, p.y + s + 2);
        ctx.fillText(site.name, p.x, p.y + s + 2);
      }
    }

    for (const cp of this.chokepoints) {
      const p = this.gameToCanvas(cp.x, cp.y);
      if (p.x < -60 || p.y < -60 || p.x > viewW + 60 || p.y > viewH + 60) {
        continue;
      }
      ctx.globalAlpha = alpha * 0.9;
      ctx.font = "italic 11px sans-serif";
      ctx.fillStyle = "rgba(220,235,255,0.95)";
      ctx.strokeStyle = "rgba(0,20,40,0.8)";
      ctx.lineWidth = 2.5;
      ctx.strokeText(`⚓ ${cp.name}`, p.x, p.y);
      ctx.fillText(`⚓ ${cp.name}`, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }
}
