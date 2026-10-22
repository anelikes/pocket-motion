#!/usr/bin/env bun
/**
 * compositions/same-frame — 《同一帧》 / Same Frame.
 *
 * 56 s · 1920×1080 · 60 fps · 3360 frames · 28 bars at 120 BPM.
 *
 * The film makes one claim about itself, and its last card carries the
 * evidence: the SHA-256 digest of its own first PROOF_FRAMES frames, as
 * `trace --frames PROOF_FRAMES` prints it. The card cannot be part of what it
 * hashes, so it opens at PROOF_FRAMES. Its nodes are mounted from frame 0 like
 * everything else, but they emit no geometry until their gate opens, so
 * writing the real digest into them cannot move a pixel of the frames the
 * digest covers. `digest.json` holds the value this generator writes in.
 *
 * At 120 BPM a beat is 30 frames and a bar is 120, so every cut lands on a
 * whole frame and every baked delay on a whole tick. Everything here is
 * written in frames and converted once, by `ms`.
 *
 *   bun compositions/same-frame/gen.ts
 *   bun src/cli/main.ts build compositions/same-frame
 */

import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL(".", import.meta.url));

// ── time ───────────────────────────────────────────────────────────────────

const FPS = 60;
const BARS = 28;
const BAR = 120; // frames
const BEAT = 30; // frames
const FRAMES = BARS * BAR; // 3360
/** The end card opens on this frame; the digest it shows covers [0, PROOF_FRAMES). */
const PROOF_FRAMES = 25 * BAR; // 3000
const bar = (n: number) => n * BAR;
const beat = (n: number) => n * BEAT;
/** Frames to the integer ms that bakes back to exactly that many ticks. */
const ms = (frames: number) => Math.round((frames * 1000) / FPS);

// ── the digest the end card shows ──────────────────────────────────────────

const DIGEST: string = (await Bun.file(`${OUT}digest.json`).json()).sha256;
if (!/^[0-9a-f]{64}$/.test(DIGEST)) throw new Error(`digest.json: not a sha256 hex string: ${DIGEST}`);

// ── animation registry ─────────────────────────────────────────────────────

type Stops = Record<string, Record<string, string>>;
const keyframes: Record<string, Stops> = {
  on: { from: { opacity: "0" }, to: { opacity: "1" } },
  off: { from: { opacity: "1" }, to: { opacity: "0" } },
  rise: {
    from: { opacity: "0", transform: "translateY(28px)" },
    to: { opacity: "1", transform: "translateY(0px)" },
  },
};
const animation: Record<string, string | { value: string; loop: string }> = {};
const byValue = new Map<string, string>();

/** Register a comma list (optionally looping every `loop` frames); returns its name. */
function anim(value: string, loop?: number): string {
  const key = loop === undefined ? value : `${value} @${loop}`;
  let name = byValue.get(key);
  if (name === undefined) {
    name = `a${byValue.size.toString(36)}`;
    animation[name] = loop === undefined ? value : { value, loop: `${ms(loop)}ms` };
    byValue.set(key, name);
  }
  return name;
}

function kf(name: string, stops: Stops): string {
  keyframes[name] ??= stops;
  return name;
}

const DRIVE = "cubic-bezier(.9,0,.1,1)";
const OUT_EXPO = "cubic-bezier(0.16,1,0.3,1)";

/**
 * Painted on frames [from, until). Frame N shows the timelines at tick N
 * (measured: a gate whose ramp starts at tick d is first fully on in frame
 * d+1), so a window opening on frame F ramps from tick F-1, and one open from
 * frame 0 is an `off` whose backwards fill holds it on.
 */
function shown(from: number, until?: number): string {
  if (from === 0) return `off 17ms linear ${ms((until ?? FRAMES + 60) - 1)}ms both`;
  const on = `on 17ms linear ${ms(from - 1)}ms both`;
  return until === undefined ? on : `${on}, off 17ms linear ${ms(until - 1)}ms forwards`;
}

/** Painted on frames [a, b) of every period of `period` frames, 0 <= a < b <= period. */
function cycle(a: number, b: number, period: number): string {
  if (a === 0) return anim(`off 17ms linear ${ms(b - 1)}ms both`, period);
  if (b === period) return anim(`on 17ms linear ${ms(a - 1)}ms both`, period);
  return anim(shown(a, b), period);
}

/** Rise in over `dur` frames at `at`, gone at `until`. */
function rise(at: number, until?: number, dur = 24): string {
  const inn = `rise ${ms(dur)}ms ${OUT_EXPO} ${ms(Math.max(0, at - 1))}ms both`;
  return anim(until === undefined ? inn : `${inn}, off 17ms linear ${ms(until - 1)}ms forwards`);
}

// ── seeded scramble ────────────────────────────────────────────────────────

/** mulberry32: the scramble is a function of its seed, decided here, at build time. */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const HEX = "0123456789abcdef";

// ── type ───────────────────────────────────────────────────────────────────

const jsx = (s: string) => `{${JSON.stringify(s)}}`;
/** JetBrains Mono advances 600/1000 em. */
const monoW = (size: number) => size * 0.6;
const C = {
  ground: "#04050a",
  ink: "#f8fafc",
  dim: "#64748b",
  faint: "#1e293b",
  cyan: "#22d3ee",
  cyanDim: "#155e75",
  violet: "#a78bfa",
  pink: "#f472b6",
};

// ── the frame counter ──────────────────────────────────────────────────────
//
// Four digits, each a cell of ten pre-placed glyphs, each glyph painted on the
// frames its digit holds that value. The units digit changes every frame, so
// frame N shows N — a claim the render can be held to by reading a frame.

function counter(opts: { size: number; color: string; from: number; until?: number }): string {
  const { size, color } = opts;
  const w = monoW(size);
  const h = Math.round(size * 1.3);
  const cells: string[] = [];
  for (let p = 3; p >= 0; p--) {
    const slot = 10 ** p;
    const glyphs: string[] = [];
    for (let v = 0; v < 10; v++) {
      let a: string;
      if (p === 3) {
        if (v * slot >= FRAMES) break;
        a = anim(shown(v * slot, (v + 1) * slot >= FRAMES ? undefined : (v + 1) * slot));
      } else {
        a = cycle(v * slot, (v + 1) * slot, 10 * slot);
      }
      glyphs.push(
        `<View class="absolute inset-0 flex-row justify-center items-center animate-${a}"><Text class="font-[code] text-[${size}px] text-[${color}]">${jsx(String(v))}</Text></View>`,
      );
    }
    cells.push(`<View class="w-[${w}px] h-[${h}px]">${glyphs.join("")}</View>`);
  }
  return `<View class="flex-row animate-${anim(shown(opts.from, opts.until))}">${cells.join("")}</View>`;
}

