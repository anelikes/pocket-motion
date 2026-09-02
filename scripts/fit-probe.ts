#!/usr/bin/env bun
/**
 * Can text be made to fit its box without touching the core?
 *
 * `engine/core/src/text.rs` says so in its own header: *"v1 line model
 * (documented limitation): NO automatic word wrap — a run breaks only on
 * explicit '\n'"*. A `Text` wider than its box therefore draws past it, and
 * `overflow-hidden` turns that into silently missing words. That is the failure
 * this probe starts from.
 *
 * The claim under test is that the fix needs no core change, because
 * compositions are generated and the host can measure text with the renderer's
 * own advance table (`Ui::measure_text` -> `ops.measureText`). If that
 * measurement is EXACT — the same number the rasteriser walks — then breaking
 * lines at build time is not an approximation of layout, it is layout.
 *
 * Nothing here is taken on the word of the API. Every claim is checked against
 * rendered pixels: ground is pure black, text pure white, boxes are fixed and
 * stacked from the top-left, so a block's band is arithmetic
 * (`compositions/fit/gen.ts`) and ink outside a box is overflow you can count.
 * Stage 0 renders a box as a white rectangle first — if the band arithmetic
 * disagrees with the layout, no later number means anything.
 *
 * Two builds: the first bakes every size the probe measures at and answers
 * stages 0-2; wrapping and fitting are then computed against ITS world, and the
 * second build renders the result so the arithmetic can be checked in pixels.
 *
 * Chinese needs a face that has Chinese in it, and NEITHER vendored face does —
 * HarmonyOS Sans here is the Latin-only cut and Inter Display maps no CJK
 * either, so the paragraph bakes as tofu and every width is the tofu cell. The
 * `--cjk` arm re-runs it against a face passed on the command line so the
 * numbers are real. Nothing about that face is checked in; on this machine it
 * was macOS's own `/System/Library/Fonts/Supplemental/Arial Unicode.ttf`.
 *
 *   bun scripts/fit-probe.ts
 *   bun scripts/fit-probe.ts --png /tmp/fit    # write each stage's frame
 *   bun scripts/fit-probe.ts --cjk "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { bands, VIEW, type Block, type Spec } from "../compositions/fit/gen.ts";
import { readAtlases } from "../src/text/atlas.ts";
import { cachedWidth, fitToBox, glyphCount, segments, wrapLines } from "../src/text/fit.ts";
import { hardenedBootWorld, type BootedWorld } from "../src/runtime/boot.ts";
import { withBuildLock } from "../src/vendor/build-lock.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const VENDOR = join(ROOT, "vendor/pocketjs");
const FACE = {
  regular: join(ROOT, "assets/fonts/HarmonyOS_Sans_Regular.ttf"),
  bold: join(ROOT, "assets/fonts/HarmonyOS_Sans_Bold.ttf"),
};

const argv = process.argv.slice(2);
const flagOf = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const PNG_DIR = flagOf("png");
const CJK_FACE = flagOf("cjk");

/** The box every wrap test has to fit, and the body size the reel uses. */
const BOX_W = 800;
const BODY = 38;

/** English of the reel's own register, and Chinese of the same weight. */
const EN =
  "Deterministic video rendering. No browser, no headless Chrome, no screenshot " +
  "loop — a Tailwind subset compiled to a binary style table, and a rasteriser " +
  "that draws the same bytes every time you ask for them.";
const ZH =
  "确定性视频渲染。没有浏览器，没有无头 Chrome，也没有截图循环——" +
  "把 Tailwind 的一个子集编译成二进制样式表，再交给一个每次都画出同样字节的光栅器。";

/**
 * Strings the pen-exactness stage checks. Latin only, deliberately: the
 * vendored faces map no CJK, and a tofu run passes this test — measurement and
 * rasterisation agree on the tofu cell just as exactly as they agree on a real
 * glyph. Chinese is checked in stage 9 against a face that has it.
 */
const CHECK = [
  "Hamburgefonstiv",
  "Deterministic video rendering.",
  "a Tailwind subset, not all of CSS",
  "no screenshot loop — a rasteriser", // em dash: not ASCII, so not free
  "PocketJS Motion · 1 thread",
];
const CHECK_SIZES = [64, BODY, 26] as const;
/** Candidate sizes for shrink-to-fit. Every one is baked by build A, so every
 *  one can be MEASURED rather than extrapolated. */
const LADDER = [64, 56, 48, 42, 38, 34, 30, 26, 22] as const;

// ---------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------

async function run(cmd: string[]): Promise<void> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", cwd: ROOT });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  if ((await p.exited) !== 0) {
    console.error(out, err);
    throw new Error(`failed: ${cmd.join(" ")}`);
  }
}

