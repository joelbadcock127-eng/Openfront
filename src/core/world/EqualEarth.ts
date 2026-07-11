/**
 * Equal Earth projection (Šavrič, Patterson & Jenny, 2018).
 *
 * Chosen for the continuous world map because it is equal-area — territory
 * near the poles is not inflated the way Web Mercator inflates it, so a
 * square kilometre of gameplay territory is worth roughly the same anywhere
 * on Earth — while still looking like a familiar world map.
 *
 * Implemented natively (same polynomial form as d3-geo's equalEarthRaw) so
 * the data pipeline (Node) and the client share one deterministic
 * implementation with no runtime dependency.
 *
 * Units: longitude/latitude in degrees; projected x/y in "Equal Earth
 * radians" for a unit sphere. x ∈ [-2.7066…, 2.7066…], y ∈ [-1.3173…, 1.3173…].
 * Projected y grows north; grid conversion (WorldGrid) flips it.
 */

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const RAD = Math.PI / 180;

/** Project lon/lat (degrees) to Equal Earth x/y (unit sphere). */
export function equalEarthForward(
  lonDeg: number,
  latDeg: number,
): [number, number] {
  const lambda = lonDeg * RAD;
  const phi = latDeg * RAD;
  const l = Math.asin(M * Math.sin(phi));
  const l2 = l * l;
  const l6 = l2 * l2 * l2;
  return [
    (lambda * Math.cos(l)) /
      (M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2))),
    l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2)),
  ];
}

/** Invert Equal Earth x/y back to lon/lat (degrees). Newton iteration. */
export function equalEarthInvert(x: number, y: number): [number, number] {
  let l = y;
  for (let i = 0; i < 12; i++) {
    const l2 = l * l;
    const l6 = l2 * l2 * l2;
    const fy = l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2)) - y;
    const fpy = A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2);
    const delta = fy / fpy;
    l -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  const l2 = l * l;
  const l6 = l2 * l2 * l2;
  const lambda =
    (M * x * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2))) / Math.cos(l);
  const phi = Math.asin(Math.sin(l) / M);
  return [lambda / RAD, phi / RAD];
}

/** Projected extent of the full Earth: [maxX, maxY] (symmetric about 0). */
export function equalEarthExtent(): [number, number] {
  const [maxX] = equalEarthForward(180, 0);
  const [, maxY] = equalEarthForward(0, 90);
  return [maxX, maxY];
}
