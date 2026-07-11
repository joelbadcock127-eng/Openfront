/**
 * Scanline polygon rasterizer for the world build pipeline.
 *
 * Fills projected GeoJSON polygons into a byte grid using the even-odd rule
 * (holes come out automatically when all rings of a polygon are rasterized
 * together). Edges are straight lines between projected vertices — at
 * Natural Earth 10m vertex density the deviation from true projected arcs
 * is far below one cell.
 */

export interface Grid {
  width: number;
  height: number;
  /** 1 byte per cell; rasterizer sets/clears bit 0 style values via ops. */
  data: Uint8Array;
}

export type ProjectFn = (lon: number, lat: number) => { x: number; y: number };

type Ring = Array<[number, number]>; // projected grid coords

/** GeoJSON geometry (Polygon | MultiPolygon) → list of polygons (ring sets). */
export function geometryToPolygons(
  geometry: {
    type: string;
    coordinates: unknown;
  },
  project: ProjectFn,
): Ring[][] {
  const projectRing = (ring: Array<[number, number]>): Ring =>
    ring.map(([lon, lat]) => {
      const p = project(lon, lat);
      return [p.x, p.y] as [number, number];
    });

  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as Array<Array<[number, number]>>;
    return [rings.map(projectRing)];
  }
  if (geometry.type === "MultiPolygon") {
    const polys = geometry.coordinates as Array<Array<Array<[number, number]>>>;
    return polys.map((rings) => rings.map(projectRing));
  }
  return [];
}

/**
 * Fill one polygon (outer ring + holes, even-odd) into the grid.
 * `value === 1` sets cells to `setTo`; used both for painting land and for
 * painting lakes back to water. Fills are clipped to [clipX0,clipX1)×[clipY0,clipY1).
 */
export function fillPolygon(
  grid: Grid,
  rings: Ring[],
  setTo: number,
  clipX0 = 0,
  clipY0 = 0,
  clipX1 = grid.width,
  clipY1 = grid.height,
): void {
  // Row range spanned by the polygon (clipped).
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [, y] of ring) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const rowStart = Math.max(clipY0, Math.floor(minY));
  const rowEnd = Math.min(clipY1 - 1, Math.ceil(maxY));
  if (rowEnd < rowStart) return;

  // Crossings per row. Sample at row centre (row + 0.5).
  const rows: number[][] = new Array(rowEnd - rowStart + 1);

  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      if (y1 === y2) continue; // horizontal edges contribute no crossings
      const yLo = Math.min(y1, y2);
      const yHi = Math.max(y1, y2);
      // Rows whose centre lies in [yLo, yHi)
      const r0 = Math.max(rowStart, Math.ceil(yLo - 0.5));
      const r1 = Math.min(rowEnd, Math.ceil(yHi - 0.5) - 1);
      const invDy = 1 / (y2 - y1);
      for (let r = r0; r <= r1; r++) {
        const yc = r + 0.5;
        const x = x1 + (yc - y1) * (x2 - x1) * invDy;
        (rows[r - rowStart] ??= []).push(x);
      }
    }
  }

  const { data, width } = grid;
  for (let r = rowStart; r <= rowEnd; r++) {
    const xs = rows[r - rowStart];
    if (!xs || xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const rowOff = r * width;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      // Cells whose centre (x + 0.5) lies within [xs[i], xs[i+1])
      let cx0 = Math.ceil(xs[i] - 0.5);
      let cx1 = Math.ceil(xs[i + 1] - 0.5) - 1;
      if (cx0 < clipX0) cx0 = clipX0;
      if (cx1 > clipX1 - 1) cx1 = clipX1 - 1;
      if (cx1 < cx0) continue;
      data.fill(setTo, rowOff + cx0, rowOff + cx1 + 1);
    }
  }
}

/** Rasterize a GeoJSON FeatureCollection's polygons into the grid. */
export function rasterizeFeatures(
  grid: Grid,
  features: Array<{ geometry: { type: string; coordinates: unknown } }>,
  project: ProjectFn,
  setTo: number,
  clipX0 = 0,
  clipY0 = 0,
  clipX1 = grid.width,
  clipY1 = grid.height,
): void {
  for (const f of features) {
    if (!f.geometry) continue;
    for (const rings of geometryToPolygons(f.geometry, project)) {
      fillPolygon(grid, rings, setTo, clipX0, clipY0, clipX1, clipY1);
    }
  }
}
