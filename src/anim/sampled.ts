/**
 * Motion a generator computes itself, baked as linear keyframes the core
 * plays.
 *
 * An element's centre, rotation, scale and opacity are sampled here on the
 * realm's 60 Hz tick with the easing applied in this file, and written as
 * linear keyframes. A rotation about any pivot is then an exact arc, a
 * landing is exactly where it was computed to be, and nothing depends on how
 * the baker would ease a segment. `Reg` collects the keyframe sets and the
 * named animations a generator writes into `pocket.config.ts`; `El` is one
 * element's state over the film.
 *
 * Three limits of the format are enforced here rather than discovered in a
 * render, each because a generator in this tree once hit it:
 *
 *   - a track holds at most 255 segments, so `prop` and `El.entry` refuse
 *     more than 250 keys instead of letting the build fail later;
 *   - `step` keys `t - 1` and `t` for every change, so changes on the same or
 *     a decreasing tick cross their keys and bake as a ramp from tick 0 —
 *     refused;
 *   - `El.path` holds the state before it starts with a key at `t0 - 1`,
 *     unless one is already there: after `set(t0, …)` that key is the state
 *     BEFORE the change, and overwriting it ramped the change in from tick 0.
 *
 * A frame shows tick `2f` at 30 fps and tick `f` at 60 fps, so an instant
 * meant to be seen at 30 fps belongs on an even tick.
 */

