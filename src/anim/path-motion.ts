/**
 * Motion along a path: a node's translation, and with `rotate` its angle,
 * baked from an SVG `d` into keyframes the core plays — GSAP's
 * MotionPathPlugin and CSS `offset-path` as data, not as an engine property.
 *
 * The `d` goes through the same normalisation a `<Path>` does
 * (`normalizePathData` in the vendored `framework/compiler/path-data.ts`), so
 * a node follows exactly the cubics a `<Path>` with that `d` draws, arcs
 * included, through the same viewBox mapping (xMidYMid meet). Its position is
 * a fraction of arc length, eased in time by the caller's easing, sampled on
 * the realm's 60 Hz tick and written as linear keyframes; the animation that
 * plays them is `linear`, so nothing depends on how the baker would ease a
 * segment.
 *
 * Determinism: the keyframe values reach the pak, so they are computed with
 * + - * / and Math.sqrt alone. Arc length is measured on 64 chords a cubic; a
 * point is the cubic evaluated at the parameter those chords put the
 * fraction at, so it is on the curve whatever the chord count; the angle is
 * `atan2Deg` below, a series in f64 after exact reductions, never the host's
 * Math.atan2.
 *
 * What the shutter sees (patches/0034, measured in
 * `baselines/path-primitives.md`). Keys sit every `every` ticks; between them
 * the node moves on the chord. A frame at `fps` shows the tick
 * `(f + 1) * 60 / fps - 1` of the clock, so at 30 fps an animation whose delay
 * is a whole number of 30 fps frames shows odd ticks, and the default keys —
 * tick 0, every odd tick, the last tick — put every frame's position on the
 * curve. A shutter samples between ticks and never across a one-tick segment
 * (it reads one as a cut), so keys every tick (`every: 1`) are exact at every
 * tick and stay sharp under a shutter, and keys every second tick blur along
 * the chords. `chordError` reports how far a chord strays from the curve,
 * at the ticks and between them, so a caller can see the price before a
 * render does.
 */

import { fileURLToPath } from "node:url";
import type { Stops } from "./sampled.ts";

// The vendored compiler, as `pocketjsRoot()` (src/runtime/boot.ts) finds it,
// by a computed specifier: `vendor/` does not typecheck under this
// repository's settings, and importing boot would load the core to read a path.
const VENDOR = process.env.POCKETJS_ROOT ?? fileURLToPath(new URL("../../vendor/pocketjs", import.meta.url));
interface NormalPath {
  verbs: number[];
  pts: number[];
}
const { normalizePathData, parseViewBox } = (await import(`${VENDOR}/framework/compiler/path-data.ts`)) as {
  normalizePathData(d: string): NormalPath;
  parseViewBox(viewBox: string): [number, number, number, number];
};
/** PATH TABLE verbs (`PATH_VERB` in the vendored spec). */
const PATH_VERB = { move: 0, line: 1, cubic: 2, close: 3 } as const;

/** The realm's tick rate: keyframe ticks are 60 Hz (`assertBakedTickRate`). */
const HZ = 60;
const CHORDS = 64;

// ---- angle --------------------------------------------------------------------------

/** atan(z) for 0 <= z <= 1: two half-angle steps, then the series (|w| <= tan(pi/16)). */
function atanUnit(z: number): number {
  let w = z;
  for (let i = 0; i < 2; i++) w = w / (1 + Math.sqrt(1 + w * w));
  const w2 = w * w;
  let term = w;
  let sum = w;
  for (let n = 1; n <= 12; n++) {
    term *= -w2;
    sum += term / (2 * n + 1);
  }
  return 4 * sum;
}

/**
 * The angle of (x, y) in degrees, in (-180, 180], from + - * / and sqrt: the
 * octant is reduced exactly by swaps and signs, so the axes and diagonals
 * come out exact and every other direction is the same bits on every host.
 * (0, 0) is 0.
 */
