/**
 * Motion computed by the generator, baked as keyframes the core plays.
 *
 * An element's centre, rotation, scale and opacity are sampled here at the
 * realm's 60 Hz with the easing applied in this file, and written as linear
 * keyframes. A rotation about any pivot is then an exact arc, a landing is
 * exactly where it was computed to be, and nothing depends on how the baker
 * would have eased a segment.
 */

export const inOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
export const outExpo = (u: number) => (u >= 1 ? 1 : 1 - 2 ** (-10 * u));
export const outCubic = (u: number) => 1 - (1 - u) ** 3;
export const inCubic = (u: number) => u * u * u;
export const linear = (u: number) => u;
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const r3 = (v: number) => (Math.abs(v) < 1e-6 ? 0 : Math.round(v * 1000) / 1000);

export type Stops = Record<string, Record<string, string>>;

export class Reg {
  readonly keyframes: Record<string, Stops> = {};
  readonly animation: Record<string, string> = {};
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
  readonly loops: Record<string, { value: string; loop: string }> = {};
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
   * One property through a list of [tick, value] keys. Between keys it
   * interpolates linearly; a key marked by a repeated tick-1 holds. Use
   * `step` for instantaneous changes.
   */
  prop(prop: string, keys: [number, string][], easing = "linear"): string {
    const sorted = [...keys].sort((a, b) => a[0] - b[0]);
    // the baker's limit is 255 segments per track
    if (sorted.length > 250) throw new Error(`Reg.prop(${prop}): ${sorted.length} keys; a track holds at most 255 segments — sample more coarsely`);
    const stops: Stops = {};
    stops["0%"] = { [prop]: sorted[0]![1] };
    for (const [t, v] of sorted) stops[this.pct(t)] = { [prop]: v };
    stops["100%"] = { [prop]: sorted[sorted.length - 1]![1] };
    return this.film(stops, easing);
  }
  /** Values that change instantly at the given ticks: [[t0, v0], [t1, v1], ...]. */
  step(prop: string, changes: [number, string][]): string {
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
    // step() keys t - 1 and t for every change; with until <= from those keys cross and bake as a ramp from tick 0
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
  constructor(
    readonly reg: Reg,
    readonly home: { x: number; y: number; w: number; h: number },
    init: Partial<State> = {},
  ) {
    this.s = { cx: home.x + home.w / 2, cy: home.y + home.h / 2, rot: 0, sx: 1, sy: 1, op: 1, ...init };
    this.keys.set(0, { ...this.s });
  }
  private key(t: number) {
    this.keys.set(t, { ...this.s });
  }
  set(t: number, p: Partial<State>) {
    if (t > 0) this.key(t - 1);
    Object.assign(this.s, p);
    this.key(t);
    return this;
  }
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
  /** Follow an arbitrary path, keyed every `every` ticks (and at both ends). */
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
  /** The animation entry for this element (transform + opacity). */
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
    if (Object.keys(stops).length > 250) throw new Error(`El: ${Object.keys(stops).length} keys; a track holds at most 255 segments`);
    return this.reg.film(stops);
  }
  node(inner: string, extra = "", more: string[] = []): string {
    const { x, y, w, h } = this.home;
    return `<View class="absolute left-[${x}px] top-[${y}px] w-[${w}px] h-[${h}px] origin-center ${extra} animate-${this.reg.anim([this.entry(), ...more])}">${inner}</View>`;
  }
}

export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const jsx = (s: string) => `{${JSON.stringify(s)}}`;
