#!/usr/bin/env bun
/**
 * What the pocket-motion paint effects cost per frame at 1920x1080.
 *
 * Each case is one small composition built into a scratch directory, booted
 * the way `render` boots one, and rasterised `--reps` times at one frame; the
 * number is the median wall time of `world.render()` — the core's draw walk
 * plus the software rasteriser, which is what an effect adds to. The
 * `baseline` case is the same picture with no effect, so each row's delta is
 * the effect's own cost. The frame hash, the encoder and the guest are not
 * in the number.
 *
 *   bun scripts/paint-bench.ts                 # every case, 15 reps
 *   bun scripts/paint-bench.ts --reps 30 --only glow
 *
 * The recorded run is `baselines/paint-effects.md`; re-run and compare rather
 * than quote it on another machine.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { hardenedBootWorld, pocketjsRoot } from "../src/runtime/boot.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const FONTS = [
  `--font-regular=${join(ROOT, "assets/fonts/HarmonyOS_Sans_Regular.ttf")}`,
  `--font-bold=${join(ROOT, "assets/fonts/HarmonyOS_Sans_Bold.ttf")}`,
];

/** Six 96 px lines of lyric-shaped copy over a dark ground; `line` adds classes to each. */
function lyrics(line: string, wrap = ""): string {
  const rows = [
    "Under the river lights",
    "we counted every sign",
    "the city hummed a line",
    "and the night kept time",
    "nobody knew the words",
    "so we sang them twice",
  ]
    .map((t) => `        <Text class="text-[96px] font-bold text-[#f8fafc]${line ? ` ${line}` : ""}">{${JSON.stringify(t)}}</Text>`)
    .join("\n");
  return `import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[#0f172a] items-center justify-center">
    <View class="flex-col items-center gap-[24px]${wrap ? ` ${wrap}` : ""}">
${rows}
    </View>
  </View>
));
`;
}

interface Case {
  readonly name: string;
  readonly what: string;
  readonly source: string;
}

const CASES: readonly Case[] = [
  { name: "baseline", what: "six 96 px bold lines, no effect", source: lyrics("") },
  { name: "stroke-outside", what: "+ text-stroke-[6px] outside on every line", source: lyrics("text-stroke-[6px] text-stroke-[#e11d48]") },
  { name: "stroke-center", what: "+ text-stroke-[4px] centred on every line", source: lyrics("text-stroke-[4px] text-stroke-[#e11d48] text-stroke-center") },
  { name: "glow", what: "+ glow-[24px] on every line (six layers)", source: lyrics("glow-[24px] glow-amber-400 glow-gain-[2]") },
  { name: "shadow", what: "+ drop-shadow-[6px_6px_8px] on every line (six layers)", source: lyrics("drop-shadow-[6px_6px_8px_#000000]") },
  { name: "blur-block", what: "+ blur-md on the column (one layer, ~1400x780 px)", source: lyrics("", "blur-md") },
  { name: "blur-3xl", what: "+ blur-3xl on the column (one layer, 64 px deviation)", source: lyrics("", "blur-3xl") },
  { name: "blend", what: "+ mix-blend-screen on the column (one layer)", source: lyrics("", "mix-blend-screen") },
  {
    name: "gradient-text",
    what: "+ bg-clip-text with a three-stop gradient on every line",
    source: lyrics("bg-clip-text text-transparent bg-linear-90 from-[#fb7185] via-[#fde047] to-[#38bdf8]"),
  },
  {
    name: "gradient-ground",
    what: "+ a full-frame four-stop 30deg gradient ground",
    source: lyrics("").replace(
      "bg-[#0f172a]",
      "bg-[linear-gradient(30deg,#1e3a8a,#7c3aed_35%,#ec4899_70%,#fde68a)]",
    ),
  },
];

async function build(dir: string, source: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "main.tsx"), `// @title paint bench\n${source}`);
  const p = Bun.spawn(
    ["bun", join(pocketjsRoot(), "tools/build.ts"), join(dir, "main.tsx"), `--outdir=${join(dir, "dist")}`, "--framework=solid", "--hz=60", ...FONTS],
    { stdout: "pipe", stderr: "pipe", cwd: ROOT },
  );
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`paint-bench: build failed\n${out}\n${err}`);
}

async function measure(dir: string, reps: number): Promise<{ median: number; min: number }> {
  const world = await hardenedBootWorld({
    bundlePath: join(dir, "dist", "main.js"),
    pakPath: join(dir, "dist", "main.pak"),
    width: 1920,
    height: 1080,
    hz: 30,
  });
  world.frame(0);
  for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
  world.render(); // warm: first-use allocations and wasm tier-up
  const times: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = Bun.nanoseconds();
    world.render();
    times.push((Bun.nanoseconds() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(times.length / 2)]!, min: times[0]! };
}

const argv = process.argv.slice(2);
const repsAt = argv.indexOf("--reps");
const reps = repsAt >= 0 ? Number(argv[repsAt + 1]) : 15;
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? argv[onlyAt + 1] : undefined;

const work = await mkdtemp(join(tmpdir(), "pocketjs-paint-bench-"));
try {
  const rows: { c: Case; median: number; min: number }[] = [];
  for (const c of CASES) {
    if (only && c.name !== only && c.name !== "baseline") continue;
    const dir = join(work, c.name);
    await build(dir, c.source);
    const { median, min } = await measure(dir, reps);
    rows.push({ c, median, min });
    console.log(`${c.name.padEnd(16)} ${median.toFixed(2).padStart(8)} ms  (min ${min.toFixed(2)})  ${c.what}`);
  }
  const base = rows.find((r) => r.c.name === "baseline")?.median;
  if (base !== undefined) {
    console.log("");
    console.log("| case | ms/frame (median) | over baseline | what |");
    console.log("|---|---:|---:|---|");
    for (const r of rows) {
      const d = r.median - base;
      const delta = r.c.name === "baseline" ? "—" : `${d >= 0 ? "+" : ""}${d.toFixed(2)}`;
      console.log(`| ${r.c.name} | ${r.median.toFixed(2)} | ${delta} | ${r.c.what} |`);
    }
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
