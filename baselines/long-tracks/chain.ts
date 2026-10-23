#!/usr/bin/env bun
/**
 * The measurement behind patches/0050's choice of a wider count over a kit
 * that chains tracks: one continuous move, written as ONE track or as TWO
 * animations on the same property in one comma list — ticks [0, H] with fill
 * both, then [H, 600] delayed H ticks with fill forwards only, so the later
 * one writes from its start on and the earlier one holds nothing it does not
 * also write. `baselines/long-tracks.md` has the numbers.
 *
 *   bun baselines/long-tracks/chain.ts <one|two> <composition dir> [--handoff H] [--odd] [--shutter ANGLE]
 *
 * Write into a scratch copy of the repository: a directory under
 * `compositions/` that neither ledger names fails both ledgers' coverage gate.
 * `--odd` keys the move on odd ticks (and 0 and 600), `--handoff` places the
 * hand-off (300 by default; an odd one needs `--odd` or it adds a one-tick
 * segment beside the even keys, which the shutter treats as a jump in both
 * versions alike).
 */

const [which, out] = process.argv.slice(2);
if ((which !== "one" && which !== "two") || !out) {
  console.error("usage: chain.ts <one|two> <composition dir> [--handoff H] [--odd] [--shutter ANGLE]");
  process.exit(2);
}
const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const TICKS = 600;
const H = Number(flag("--handoff") ?? 300);
const odd = process.argv.includes("--odd");
const angle = flag("--shutter");
const name = out.replace(/\/$/, "").split("/").pop()!;

/** 120 px either side of 140 every 40 ticks: about 19 px per tick through the centre. */
const x = (t: number) => Math.round((140 + 120 * Math.sin((2 * Math.PI * t) / 40)) * 1000) / 1000;
const keys: number[] = [];
if (odd) {
  keys.push(0);
  for (let t = 1; t < TICKS; t += 2) keys.push(t);
  keys.push(TICKS);
} else {
  for (let t = 0; t <= TICKS; t += 2) keys.push(t);
}
if (!keys.includes(H)) keys.push(H), keys.sort((a, b) => a - b);

const stop = (t: number, from: number, span: number) =>
  [`${(((t - from) * 100) / span).toFixed(4)}%`, { transform: `translateX(${x(t)}px)` }] as const;
const ms = (t: number) => ((t * 1000) / 60).toFixed(3);
const keyframes: Record<string, Record<string, unknown>> = {};
const animation: Record<string, string> = {};
if (which === "one") {
  keyframes.k = Object.fromEntries(keys.map((t) => stop(t, 0, TICKS)));
  animation.m = `k ${ms(TICKS)}ms linear 0ms both`;
} else {
  keyframes.a = Object.fromEntries(keys.filter((t) => t <= H).map((t) => stop(t, 0, H)));
  keyframes.b = Object.fromEntries(keys.filter((t) => t >= H).map((t) => stop(t, H, TICKS - H)));
  animation.m = `a ${ms(H)}ms linear 0ms both, b ${ms(TICKS - H)}ms linear ${ms(H)}ms forwards`;
}

await Bun.write(
  `${out}/pocket.config.ts`,
  `import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";\n` +
    `export default definePocketConfig({ theme: { keyframes: ${JSON.stringify(keyframes)}, animation: ${JSON.stringify(animation)} } });\n`,
);
await Bun.write(
  `${out}/main.tsx`,
  `import { mount } from "@pocketjs/framework";\nimport { View } from "@pocketjs/framework/components";\n` +
    `mount(() => (<View class="w-full h-full bg-[#000000]"><View class="absolute left-[0px] top-[70px] w-[40px] h-[40px] bg-[#ffffff] animate-m" /></View>));\n`,
);
await Bun.write(
  `${out}/pocket.json`,
  JSON.stringify(
    {
      $schema: "https://pocketjs.dev/schema/pocket-2.json",
      pocket: 2,
      id: `dev.pocket-stack.motion-${name}`,
      name,
      title: "chained tracks against one",
      version: "0.0.0",
      engine: { capabilities: { requires: ["text.glyphs.baked"] } },
      app: {
        entry: `compositions/${name}/main.tsx`,
        output: name,
        framework: "solid",
        viewport: { fixed: { logical: [320, 180], presentation: "native" } },
      },
    },
    null,
    2,
  ),
);
await Bun.write(
  `${out}/pocket-motion.json`,
  JSON.stringify(
    { motion: 1, durationFrames: TICKS / 2, fps: 30, supersample: 1, ...(angle ? { shutter: { angle: Number(angle), samples: 8 } } : {}) },
    null,
    2,
  ),
);
