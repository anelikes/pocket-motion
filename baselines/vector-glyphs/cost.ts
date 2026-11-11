#!/usr/bin/env bun
/**
 * What a vector glyph costs against an atlas glyph (`patches/0063`), per
 * frame, in the core: the draw walk (where a vector glyph's outline is
 * flattened and mapped) and the raster (where its PATH op is filled).
 *
 *   bun baselines/vector-glyphs/cost.ts [--runs 40]
 *
 * Stages its compositions into a fresh tree of symlinks under `dist/`, builds
 * each through `runBuild`, boots each, and times `ui_draw_hash` (the walk,
 * nothing rasterised) and `render` (walk + raster) at frame 0, `runs` times
 * each after a warm-up. Prints min and median ms and the load average.
 */

import { mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join, resolve } from "node:path";

import { runBuild } from "../../src/cli/build.ts";
import { resolveComposition } from "../../src/cli/resolve.ts";
import { WasmFrameSource } from "../../src/runtime/frame-source.ts";

const ROOT = resolve(import.meta.dir, "../..");
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1] ?? 40) || 40;

const LINE = "排行榜第一名进击";
const lines = (cls: string, n: number, step: number) =>
  Array.from({ length: n }, (_, i) => `    <Text class="absolute left-[40px] top-[${20 + i * step}px] ${cls} text-white">{${JSON.stringify(LINE)}}</Text>`);

const SCENES: Record<string, { body: string[]; note: string }> = {
  "atlas-176": { body: lines("text-[176px] font-bold", 4, 260), note: "4 lines x 8 glyphs, atlas (GLYPH_RUN), Noto Sans SC Bold's largest atlas size" },
  "vector-176": { body: lines("text-[176px] font-bold text-vector", 4, 260), note: "the same, text-vector (PATH per glyph)" },
  "vector-176-turned": {
    body: lines("text-[176px] font-bold text-vector rotate-6", 4, 260),
    note: "the same, each line turned 6 degrees (no atlas equivalent: cells stay upright)",
  },
  "vector-480": {
    body: [`    <Text class="absolute left-[40px] top-[200px] text-[480px] font-bold text-white">{"第一名"}</Text>`],
    note: "3 glyphs at 480 px, vector because the atlas cell cannot hold it",
  },
  "atlas-64": { body: lines("text-[64px] font-bold", 12, 88), note: "12 lines x 8 glyphs at 64 px, atlas: a title size" },
  "vector-64": { body: lines("text-[64px] font-bold text-vector", 12, 88), note: "the same, text-vector" },
};

const tree = mkdtempSync(join(ROOT, "dist", "vector-glyphs-cost-"));
mkdirSync(join(tree, "dist"), { recursive: true });
for (const entry of readdirSync(ROOT)) {
  if (entry === "dist" || entry === ".git" || entry === "compositions") continue;
  symlinkSync(join(ROOT, entry), join(tree, entry));
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

console.log(`vector-glyph cost — ${runs} runs each, load ${loadavg().map((l) => l.toFixed(1)).join(" ")}`);
console.log("scene | walk min/median ms | walk+raster min/median ms | what");
for (const [name, scene] of Object.entries(SCENES)) {
  const dir = join(tree, "compositions", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "main.tsx"),
    [
      'import { mount } from "@pocketjs/framework";',
      'import { Text, View } from "@pocketjs/framework/components";',
      "mount(() => (",
      '  <View class="w-full h-full bg-black">',
      ...scene.body,
      "  </View>",
      "));",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "pocket-motion.json"),
    JSON.stringify({
      motion: 1,
      durationFrames: 1,
      fps: 30,
      supersample: 1,
      fonts: { regular: "assets/fonts/NotoSansSC-Regular.otf", bold: "assets/fonts/NotoSansSC-Bold.otf" },
    }),
  );
  writeFileSync(
    join(dir, "pocket.json"),
    JSON.stringify({
      pocket: 2,
      id: `dev.pocket-stack.motion-cost-${name}`,
      name: `cost-${name}`,
      title: name,
      version: "0.0.0",
      engine: { capabilities: { requires: [] } },
      app: {
        entry: `compositions/${name}/main.tsx`,
        output: "main",
        framework: "solid",
        viewport: { fixed: { logical: [1920, 1080], presentation: "native" } },
      },
    }),
  );
  const resolved = await resolveComposition({ dir, flags: { json: false }, requireBundle: false });
  if (!resolved.ok) throw new Error(`${name}: ${resolved.message}`);
  const c = resolved.value;
  await runBuild(c);
  const source = await WasmFrameSource.create({
    compositionId: c.compositionId,
    bundlePath: c.bundlePath,
    pakPath: c.pakPath,
    width: c.width,
    height: c.height,
    hz: c.fps,
    durationFrames: 1,
    renderScale: 1,
    shutter: null,
  });
  await source.seekFrame(0);
  const ex = source.world.exports as unknown as Record<string, () => bigint>;
  const walk: number[] = [];
  const full: number[] = [];
  for (let i = 0; i < runs + 3; i++) {
    let t = performance.now();
    ex.ui_draw_hash!();
    const w = performance.now() - t;
    t = performance.now();
    source.world.render();
    const f = performance.now() - t;
    if (i >= 3) {
      walk.push(w);
      full.push(f);
    }
  }
  await source.dispose();
  console.log(
    `${name} | ${Math.min(...walk).toFixed(2)} / ${median(walk).toFixed(2)} | ${Math.min(...full).toFixed(2)} / ${median(full).toFixed(2)} | ${scene.note}`,
  );
}
console.log(`load after: ${loadavg().map((l) => l.toFixed(1)).join(" ")}`);