interface SlotInfo {
  readonly slot: number;
  readonly px: number;
  readonly bold: boolean;
  /** Atlas default line advance, from the pak header. */
  readonly lineHeight: number;
  readonly cellH: number;
  readonly cellW: number;
  /** Codepoints the atlas actually carries, from its cmap. */
  readonly codepoints: ReadonlySet<number>;
}

interface Stage {
  readonly frame: Uint8Array;
  readonly info: (px: number, bold?: boolean) => SlotInfo;
  readonly measure: (px: number, bold?: boolean) => (s: string) => number;
  readonly world: BootedWorld;
  /** Characters of `text` this build did NOT bake. */
  readonly unmapped: (text: string, px?: number) => string[];
}

/**
 * `ops.measureText` returns WIDTH only — `Ui::measure_text` is
 * `measure_run(...).0` — so the line advance that a wrapped block's HEIGHT
 * depends on is not reachable through the ops table at all, and neither is the
 * set of codepoints a build actually baked. Both come out of the pak
 * (`src/text/atlas.ts`).
 *
 * The cmap matters as much as the metrics. A codepoint the atlas does not carry
 * resolves to tofu and MEASURES as `cell_w` (`text.rs` `glyph()`), so a build
 * that was never asked to bake a character still returns a plausible width for
 * it — the first CJK run of this probe measured a paragraph against a build that
 * held only part of it, and the numbers moved by 36px between runs with nothing
 * to show why. Every measurement below is guarded against its own build.
 */
const atlasMetrics = readAtlases;

let builds = 0;

/** Generate, build, boot and render one spec. */
async function stage(spec: Spec, name: string, face = FACE): Promise<Stage> {
  const specPath = `/tmp/pocketjs-motion-fit-${name}.json`;
  await Bun.write(specPath, JSON.stringify(spec));
  await run(["bun", join(ROOT, "compositions/fit/gen.ts"), specPath]);

  const dist = join(ROOT, `dist/fit-${name}`);
  // The build and the read of the mirror are ONE critical section, for the
  // reason `src/vendor/build-lock.ts` sets out: any other build landing between
  // them replaces the slot table this pak is about to be paired against. This
  // probe has no `verifySlots`, so it would not notice — it would print the
  // advances of a different font size, which is the failure mode this whole
  // file exists to rule out one level down.
  const { gen, metrics } = await withBuildLock(`fit-probe ${name}`, async () => {
    await run([
      "bun", join(VENDOR, "tools/build.ts"), join(ROOT, "compositions/fit/main.tsx"),
      `--outdir=${dist}`, "--framework=solid",
      `--font-regular=${face.regular}`, `--font-bold=${face.bold}`,
    ]);
    // styles.generated.ts is rewritten by every build (an ignored mirror — see
    // tools/build.ts). The cache buster is what makes the second build see its
    // own slot assignment rather than the first build's.
    return {
      gen: (await import(
        `${VENDOR}/framework/src/styles.generated.ts?fit=${++builds}`
      )) as { FONT_SLOTS: Record<number, { px: number; bold: boolean }> },
      metrics: await atlasMetrics(join(dist, "main.pak")),
    };
  });

  const pakPath = join(dist, "main.pak");
  const slots: SlotInfo[] = Object.entries(gen.FONT_SLOTS).map(([k, v]) => {
    const h = metrics.get(Number(k));
    return {
      slot: Number(k),
      px: v.px,
      bold: v.bold,
      lineHeight: h?.lineHeight ?? 0,
      cellH: h?.cellH ?? 0,
      cellW: h?.cellW ?? 0,
      codepoints: h?.codepoints ?? new Set<number>(),
    };
  });

  const world = await hardenedBootWorld({
    bundlePath: join(dist, "main.js"),
    pakPath,
    width: VIEW.w,
    height: VIEW.h,
    hz: 30,
  });
  world.frame(0);
  for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
  const frame = world.render();

  if (PNG_DIR) {
    await mkdir(PNG_DIR, { recursive: true });
    await writePng(frame, VIEW.w, VIEW.h, join(PNG_DIR, `${name}.png`));
  }

  const info = (px: number, bold = false): SlotInfo => {
    const s = slots.find((x) => x.px === px && x.bold === bold);
    if (!s) throw new Error(`fit-probe: no slot baked for ${px}px ${bold ? "bold" : "regular"}`);
    return s;
  };
  const raw = (world.ops as { measureText: (s: string, slot: number) => number }).measureText;
  const unmapped = (text: string, px = BODY): string[] => {
    const { codepoints } = info(px);
    return [...new Set([...text])].filter((c) => c !== "\n" && !codepoints.has(c.codePointAt(0)!));
  };
  return { frame, info, measure: (px, bold) => (s) => raw(s, info(px, bold).slot), world, unmapped };
}