export const inOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
export const outExpo = (u: number) => (u >= 1 ? 1 : 1 - 2 ** (-10 * u));
export const outCubic = (u: number) => 1 - (1 - u) ** 3;
export const inCubic = (u: number) => u * u * u;
export const linear = (u: number) => u;
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` as an easing of u in [0, 1]: x is solved
 * for u by bisection (40 halvings, below 1e-12), then y is read. Endpoints
 * are exact.
 */
export function bezier(x1: number, y1: number, x2: number, y2: number): (u: number) => number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (u: number) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < u) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

/** A seeded generator in [0, 1) (mulberry32): the same seed gives the same film. */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A JSX text child for a string: `{"…"}`, escaped. */
export const jsxText = (s: string) => `{${JSON.stringify(s)}}`;

const r3 = (v: number) => (Math.abs(v) < 1e-6 ? 0 : Math.round(v * 1000) / 1000);

export type Stops = Record<string, Record<string, string>>;

/** The largest key count a single track is given; the baker's limit is 255 segments. */
export const MAX_KEYS = 250;

export class Reg {
  readonly keyframes: Record<string, Stops> = {};
  readonly animation: Record<string, string> = {};
  readonly loops: Record<string, { value: string; loop: string }> = {};
  private n = 0;
  constructor(
    readonly ticks: number,
    readonly durMs: number,
  ) {}

  pct(t: number): string {
    return `${((Math.max(0, Math.min(this.ticks, t)) * 100) / this.ticks).toFixed(4)}%`;
  }

  /** A whole-film keyframe set, eased per segment by `easing`. Returns the comma-list entry. */
  film(stops: Stops, easing = "linear"): string {
    const name = `f${(this.n++).toString(36)}`;
    this.keyframes[name] = stops;
    return `${name} ${this.durMs}ms ${easing} 0ms both`;
  }

  /** Register a comma list as a named animation; returns the name for `animate-<name>`. */
  anim(list: string | string[]): string {
    const name = `a${(this.n++).toString(36)}`;
    this.animation[name] = Array.isArray(list) ? list.join(", ") : list;
    return name;
  }

  /** A comma list that restarts every `periodTicks`. */
  loop(list: string | string[], periodTicks: number): string {
    const name = `l${(this.n++).toString(36)}`;
    this.loops[name] = { value: Array.isArray(list) ? list.join(", ") : list, loop: `${Math.round((periodTicks * this.durMs) / this.ticks)}ms` };
    return name;
  }

  /** A keyframe set of `periodTicks` length (for use inside `loop`). */
  short(stops: Stops, periodTicks: number, easing = "linear", delayTicks = 0, fill = "both"): string {
    const name = `s${(this.n++).toString(36)}`;
    this.keyframes[name] = stops;
    const ms = (t: number) => Math.round((t * this.durMs) / this.ticks);
    return `${name} ${ms(periodTicks)}ms ${easing} ${ms(delayTicks)}ms ${fill}`;
  }

  /**
   * One property through a list of [tick, value] keys, sorted here. Between
   * keys it interpolates, each segment eased by `easing`; the first value
   * holds before the first key and the last after the last.
   */
  prop(prop: string, keys: [number, string][], easing = "linear"): string {
    // a key past the film's end clamps onto 100 %, where a later key overwrites it: the track then ramps from its
    // first value to the last over the whole film. A typed line whose last glyphs fell after the final tick was
    // faintly on screen from the first second as a stray "108".
    const late = keys.find(([t]) => t > this.ticks);
    if (late) throw new Error(`Reg.prop(${prop}): a key at tick ${late[0]}, past the film's ${this.ticks}; it would ramp the whole film toward its value`);
    const sorted = [...keys].sort((a, b) => a[0] - b[0]);
    if (sorted.length > MAX_KEYS) throw new Error(`Reg.prop(${prop}): ${sorted.length} keys; a track holds at most 255 segments — sample more coarsely`);
    const stops: Stops = {};
    stops["0%"] = { [prop]: sorted[0]![1] };
    for (const [t, v] of sorted) stops[this.pct(t)] = { [prop]: v };
    stops["100%"] = { [prop]: sorted[sorted.length - 1]![1] };
    return this.film(stops, easing);
  }

  /**
   * Values that change instantly at the given ticks: [[t0, v0], [t1, v1], …],
   * strictly increasing. Each change is keyed at `t - 1` (the old value) and
   * `t` (the new one).
   */
  step(prop: string, changes: [number, string][]): string {
    for (let i = 1; i < changes.length; i++) {
      if (changes[i]![0] <= changes[i - 1]![0]) {
        throw new Error(`Reg.step(${prop}): change ${i} at tick ${changes[i]![0]} does not follow tick ${changes[i - 1]![0]}; crossed keys would bake as a ramp from tick 0`);
      }
    }
    const keys: [number, string][] = [];
    changes.forEach(([t, v], i) => {
      if (i > 0) keys.push([t - 1, changes[i - 1]![1]]);
      keys.push([t, v]);
    });
    return this.prop(prop, keys);
  }

  /** Opacity 1 on ticks [a, b) of every `period` ticks, from tick 0 on: a looping animation name. */
  cycle(a: number, b: number, period: number): string {
    const q = (t: number) => `${((t * 100) / period).toFixed(4)}%`;
    const st: Stops = {};
    st["0%"] = { opacity: a === 0 ? "1" : "0" };
    if (a > 0) {
      st[q(a - 1)] = { opacity: "0" };
      st[q(a)] = { opacity: "1" };
    }
    if (b < period) {
      st[q(b - 1)] = { opacity: "1" };
      st[q(b)] = { opacity: "0" };
    }
    st["100%"] = { opacity: b === period ? "1" : "0" };
    return this.loop([this.short(st, period)], period);
  }

  /** Opacity 1 on [from, until), 0 elsewhere, switched on single ticks. */
  window(from: number, until?: number): string {
    if (until !== undefined && until <= from) throw new Error(`Reg.window(${from}, ${until}): empty or inverted window`);
    const ch: [number, string][] = [];
    if (from > 0) ch.push([0, "0"], [from, "1"]);
    else ch.push([0, "1"]);
    if (until !== undefined) ch.push([until, "0"]);
    return this.step("opacity", ch);
  }
}

export interface State {
  cx: number;
  cy: number;
  rot: number;
  sx: number;
  sy: number;
  op: number;
}

export class El {
  readonly keys = new Map<number, State>();
  s: State;
  /** The latest tick a key has been written at: keys are written in time order. */
  private last = 0;
  constructor(
    readonly reg: Reg,
    readonly home: { x: number; y: number; w: number; h: number },
    init: Partial<State> = {},
  ) {
    this.s = { cx: home.x + home.w / 2, cy: home.y + home.h / 2, rot: 0, sx: 1, sy: 1, op: 1, ...init };
    this.keys.set(0, { ...this.s });
  }

