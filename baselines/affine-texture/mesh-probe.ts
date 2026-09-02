/**
 * How much foreshortened image does a composition actually paint?
 *
 * Walks the DrawList each frame and groups consecutive TEX_TRI ops by texture
 * handle. `draw.rs` emits nx*ny*2 of them for a subdivided mesh and 2 for an
 * unsubdivided quad, so a run length is the subdivision that frame asked for.
 * Runs through the CLI's own resolve + render path, so footage and pak binding
 * match a real trace.
 *
 * Needs two exports the engine does not ship. Add them to
 * `vendor/pocketjs/engine/wasm/src/lib.rs`, rebuild the wasm, and revert after:
 *
 *   #[no_mangle] pub extern "C" fn ui_dl_ptr() -> *const u32 { ui().draw().words.as_ptr() }
 *   #[no_mangle] pub extern "C" fn ui_dl_len() -> u32 { ui().draw().words.len() as u32 }
 *
 * Copy to the repository root and run: `bun mesh-probe.ts compositions/<name>`.
 */
import { existsSync } from "node:fs";
import { render as renderComposition } from "./src/render/render.ts";
import { openFootage, scratchTree, type FootageHandle } from "./src/cli/footage.ts";
import { resolveComposition } from "./src/cli/resolve.ts";

const OPLEN: Record<number, number> = { 1: 4, 2: 6, 4: 9, 5: 3, 6: 1, 7: 7, 8: 12 };
const OPNAME: Record<number, string> = {
  1: "RECT", 2: "GRAD_RECT", 3: "GLYPH_RUN", 4: "TEX_QUAD",
  5: "SCISSOR", 6: "SCISSOR_POP", 7: "TRI", 8: "TEX_TRI",
  9: "TEXT_RUN", 10: "POLY",
};

/**
 * The three variable-length ops. Read the opcodes off
 * `engine/core/src/spec.rs`, not from memory: upstream took 9 for TEXT_RUN
 * after this file was written, and POLY moved to 10. At the wrong number a
 * POLY is walked as a TEXT_RUN header and the walk desynchronises silently
 * rather than failing.
 *
 * GLYPH_RUN is 3 + 2n with n in bits 16-31 of word1; TEXT_RUN is
 * 8 + ceil(byteLen/4) with byteLen in word7; POLY is 3 + N with N in word1.
 */
function stride(words: Uint32Array, i: number): number {
  const op = words[i];
  if (op === 3) return 3 + 2 * (words[i + 1] >>> 16);
  if (op === 9) return 8 + Math.ceil(words[i + 7] / 4);
  if (op === 10) return 3 + words[i + 1];
  return OPLEN[op] ?? 0;
}

const opHist = new Map<number, number>();

function texTriRuns(words: Uint32Array): number[] {
  const runs: number[] = [];
  let i = 0, runLen = 0, runHandle = -1;
  const flush = () => { if (runLen) runs.push(runLen); runLen = 0; runHandle = -1; };
  while (i < words.length) {
    const op = words[i];
    opHist.set(op, (opHist.get(op) ?? 0) + 1);
    if (op === 8) {
      const h = words[i + 1];
      if (h !== runHandle) { flush(); runHandle = h; }
      runLen++; i += 12; continue;
    }
    flush();
    const s = stride(words, i);
    if (!s) break;
    i += s;
  }
  flush();
  return runs;
}

const dir = process.argv[2];
const r = await resolveComposition({ dir, flags: {} as never, requireBundle: true });
if (!r.ok) { console.error("resolve failed", r); process.exit(1); }
const c = r.value;

const bound: { footage: FootageHandle | null } = { footage: null };
const declared = c.sidecar.footage.length > 0;
const tree = declared ? await scratchTree(c) : null;
let src: { world: { exports: Record<string, unknown> } } | null = null;
const cellHist = new Map<number, number>();
let framesWithMesh = 0, framesTotal = 0, maxCells = 0;

await renderComposition({
  compositionId: c.compositionId,
  bundlePath: c.bundlePath,
  pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
  width: c.width, height: c.height, hz: c.fps,
  durationFrames: c.durationFrames, renderScale: c.supersample,
  hashAlgorithm: "fast",
  setup: async (source) => {
    src = source as never;
    if (declared) { await source.seekFrame(0); bound.footage = await openFootage(c, source.world, tree!); }
  },
  onFrameBoundary: (frame) => bound.footage?.present(frame),
  onProgress: () => {
    const ex = src!.world.exports as unknown as {
      memory: WebAssembly.Memory; ui_dl_ptr: () => number; ui_dl_len: () => number;
    };
    const words = new Uint32Array(ex.memory.buffer, ex.ui_dl_ptr(), ex.ui_dl_len());
    framesTotal++;
    let frameMax = 0;
    for (const run of texTriRuns(words)) {
      const cells = run / 2;
      cellHist.set(cells, (cellHist.get(cells) ?? 0) + 1);
      if (cells > frameMax) frameMax = cells;
    }
    if (frameMax > 1) framesWithMesh++;
    if (frameMax > maxCells) maxCells = frameMax;
  },
});

console.log(dir);
console.log(`  frames                             ${framesTotal}`);
console.log(`  frames painting a subdivided mesh  ${framesWithMesh} (${((100 * framesWithMesh) / framesTotal).toFixed(1)}%)`);
console.log(`  max cells in any single mesh       ${maxCells}`);
console.log(`  ops  ${[...opHist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${OPNAME[k] ?? k}:${v}`).join("  ")}`);