/** Refuse to report a width for a string this build cannot draw. */
function assertMappable(st: Stage, label: string, text: string, sizes: readonly number[]): void {
  for (const px of sizes) {
    const missing = st.unmapped(text, px);
    if (missing.length > 0) {
      throw new Error(
        `fit-probe: ${label} at ${px}px is missing ${missing.length} codepoint(s) from the ` +
          `atlas (${missing.slice(0, 8).join("")}) — they would measure as the tofu cell`,
      );
    }
  }
}

async function writePng(rgba: Uint8Array, w: number, h: number, path: string): Promise<void> {
  const p = Bun.spawn(
    ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba",
      "-s", `${w}x${h}`, "-i", "pipe:0", "-frames:v", "1", path],
    { stdin: "pipe", stdout: "inherit", stderr: "inherit" },
  );
  p.stdin.write(rgba);
  await p.stdin.end();
  if ((await p.exited) !== 0) throw new Error(`png write failed: ${path}`);
}

interface Ink {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly pixels: number;
  /** Runs of consecutive rows carrying ink — the number of drawn text lines,
   *  as long as the line advance leaves a blank row between them. */
  readonly runs: number;
}

const EMPTY: Ink = { x0: 0, x1: -1, y0: 0, y1: -1, pixels: 0, runs: 0 };

/** Ink extents inside a band. "Ink" is any pixel above black by more than the
 *  coverage floor — antialiased edges are real ink and are counted. */
function inkOf(frame: Uint8Array, y0: number, y1: number): Ink {
  let x0 = Infinity, x1 = -Infinity, iy0 = Infinity, iy1 = -Infinity, pixels = 0, runs = 0;
  let prev = false;
  for (let y = y0; y < y1; y++) {
    let rowInk = false;
    for (let x = 0; x < VIEW.w; x++) {
      const i = (y * VIEW.w + x) * 4;
      if (frame[i]! > 8 || frame[i + 1]! > 8 || frame[i + 2]! > 8) {
        pixels++;
        rowInk = true;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < iy0) iy0 = y;
        if (y > iy1) iy1 = y;
      }
    }
    if (rowInk && !prev) runs++;
    prev = rowInk;
  }
  return pixels === 0 ? EMPTY : { x0, x1, y0: iy0, y1: iy1, pixels, runs };
}

const P = (s: string, n: number): string => s.padEnd(n);
const N = (v: number, n: number, d = 0): string => v.toFixed(d).padStart(n);
const clip = (s: string, n: number): string =>
  glyphCount(s) <= n ? s : `${[...s].slice(0, n - 1).join("")}…`;

// ---------------------------------------------------------------------------
// build A — ground truth
// ---------------------------------------------------------------------------

console.log("# Build-time text fitting — probe\n");

const truthBlocks: Block[] = [{ text: "", cls: "", w: BOX_W, h: 60, fill: true }];
const clsOf = (px: number, extra = ""): string => `text-[${px}px] text-white ${extra}`.trim();
const hOf = (px: number): number => px + 24;

// Pen-exactness rows: a probe glyph alone, then each string with the probe
// appended. Sizes first so one probe row serves the whole size.
for (const px of CHECK_SIZES) {
  truthBlocks.push({ text: "H", cls: clsOf(px), w: 1900, h: hOf(px) });
  for (const s of CHECK) truthBlocks.push({ text: `${s}H`, cls: clsOf(px), w: 1900, h: hOf(px) });
}
// Tracking: `measureText` is tracking-blind (measure_run is called with 0.0),
// so these two rows ask whether plain arithmetic recovers it.
truthBlocks.push({ text: "H", cls: clsOf(BODY, "tracking-wide"), w: 1900, h: hOf(BODY) });
truthBlocks.push({ text: `${CHECK[0]}H`, cls: clsOf(BODY, "tracking-wide"), w: 1900, h: hOf(BODY) });
// Sizes that exist only to be baked, so the fit ladder can be measured.
for (const px of LADDER) {
  if ((CHECK_SIZES as readonly number[]).includes(px)) continue;
  truthBlocks.push({ text: "Hg", cls: clsOf(px), w: 1900, h: hOf(px) });
}
// The paragraphs are measured against THIS build, so this build has to bake
// their codepoints — the charset comes from the AST scan, and EN's em dash is
// not in any string above it. These two rows exist only to be collected.
truthBlocks.push({ text: EN, cls: clsOf(BODY), w: 1900, h: hOf(BODY) });
truthBlocks.push({ text: ZH, cls: clsOf(BODY), w: 1900, h: hOf(BODY) });

