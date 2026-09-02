#!/usr/bin/env bun
/**
 * Render the three line-breaking strategies side by side, so the choice of
 * default is made by looking rather than by argument.
 *
 * Same copy, same box, same face — only `strategy` differs. A white rule the
 * width of the column sits above each block, because the whole question is how
 * the lines sit against that edge.
 *
 * The face is Noto Sans SC: the Chinese cases need it, and using one face for
 * both scripts keeps the comparison about breaking rather than about metrics.
 *
 *   bun scripts/assets.ts                 # once, if the face is missing
 *   bun scripts/wrap-compare.ts
 *   bun scripts/wrap-compare.ts --out /tmp/wrap.png
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { bands, VIEW, type Block } from "../compositions/fit/gen.ts";
import { cachedWidth, wrapLines, type WrapStrategy } from "../src/text/fit.ts";
import { openMeasurer } from "../src/text/measure.ts";
import { hardenedBootWorld } from "../src/runtime/boot.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const VENDOR = join(ROOT, "vendor/pocketjs");
const FACE = {
  regular: join(ROOT, "assets/fonts/NotoSansSC-Regular.otf"),
  bold: join(ROOT, "assets/fonts/NotoSansSC-Bold.otf"),
};

const argv = process.argv.slice(2);
const flagOf = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const OUT = flagOf("out") ?? "/tmp/pocketjs-motion-wrap.png";

const COLUMN = 880;
const STRATEGIES: readonly WrapStrategy[] = ["greedy", "balanced"];

interface Case {
  readonly key: string;
  readonly note: string;
  readonly text: string;
  readonly locale: string;
  readonly px: number;
  readonly bold: boolean;
}

const CASES: readonly Case[] = [
  {
    key: "标题 · 中文",
    note: "heading, Chinese — 2 lines",
    text: "把网页那套写法用来写视频，但不要浏览器",
    locale: "zh",
    px: 56,
    bold: true,
  },
  {
    key: "标题 · 英文",
    note: "heading, English — 2 lines",
    text: "Deterministic video rendering without a browser",
    locale: "en",
    px: 56,
    bold: true,
  },
  {
    key: "正文 · 中文",
    note: "body, Chinese — 4 lines",
    text:
      "文字的断行在构建期就定好了：先问渲染器每个字形的步进宽度，再决定每一行到哪里断、" +
      "标题能用多大的字号，然后把带着换行符的字符串写进生成的源码。",
    locale: "zh",
    px: 30,
    bold: false,
  },
  {
    key: "正文 · 英文",
    note: "body, English — 4 lines",
    text:
      "Deterministic video rendering. No browser, no headless Chrome, no screenshot " +
      "loop, and the same bytes every time you ask for them.",
    locale: "en",
    px: 30,
    bold: false,
  },
];

if (!existsSync(FACE.regular)) {
  console.error(`wrap-compare: ${FACE.regular} is absent — run \`bun scripts/assets.ts\``);
  process.exit(1);
}

const LABEL_PX = 22;
// One entry per distinct (px, weight): the cases deliberately share sizes — two
// headings at 56 bold, two bodies at 30 regular — and `openMeasurer` refuses a
// list that asks for the same slot twice, because a duplicate is how a caller
// discovers it was reading someone else's slot table.
const sizes = [...new Map(
  [{ px: LABEL_PX, bold: false }, ...CASES.map((c) => ({ px: c.px, bold: c.bold }))]
    .map((s) => [`${s.px}:${s.bold}`, s] as const),
).values()];

const measurer = await openMeasurer({
  face: FACE,
  sizes,
  texts: [...CASES.map((c) => c.text), ...CASES.map((c) => c.key), "greedy balanced ·"],
});

interface Row {
  readonly caseKey: string;
  readonly strategy: WrapStrategy;
  readonly lines: readonly string[];
  readonly widths: readonly number[];
}

const rows: Row[] = [];
const blocks: Block[] = [{ text: "", cls: "", w: 40, h: 40, fill: false }];

for (const c of CASES) {
  const measure = measurer.measure(c.px, c.bold);
  const width = cachedWidth(measure);
  const lh = measurer.lineHeight(c.px, c.bold);

  for (const strategy of STRATEGIES) {
    const lines = wrapLines(c.text, { maxWidth: COLUMN, measure, locale: c.locale, strategy });
    rows.push({ caseKey: c.key, strategy, lines, widths: lines.map((l) => width([l])) });

    blocks.push({
      text: `${c.key}  ·  ${strategy}`,
      cls: `text-[${LABEL_PX}px] text-cyan-400`,
      w: COLUMN,
      h: 34,
    });
    // The column edge, so the eye has the thing the strategies disagree about.
    blocks.push({ text: "", cls: "", w: COLUMN, h: 2, fill: true });
    blocks.push({
      text: lines.join("\n"),
      cls: `text-[${c.px}px] text-white${c.bold ? " font-bold" : ""}`,
      w: COLUMN,
      h: lines.length * lh + 26,
    });
  }
}

await measurer.close();

const spec = { blocks };
const total = blocks.reduce((n, b) => n + b.h, 0);
if (total > VIEW.h) throw new Error(`wrap-compare: ${total}px of blocks, viewport is ${VIEW.h}`);

const specPath = "/tmp/pocketjs-motion-wrap-compare.json";
await Bun.write(specPath, JSON.stringify(spec));

const run = async (cmd: string[]): Promise<void> => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", cwd: ROOT });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  if ((await p.exited) !== 0) {
    console.error(out, err);
    throw new Error(`failed: ${cmd.join(" ")}`);
  }
};

await run(["bun", join(ROOT, "compositions/fit/gen.ts"), specPath]);
const dist = join(ROOT, "dist/wrap-compare");
await run([
  "bun", join(VENDOR, "tools/build.ts"), join(ROOT, "compositions/fit/main.tsx"),
  `--outdir=${dist}`, "--framework=solid",
  `--font-regular=${FACE.regular}`, `--font-bold=${FACE.bold}`,
]);

const world = await hardenedBootWorld({
  bundlePath: join(dist, "main.js"),
  pakPath: join(dist, "main.pak"),
  width: VIEW.w,
  height: VIEW.h,
  hz: 30,
});
world.frame(0);
for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
const frame = world.render();

// Crop to the content: full width is 1920 and the column is 880.
const cropW = COLUMN + 80;
const cropH = Math.min(VIEW.h, total + 20);
const ff = Bun.spawn(
  ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba",
    "-s", `${VIEW.w}x${VIEW.h}`, "-i", "pipe:0",
    "-vf", `crop=${cropW}:${cropH}:0:0`, "-frames:v", "1", OUT],
  { stdin: "pipe", stdout: "inherit", stderr: "inherit" },
);
ff.stdin.write(frame);
await ff.stdin.end();
if ((await ff.exited) !== 0) throw new Error("wrap-compare: png write failed");

console.log(`\ncolumn ${COLUMN}px, Noto Sans SC\n`);
console.log(`${"case".padEnd(16)}${"strategy".padEnd(11)}${"lines".padStart(6)}${"widths (px)".padStart(14)}`);
for (const r of rows) {
  console.log(
    `${r.caseKey.padEnd(16)}${r.strategy.padEnd(11)}${String(r.lines.length).padStart(6)}` +
      `   ${r.widths.map((w) => String(w)).join(" / ")}`,
  );
}
console.log(`\n${OUT}`);