export function atan2Deg(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x), ay = Math.abs(y);
  const swap = ay > ax;
  const z = swap ? ax / ay : ay / ax;
  let deg = z === 1 ? 45 : (atanUnit(z) * 180) / Math.PI;
  if (swap) deg = 90 - deg;
  if (x < 0) deg = 180 - deg;
  return y < 0 ? -deg : deg;
}

// ---- the follower --------------------------------------------------------------------

type Seg = { x0: number; y0: number; c: [number, number, number, number, number, number] };

/** Where a `<Path>` draws: its box in the containing block, and its viewBox if it has one. */
export interface PathPlacement {
  /** `"x y w h"`, as the `<Path>`'s viewBox attribute. */
  viewBox?: string;
  /** The `<Path>`'s box (left, top, width, height) in the containing block; needed with a viewBox. */
  box?: { x: number; y: number; w: number; h: number };
}

/** A point on the path and the direction of travel there, in the containing block's px. */
export interface PathPoint {
  x: number;
  y: number;
  /** Degrees, clockwise from +x on screen (y runs down), in (-180, 180]. */
  angle: number;
}

/**
 * A `d` as the outline a `<Path>` draws, measured by arc length. Subpaths are
 * followed in order, joined by the jump between them (a move has no length,
 * so the node is there for no time at all); a closed subpath's closing edge
 * is part of it.
 */
export class PathFollower {
  private readonly segs: Seg[] = [];
  private readonly cum: number[][] = [];
  private readonly starts: number[] = [];
  /** Arc length in the containing block's px. */
  readonly length: number;

  constructor(d: string, place: PathPlacement = {}) {
    const p: NormalPath = normalizePathData(d);
    // The viewBox mapping a `<Path>` applies (`local_frame` in the core): meet, centred.
    let s = 1, tx = place.box?.x ?? 0, ty = place.box?.y ?? 0;
    if (place.viewBox !== undefined) {
      if (!place.box) throw new Error("PathFollower: a viewBox needs the <Path>'s box to map onto");
      const [vx, vy, vw, vh] = parseViewBox(place.viewBox);
      const { w, h } = place.box;
      s = Math.min(w / vw, h / vh);
      tx += (w - vw * s) * 0.5 - vx * s;
      ty += (h - vh * s) * 0.5 - vy * s;
    }
    const X = (v: number): number => tx + v * s;
    const Y = (v: number): number => ty + v * s;
    let k = 0, cx = 0, cy = 0, sx = 0, sy = 0;
    const line = (x: number, y: number): void => {
      const dx = x - cx, dy = y - cy;
      this.segs.push({ x0: cx, y0: cy, c: [cx + dx / 3, cy + dy / 3, cx + (2 * dx) / 3, cy + (2 * dy) / 3, x, y] });
      cx = x;
      cy = y;
    };
    for (const v of p.verbs) {
      if (v === PATH_VERB.move) {
        cx = sx = X(p.pts[k]!);
        cy = sy = Y(p.pts[k + 1]!);
        k += 2;
      } else if (v === PATH_VERB.line) {
        line(X(p.pts[k]!), Y(p.pts[k + 1]!));
        k += 2;
      } else if (v === PATH_VERB.cubic) {
        const q = p.pts.slice(k, k + 6);
        const c: Seg["c"] = [X(q[0]!), Y(q[1]!), X(q[2]!), Y(q[3]!), X(q[4]!), Y(q[5]!)];
        this.segs.push({ x0: cx, y0: cy, c });
        cx = c[4];
        cy = c[5];
        k += 6;
      } else if (cx !== sx || cy !== sy) {
        line(sx, sy);
      }
    }
    if (this.segs.length === 0) throw new Error(`PathFollower: ${JSON.stringify(d)} has no length to follow`);
    let total = 0;
    for (const g of this.segs) {
      const row = [0];
      let [px, py] = [g.x0, g.y0];
      let acc = 0;
      for (let j = 1; j <= CHORDS; j++) {
        const [x, y] = bez(g, j / CHORDS);
        acc += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
        row.push(acc);
        px = x;
        py = y;
      }
      this.starts.push(total);
      this.cum.push(row);
      total += acc;
    }
    if (!(total > 0)) throw new Error(`PathFollower: ${JSON.stringify(d)} has no length to follow`);
    this.length = total;
  }