const A = await stage({ blocks: truthBlocks }, "truth");
const aBands = bands({ blocks: truthBlocks });
assertMappable(A, "EN", EN, LADDER);
for (const s of CHECK) assertMappable(A, JSON.stringify(s), s, CHECK_SIZES);

// -- stage 0: does the band arithmetic match the layout? ---------------------

const boxInk = inkOf(A.frame, aBands[0]!.y0, aBands[0]!.y1);
const boxOk = boxInk.x0 === 0 && boxInk.x1 === BOX_W - 1 && boxInk.y0 === 0 && boxInk.y1 === 59;
console.log("## 0 — band arithmetic vs the layout");
console.log(
  `   an ${BOX_W}x60 box renders x ${boxInk.x0}..${boxInk.x1}, y ${boxInk.y0}..${boxInk.y1}` +
    `   ${boxOk ? "exact" : "MISMATCH — stop reading here"}\n`,
);

// -- stage 1: is ops.measureText the pen the rasteriser walks? ---------------

console.log("## 1 — is `ops.measureText` the pen the rasteriser walks?");
console.log("   A probe glyph is appended to each string. Its ink starts at pen(S) + its own");
console.log("   left side bearing; rendering it ALONE gives that bearing, so the difference of");
console.log("   the two ink right edges is the pen exactly — ink extents alone would not do.\n");
console.log(`   ${P("string", 34)}${P("px", 5)}${"measured".padStart(9)}${"rendered".padStart(9)}${"err".padStart(6)}`);

let penWorst = 0;
let row = 1;
for (const px of CHECK_SIZES) {
  const probe = inkOf(A.frame, aBands[row]!.y0, aBands[row]!.y1);
  row++;
  for (const s of CHECK) {
    const ink = inkOf(A.frame, aBands[row]!.y0, aBands[row]!.y1);
    row++;
    const rendered = ink.x1 - probe.x1;
    const measured = A.measure(px)(s);
    const err = rendered - measured;
    penWorst = Math.max(penWorst, Math.abs(err));
    console.log(
      `   ${P(clip(s, 33), 34)}${P(String(px), 5)}${N(measured, 9)}${N(rendered, 9)}${N(err, 6)}`,
    );
  }
}
console.log(`\n   worst |error| over ${CHECK.length * CHECK_SIZES.length} rows: ${penWorst} px\n`);

// -- stage 1b: tracking ------------------------------------------------------

{
  const probe = inkOf(A.frame, aBands[row]!.y0, aBands[row]!.y1);
  row++;
  const ink = inkOf(A.frame, aBands[row]!.y0, aBands[row]!.y1);
  row++;
  const s = CHECK[0]!;
  const rendered = ink.x1 - probe.x1;
  const plain = A.measure(BODY)(s);
  // tailwind.ts: `tracking-wide` compiles to px(0.025 * effPx).
  const tracking = 0.025 * BODY;
  const predicted = plain + tracking * glyphCount(s);
  console.log("## 1b — tracking, which `measureText` does not see");
  console.log(`   ${P("tracking-wide, 38px", 34)}${"".padStart(5)}${"plain".padStart(9)}${"rendered".padStart(9)}${"pred".padStart(9)}${"err".padStart(6)}`);
  console.log(
    `   ${P(clip(s, 33), 34)}${"".padStart(5)}${N(plain, 9)}${N(rendered, 9)}${N(predicted, 9, 2)}${N(rendered - predicted, 6, 2)}\n`,
  );
}

// -- stage 2: is width additive, and is it linear in size? -------------------

console.log("## 2a — is width additive over a split? (it must be, for cached segments)");
let addWorst = 0;
for (const s of CHECK) {
  const m = A.measure(BODY);
  const chars = [...s];
  for (let k = 1; k < chars.length; k++) {
    const a = chars.slice(0, k).join("");
    const b = chars.slice(k).join("");
    addWorst = Math.max(addWorst, Math.abs(m(a) + m(b) - m(s)));
  }
}
console.log(`   every split of every check string at 38px: worst |error| ${addWorst} px\n`);

console.log("## 2b — can a size be extrapolated instead of baked?");
console.log("   Advances are u8 LOGICAL px per glyph, so a 38px bake is not a 64px bake times");
console.log("   38/64. If the error is small the fit ladder can be predicted from one bake;");
console.log("   if it is not, every candidate size has to be baked and measured.\n");
console.log(`   ${P("px", 5)}${"measured".padStart(10)}${"from 64px".padStart(11)}${"err".padStart(8)}${"err %".padStart(8)}`);
{
  const base = A.measure(64)(EN);
  let worstPct = 0;
  for (const px of LADDER) {
    const measured = A.measure(px)(EN);
    const scaled = (base * px) / 64;
    const err = scaled - measured;
    const pct = (100 * err) / measured;
    worstPct = Math.max(worstPct, Math.abs(pct));
    console.log(`   ${P(String(px), 5)}${N(measured, 10)}${N(scaled, 11, 1)}${N(err, 8, 1)}${N(pct, 8, 2)}`);
  }
  console.log(`\n   worst deviation ${worstPct.toFixed(2)}%\n`);
}