// ── the hex row ────────────────────────────────────────────────────────────
//
// 64 cells of mono glyphs. In the cold open every cell cycles through seeded
// hex forever — a hash not yet computed. On the end card the same row cycles
// and then lands, left to right, on DIGEST.

const HEX_SIZE = 40;
const HEX_N = 64;
const SCR = 6; // glyphs per cell
const SCR_STEP = 3; // frames each

function hexCellsLooping(seed: number, color: string): string[] {
  const r = rng(seed);
  const period = SCR * SCR_STEP;
  return Array.from({ length: HEX_N }, () => {
    const glyphs = Array.from({ length: SCR }, (_, k) => {
      const ch = HEX[Math.floor(r() * 16)]!;
      return `<View class="absolute inset-0 flex-row justify-center items-center animate-${cycle(k * SCR_STEP, (k + 1) * SCR_STEP, period)}"><Text class="font-[code] text-[${HEX_SIZE}px] text-[${color}]">${jsx(ch)}</Text></View>`;
    });
    return glyphs.join("");
  });
}

function hexRow(cells: string[], cls = ""): string {
  const w = monoW(HEX_SIZE);
  const h = Math.round(HEX_SIZE * 1.4);
  return `<View class="flex-row ${cls}">${cells.map((c) => `<View class="w-[${w}px] h-[${h}px]">${c}</View>`).join("")}</View>`;
}

/** The end card's row: scramble from `at`, cell i lands on DIGEST[i] at `land(i)`. */
function hexCellsLanding(seed: number, at: number, land: (i: number) => number): string[] {
  const r = rng(seed);
  return [...DIGEST].map((final, i) => {
    const until = land(i);
    // SCR glyph nodes, each re-gated every SCR*SCR_STEP frames until the cell lands.
    const gates: string[][] = Array.from({ length: SCR }, () => []);
    for (let t = at, k = 0; t < until; t += SCR_STEP, k = (k + 1) % SCR) {
      const end = Math.min(t + SCR_STEP, until);
      gates[k]!.push(`on 17ms linear ${ms(t - 1)}ms ${gates[k]!.length === 0 ? "both" : "forwards"}`, `off 17ms linear ${ms(end - 1)}ms forwards`);
    }
    const scramble = gates
      .filter((g) => g.length > 0)
      .map((g) => {
        const ch = HEX[Math.floor(r() * 16)]!;
        return `<View class="absolute inset-0 flex-row justify-center items-center animate-${anim(g.join(", "))}"><Text class="font-[code] text-[${HEX_SIZE}px] text-[${C.cyanDim}]">${jsx(ch)}</Text></View>`;
      })
      .join("");
    const landed = `<View class="absolute inset-0 flex-row justify-center items-center animate-${anim(shown(until))}"><Text class="font-[code] text-[${HEX_SIZE}px] text-[${C.ink}]">${jsx(final)}</Text></View>`;
    return scramble + landed;
  });
}

// ── shot 1 · cold open (bars 0–1) ──────────────────────────────────────────

const PROMPT = "$ bun run motion render compositions/same-frame";

function coldOpen(): string {
  const end = bar(2);
  const typeAt = 18;
  const chars = [...PROMPT]
    .map((ch, i) => {
      const color = i === 0 ? C.cyan : C.dim;
      return `<View class="animate-${anim(shown(typeAt + i * 2, end))}"><Text class="font-[code] text-[30px] text-[${color}]">${jsx(ch)}</Text></View>`;
    })
    .join("");
  const caret = `<View class="w-[18px] h-[34px] ml-[4px] bg-[${C.cyan}] animate-${anim(`${shown(0, end)}`)}"><View class="absolute inset-0 bg-[${C.ground}] animate-${cycle(15, 30, 30)}" /></View>`;
  return `
    {/* 1 · cold open: the challenge, and a hash still being computed */}
    <View class="absolute inset-0 flex-col items-center">
      <View class="absolute top-[300px] left-0 right-0 flex-row justify-center items-center">${chars}${caret}</View>
      <View class="absolute top-[400px] left-0 right-0 flex-row justify-center animate-${anim(`${shown(beat(3), end)}`)}">
        ${hexRow(hexCellsLooping(7, C.cyanDim))}
      </View>
      <View class="absolute top-[540px] left-0 right-0 flex-row justify-center animate-${rise(bar(1), end)}">
        <Text class="font-[cjk] font-bold text-[64px] text-[${C.ink}]">${jsx("在你的电脑上渲染这条视频，")}</Text>
      </View>
      <View class="absolute top-[640px] left-0 right-0 flex-row justify-center animate-${rise(bar(1) + beat(1), end)}">
        <Text class="font-[cjk] font-bold text-[64px] text-[${C.ink}]">${jsx("你会得到完全相同的字节。")}</Text>
      </View>
      <View class="absolute top-[760px] left-0 right-0 flex-row justify-center animate-${rise(bar(1) + beat(2), end)}">
        <Text class="text-[30px] text-[#94a3b8]">${jsx("Render this film on your machine. You will get these exact bytes.")}</Text>
      </View>
    </View>
`;
}

// ── shared motion ──────────────────────────────────────────────────────────

/** One tween as a comma-list entry; `at` is the first frame it moves on. */
const tw = (name: string, dur: number, at: number, ease = OUT_EXPO, fill = "both") =>
  `${name} ${ms(dur)}ms ${ease} ${ms(Math.max(0, at - 1))}ms ${fill}`;
/** Gone from frame `until` on. */
const cut = (until: number) => `off 17ms linear ${ms(until - 1)}ms forwards`;
/** Fade out over `dur` frames from `at`. */
const fade = (at: number, dur: number) => `off ${ms(dur)}ms linear ${ms(at - 1)}ms forwards`;