  /** The point at fraction `u` of the arc length (clamped to [0, 1]). */
  at(u: number): PathPoint {
    const at = (u <= 0 ? 0 : u >= 1 ? 1 : u) * this.length;
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= at) lo = mid;
      else hi = mid - 1;
    }
    // A cubic with no length (a move's jump, a repeated point) is skipped forward.
    while (lo + 1 < this.segs.length && this.starts[lo + 1]! === this.starts[lo]!) lo++;
    const row = this.cum[lo]!;
    const local = at - this.starts[lo]!;
    let j = 0;
    while (j + 1 < CHORDS && row[j + 1]! < local) j++;
    const span = row[j + 1]! - row[j]!;
    const f = span > 0 ? Math.min(1, Math.max(0, (local - row[j]!) / span)) : 0;
    const t = (j + f) / CHORDS;
    const g = this.segs[lo]!;
    const [x, y] = bez(g, t);
    let [dx, dy] = deriv(g, t);
    if (!(dx * dx + dy * dy > 1e-18)) {
      // A cusp or a control point on its end: the direction to a point just along.
      const e = t < 0.5 ? 1e-4 : -1e-4;
      const [qx, qy] = bez(g, t + e);
      [dx, dy] = e > 0 ? [qx - x, qy - y] : [x - qx, y - qy];
    }
    return { x, y, angle: atan2Deg(dy, dx) };
  }
}

function bez(g: Seg, t: number): [number, number] {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return [a * g.x0 + b * g.c[0] + c * g.c[2] + d * g.c[4], a * g.y0 + b * g.c[1] + c * g.c[3] + d * g.c[5]];
}

function deriv(g: Seg, t: number): [number, number] {
  const mt = 1 - t;
  const a = 3 * mt * mt, b = 6 * mt * t, c = 3 * t * t;
  return [
    a * (g.c[0] - g.x0) + b * (g.c[2] - g.c[0]) + c * (g.c[4] - g.c[2]),
    a * (g.c[1] - g.y0) + b * (g.c[3] - g.c[1]) + c * (g.c[5] - g.c[3]),
  ];
}

// ---- keys ------------------------------------------------------------------------------

/** The ticks a move over [0, ticks] is keyed on: 0, then every `every`-th tick from `phase`, and the last. */
export function keyTicks(ticks: number, every: number, phase: number): number[] {
  const out = [0];
  for (let t = phase; t < ticks; t += every) if (t > 0) out.push(t);
  if (out[out.length - 1] !== ticks) out.push(ticks);
  return out;
}

/** Degrees moved by whole turns so each differs from the one before by at most 180. */
export function unwrapDegrees(angles: number[]): number[] {
  const out: number[] = [];
  for (const a of angles) {
    if (out.length === 0) {
      out.push(a);
      continue;
    }
    const prev = out[out.length - 1]!;
    let v = a;
    while (v - prev > 180) v -= 360;
    while (v - prev <= -180) v += 360;
    out.push(v);
  }
  return out;
}

export interface MotionPathOptions {
  /** The path, as a `<Path>`'s `d`. */
  d: string;
  /** Where the `<Path>` drawing it sits, when the node follows a drawn outline with a viewBox. */
  path?: PathPlacement;
  /**
   * The moving node's box (left, top, width, height) in the same containing
   * block: its centre is put on the path, and it turns about its centre
   * (the default transform origin). Without it, the path's coordinates ARE
   * the node's translation (GSAP's default without `align`).
   */
  node?: { x: number; y: number; w: number; h: number };
  /** Milliseconds, a whole number of 60 Hz ticks or it is rounded to one, as the baker rounds. */
  durationMs: number;
  /** Progress in time, u in [0, 1] -> [0, 1] (`bezier`, `inOut` … in `sampled.ts`). Default linear. */
  ease?: (u: number) => number;
  /** Fractions of the arc length the move runs between (default 0 and 1; `to < from` runs backward). */
  from?: number;
  to?: number;
  /** Turn with the path: true, or degrees added to the direction of travel. Default: no rotation. */
  rotate?: boolean | number;
  /** Ticks between keys: 2 (default) blurs under a shutter, 1 is exact at every tick and stays sharp. */
  every?: 1 | 2;
}