// -- stage 3: line height ----------------------------------------------------

console.log("## 3 — line height, which the ops table does not expose");
console.log(`   ${P("px", 5)}${"slot".padStart(6)}${"cellH".padStart(7)}${"lineHeight".padStart(12)}${"lh/px".padStart(8)}`);
for (const px of LADDER) {
  const s = A.info(px);
  console.log(`   ${P(String(px), 5)}${N(s.slot, 6)}${N(s.cellH, 7)}${N(s.lineHeight, 12)}${N(s.lineHeight / px, 8, 3)}`);
}
console.log();

// ---------------------------------------------------------------------------
// wrap and fit, computed against build A's world
// ---------------------------------------------------------------------------

const m38 = A.measure(BODY);
const lh38 = A.info(BODY).lineHeight;
const w38 = cachedWidth(m38);

const enLines = wrapLines(EN, { maxWidth: BOX_W, measure: m38, locale: "en" });
const zhLines = wrapLines(ZH, { maxWidth: BOX_W, measure: m38, locale: "zh" });
const zhNoKinsoku = wrapLines(ZH, { maxWidth: BOX_W, measure: m38, locale: "zh", kinsoku: false });

/** The control: what a space-splitter does to Chinese. */
function naiveWrap(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const trial = line === "" ? word : `${line} ${word}`;
    if (line !== "" && measure(trial) > maxWidth) {
      out.push(line);
      line = word;
    } else line = trial;
  }
  out.push(line);
  return out;
}
const zhNaive = naiveWrap(ZH, BOX_W, m38);

// Shrink-to-fit: the same paragraph into a box that cannot hold it at 38px.
const FIT_BOX = { maxWidth: BOX_W, maxHeight: 3 * lh38 };
const fitted = fitToBox(
  EN,
  FIT_BOX,
  LADDER.map((px) => ({ px, measure: A.measure(px), lineHeight: A.info(px).lineHeight })),
  "en",
);

// ---------------------------------------------------------------------------
// build B — render what the arithmetic decided
// ---------------------------------------------------------------------------

interface Case {
  readonly label: string;
  readonly text: string;
  readonly px: number;
  readonly boxCls?: string;
  readonly lines: number;
}
const cases: Case[] = [
  { label: "EN, no wrap (today)", text: EN, px: BODY, lines: 1 },
  { label: "EN, no wrap + overflow-hidden", text: EN, px: BODY, boxCls: "overflow-hidden", lines: 1 },
  { label: "EN, wrapped", text: enLines.join("\n"), px: BODY, lines: enLines.length },
  { label: "ZH, no wrap (today)", text: ZH, px: BODY, lines: 1 },
  { label: "ZH, split on spaces", text: zhNaive.join("\n"), px: BODY, lines: zhNaive.length },
  { label: "ZH, wrapped", text: zhLines.join("\n"), px: BODY, lines: zhLines.length },
  { label: `fitToBox -> ${fitted.px}px`, text: fitted.text, px: fitted.px, lines: fitted.lines.length },
];

const fitBlocks: Block[] = cases.map((c) => ({
  text: c.text,
  cls: clsOf(c.px),
  w: BOX_W,
  h: c.lines * (A.info(c.px).lineHeight ?? lh38) + 40,
  boxCls: c.boxCls,
}));

const B = await stage({ blocks: fitBlocks }, "wrap");
const bBands = bands({ blocks: fitBlocks });

console.log("## 4 — overflow today, and what the wrap does about it");
console.log(`   Box is ${BOX_W}px wide. "over" is how far the PEN runs past its right edge —`);
console.log(`   read off the widest line, not off the ink, because ink is clipped by the`);
console.log(`   ${VIEW.w}px viewport and an unwrapped line runs well past it.\n`);
console.log(
  `   ${P("case", 30)}${"lines".padStart(6)}${"widest".padStart(8)}${"over".padStart(7)}${"ink x1".padStart(8)}${"runs".padStart(6)}${"ink px".padStart(9)}`,
);
cases.forEach((c, i) => {
  const ink = inkOf(B.frame, bBands[i]!.y0, bBands[i]!.y1);
  const width = cachedWidth(A.measure(c.px));
  const widest = Math.max(...c.text.split("\n").map((l) => width([l])));
  const over = Math.max(0, widest - BOX_W);
  console.log(
    `   ${P(c.label, 30)}${N(c.lines, 6)}${N(widest, 8)}${N(over, 7)}${N(ink.x1 + 1, 8)}${N(ink.runs, 6)}${N(ink.pixels, 9)}`,
  );
});
{
  const kept = inkOf(B.frame, bBands[1]!.y0, bBands[1]!.y1).pixels;
  const all = inkOf(B.frame, bBands[2]!.y0, bBands[2]!.y1).pixels;
  console.log(
    `\n   overflow-hidden keeps ${((100 * kept) / all).toFixed(0)}% of the ink the wrapped ` +
      `block draws — the rest of the sentence is simply not on screen.`,
  );
}

