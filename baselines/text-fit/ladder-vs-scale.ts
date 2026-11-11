#!/usr/bin/env bun
/**
 * Two ways a fitted text size can reach the frame, measured before either is
 * built into the core.
 *
 *   LADDER  every rung is its own baked slot; a fitted node draws with the
 *           rung's atlas through GLYPH_RUN, exactly as a node declared at that
 *           size draws.
 *   SCALE   one slot is baked at the largest size; a fitted node draws it
 *           scaled by `rung / max`, which is the path an axis-aligned scale
 *           already takes today (`emit_text`: glyph-page TEX_QUADs).
 *
 * Both are measured with what the tree draws today: LADDER as text declared
 * at each rung, SCALE as text declared at the top rung under `scale-N`. So
 * this needs no engine change, and what it measures is what each option would
 * draw.
 *
 * Three numbers per option:
 *
 *   build  pak bytes and build CPU, for a Latin charset and for 1,000 CJK
 *          ideographs, one rung against five against eight. The baker's
 *          charset is global — every slot bakes every collected codepoint
 *          its face maps — so a ladder costs rungs x charset.
 *   pixels each rung drawn both ways, glyph by glyph: the ink box's size and
 *          the mean absolute coverage difference after aligning the two
 *          boxes, and the run's width (integer advances at the rung against
 *          the top rung's advances times the scale).
 *   render CPU per frame for 40 runs drawn each way, `trace --no-reuse`.
 *
 *   bun baselines/text-fit/ladder-vs-scale.ts [build|pixels|render]   # writes runs/*.json and *.png
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
/** `dist/<name>`: two levels down, where `repoRootOf` finds the repository. */
const STAGE = join(ROOT, "dist");
const OUT = join(ROOT, "baselines/text-fit/runs");
const CLI = join(ROOT, "src/cli/main.ts");

const FONTS = { regular: "assets/fonts/NotoSansSC-Regular.otf", bold: "assets/fonts/NotoSansSC-Bold.otf" };
const W = 1920;
const H = 1080;

/** The batch-QA name ladder, and the ten-percent ladder `text-fit-[48..88]` writes. */
const LADDER5 = [88, 76, 64, 56, 48];
const LADDER8 = [88, 80, 72, 65, 59, 54, 49, 48];

const LATIN = "Acme Kühlschrankzubehör Pro 3000 — Édition limitée, 12,99 € (inkl. MwSt.) Ågård Øresund";
const CJK = Array.from({ length: 1000 }, (_, i) => String.fromCodePoint(0x4e00 + i * 7)).join("");

function files(id: string, app: string, sidecar: object): Record<string, string> {
  return {
    "main.tsx": `import { mount } from "@pocketjs/framework";\nimport App from "./app.tsx";\n\nmount(() => <App />);\n`,
    "app.tsx": app,
    "pocket.json":
      JSON.stringify(
        {
          $schema: "https://pocketjs.dev/schema/pocket-2.json",
          pocket: 2,
          id: `dev.pocket-stack.motion-textfit-${id}`,
          name: `pocketjs-motion-textfit-${id}`,
          title: `text-fit probe ${id}`,
          version: "0.0.0",
          engine: { capabilities: { requires: ["text.glyphs.baked"] } },
          app: {
            entry: "main.tsx",
            output: "main",
            framework: "solid",
            viewport: { fixed: { logical: [W, H], presentation: "native" } },
          },
        },
        null,
        2,
      ) + "\n",
    "pocket-motion.json": JSON.stringify({ motion: 1, durationFrames: 60, fps: 30, supersample: 1, fonts: FONTS, ...sidecar }, null, 2) + "\n",
  };
}