kf("focus", { from: { opacity: "0", filter: "blur(28px)" }, to: { opacity: "1", filter: "blur(0px)" } });
kf("defocus", { from: { opacity: "1", filter: "blur(0px)" }, to: { opacity: "0", filter: "blur(28px)" } });

const RED = "#f43f5e";
/** Spaced capitals: the type has no tracking utility, so the spacing is in the string. */
const spaced = (s: string) => [...s].join(" ").replace(/ {3}/g, "    ");

// ── shots 2–5 · three removals and what is left (bars 2–5) ─────────────────
//
// One bar each, cut on the downbeat. An icon, a red strike across it on beat
// two, and the sentence. The fourth bar keeps nothing but the frame number.

function browserIcon(): string {
  const dot = (c: string) => `<View class="w-[14px] h-[14px] rounded-[7px] bg-[${c}]" />`;
  const line = (w: number) => `<View class="w-[${w}px] h-[14px] rounded-[7px] bg-[#334155]" />`;
  return `<View class="w-[320px] h-[210px] rounded-[20px] border-[#cbd5e1] border-4 flex-col overflow-hidden">
          <View class="h-[44px] flex-row items-center px-[18px] gap-[10px]">${dot("#f87171")}${dot("#fbbf24")}${dot("#34d399")}<View class="ml-[14px] w-[180px] h-[16px] rounded-[8px] bg-[#334155]" /></View>
          <View class="h-[4px] bg-[#cbd5e1]" />
          <View class="flex-col p-[22px] gap-[14px]">${line(220)}${line(256)}${line(150)}</View>
        </View>`;
}