// Predicted vs rendered width, line by line, for the wrapped English.
{
  console.log("\n## 5 — does the predicted block match the rendered one?");
  const predictedW = Math.max(...enLines.map((l) => w38([l])));
  const predictedH = enLines.length * lh38;
  const ink = inkOf(B.frame, bBands[2]!.y0, bBands[2]!.y1);
  console.log(
    `   EN wrapped: predicted ${predictedW}x${predictedH} px, ink spans ` +
      `${ink.x1 + 1 - ink.x0}x${ink.y1 + 1 - ink.y0} in ${ink.runs} row run(s) of ${enLines.length} line(s)`,
  );
  console.log(
    `   ink right edge ${ink.x1 + 1} <= predicted pen ${predictedW} <= box ${BOX_W}: ` +
      `${ink.x1 + 1 <= predictedW && predictedW <= BOX_W ? "holds" : "FAILS"}`,
  );
}

// -- stage 6: is the text still all there, and are the CJK rules respected? --

const flatten = (lines: readonly string[]): string => lines.join("").replace(/\s+/g, "");
const NO_START_CHECK = new Set([..."、。，．！？：；）］｝〕〉》」』】,.;:!?)]}"]);
const badStarts = (lines: readonly string[]): number =>
  lines.filter((l) => l.length > 0 && NO_START_CHECK.has([...l][0]!)).length;

console.log("\n## 6 — losslessness and the CJK line-start rule");
console.log(`   ${P("case", 30)}${"chars in".padStart(10)}${"chars out".padStart(11)}${"lost".padStart(6)}${"bad line starts".padStart(17)}`);
const lossRows: [string, string, readonly string[]][] = [
  ["EN, wrapped", EN, enLines],
  ["ZH, split on spaces", ZH, zhNaive],
  ["ZH, wrapped", ZH, zhLines],
  ["ZH, wrapped (kinsoku off)", ZH, zhNoKinsoku],
];
for (const [label, src, lines] of lossRows) {
  const a = flatten([src]);
  const b = flatten(lines);
  console.log(
    `   ${P(label, 30)}${N(glyphCount(a), 10)}${N(glyphCount(b), 11)}${N(glyphCount(a) - glyphCount(b), 6)}${N(badStarts(lines), 17)}`,
  );
}

// A single box width proves nothing about the line-start rule: whether a break
// lands before a full stop is an accident of that width. Sweep instead, and
// report how often the rule is needed and whether it ever costs a violation of
// the box.
console.log("\n## 6b — the CJK line-start rule, swept across box widths");
{
  const width = cachedWidth(m38);
  let widthsNeedingIt = 0;
  let offendersOff = 0;
  let offendersOn = 0;
  let overrunOn = 0;
  let lossyOn = 0;
  let n = 0;
  for (let w = 300; w <= 1200; w += 10) {
    n++;
    const off = wrapLines(ZH, { maxWidth: w, measure: m38, locale: "zh", kinsoku: false });
    const on = wrapLines(ZH, { maxWidth: w, measure: m38, locale: "zh" });
    const bOff = badStarts(off);
    const bOn = badStarts(on);
    if (bOff > 0) widthsNeedingIt++;
    offendersOff += bOff;
    offendersOn += bOn;
    if (Math.max(...on.map((l) => width([l]))) > w) overrunOn++;
    if (flatten(on) !== flatten([ZH])) lossyOn++;
  }
  console.log(`   ${n} box widths, 300..1200px, the same Chinese paragraph at ${BODY}px`);
  console.log(`   widths where a naive break starts a line with 、。，）: ${widthsNeedingIt}`);
  console.log(`   offending lines, rule off / rule on: ${offendersOff} / ${offendersOn}`);
  console.log(`   widths where the rule pushed a line past the box: ${overrunOn}`);
  console.log(`   widths where the rule dropped a character: ${lossyOn}`);

  // The claim the whole approach rests on: no line is ever wider than the box.
  let bad = 0;
  let checked = 0;
  for (const [text, locale] of [[EN, "en"], [ZH, "zh"]] as const) {
    for (const px of LADDER) {
      const mw = cachedWidth(A.measure(px));
      for (let w = 200; w <= 1400; w += 10) {
        checked++;
        const lines = wrapLines(text, { maxWidth: w, measure: A.measure(px), locale });
        if (Math.max(...lines.map((l) => mw([l]))) > w) bad++;
        if (flatten(lines) !== flatten([text])) bad++;
      }
    }
  }
  console.log(
    `\n   both paragraphs x ${LADDER.length} sizes x 121 widths = ${checked} wraps: ` +
      `${bad} produced a line wider than the box or lost a character`,
  );
}

