#!/usr/bin/env bun
/**
 * PROTOTYPE probe for `src/text/shape.ts` — see docs/text-shaping.design.md.
 *
 * Shapes a fixed corpus with HarfBuzz-in-wasm and prints, per string, the
 * glyph count, the run's canonical digest, and (with --records) every glyph.
 * The corpus digest at the end is what two runs, two processes or two
 * machines are compared by.
 *
 *   bun scripts/shape-probe.ts --wasm <hb.wasm> --arabic <face> [--devanagari <face>] [--json]
 *
 * The shaper and the faces are passed by path because none of them is in the
 * repository yet: where they would be declared is part of the design.
 */

import { createHash } from "node:crypto";

import { canonicalBytes, openShaper, runDigest, type ShapeRequest } from "../src/text/shape.ts";

/** What each string exercises is the reason it is in the corpus. */
export const CORPUS: readonly (ShapeRequest & { readonly face: "arabic" | "devanagari"; readonly why: string })[] = [
  { face: "arabic", text: "مرحبا بالعالم", direction: "rtl", script: "Arab", language: "ar", why: "joining forms: init/medi/fina/isol" },
  { face: "arabic", text: "لا إله", direction: "rtl", script: "Arab", language: "ar", why: "lam-alef ligature (rlig)" },
  { face: "arabic", text: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ", direction: "rtl", script: "Arab", language: "ar", why: "harakat: mark and mark-to-mark positioning" },
  { face: "arabic", text: "السعر ١٢٣ ريال", direction: "rtl", script: "Arab", language: "ar", why: "Arabic-Indic digits inside an RTL run" },
  { face: "arabic", text: "۱۲۳ تست", direction: "rtl", script: "Arab", language: "fa", why: "Persian: language changes locl" },
  { face: "devanagari", text: "नमस्ते दुनिया", direction: "ltr", script: "Deva", language: "hi", why: "conjunct स्ते" },
  { face: "devanagari", text: "धर्म कि क्षत्रिय", direction: "ltr", script: "Deva", language: "hi", why: "reph, i-matra reordering, क्ष" },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const wasmPath = arg("wasm");
  const faces = { arabic: arg("arabic"), devanagari: arg("devanagari") };
  if (!wasmPath || !faces.arabic) {
    console.error("usage: bun scripts/shape-probe.ts --wasm <hb.wasm> --arabic <face> [--devanagari <face>] [--json] [--records]");
    process.exit(2);
  }
  const wasm = new Uint8Array(await Bun.file(wasmPath).arrayBuffer());
  const shaper = await openShaper(wasm);
  const loaded: Record<string, ReturnType<typeof shaper.face> | undefined> = {};
  const faceSha: Record<string, string> = {};
  for (const [k, p] of Object.entries(faces)) {
    if (!p) continue;
    const bytes = new Uint8Array(await Bun.file(p).arrayBuffer());
    faceSha[k] = createHash("sha256").update(bytes).digest("hex");
    loaded[k] = shaper.face(bytes);
  }
  const corpus = createHash("sha256");
  const rows = [];
  for (const req of CORPUS) {
    const face = loaded[req.face];
    if (!face) continue;
    const run = face.shape(req);
    corpus.update(canonicalBytes(run));
    rows.push({
      text: req.text,
      why: req.why,
      glyphs: run.glyphs.length,
      digest: runDigest(run),
      ...(process.argv.includes("--records") ? { records: run.glyphs } : {}),
    });
  }
  const out = {
    shaper: { version: shaper.version, sha256: shaper.sha256 },
    faces: faceSha,
    platform: `${process.platform}-${process.arch}`,
    bun: Bun.version,
    corpus: corpus.digest("hex"),
    rows,
  };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(`shaper HarfBuzz ${out.shaper.version} (${out.shaper.sha256.slice(0, 12)}…) on ${out.platform}, Bun ${out.bun}`);
  for (const r of rows) console.log(`  ${r.digest.slice(0, 16)}  ${String(r.glyphs).padStart(3)} glyphs  ${r.why}`);
  console.log(`corpus ${out.corpus}`);
}

if (import.meta.main) await main();
