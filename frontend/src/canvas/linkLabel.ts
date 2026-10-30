/**
 * Where a two-device link's label sits along its link (FR-50).
 *
 * Crossing links of much the same length put their labels at the same
 * midpoint, one on top of another. A label can be slid along its own link,
 * and stays on the line wherever it is put. Its place is the curve's
 * parameter t, from the first device's end: 0.5 is the middle, where React
 * Flow puts a label, and is the default.
 *
 * Pure geometry on the path React Flow draws, `M sx,sy C c1x,c1y c2x,c2y tx,ty`,
 * so it is tested without a browser; jsdom has no `getPointAtLength`.
 */

export interface Point {
  x: number;
  y: number;
}

export type Cubic = [Point, Point, Point, Point];

/** The ends a label may be slid to, short of the devices themselves. */
export const LABEL_MIN = 0.05;
export const LABEL_MAX = 0.95;

export function clampLabelAt(t: number): number {
  return Math.round(Math.min(LABEL_MAX, Math.max(LABEL_MIN, t)) * 1000) / 1000;
}

/** The four points of a cubic bezier path, or null for any other path. */
export function parseCubic(path: string): Cubic | null {
  const numbers = path.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)?.map(Number);
  if (!/^\s*M/.test(path) || !/C/.test(path) || numbers?.length !== 8) return null;
  const [a, b, c, d, e, f, g, h] = numbers as [number, number, number, number, number, number, number, number];
  return [
    { x: a, y: b },
    { x: c, y: d },
    { x: e, y: f },
    { x: g, y: h },
  ];
}

export function cubicPoint([p0, p1, p2, p3]: Cubic, t: number): Point {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
    y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
  };
}

/**
 * The parameter of the point on the curve nearest to `p`, within the range a
 * label may take: sampled, then refined around the best sample.
 */
export function nearestT(curve: Cubic, p: Point, samples = 64): number {
  const distance = (t: number) => {
    const q = cubicPoint(curve, t);
    return (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  };
  let best = LABEL_MIN;
  for (let i = 0; i <= samples; i++) {
    const t = LABEL_MIN + ((LABEL_MAX - LABEL_MIN) * i) / samples;
    if (distance(t) < distance(best)) best = t;
  }
  let step = (LABEL_MAX - LABEL_MIN) / samples;
  for (let round = 0; round < 12; round++) {
    step /= 2;
    for (const t of [best - step, best + step]) {
      if (t >= LABEL_MIN && t <= LABEL_MAX && distance(t) < distance(best)) best = t;
    }
  }
  return clampLabelAt(best);
}