console.log("\n## 7 — shrink-to-fit");
console.log(
  `   box ${FIT_BOX.maxWidth}x${FIT_BOX.maxHeight} (3 lines at ${BODY}px); ` +
    `ladder ${LADDER.join("/")}`,
);
console.log(
  `   chose ${fitted.px}px -> ${fitted.lines.length} line(s), ${fitted.width}x${fitted.height} px, ` +
    `overflows=${fitted.overflows}`,
);
{
  const ink = inkOf(B.frame, bBands[6]!.y0, bBands[6]!.y1);
  const over = Math.max(0, ink.x1 + 1 - BOX_W);
  console.log(`   rendered: ink right edge ${ink.x1 + 1}, over ${over} px, ${ink.runs} row run(s)`);
}

console.log("\n## 8 — segmentation cost");
{
  const t0 = performance.now();
  const segs = segments(ZH, "zh");
  const t1 = performance.now();
  const lines = wrapLines(EN, { maxWidth: BOX_W, measure: m38, locale: "en" });
  const t2 = performance.now();
  console.log(
    `   Intl.Segmenter on ${glyphCount(ZH)} CJK chars: ${(t1 - t0).toFixed(2)} ms -> ${segs.length} segments`,
  );
  console.log(
    `   full wrap of ${glyphCount(EN)} chars incl. measurement: ${(t2 - t1).toFixed(2)} ms -> ${lines.length} lines`,
  );
}

// ---------------------------------------------------------------------------
// stage 9 — Chinese, against a face that has Chinese in it
// ---------------------------------------------------------------------------

/** How many of a string's distinct codepoints a face maps. A cmap miss draws
 *  tofu and MEASURES as the atlas cell width, so an unmapped face produces a
 *  perfectly self-consistent table of numbers that mean nothing. */
async function coverage(facePath: string, text: string): Promise<[mapped: number, total: number]> {
  const op = (await import(Bun.resolveSync("opentype.js", VENDOR))) as {
    parse: (b: ArrayBuffer) => { charToGlyphIndex: (c: string) => number };
  };
  const bytes = await Bun.file(facePath).arrayBuffer();
  const font = op.parse(bytes);
  const distinct = [...new Set([...text])].filter((c) => c.trim() !== "");
  return [distinct.filter((c) => font.charToGlyphIndex(c) !== 0).length, distinct.length];
}

console.log("\n## 9 — does the face have the glyphs at all?");
{
  const rows: [string, string][] = [
    ["HarmonyOS Sans Regular (vendored)", FACE.regular],
    ["Inter Display Regular (upstream)", join(VENDOR, "assets/fonts/InterDisplay-Regular.ttf")],
  ];
  if (CJK_FACE) rows.push([`${CJK_FACE.split("/").pop()} (--cjk, NOT vendored)`, CJK_FACE]);
  console.log(`   ${P("face", 42)}${"ZH chars mapped".padStart(17)}`);
  for (const [label, path] of rows) {
    const [mapped, total] = await coverage(path, ZH);
    console.log(`   ${P(label, 42)}${`${mapped} / ${total}`.padStart(17)}`);
  }
  console.log("\n   Every Chinese number in stages 4-6b above is therefore a TOFU width: the wrap");
  console.log("   logic is exercised, the metrics are the missing-glyph cell.");
}