function stage(id: string, app: string, sidecar: object = {}): string {
  const dir = join(STAGE, `textfit-${id}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files(id, app, sidecar))) writeFileSync(join(dir, name), text);
  return dir;
}

async function run(argv: string[]): Promise<{ stdout: string; cpuMs: number; wallMs: number }> {
  const t0 = performance.now();
  const p = Bun.spawn(["bun", CLI, ...argv], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  const wallMs = performance.now() - t0;
  if (code !== 0) throw new Error(`${argv.join(" ")} exited ${code}\n${stderr}\n${stdout}`);
  const u = p.resourceUsage();
  const cpuMs = u ? (Number(u.cpuTime.user) + Number(u.cpuTime.system)) / 1000 : NaN;
  return { stdout, cpuMs, wallMs };
}

const q = (s: string): string => JSON.stringify(s);

// ---- build cost -----------------------------------------------------------

function ladderApp(rungs: readonly number[], charset: string): string {
  const rows = rungs
    .map((px, i) => `      <Text class="absolute left-[40px] top-[${40 + i * 10}px] text-[${px}px] font-bold text-white">{${q(i === 0 ? charset : "A")}}</Text>`)
    .join("\n");
  return `import { Text, View } from "@pocketjs/framework/components";\n\nexport default function App() {\n  return (\n    <View class="w-full h-full bg-black relative">\n${rows}\n    </View>\n  );\n}\n`;
}

async function buildCost(): Promise<object[]> {
  const out: object[] = [];
  for (const [charsetName, charset] of [["latin", LATIN], ["cjk-1000", CJK]] as const) {
    for (const rungs of [[88], LADDER5, LADDER8]) {
      const id = `build-${charsetName}-${rungs.length}`;
      const dir = stage(id, ladderApp(rungs, charset));
      const samples: number[] = [];
      let pak = 0;
      for (let i = 0; i < 3; i++) {
        const r = await run(["build", dir]);
        samples.push(r.cpuMs);
        pak = Bun.file(join(ROOT, "dist", "dist", `textfit-${id}`, "main.pak")).size;
      }
      const sorted = samples.sort((a, b) => a - b);
      const row = { charset: charsetName, rungs: rungs.length, sizes: rungs, pakBytes: pak, buildCpuMsMedian: Math.round(sorted[1]!) };
      console.log(JSON.stringify(row));
      out.push(row);
    }
  }
  return out;
}

// ---- pixels ---------------------------------------------------------------

const GLYPHS = ["a", "g", "W", "e", "8", "@", "价", "格", "東"];
const RUN = "Kühlschrankzubehör Pro 3000";
const RUNGS = [76, 64, 56, 48];

/** Each glyph alone at a fixed anchor, one row per rung, plus one run per rung. */
function pixelsApp(mode: "ladder" | "scale"): string {
  const nodes: string[] = [];
  RUNGS.forEach((px, r) => {
    const top = 20 + r * 250;
    GLYPHS.forEach((g, i) => {
      const left = 40 + i * 140;
      nodes.push(
        mode === "ladder"
          ? `<Text class="absolute left-[${left}px] top-[${top}px] text-[${px}px] font-bold text-white">{${q(g)}}</Text>`
          : `<Text class="absolute left-[${left}px] top-[${top}px] text-[88px] font-bold text-white origin-top-left scale-${((px / 88) * 100).toFixed(4)}">{${q(g)}}</Text>`,
      );
    });
    nodes.push(
      mode === "ladder"
        ? `<Text class="absolute left-[40px] top-[${top + 130}px] text-[${px}px] font-bold text-white">{${q(RUN)}}</Text>`
        : `<Text class="absolute left-[40px] top-[${top + 130}px] text-[88px] font-bold text-white origin-top-left scale-${((px / 88) * 100).toFixed(4)}">{${q(RUN)}}</Text>`,
    );
  });
  return `import { Text, View } from "@pocketjs/framework/components";\n\nexport default function App() {\n  return (\n    <View class="w-full h-full bg-black relative">\n      ${nodes.join("\n      ")}\n    </View>\n  );\n}\n`;
}

async function rgbaOf(png: string): Promise<Uint8Array> {
  const p = Bun.spawn(["ffmpeg", "-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { stdout: "pipe" });
  const buf = new Uint8Array(await new Response(p.stdout).arrayBuffer());
  await p.exited;
  return buf;
}

interface Ink { x: number; y: number; w: number; h: number }

function inkBox(g: Uint8Array, x0: number, y0: number, x1: number, y1: number): Ink | null {
  let mx = Infinity, my = Infinity, Mx = -1, My = -1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (g[y * W + x]! > 0) { mx = Math.min(mx, x); my = Math.min(my, y); Mx = Math.max(Mx, x); My = Math.max(My, y); }
  }
  return Mx < 0 ? null : { x: mx, y: my, w: Mx - mx + 1, h: My - my + 1 };
}

/** Mean |a - b| over the union of two ink boxes, the second shifted so their top-left corners meet. */
function meanAbs(a: Uint8Array, ia: Ink, b: Uint8Array, ib: Ink): number {
  const w = Math.max(ia.w, ib.w);
  const h = Math.max(ia.h, ib.h);
  let sum = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const va = x < ia.w && y < ia.h ? a[(ia.y + y) * W + ia.x + x]! : 0;
    const vb = x < ib.w && y < ib.h ? b[(ib.y + y) * W + ib.x + x]! : 0;
    sum += Math.abs(va - vb);
  }
  return sum / (w * h);
}

async function pixels(): Promise<object[]> {
  const out: object[] = [];
  const frames: Record<string, Uint8Array> = {};
  for (const mode of ["ladder", "scale"] as const) {
    const dir = stage(`pixels-${mode}`, pixelsApp(mode));
    await run(["build", dir]);
    const png = join(OUT, `pixels-${mode}.png`);
    await run(["frame", dir, "--at", "0", "--out", png]);
    frames[mode] = await rgbaOf(png);
  }
  const L = frames.ladder!;
  const S = frames.scale!;
  RUNGS.forEach((px, r) => {
    const top = 20 + r * 250;
    const errs: number[] = [];
    const sizeDelta: number[] = [];
    GLYPHS.forEach((_, i) => {
      const left = 40 + i * 140;
      const a = inkBox(L, left - 10, top, left + 130, top + 125);
      const b = inkBox(S, left - 10, top, left + 130, top + 125);
      if (!a || !b) return;
      errs.push(meanAbs(L, a, S, b));
      sizeDelta.push(Math.abs(a.w - b.w) + Math.abs(a.h - b.h));
    });
    const ra = inkBox(L, 0, top + 125, W, top + 245)!;
    const rb = inkBox(S, 0, top + 125, W, top + 245)!;
    const row = {
      rung: px,
      scale: +(px / 88).toFixed(4),
      glyphMeanAbsCoverage: +(errs.reduce((s, e) => s + e, 0) / errs.length).toFixed(2),
      glyphMaxMeanAbs: +Math.max(...errs).toFixed(2),
      glyphInkSizeDeltaPx: Math.max(...sizeDelta),
      runInkWidthLadder: ra.w,
      runInkWidthScale: rb.w,
    };
    console.log(JSON.stringify(row));
    out.push(row);
  });
  return out;
}

// ---- render cost ----------------------------------------------------------

function costApp(mode: "ladder" | "scale"): string {
  const nodes: string[] = [];
  for (let i = 0; i < 40; i++) {
    const px = RUNGS[i % RUNGS.length]!;
    const top = 10 + (i % 20) * 52;
    const left = i < 20 ? 20 : 980;
    nodes.push(
      mode === "ladder"
        ? `<Text class="absolute left-[${left}px] top-[${top}px] text-[${px}px] font-bold text-white">{${q(RUN)}}</Text>`
        : `<Text class="absolute left-[${left}px] top-[${top}px] text-[88px] font-bold text-white origin-top-left scale-${((px / 88) * 100).toFixed(4)}">{${q(RUN)}}</Text>`,
    );
  }
  return `import { Text, View } from "@pocketjs/framework/components";\n\nexport default function App() {\n  return (\n    <View class="w-full h-full bg-black relative">\n      ${nodes.join("\n      ")}\n    </View>\n  );\n}\n`;
}

async function renderCost(): Promise<object[]> {
  // `trace` reports no timing, so a frame's cost is the CPU of 61 frames less
  // the CPU of 1, over 60: boot, build read and hashing setup cancel.
  const out: object[] = [];
  for (const mode of ["ladder", "scale"] as const) {
    const dir = stage(`cost-${mode}`, costApp(mode));
    await run(["build", dir]);
    const perFrame: number[] = [];
    for (let i = 0; i < 5; i++) {
      const one = await run(["trace", dir, "--no-reuse", "--hash", "fast", "--frames", "1", "--json"]);
      const many = await run(["trace", dir, "--no-reuse", "--hash", "fast", "--frames", "61", "--json"]);
      perFrame.push((many.cpuMs - one.cpuMs) / 60);
    }
    const sorted = perFrame.sort((a, b) => a - b);
    const row = { mode, runs: 40, cpuMsPerFrameMedian: +sorted[2]!.toFixed(2), samples: sorted.map((s) => +s.toFixed(2)) };
    console.log(JSON.stringify(row));
    out.push(row);
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
const result = {
  bun: Bun.version,
  ...(only === undefined || only === "build" ? { build: await buildCost() } : {}),
  ...(only === undefined || only === "pixels" ? { pixels: await pixels() } : {}),
  ...(only === undefined || only === "render" ? { render: await renderCost() } : {}),
};
writeFileSync(join(OUT, `ladder-vs-scale${only ? `-${only}` : ""}.json`), JSON.stringify(result, null, 2) + "\n");
