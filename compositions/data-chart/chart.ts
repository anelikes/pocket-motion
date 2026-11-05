// Path data computed from rows at mount — what d3-shape's `line()` with
// `curveMonotoneX`, `area()` and a symbol generator return, written out so
// the fixture needs no package. Every step is + - * / and Math.abs/min/round:
// none of the host's transcendental functions, whose last bit is the
// machine's (AGENTS.md). The outlines are strings the build cannot read where
// they are written; it mounts the bundle, takes them from the tree and bakes
// them (patches/0054).

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Hundredths: a short `d`, and the same digits on every host. */
function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? "0" : String(r);
}

/**
 * The tangent at each point of a monotone cubic through `pts` (Fritsch and
 * Carlson, as d3's curveMonotoneX computes it): never overshoots a
 * neighbour, so a series that only rises is drawn only rising.
 */
function tangents(pts: readonly Point[]): number[] {
  const last = pts.length - 1;
  const h = (i: number): number => pts[i + 1]!.x - pts[i]!.x;
  const s = (i: number): number => (pts[i + 1]!.y - pts[i]!.y) / h(i);
  const sign = (v: number): number => (v < 0 ? -1 : 1);
  const t: number[] = new Array(pts.length).fill(0);
  for (let i = 1; i < last; i++) {
    const s0 = s(i - 1);
    const s1 = s(i);
    const p = (s0 * h(i) + s1 * h(i - 1)) / (h(i - 1) + h(i));
    t[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  t[0] = (3 * s(0) - t[1]!) / 2;
  t[last] = (3 * s(last - 1) - t[last - 1]!) / 2;
  return t;
}

/** The series as one open path of cubics. */
export function monotoneX(pts: readonly Point[]): string {
  const t = tangents(pts);
  let d = `M${n(pts[0]!.x)} ${n(pts[0]!.y)}`;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = (b.x - a.x) / 3;
    d += `C${n(a.x + dx)} ${n(a.y + dx * t[i]!)} ${n(b.x - dx)} ${n(b.y - dx * t[i + 1]!)} ${n(b.x)} ${n(b.y)}`;
  }
  return d;
}

/** The region under the series, closed along `floor`. */
export function areaUnder(pts: readonly Point[], floor: number): string {
  const last = pts[pts.length - 1]!;
  return `${monotoneX(pts)}L${n(last.x)} ${n(floor)}L${n(pts[0]!.x)} ${n(floor)}Z`;
}

/** A disc of radius `r` at each point, one subpath each. */
export function dots(pts: readonly Point[], r: number): string {
  return pts.map((p) => `M${n(p.x + r)} ${n(p.y)}A${r} ${r} 0 1 1 ${n(p.x - r)} ${n(p.y)}A${r} ${r} 0 1 1 ${n(p.x + r)} ${n(p.y)}Z`).join("");
}

/** Horizontal rules at `count` + 1 even steps from `top` to `bottom`, `width` long. */
export function rules(width: number, top: number, bottom: number, count: number): string {
  let d = "";
  for (let i = 0; i <= count; i++) {
    const y = top + ((bottom - top) * i) / count;
    d += `M0 ${n(y)}L${n(width)} ${n(y)}`;
  }
  return d;
}