function clockIcon(at: number): string {
  kf("whirl-m", { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(1470deg)" } });
  kf("whirl-h", { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(150deg)" } });
  const spin = (k: string) => anim(tw(k, 54, at, "cubic-bezier(0.1,0.7,0.2,1)"));
  return `<View class="w-[220px] h-[220px] rounded-[110px] border-[#cbd5e1] border-8">
          <View class="absolute inset-0 animate-${spin("whirl-h")}"><View class="absolute left-[99px] top-[52px] w-[6px] h-[54px] rounded-[3px] bg-[#cbd5e1]" /></View>
          <View class="absolute inset-0 animate-${spin("whirl-m")}"><View class="absolute left-[99px] top-[22px] w-[6px] h-[84px] rounded-[3px] bg-[#e2e8f0]" /></View>
          <View class="absolute left-[92px] top-[92px] w-[20px] h-[20px] rounded-[10px] bg-[#e2e8f0]" />
        </View>`;
}

function diceIcon(): string {
  const pip = (x: number, y: number) =>
    `<View class="absolute left-[${x - 15}px] top-[${y - 15}px] w-[30px] h-[30px] rounded-[15px] bg-[#e2e8f0]" />`;
  return `<View class="w-[210px] h-[210px] rounded-[34px] border-[#cbd5e1] border-8">
          ${pip(55, 55)}${pip(147, 55)}${pip(101, 101)}${pip(55, 147)}${pip(147, 147)}
        </View>`;
}

function removal(i: number, icon: string, cn: string, en: string): string {
  const at = bar(2 + i);
  const end = at + BAR;
  const strikeAt = at + beat(1);
  kf("strike", { from: { width: "0px" }, to: { width: "470px" } });
  return `
    <View class="absolute inset-0 animate-${anim(shown(at, end))}">
      <View class="absolute top-[150px] left-0 right-0 h-[300px] flex-row justify-center items-center animate-${rise(at, undefined, 18)}">
        ${icon}
      </View>
      <View class="absolute left-[730px] top-[380px] w-[0px] h-[14px] rounded-[7px] bg-[${RED}] rotate-340 origin-left glow-[16px] glow-[${RED}] animate-${anim(tw("strike", 8, strikeAt, DRIVE))}" />
      <View class="absolute top-[500px] left-0 right-0 flex-row justify-center animate-${anim(tw("focus", 14, at + 4))}">
        <Text class="font-[cjk] font-bold text-[150px] text-[${C.ink}]">${jsx(cn)}</Text>
      </View>
      <View class="absolute top-[730px] left-0 right-0 flex-row justify-center animate-${rise(at + 12)}">
        <Text class="font-bold text-[40px] text-[#94a3b8]">${jsx(spaced(en))}</Text>
      </View>
    </View>`;
}

function onlyFrames(): string {
  const at = bar(5);
  const end = bar(6);
  return `
    <View class="absolute inset-0 animate-${anim(shown(at, end))}">
      <View class="absolute top-[170px] left-0 right-0 flex-row justify-center animate-${anim(tw("focus", 14, at))}">
        <Text class="font-[cjk] font-bold text-[120px] text-[${C.ink}]">${jsx("只有帧")}</Text>
      </View>
      <View class="absolute top-[400px] left-0 right-0 flex-row justify-center animate-${anim(tw("focus", 10, at + beat(1)))}">
        <View class="glow-[22px] glow-[#22d3ee] glow-gain-[0.9]">${counter({ size: 180, color: C.ink, from: at, until: end })}</View>
      </View>
      <View class="absolute top-[690px] left-0 right-0 flex-row justify-center animate-${rise(at + beat(2))}">
        <Text class="font-bold text-[40px] text-[#94a3b8]">${jsx(spaced("ONLY FRAMES"))}</Text>
      </View>
      <View class="absolute top-[790px] left-0 right-0 flex-row justify-center animate-${rise(at + beat(3))}">
        <Text class="font-[code] text-[28px] text-[${C.dim}]">${jsx("the number above is the frame you are looking at")}</Text>
      </View>
    </View>`;
}

// ── shot 6 · the function (bars 6–8) ───────────────────────────────────────
//
// The equation types itself, then holds over the field while two lines say
// what it means. Its second line carries a live counter: `frame = ` and the
// frame you are looking at.

const EQ = "pixels = f(frame)";
const EQ_SIZE = 96;
/** The signature gradient, sampled per character so each typed glyph is one solid colour. */
function sig(t: number): string {
  const stops: [number, number[]][] = [
    [0, [0x22, 0xd3, 0xee]],
    [0.5, [0xa7, 0x8b, 0xfa]],
    [1, [0xf4, 0x72, 0xb6]],
  ];
  let k = 0;
  while (k < stops.length - 2 && t > stops[k + 1]![0]) k++;
  const [t0, c0] = stops[k]!;
  const [t1, c1] = stops[k + 1]!;
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return `#${c0.map((v, i) => Math.round(v + (c1[i]! - v) * u).toString(16).padStart(2, "0")).join("")}`;
}

function equation(): string {
  const at = bar(6);
  const end = bar(9);
  const typeAt = at + 6;
  const chars = [...EQ]
    .map((ch, i) => `<View class="animate-${anim(shown(typeAt + i * 3, end))}"><Text class="font-[code] text-[${EQ_SIZE}px] text-[${sig(i / (EQ.length - 1))}]">${jsx(ch)}</Text></View>`)
    .join("");
  const typed = typeAt + EQ.length * 3;
  return `
    {/* 6 · the function */}
    <View class="absolute inset-0 animate-${anim(shown(at, end))}">
      <View class="absolute left-0 right-0 top-[330px] h-[420px] bg-[radial-gradient(#04050af2,#04050ae0_40%,#04050a00)] animate-${anim(shown(bar(7), end))}" />
      <View class="absolute top-[380px] left-0 right-0 flex-row justify-center glow-[18px] glow-[#a78bfa] glow-gain-[0.7]">${chars}</View>
      <View class="absolute top-[520px] left-0 right-0 flex-row justify-center items-center animate-${rise(typed + 8)}">
        <Text class="font-[code] text-[44px] text-[${C.dim}]">${jsx("frame = ")}</Text>
        ${counter({ size: 44, color: C.cyan, from: typed + 8, until: end })}
      </View>
      <View class="absolute top-[620px] left-0 right-0 flex-row justify-center animate-${rise(bar(7) + beat(2))}">
        <Text class="font-[cjk] font-bold text-[44px] text-[#e2e8f0]">${jsx("每一帧，都只是帧号的函数。")}</Text>
      </View>
      <View class="absolute top-[690px] left-0 right-0 flex-row justify-center animate-${rise(bar(7) + beat(3))}">
        <Text class="text-[28px] text-[#94a3b8]">${jsx("Every frame is a function of its number. Nothing else.")}</Text>
      </View>
    </View>`;
}

// ── shot 7 · the field of 帧 (bars 7–8, again in reverse at 13–14) ─────────
//
// A grid of one character. Waves of light cross it from a point, each glyph's
// pulse delayed by its distance — a ripple that is nothing but 264 baked
// opacity timelines with different start ticks. The rewind plays the same
// grid with the delays mirrored, so the waves fall back into the point.

const F_COLS = 22;
const F_ROWS = 12;
const F_CELL = 88;
const F_SIZE = 56;
const PEAKS = ["#67e8f9", "#7dd3fc", "#93c5fd", "#a5b4fc", "#c4b5fd", "#d8b4fe", "#f0abfc", "#f9a8d4"];
kf("flash", { from: { opacity: "0" }, "16%": { opacity: "1" }, to: { opacity: "0" } });

function field(opts: { at: number; end: number; waves: number[]; reverse?: boolean; cx: number; cy: number; speed: number }): string {
  const { at, end, waves, reverse, cx, cy, speed } = opts;
  const ox = (1920 - F_COLS * F_CELL) / 2;
  const oy = (1080 - F_ROWS * F_CELL) / 2;
  let maxD = 0;
  for (let r = 0; r < F_ROWS; r++) for (let c = 0; c < F_COLS; c++) maxD = Math.max(maxD, Math.hypot(c - cx, r - cy));
  // A glow is the layer's alpha, not its luminance: a dark opaque glyph glows
  // exactly as hard as a bright one. So the dim grid is its own layer with no
  // glow, and the light is a second grid that is transparent except where a
  // wave is passing.
  const base: string[] = [];
  const lit: string[] = [];
  for (let r = 0; r < F_ROWS; r++) {
    for (let c = 0; c < F_COLS; c++) {
      const d = Math.hypot(c - cx, r - cy);
      const band = Math.min(PEAKS.length - 1, Math.floor((c / (F_COLS - 1)) * PEAKS.length));
      const color = PEAKS[reverse ? PEAKS.length - 1 - band : band]!;
      const delay = (w: number) => w + Math.round((reverse ? maxD - d : d) * speed);
      const a = anim(waves.map((w, k) => tw("flash", 48, delay(w), "linear", k === 0 ? "both" : "forwards")).join(", "));
      const pos = `absolute left-[${ox + c * F_CELL}px] top-[${oy + r * F_CELL}px] w-[${F_CELL}px] h-[${F_CELL}px] flex-row justify-center items-center`;
      base.push(`<View class="${pos}"><Text class="font-[cjk] font-bold text-[${F_SIZE}px] text-[#0c1424]">${jsx("帧")}</Text></View>`);
      lit.push(`<View class="${pos} animate-${a}"><Text class="font-[cjk] font-bold text-[${F_SIZE}px] text-[${color}]">${jsx("帧")}</Text></View>`);
    }
  }
  return `
    <View class="absolute inset-0 animate-${anim(`${tw("on", 20, at, "linear")}, ${cut(end)}`)}">
      <View class="absolute inset-0">
        ${base.join("\n        ")}
      </View>
      <View class="absolute inset-0 glow-[18px] glow-[${reverse ? "#f0abfc" : "#7dd3fc"}] glow-gain-[1.6]">
        ${lit.join("\n        ")}
      </View>
    </View>`;
}

// ── shots 8–9 · 同一帧 (bars 9–12) ──────────────────────────────────────────
//
// The drop. An iris opens on the gradient world and the title lands in it,
// with four hollow copies of itself breathing on the beat — the same frame,
// again and again. Then a rack focus walks down three sentences.

kf("iris", { from: { width: "0px", height: "0px" }, to: { width: "2300px", height: "2300px" } });
kf("iris-close", { from: { width: "2300px", height: "2300px" }, to: { width: "0px", height: "0px" } });
kf("turn", { from: { gradAngle: "120deg" }, to: { gradAngle: "300deg" } });
kf("echo", { from: { opacity: "0.7" }, to: { opacity: "0.12" } });

function world(): string {
  const at = bar(9);
  const end = bar(13);
  return `
    <View class="absolute inset-0 bg-[linear-gradient(120deg,#0e7490,#6d28d9_40%,#be185d_72%,#f59e0b)] animate-${anim(tw("turn", end - at, at, "linear"))}" />
    <View class="absolute inset-0 bg-[radial-gradient(#04050a00,#04050a33_55%,#04050ad9)]" />`;
}

function sameFrameTitle(at: number, end: number): string {
  const TITLE = "同一帧";
  // Four hollow copies, one beat apart, each fading from a flash.
  // A strip of the same frame: hollow copies of the title one title-width
  // apart on either side, each lit on the beat from the centre outwards.
  const W = 3 * 176 + 72;
  const echoes = [-2, -1, 1, 2]
    .map((k) => {
      const beats = Array.from({ length: Math.floor((end - at) / BEAT) }, (_, b) => at + b * BEAT + Math.abs(k) * 4);
      const a = anim(beats.map((t, j) => tw("echo", 26, t, "linear", j === 0 ? "both" : "forwards")).join(", "));
      return `<View class="absolute left-[${k * W}px] right-[${-k * W}px] top-[360px] flex-row justify-center animate-${a}"><Text class="font-[cjk] font-bold text-[176px] text-transparent text-stroke-[2px] text-stroke-[#ffffff]">${jsx(TITLE)}</Text></View>`;
    })
    .join("\n      ");
  return `
    <View class="absolute inset-0 animate-${anim(shown(at, end))}">
      ${echoes}
      <View class="absolute left-0 right-0 top-[360px] flex-row justify-center animate-${anim(tw("focus", 12, at))}">
        <View class="glow-[30px] glow-[#ffffff] glow-gain-[0.55]"><Text class="font-[cjk] font-bold text-[176px] text-[#ffffff]">${jsx(TITLE)}</Text></View>
      </View>
      <View class="absolute left-0 right-0 top-[620px] flex-row justify-center animate-${rise(at + beat(1))}">
        <Text class="font-bold text-[56px] text-[#ffffff]">${jsx(spaced("SAME FRAME"))}</Text>
      </View>
    </View>`;
}

function drop(): string {
  const at = bar(9);
  const end = bar(13);
  const iris = anim(`${tw("iris", 42, at, DRIVE)}, ${tw("iris-close", 24, end - 24, "cubic-bezier(.7,0,1,.4)", "forwards")}`);
  // rack focus, bars 11–12
  const rf = bar(11);
  kf("sharpen", { from: { opacity: "0.3", filter: "blur(14px)" }, to: { opacity: "1", filter: "blur(0px)" } });
  kf("soften", { from: { opacity: "1", filter: "blur(0px)" }, to: { opacity: "0.3", filter: "blur(14px)" } });
  const lines: [string, string, string][] = [
    ["同样的输入", "same input", `${tw("rise", 18, rf)}, ${tw("soften", 14, rf + beat(2), "ease-in-out", "forwards")}, ${tw("sharpen", 14, rf + beat(6), "ease-in-out", "forwards")}`],
    ["同样的函数", "same function", `${tw("sharpen", 14, rf + beat(2), "ease-in-out")}, ${tw("soften", 14, rf + beat(4), "ease-in-out", "forwards")}, ${tw("sharpen", 14, rf + beat(6), "ease-in-out", "forwards")}`],
    ["同样的帧", "same frame", `${tw("sharpen", 14, rf + beat(4), "ease-in-out")}`],
  ];
  const triptych = lines
    .map(([cn, en, a], k) => `
        <View class="absolute left-0 right-0 top-[${250 + k * 200}px] flex-col items-center animate-${anim(a)}">
          <Text class="font-[cjk] font-bold text-[96px] text-[#ffffff]">${jsx(cn)}</Text>
          <Text class="font-bold text-[30px] text-[#ffffffb3]">${jsx(spaced(en.toUpperCase()))}</Text>
        </View>`)
    .join("");
  return `
    {/* 8–9 · 同一帧: the drop, then the rack focus */}
    <View class="absolute inset-0 flex-row justify-center items-center animate-${anim(shown(at, end))}">
      <View class="w-[0px] h-[0px] shrink-0 rounded-[1150px] overflow-mask flex-row justify-center items-center animate-${iris}">
        <View class="w-[1920px] h-[1080px] shrink-0">
          ${world()}
          ${sameFrameTitle(at, rf)}
          <View class="absolute inset-0 animate-${anim(shown(rf, end))}">${triptych}
          </View>
        </View>
      </View>
    </View>`;
}

// ── shot 10 · rewind (bars 13–14) ──────────────────────────────────────────

function rewind(): string {
  const at = bar(13);
  const end = bar(15);
  const seek = "seekFrame(960)";
  const typeAt = at + 10;
  const chars = [...seek]
    .map((ch, i) => `<View class="animate-${anim(shown(typeAt + i * 2, end))}"><Text class="font-[code] text-[72px] text-[${i < 9 ? C.pink : C.ink}]">${jsx(ch)}</Text></View>`)
    .join("");
  return `
    {/* 10 · rewind: the waves fall back into the point */}
    ${field({ at, end, waves: [at + 4, at + beat(3)], reverse: true, cx: 10.5, cy: 5.5, speed: 2 })}
    <View class="absolute inset-0 animate-${anim(shown(at, end))}">
      <View class="absolute left-0 right-0 top-[340px] h-[400px] bg-[radial-gradient(#04050af2,#04050ae0_40%,#04050a00)]" />
      <View class="absolute top-[380px] left-0 right-0 flex-row justify-center">
        <Text class="font-[code] text-[72px] text-[${C.pink}]">${jsx("<< ")}</Text>${chars}
      </View>
      <View class="absolute top-[520px] left-0 right-0 flex-row justify-center animate-${rise(at + beat(3))}">
        <Text class="font-[cjk] font-bold text-[56px] text-[${C.ink}]">${jsx("倒回任意一帧，像素一个都不变。")}</Text>
      </View>
      <View class="absolute top-[610px] left-0 right-0 flex-row justify-center animate-${rise(at + beat(4))}">
        <Text class="text-[30px] text-[#94a3b8]">${jsx("Seek to any frame, in any order. Same pixels.")}</Text>
      </View>
    </View>`;
}

// ── shots 11–13 · the proof (bars 15–22) ───────────────────────────────────
//
// Real numbers only. The hashes are compositions/smoke's 450 frame hashes as
// `trace` prints them (smoke-trace.json, re-read here); its digest is the one
// baselines/digests.json records and CI re-derives on Linux/x86-64 on every
// push. The timings are baselines/remotion-m4.md and hyperframes-m4.md.

const SMOKE: { digest: string; frames: string[] } = await Bun.file(`${OUT}smoke-trace.json`).json();

kf("slide-in-l", { from: { transform: "translateX(-140px)", opacity: "0" }, to: { transform: "translateX(0px)", opacity: "1" } });
kf("slide-in-r", { from: { transform: "translateX(140px)", opacity: "0" }, to: { transform: "translateX(0px)", opacity: "1" } });
kf("merge-l", { from: { transform: "translateX(0px)" }, to: { transform: "translateX(450px)" } });
kf("merge-r", { from: { transform: "translateX(0px)" }, to: { transform: "translateX(-450px)" } });

const ROW_H = 36;
const VIEW_ROWS = 14;

function hashPanel(side: "l" | "r", label: string, sub: string, at: number, mergeAt: number, scrollAt: number): string {
  const scroll = (SMOKE.frames.length - VIEW_ROWS) * ROW_H;
  kf("scroll", { from: { transform: "translateY(0px)" }, to: { transform: `translateY(-${scroll}px)` } });
  const rows = SMOKE.frames
    .map((h, i) => `<View class="h-[${ROW_H}px] flex-row items-center"><Text class="font-[code] text-[22px] text-[#475569]">${jsx(String(i).padStart(3, "0") + "  ")}</Text><Text class="font-[code] text-[22px] text-[#a5f3fc]">${jsx(h.slice(0, 40))}</Text></View>`)
    .join("");
  const x = side === "l" ? 80 : 980;
  const enter = tw(side === "l" ? "slide-in-l" : "slide-in-r", 30, at);
  const merge = tw(side === "l" ? "merge-l" : "merge-r", 40, mergeAt, DRIVE, "forwards");
  return `
      <View class="absolute left-[${x}px] top-[170px] w-[860px] h-[700px] animate-${anim(`${enter}, ${merge}`)}">
        <View class="absolute inset-0 rounded-[24px] bg-[#0b1220e6] border-[#1e293b] border-2" />
        <View class="absolute left-[40px] top-[30px] flex-col animate-${anim(fade(mergeAt - 10, 10))}">
          <Text class="font-bold text-[40px] text-[${C.ink}]">${jsx(label)}</Text>
          <Text class="font-[code] text-[22px] text-[${C.dim}]">${jsx(sub)}</Text>
        </View>
        <View class="absolute left-[40px] top-[140px] w-[780px] h-[${VIEW_ROWS * ROW_H}px] overflow-hidden">
          <View class="absolute left-0 top-0 flex-col animate-${anim(tw("scroll", mergeAt + 40 - scrollAt, scrollAt, "linear"))}">${rows}</View>
        </View>
        <View class="absolute left-[40px] top-[652px] flex-row">
          <Text class="font-[code] text-[24px] text-[${C.dim}]">${jsx("digest ")}</Text>
          <Text class="font-[code] text-[24px] text-[${C.ink}]">${jsx(SMOKE.digest.slice(0, 32) + "…")}</Text>
        </View>
      </View>`;
}

function machines(): string {
  const at = bar(15);
  const mergeAt = bar(18);
  const end = bar(19);
  return `
    {/* 11 · two machines, one sequence of hashes */}
    <View class="absolute inset-0 animate-${anim(shown(at, end))}">
      <View class="absolute top-[70px] left-0 right-0 flex-row justify-center animate-${rise(at)}">
        <Text class="font-[cjk] font-bold text-[52px] text-[${C.ink}]">${jsx("两台机器，同一串哈希")}</Text>
      </View>
      ${hashPanel("l", "macOS · Apple M4", "darwin / arm64", at + 10, mergeAt, at + 40)}
      ${hashPanel("r", "Linux · x86-64", "linux / x64 · CI, every push", at + 20, mergeAt, at + 40)}
      <View class="absolute top-[900px] left-0 right-0 flex-col items-center animate-${rise(mergeAt + 44)}">
        <Text class="font-[cjk] font-bold text-[48px] text-[${C.ink}]">${jsx("450 / 450 帧，逐字节相同")}</Text>
        <Text class="text-[26px] text-[#94a3b8]">${jsx("compositions/smoke · 450 of 450 frames, byte for byte")}</Text>
      </View>
    </View>`;
}

const RACE = [
  { name: "Pocket Motion", ms: 5.75, color: C.cyan, note: "smoke · 1 thread" },
  { name: "HyperFrames", ms: 38.19, color: "#94a3b8", note: "nyt-graph · similar content · 1 worker" },
  { name: "Remotion", ms: 52.36, color: "#94a3b8", note: "smoke, ported to React · 1 worker" },
];

function race(): string {
  const at = bar(19);
  const end = bar(23);
  const go = at + beat(2);
  const FULL = 1100;
  const pmDur = 72; // frames for Pocket Motion's 450 frames on screen
  const lanes = RACE.map((r, k) => {
    const width = FULL; // every bar has the same distance: 450 frames
    const dur = Math.round((pmDur * r.ms) / RACE[0]!.ms);
    kf(`lane${k}`, { from: { width: "0px" }, to: { width: `${width}px` } });
    const seconds = ((450 * r.ms) / 1000).toFixed(1);
    const y = 300 + k * 170;
    return `
      <View class="absolute left-[120px] top-[${y}px] flex-col animate-${rise(at + k * 6)}">
        <Text class="font-bold text-[40px] text-[${k === 0 ? C.ink : "#cbd5e1"}]">${jsx(r.name)}</Text>
        <Text class="font-[code] text-[20px] text-[${C.dim}]">${jsx(r.note)}</Text>
      </View>
      <View class="absolute left-[560px] top-[${y + 10}px] w-[${FULL}px] h-[44px] rounded-[22px] bg-[#0f172a]" />
      <View class="absolute left-[560px] top-[${y + 10}px] w-[0px] h-[44px] rounded-[22px] bg-[${r.color}] ${k === 0 ? "glow-[18px] glow-[#22d3ee] glow-gain-[1.2]" : ""} animate-${anim(tw(`lane${k}`, dur, go, "linear"))}" />
      <View class="absolute left-[1690px] top-[${y + 8}px] flex-col animate-${rise(at + k * 6)}">
        <Text class="font-[code] text-[34px] text-[${k === 0 ? C.ink : "#cbd5e1"}]">${jsx(`${r.ms.toFixed(2)}`)}</Text>
        <Text class="font-[code] text-[18px] text-[${C.dim}]">${jsx(`ms/frame · ${seconds}s`)}</Text>
      </View>`;
  }).join("");
  const doneAt = go + pmDur;
  return `
    {/* 12 · the race: 450 frames each, measured on one M4 */}
    <View class="absolute inset-0 animate-${anim(shown(at, end))}">
      <View class="absolute top-[120px] left-0 right-0 flex-row justify-center animate-${rise(at)}">
        <Text class="font-[cjk] font-bold text-[52px] text-[${C.ink}]">${jsx("渲染 450 帧 1080p，同一台 M4，单线程")}</Text>
      </View>
      ${lanes}
      <View class="absolute left-[560px] top-[214px] flex-row items-center animate-${rise(doneAt)}">
        <Text class="font-[cjk] font-bold text-[44px] text-[${C.cyan}]">${jsx("Pocket Motion 已经渲染完了。")}</Text>
      </View>
      <View class="absolute right-[120px] top-[780px] flex-row items-end animate-${anim(tw("focus", 14, doneAt + beat(2)))}">
        <View class="glow-[26px] glow-[#22d3ee] glow-gain-[0.8]"><Text class="font-bold text-[170px] text-[${C.ink}]">${jsx("9.1×")}</Text></View>
      </View>
      <View class="absolute left-[120px] top-[830px] flex-col animate-${rise(doneAt + beat(3))}">
        <Text class="font-[cjk] font-bold text-[40px] text-[${C.ink}]">${jsx("同一份 composition，比 Remotion 快 9.1 倍")}</Text>
        <Text class="text-[22px] text-[${C.dim}]">${jsx("Apple M4 · 1080p · 30 fps · wall clock incl. encode · baselines/remotion-m4.md, hyperframes-m4.md")}</Text>
      </View>
      <View class="absolute top-[990px] left-0 right-0 flex-row justify-center animate-${rise(bar(22))}">
        <Text class="font-[cjk] font-bold text-[36px] text-[#e2e8f0]">${jsx("没有浏览器，所以快。没有时钟，所以准。")}</Text>
      </View>
    </View>`;
}

// ── shot 14 · the picture is code, the music is a score (bars 23–24) ───────

const SCORE_LINES = (await Bun.file(`${OUT}score.yaml`).text())
  .split("\n")
  .filter((l) => /^\s+(intro|build|groove|drop|proof|climax|outro|rewind|kick|clap|hat|snare|rhythm|sound|texture|notes)\b|^\s+[A-G][#b]?\d\//.test(l))
  .map((l) => l.trim())
  .filter((l) => l.length > 0)
  .slice(0, 40);
const CODE_LINES = (await Bun.file(fileURLToPath(import.meta.url)).text())
  .split("\n")
  .filter((l) => /class=|kf\(|anim\(|tw\(/.test(l) && !l.includes("CODE_LINES"))
  .map((l) => l.trim())
  .filter((l) => l.length > 0)
  .slice(0, 40);

function codeColumn(lines: string[], x: number, color: string, at: number, dur: number): string {
  const rows = lines.map((l) => `<View class="h-[38px] flex-row items-center"><Text class="font-[code] text-[22px] text-[${color}]">${jsx(l.length > 58 ? l.slice(0, 57) + "…" : l)}</Text></View>`).join("");
  const travel = lines.length * 38 + 400;
  kf(`col${x}`, { from: { transform: "translateY(200px)" }, to: { transform: `translateY(-${travel - 1080}px)` } });
  return `<View class="absolute left-[${x}px] top-[0px] w-[800px] h-[1080px] overflow-hidden"><View class="absolute left-0 top-0 flex-col animate-${anim(tw(`col${x}`, dur, at, "linear"))}">${rows}</View></View>`;
}

function climax(): string {
  const at = bar(23);
  const titleAt = bar(24);
  const end = PROOF_FRAMES;
  return `
    {/* 14 · the picture is code, the music is a score */}
    <View class="absolute inset-0 animate-${anim(`${shown(at)}, ${tw("defocus", 20, titleAt - 10, "ease-in", "forwards")}`)}">
      ${codeColumn(CODE_LINES, 90, "#67e8f9", at, BAR + 20)}
      ${codeColumn(SCORE_LINES, 1030, "#f9a8d4", at, BAR + 20)}
      <View class="absolute left-0 right-0 top-0 h-[230px] bg-[linear-gradient(180deg,#04050a,#04050a_62%,#04050a00)]" />
      <View class="absolute left-0 right-0 bottom-0 h-[160px] bg-[linear-gradient(0deg,#04050a,#04050a00)]" />
      <View class="absolute left-[90px] top-[60px] flex-row items-end"><Text class="font-[cjk] font-bold text-[56px] text-[${C.ink}]">${jsx("画面是代码")}</Text><Text class="font-[code] text-[24px] text-[${C.dim}] ml-[20px] mb-[10px]">${jsx("gen.ts")}</Text></View>
      <View class="absolute left-[1030px] top-[60px] flex-row items-end"><Text class="font-[cjk] font-bold text-[56px] text-[${C.ink}]">${jsx("音乐是乐谱")}</Text><Text class="font-[code] text-[24px] text-[${C.dim}] ml-[20px] mb-[10px]">${jsx("score.yaml")}</Text></View>
    </View>
    <View class="absolute inset-0 animate-${anim(`${shown(titleAt, end)}, ${fade(end - 14, 14)}`)}">
      <View class="absolute inset-0 bg-[linear-gradient(200deg,#0e7490,#6d28d9_40%,#be185d_72%,#f59e0b)] animate-${anim(tw("turn", end - titleAt, titleAt, "linear"))}" />
      <View class="absolute inset-0 bg-[radial-gradient(#04050a00,#04050a40_50%,#04050ae6)]" />
      ${sameFrameTitle(titleAt, end)}
      <View class="absolute left-0 right-0 top-[760px] flex-row justify-center animate-${rise(titleAt + beat(2))}">
        <Text class="font-[cjk] font-bold text-[40px] text-[#ffffffd9]">${jsx("一个仓库，两份文本，一个结果。")}</Text>
      </View>
    </View>`;
}

// ── end card (bars 25–27) ──────────────────────────────────────────────────

function endCard(): string {
  const at = PROOF_FRAMES;
  const scrambleFrom = at + 8;
  const land = (i: number) => at + 36 + Math.round(i * 1.5);
  const landed = land(HEX_N - 1);
  return `
    {/* end card: the digest of everything before it. Its nodes paint nothing
        before PROOF_FRAMES, so the value written into them cannot move a pixel
        of the frames it covers. */}
    <View class="absolute inset-0 flex-col items-center animate-${anim(shown(at))}">
      <View class="absolute top-[290px] left-0 right-0 flex-row justify-center items-end animate-${rise(at)}">
        <Text class="font-[cjk] font-bold text-[52px] text-[${C.ink}]">${jsx("你刚刚看到的前 3000 帧")}</Text>
        <View class="w-[24px]" />
        <Text class="text-[30px] text-[#94a3b8] mb-[6px]">${jsx("SHA-256")}</Text>
      </View>
      <View class="absolute top-[400px] left-0 right-0 flex-row justify-center glow-[10px] glow-[#67e8f9] glow-gain-[1.2]">
        ${hexRow(hexCellsLanding(11, scrambleFrom, land))}
      </View>
      <View class="absolute top-[540px] left-0 right-0 flex-row justify-center animate-${rise(landed + 12)}">
        <Text class="font-[cjk] font-bold text-[48px] text-[${C.ink}]">${jsx("在你自己的机器上跑一遍。它不会变。")}</Text>
      </View>
      <View class="absolute top-[624px] left-0 right-0 flex-row justify-center animate-${rise(landed + 24)}">
        <Text class="text-[28px] text-[#94a3b8]">${jsx("Run it on your own machine. It will not change.")}</Text>
      </View>
      <View class="absolute top-[740px] left-0 right-0 flex-row justify-center animate-${rise(landed + 48)}">
        <View class="px-[28px] py-[16px] rounded-[14px] bg-[#0b1220] border-2 border-[#1e293b] flex-row items-center">
          <Text class="font-[code] text-[26px] text-[${C.cyan}]">${jsx("$ ")}</Text>
          <Text class="font-[code] text-[26px] text-[#e2e8f0]">${jsx(`bun run motion trace compositions/same-frame --frames ${PROOF_FRAMES}`)}</Text>
        </View>
      </View>
      <View class="absolute top-[880px] left-0 right-0 flex-row justify-center items-center animate-${rise(landed + 72)}">
        <Text class="font-bold text-[30px] text-[${C.ink}]">${jsx("Pocket Motion")}</Text>
        <View class="w-[20px]" />
        <Text class="text-[26px] text-[${C.dim}]">${jsx("github.com/anelikes/pocket-motion")}</Text>
      </View>
    </View>`;
}

// ── chrome: the counter, on screen for the whole film ──────────────────────

function chrome(): string {
  return `
    {/* the counter: frame N shows N */}
    <View class="absolute top-[36px] right-[48px] px-[14px] py-[6px] rounded-[10px] bg-[#04050ad9] flex-row items-center">
      <Text class="font-[code] text-[22px] text-[#475569]">${jsx("frame ")}</Text>
      ${counter({ size: 22, color: "#94a3b8", from: 0 })}
    </View>`;
}

// ── write ──────────────────────────────────────────────────────────────────

const body = [
  coldOpen(),
  removal(0, browserIcon(), "没有浏览器", "NO BROWSER"),
  removal(1, clockIcon(bar(3)), "没有时钟", "NO CLOCK"),
  removal(2, diceIcon(), "没有随机", "NO DICE"),
  onlyFrames(),
  `\n    {/* 7 · the field of 帧 */}` + field({ at: bar(7), end: bar(9), waves: [bar(7) + beat(1), bar(7) + beat(5)], cx: 5.5, cy: 8.5, speed: 3 }),
  equation(),
  drop(),
  rewind(),
  machines(),
  race(),
  climax(),
  endCard(),
  chrome(),
].join("\n");

await Bun.write(
  `${OUT}main.tsx`,
  `// GENERATED by compositions/same-frame/gen.ts — do not edit by hand.
// Mount-only: every motion is a baked keyframe timeline the core plays itself.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[${C.ground}]">
${body}
  </View>
));
`,
);

await Bun.write(
  `${OUT}pocket.config.ts`,
  `// GENERATED by compositions/same-frame/gen.ts — do not edit by hand.
import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: ${JSON.stringify(keyframes, null, 2).replace(/\n/g, "\n    ")},
    animation: ${JSON.stringify(animation, null, 2).replace(/\n/g, "\n    ")},
  },
});
`,
);

await Bun.write(
  `${OUT}pocket-motion.json`,
  JSON.stringify(
    {
      motion: 1,
      durationFrames: FRAMES,
      fps: FPS,
      supersample: 1,
      fonts: {
        regular: "assets/fonts/HarmonyOS_Sans_Regular.ttf",
        bold: "assets/fonts/HarmonyOS_Sans_Bold.ttf",
        faces: {
          cjk: { regular: "assets/fonts/NotoSansSC-Regular.otf", bold: "assets/fonts/NotoSansSC-Bold.otf" },
          code: {
            regular: "vendor/pocketjs/assets/fonts/JetBrainsMono-Regular.ttf",
            bold: "vendor/pocketjs/assets/fonts/JetBrainsMono-Regular.ttf",
          },
        },
      },
    },
    null,
    2,
  ) + "\n",
);

console.log(`same-frame: ${FRAMES} frames, ${Object.keys(animation).length} animations, ${Object.keys(keyframes).length} keyframe sets`);