export interface MotionPath {
  /** The keyframe set: translateX/translateY in px, rotate in degrees when asked. */
  keyframes: Stops;
  /**
   * The animation shorthand that plays it under `name`: linear, after
   * `delayMs` (0), `iterations` times (1, or "infinite" for a closed path
   * walked from 0 to 1), with `fill` (`both`).
   */
  value(name: string, o?: { delayMs?: number; iterations?: number | "infinite"; fill?: "both" | "forwards" | "backwards" | "none" }): string;
  ticks: number;
  /** How far the keyed motion strays from the curve, px: at the keyed ticks' neighbours and between ticks. */
  chordError: { atTicks: number; betweenTicks: number };
}

const r3 = (v: number): number => (Math.abs(v) < 1e-6 ? 0 : Math.round(v * 1000) / 1000);

/** A node moving along `d` over `durationMs`, as one keyframe set. */
export function motionPath(o: MotionPathOptions): MotionPath {
  const f = new PathFollower(o.d, o.path);
  const ticks = Math.round((o.durationMs * HZ) / 1000);
  if (!(ticks >= 1)) throw new Error(`motionPath: ${o.durationMs} ms is less than one tick`);
  const every = o.every ?? 2;
  const ease = o.ease ?? ((u: number) => u);
  const from = o.from ?? 0;
  const to = o.to ?? 1;
  const origin = o.node ? { x: o.node.x + o.node.w / 2, y: o.node.y + o.node.h / 2 } : { x: 0, y: 0 };
  const pointAt = (tick: number): PathPoint => f.at(from + (to - from) * ease(tick / ticks));
  const keys = keyTicks(ticks, every, 1);
  const pts = keys.map(pointAt);
  const turn = o.rotate === undefined || o.rotate === false ? null : o.rotate === true ? 0 : o.rotate;
  const back = to < from ? 180 : 0;
  const angles = turn === null ? [] : unwrapDegrees(pts.map((p) => p.angle + back + turn));
  const keyframes: Stops = {};
  keys.forEach((t, i) => {
    const pct = t === 0 ? "0%" : t === ticks ? "100%" : `${((t * 100) / ticks).toFixed(4)}%`;
    const v: Record<string, string> = {
      translateX: `${r3(pts[i]!.x - origin.x)}px`,
      translateY: `${r3(pts[i]!.y - origin.y)}px`,
    };
    if (turn !== null) v.rotate = `${r3(angles[i]!)}deg`;
    keyframes[pct] = v;
  });
  // The chord against the curve, at every tick and at eight instants inside each.
  let atTicks = 0, betweenTicks = 0;
  for (let i = 0; i + 1 < keys.length; i++) {
    const [a, b] = [keys[i]!, keys[i + 1]!];
    for (let q = 0; q <= 8 * (b - a); q++) {
      const t = a + q / 8;
      const u = (t - a) / (b - a);
      const lx = pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * u;
      const ly = pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * u;
      const p = pointAt(t);
      const err = Math.sqrt((lx - p.x) * (lx - p.x) + (ly - p.y) * (ly - p.y));
      if (q % 8 === 0) atTicks = Math.max(atTicks, err);
      else betweenTicks = Math.max(betweenTicks, err);
    }
  }
  return {
    keyframes,
    ticks,
    chordError: { atTicks, betweenTicks },
    value: (name, v = {}) =>
      `${name} ${o.durationMs}ms linear ${v.delayMs ?? 0}ms${v.iterations === undefined ? "" : ` ${v.iterations}`} ${v.fill ?? "both"}`,
  };
}