  /**
   * Keys are written in time order. A key written behind a later one is not an
   * edit of the past: the later key still carries the state it was written
   * with, and the core interpolates between them. An opacity set to 0 on the
   * drop, written after the tick-after-the-roll key that still held 1, faded a
   * module from 1 to 0 across two seconds as a translucent ghost.
   */
  private key(t: number) {
    if (t < this.last) throw new Error(`El: a key at tick ${t} written after one at tick ${this.last}; write an element's keys in time order`);
    this.last = t;
    this.keys.set(t, { ...this.s });
  }

  /** An instant change at `t`: the state before it is held to `t - 1`. */
  set(t: number, p: Partial<State>) {
    if (t > 0) this.key(t - 1);
    Object.assign(this.s, p);
    this.key(t);
    return this;
  }

  /** A move to `p` over [t0, t1], keyed every tick through `ease`. */
  to(t0: number, t1: number, p: Partial<State>, ease = inOut) {
    const a = { ...this.s };
    const z = { ...a, ...p };
    for (let t = t0; t <= t1; t++) {
      const u = ease((t - t0) / Math.max(1, t1 - t0));
      this.s = { cx: lerp(a.cx, z.cx, u), cy: lerp(a.cy, z.cy, u), rot: lerp(a.rot, z.rot, u), sx: lerp(a.sx, z.sx, u), sy: lerp(a.sy, z.sy, u), op: lerp(a.op, z.op, u) };
      this.key(t);
    }
    this.s = z;
    return this;
  }

  /** Follow an arbitrary path, keyed every `every` ticks and at both ends. */
  path(t0: number, t1: number, f: (t: number) => Partial<State>, every = 1) {
    // hold until the path starts — unless a key already sits there: set(t0, …) has just written the state
    // BEFORE its change at t0 - 1, and re-keying it with the current state would ramp the change in from tick 0
    if (t0 > 0 && !this.keys.has(t0 - 1)) this.key(t0 - 1);
    for (let t = t0; t <= t1; t++) {
      if ((t - t0) % every !== 0 && t !== t1) continue;
      Object.assign(this.s, f(t));
      this.key(t);
    }
    return this;
  }

  /** A turn of `deg` about the pivot (px, py) over [t0, t1]: position on the arc, and the element's own angle with it. */
  orbit(t0: number, t1: number, px: number, py: number, deg: number, ease = inOut) {
    const a = { ...this.s };
    const dx = a.cx - px;
    const dy = a.cy - py;
    for (let t = t0; t <= t1; t++) {
      const u = ease((t - t0) / Math.max(1, t1 - t0));
      const th = (deg * u * Math.PI) / 180;
      this.s = { ...a, cx: px + dx * Math.cos(th) - dy * Math.sin(th), cy: py + dx * Math.sin(th) + dy * Math.cos(th), rot: a.rot + deg * u };
      this.key(t);
    }
    return this;
  }

  /** The animation entry for this element: translate, rotate, scale and opacity, held interiors dropped. */
  entry(): string {
    const T = this.reg.ticks;
    if (!this.keys.has(T)) this.keys.set(T, { ...this.s });
    const ticks = [...this.keys.keys()].sort((a, c) => a - c);
    const hx = this.home.x + this.home.w / 2;
    const hy = this.home.y + this.home.h / 2;
    const rows = ticks.map((t) => {
      const k = this.keys.get(t)!;
      return { t, v: { translateX: `${r3(k.cx - hx)}px`, translateY: `${r3(k.cy - hy)}px`, rotate: `${r3(k.rot)}deg`, scaleX: `${r3(k.sx)}`, scaleY: `${r3(k.sy)}`, opacity: `${r3(k.op)}` } };
    });
    const stops: Stops = {};
    let prev: string | undefined;
    rows.forEach((row, i) => {
      const sig = JSON.stringify(row.v);
      const next = rows[i + 1] ? JSON.stringify(rows[i + 1]!.v) : undefined;
      if (i > 0 && i < rows.length - 1 && sig === prev && sig === next) return;
      stops[this.reg.pct(row.t)] = row.v;
      prev = sig;
    });
    if (Object.keys(stops).length > MAX_KEYS) throw new Error(`El: ${Object.keys(stops).length} keys; a track holds at most 255 segments`);
    return this.reg.film(stops);
  }