if (CJK_FACE) {
  const cjkFace = { regular: CJK_FACE, bold: CJK_FACE };
  // Pen check on fragments that FIT the viewport — the whole paragraph is
  // 2699px wide and would be clipped at 1920, which makes the ink right edge
  // the viewport rather than the pen.
  const ZH_PARTS = [
    "确定性视频渲染。",
    "没有浏览器，没有无头 Chrome",
    "把 Tailwind 的一个子集编译成二进制样式表",
  ];
  const probeBlocks: Block[] = [{ text: "H", cls: clsOf(BODY), w: 1900, h: hOf(BODY) }];
  for (const s of ZH_PARTS) probeBlocks.push({ text: `${s}H`, cls: clsOf(BODY), w: 1900, h: hOf(BODY) });
  // ZH_PARTS is not the whole paragraph, and the wrap below measures the whole
  // paragraph against this build. Bake it.
  probeBlocks.push({ text: ZH, cls: clsOf(BODY), w: 1900, h: hOf(BODY) });
  const C0 = await stage({ blocks: probeBlocks }, "cjk-truth", cjkFace);
  const cBands = bands({ blocks: probeBlocks });
  assertMappable(C0, "ZH", ZH, [BODY]);
  const mz = C0.measure(BODY);
  const lhz = C0.info(BODY).lineHeight;
  const wz = cachedWidth(mz);

  const zProbe = inkOf(C0.frame, cBands[0]!.y0, cBands[0]!.y1).x1;
  console.log(`\n   ${P("pen check, real CJK glyphs", 44)}${"measured".padStart(9)}${"rendered".padStart(9)}${"err".padStart(6)}`);
  ZH_PARTS.forEach((s, i) => {
    const rendered = inkOf(C0.frame, cBands[i + 1]!.y0, cBands[i + 1]!.y1).x1 - zProbe;
    console.log(`   ${P(clip(s, 43), 44)}${N(mz(s), 9)}${N(rendered, 9)}${N(rendered - mz(s), 6)}`);
  });

  const lines = wrapLines(ZH, { maxWidth: BOX_W, measure: mz, locale: "zh" });
  const naive = naiveWrap(ZH, BOX_W, mz);
  const noKin = wrapLines(ZH, { maxWidth: BOX_W, measure: mz, locale: "zh", kinsoku: false });

  const cjkCases: Case[] = [
    { label: "ZH, no wrap (today)", text: ZH, px: BODY, lines: 1 },
    { label: "ZH, split on spaces", text: naive.join("\n"), px: BODY, lines: naive.length },
    { label: "ZH, wrapped", text: lines.join("\n"), px: BODY, lines: lines.length },
  ];
  const cjkBlocks: Block[] = cjkCases.map((c) => ({
    text: c.text, cls: clsOf(c.px), w: BOX_W, h: c.lines * lhz + 40,
  }));
  const C = await stage({ blocks: cjkBlocks }, "cjk-wrap", cjkFace);
  const cwBands = bands({ blocks: cjkBlocks });

  console.log(`\n   with real glyphs, box ${BOX_W}px, ${BODY}px:`);
  console.log(`   ${P("case", 24)}${"lines".padStart(6)}${"widest".padStart(8)}${"over".padStart(7)}${"ink x1".padStart(8)}${"runs".padStart(6)}`);
  cjkCases.forEach((c, i) => {
    const ink = inkOf(C.frame, cwBands[i]!.y0, cwBands[i]!.y1);
    const widest = Math.max(...c.text.split("\n").map((l) => wz([l])));
    console.log(
      `   ${P(c.label, 24)}${N(c.lines, 6)}${N(widest, 8)}${N(Math.max(0, widest - BOX_W), 7)}${N(ink.x1 + 1, 8)}${N(ink.runs, 6)}`,
    );
  });

  let need = 0, off = 0, on = 0, overrun = 0, lossy = 0, n = 0;
  for (let w = 300; w <= 1200; w += 10) {
    n++;
    const a = wrapLines(ZH, { maxWidth: w, measure: mz, locale: "zh", kinsoku: false });
    const b = wrapLines(ZH, { maxWidth: w, measure: mz, locale: "zh" });
    if (badStarts(a) > 0) need++;
    off += badStarts(a);
    on += badStarts(b);
    if (Math.max(...b.map((l) => wz([l]))) > w) overrun++;
    if (flatten(b) !== flatten([ZH])) lossy++;
  }
  console.log(
    `\n   ${n} widths swept: line-start rule needed at ${need}, offenders off/on ${off}/${on}, ` +
      `overruns ${overrun}, lost chars ${lossy}`,
  );
  console.log(`   lines: ${lines.map((l) => `${wz([l])}px`).join("  ")}`);
  for (const l of lines) console.log(`     | ${l}`);

  const latinPak = Bun.file(join(ROOT, "dist/fit-wrap/main.pak")).size;
  const cjkPak = Bun.file(join(ROOT, "dist/fit-cjk-wrap/main.pak")).size;
  console.log(
    `\n   pak: ${(latinPak / 1024).toFixed(0)} KB Latin vs ${(cjkPak / 1024).toFixed(0)} KB with ` +
      `${new Set([...ZH]).size} CJK codepoints baked — the atlas holds the characters the` +
      ` composition uses, not the face.`,
  );
} else {
  console.log("\n   pass --cjk <path-to-a-CJK-face> to measure the Chinese arm for real.");
}

if (PNG_DIR) console.log(`\n   frames written to ${PNG_DIR}`);
