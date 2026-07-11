import {
  equalEarthExtent,
  equalEarthForward,
  equalEarthInvert,
} from "../../src/core/world/EqualEarth";
import { CHUNK_SIZE, WorldGrid } from "../../src/core/world/WorldGrid";

const grid = new WorldGrid({ w0: 65536, h0: 32768, maxLod: 6 });

describe("Equal Earth projection", () => {
  test("forward/invert roundtrip over the globe", () => {
    for (let lon = -175; lon <= 175; lon += 25) {
      for (let lat = -85; lat <= 85; lat += 17) {
        const [x, y] = equalEarthForward(lon, lat);
        const [lon2, lat2] = equalEarthInvert(x, y);
        expect(lon2).toBeCloseTo(lon, 6);
        expect(lat2).toBeCloseTo(lat, 6);
      }
    }
  });

  test("extent is symmetric and matches published aspect (~2.05)", () => {
    const [ex, ey] = equalEarthExtent();
    expect(ex).toBeGreaterThan(0);
    expect(ey).toBeGreaterThan(0);
    expect(ex / ey).toBeCloseTo(2.05, 1);
    const [xw] = equalEarthForward(-180, 0);
    expect(xw).toBeCloseTo(-ex, 9);
  });

  test("equal-area property: no polar inflation vs Mercator", () => {
    // A 1°×1° patch at lat 70 must project to roughly the same area as at
    // the equator (equal-area), not ~3× larger as under Mercator.
    const area = (lat: number): number => {
      const [x0, y0] = equalEarthForward(0, lat);
      const [x1] = equalEarthForward(1, lat);
      const [, y1] = equalEarthForward(0, lat + 1);
      // The patch is a near-parallelogram; |dx * dy| approximates its area.
      return Math.abs((x1 - x0) * (y1 - y0)) * Math.cos(0); // dx at given lat
    };
    // cos(lat) shrink of true ground area is expected; compare projected
    // area per true ground area instead.
    const perGround = (lat: number): number =>
      area(lat) / Math.cos((lat * Math.PI) / 180);
    expect(perGround(70) / perGround(0)).toBeGreaterThan(0.85);
    expect(perGround(70) / perGround(0)).toBeLessThan(1.15);
  });
});

describe("WorldGrid coordinates", () => {
  test("geo → world → geo roundtrip is stable", () => {
    const samples: Array<[number, number]> = [
      [146.35, -41.18], // Devonport
      [0, 51.5], // London
      [-74, 40.7], // New York
      [151.2, -33.9], // Sydney
      [-179.5, 65], // near date line west
      [179.5, 65], // near date line east
    ];
    for (const [lon, lat] of samples) {
      const w = grid.geoToWorld(lon, lat);
      const g = grid.worldToGeo(w.x, w.y);
      expect(g.lon).toBeCloseTo(lon, 5);
      expect(g.lat).toBeCloseTo(lat, 5);
    }
  });

  test("world coordinates are stable and screen-independent", () => {
    const a = grid.geoToWorld(146.35, -41.18);
    const b = grid.geoToWorld(146.35, -41.18);
    expect(a).toEqual(b);
    expect(a.x).toBeGreaterThan(0);
    expect(a.x).toBeLessThan(65536);
    expect(a.y).toBeGreaterThan(0);
    expect(a.y).toBeLessThan(32768);
  });

  test("longitude edges map to world edges without wrapping", () => {
    const west = grid.geoToWorld(-180, 0);
    const east = grid.geoToWorld(180, 0);
    expect(west.x).toBeCloseTo(0, 6);
    expect(east.x).toBeCloseTo(65536, 6);
  });

  test("LOD and chunk addressing", () => {
    expect(grid.width(0)).toBe(65536);
    expect(grid.width(2)).toBe(16384);
    expect(grid.width(6)).toBe(1024);
    expect(grid.chunkCols(6)).toBe(4);
    expect(grid.chunkRows(6)).toBe(2);
    expect(grid.toLod(1000, 2000, 2)).toEqual({ x: 250, y: 500 });
    expect(grid.cellToChunk(300, 511)).toEqual({
      chunkX: 1,
      chunkY: 1,
      ox: 300 - CHUNK_SIZE,
      oy: 511 - CHUNK_SIZE,
    });
  });
});