  /** An absolute View at the element's home box, its transform about its centre, carrying this element's animation. */
  node(inner: string, extra = "", more: string[] = []): string {
    const { x, y, w, h } = this.home;
    return `<View class="absolute left-[${x}px] top-[${y}px] w-[${w}px] h-[${h}px] origin-center ${extra} animate-${this.reg.anim([this.entry(), ...more])}">${inner}</View>`;
  }
}

/** An element's state at tick t, read from its keys the way the core interpolates them (linearly). */
export function stateAt(el: El, t: number): State {
  const ks = [...el.keys.keys()].sort((a, c) => a - c);
  if (t <= ks[0]!) return { ...el.keys.get(ks[0]!)! };
  for (let i = 0; i + 1 < ks.length; i++) {
    const a = ks[i]!;
    const z = ks[i + 1]!;
    if (t >= a && t <= z) {
      const p = el.keys.get(a)!;
      const q = el.keys.get(z)!;
      const u = z === a ? 1 : (t - a) / (z - a);
      return { cx: lerp(p.cx, q.cx, u), cy: lerp(p.cy, q.cy, u), rot: lerp(p.rot, q.rot, u), sx: lerp(p.sx, q.sx, u), sy: lerp(p.sy, q.sy, u), op: lerp(p.op, q.op, u) };
    }
  }
  return { ...el.keys.get(ks[ks.length - 1]!)! };
}

/**
 * The element again, `lag` ticks behind it at `alpha` of its opacity, present
 * only inside `spans` and invisible everywhere else. A trail for a fast move.
 */
export function echo(el: El, lag: number, alpha: number, spans: [number, number][]): El {
  const g = new El(el.reg, el.home, { op: 0 });
  for (const [a, z] of spans) {
    g.keys.set(a + lag - 1, { ...stateAt(el, a - 1), op: 0 });
    for (let t = a + lag; t <= z + lag; t++) {
      const s = stateAt(el, t - lag);
      g.keys.set(t, { ...s, op: s.op * alpha });
    }
    g.keys.set(z + lag + 1, { ...stateAt(el, z), op: 0 });
  }
  g.s = { ...stateAt(el, el.reg.ticks), op: 0 };
  return g;
}

/**
 * A cell that shows one glyph at a time, for counters and decodes. `seq` is
 * [tick, glyph] changes in time order; a later change on the same tick
 * replaces an earlier one, and a change that goes back in time is refused.
 * The cell is empty before the first change. Each distinct glyph is its own
 * node switched on single ticks, so a change is a hard cut, and from the
 * first change on exactly one glyph is lit at every tick: no frame shows two
 * glyphs, or none.
 */
export function glyphCell(reg: Reg, seq: [number, string][], draw: (glyph: string) => string, w: number, h: number): string {
  const norm: [number, string][] = [];
  for (const [t, g] of seq) {
    const last = norm[norm.length - 1];
    if (last && t < last[0]) throw new Error(`glyphCell: change at tick ${t} comes after tick ${last[0]}; a cell's changes run forward in time`);
    if (last && t === last[0]) norm[norm.length - 1] = [t, g];
    else norm.push([t, g]);
  }
  const nodes = [...new Set(norm.map(([, g]) => g))].map((g) => {
    const ch: [number, string][] = [];
    let on = false;
    for (const [t, v] of norm) {
      if ((v === g) !== on) {
        ch.push([t, v === g ? "1" : "0"]);
        on = v === g;
      }
    }
    // dark until its first change: a track's first value holds from tick 0
    if (ch[0]![0] > 0) ch.unshift([0, "0"]);
    return `<View class="absolute inset-0 flex-row justify-center items-center animate-${reg.anim(reg.step("opacity", ch))}">${draw(g)}</View>`;
  });
  return `<View class="w-[${w}px] h-[${h}px]">${nodes.join("")}</View>`;
}

/** A decode for `glyphCell`: `frames` frames of glyphs drawn from `pool`, two ticks each from `t0`, then `final`. */
export function decodeSeq(final: string, pool: string, t0: number, frames: number, r: () => number): [number, string][] {
  const chars = [...pool];
  const seq: [number, string][] = [];
  for (let f = 0; f < frames; f++) seq.push([t0 + 2 * f, chars[Math.floor(r() * chars.length)]!]);
  seq.push([t0 + 2 * frames, final]);
  return seq;
}
