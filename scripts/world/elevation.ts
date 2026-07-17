/**
 * Real elevation for the world pipeline: NOAA ETOPO1 (public domain), the
 * 1 arc-minute global relief grid (ice surface), as a raw little-endian
 * int16 raster (21601×10801, row 0 = 90°N, col 0 = 180°W, metres;
 * negative = below sea level).
 *
 * The dataset is forward-projected once into an Equal Earth world raster at
 * the global base LOD (max-accumulated so ridges and islands survive), then
 * sampled per cell at any LOD. Forward projection is linear in longitude at
 * fixed latitude, so each ETOPO row projects in O(columns).
 */
import * as fs from "node:fs";
import { WorldGrid } from "../../src/core/world/WorldGrid";

export const ETOPO_NODATA = -32768;

const ETOPO_W = 21601;
const ETOPO_H = 10801;

export interface WorldElevation {
  /** Raster LOD (relative to the world grid's LOD 0). */
  lod: number;
  width: number;
  height: number;
  /** Metres; ETOPO_NODATA where nothing projected (filled during build). */
  data: Int16Array;
  /** Elevation in metres for a cell at any LOD (nearest raster cell). */
  at(lod: number, x: number, y: number): number;
}

/**
 * Build the projected world elevation raster at `rasterLod` from an ETOPO1
 * binary grid. Returns null if the dataset file is missing (callers fall
 * back to distance-to-coast magnitude).
 */
export function buildWorldElevation(
  grid: WorldGrid,
  rasterLod: number,
  etopoPath: string,
): WorldElevation | null {
  if (!fs.existsSync(etopoPath)) return null;
  const buf = fs.readFileSync(etopoPath);
  if (buf.length !== ETOPO_W * ETOPO_H * 2) {
    throw new Error(
      `unexpected ETOPO1 size ${buf.length} (want ${ETOPO_W * ETOPO_H * 2})`,
    );
  }
  const width = grid.width(rasterLod);
  const height = grid.height(rasterLod);
  const data = new Int16Array(width * height).fill(ETOPO_NODATA);
  const scale = 1 / (1 << rasterLod);

  const step = 1 / 60; // ETOPO1 cell size in degrees
  for (let row = 0; row < ETOPO_H; row++) {
    const lat = 90 - row * step;
    // Equal Earth x is linear in longitude at fixed latitude: project the
    // row's endpoints once and interpolate.
    const west = grid.geoToWorld(-180, lat);
    const east = grid.geoToWorld(180, lat);
    const y = Math.min(height - 1, Math.floor(west.y * scale));
    const rowOff = y * width;
    const x0 = west.x * scale;
    const dx = ((east.x - west.x) * scale) / (ETOPO_W - 1);
    const rowByteOff = row * ETOPO_W * 2;
    for (let col = 0; col < ETOPO_W; col++) {
      const x = Math.min(width - 1, Math.floor(x0 + dx * col));
      const e = buf.readInt16LE(rowByteOff + col * 2);
      const i = rowOff + x;
      if (e > data[i] || data[i] === ETOPO_NODATA) data[i] = e;
    }
  }

  // Fill any unprojected cells from the nearest filled cell to the left,
  // then (for leading gaps) to the right. Rows are dense in practice; this
  // guards edges where the projection compresses.
  for (let y = 0; y < height; y++) {
    const off = y * width;
    let last = ETOPO_NODATA;
    for (let x = 0; x < width; x++) {
      if (data[off + x] === ETOPO_NODATA) data[off + x] = last;
      else last = data[off + x];
    }
    last = ETOPO_NODATA;
    for (let x = width - 1; x >= 0; x--) {
      if (data[off + x] === ETOPO_NODATA) data[off + x] = last;
      else last = data[off + x];
    }
  }

  return {
    lod: rasterLod,
    width,
    height,
    data,
    at(lod: number, x: number, y: number): number {
      const shift = rasterLod - lod;
      const rx =
        shift >= 0
          ? Math.min(width - 1, x >> shift)
          : Math.min(width - 1, x << -shift);
      const ry =
        shift >= 0
          ? Math.min(height - 1, y >> shift)
          : Math.min(height - 1, y << -shift);
      return data[ry * width + rx];
    },
  };
}

/**
 * Land magnitude (1–24, never ≥25) from elevation in metres. Bands follow
 * the engine's visual tiers: plains → highland → mountain.
 */
export function landMagnitudeFromElevation(metres: number): number {
  const e = metres;
  if (e <= 0) return 1; // below-sea-level land (Lake Eyre basin…)
  if (e <= 150) return Math.max(1, Math.round((e / 150) * 9));
  if (e <= 600) return 10 + Math.floor(((e - 150) / 450) * 6);
  if (e <= 1500) return 16 + Math.floor(((e - 600) / 900) * 4);
  return Math.min(24, 20 + Math.floor((e - 1500) / 700));
}

/** Water magnitude (0–31) from depth in metres (bathymetric shading). */
export function waterMagnitudeFromDepth(metres: number): number {
  const depth = Math.max(0, -metres);
  return Math.min(31, Math.round(Math.sqrt(depth) / 3));
}
