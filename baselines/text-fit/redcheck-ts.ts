#!/usr/bin/env bun
/**
 * The host half of patch 0059's guards: introduce each defect, run the test
 * that should catch it, revert. `redcheck.py` beside this holds the core
 * half.
 *
 *   bun baselines/text-fit/redcheck-ts.ts [mutation name ...]
 *
 * Prints RED (the guard caught it), GREEN (it did not) or SKIP (the anchor is
 * not found exactly once). The core mutation here rebuilds the wasm, so it
 * takes a minute and leaves the tree's wasm rebuilt from restored sources.
 * Nothing else may build the tree while this runs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

interface Mutation {
  readonly name: string;
  readonly file: string;
  readonly old: string;
  readonly new: string;
  /** Test file and the test name filter that should go red. */
  readonly test: readonly [string, string];
  /** The core is edited: rebuild the wasm before and after. */
  readonly wasm?: boolean;
}

const MUTATIONS: readonly Mutation[] = [
  {
    name: "layout reads no fit record",
    file: "src/cli/commands/layout.ts",
    old: "const fit = text ? readTextFit(world.exports, node.i, options.slotPx) : null;",
    new: "const fit = null as ReturnType<typeof readTextFit>;",
    test: ["tests/text-fit.test.ts", "a run that holds its box takes the largest rung"],
  },
  {
    name: "no text_truncated code",
    file: "src/render/findings.ts",
    old: "    if (n.fit && truncated(n.fit)) {",
    new: "    if (n.fit && truncated(n.fit) && false) {",
    test: ["tests/text-fit.test.ts", "a ladder that bottoms out and a clamp that drops are text_truncated"],
  },
  {
    name: "no text_truncated code (catalogue)",
    file: "src/render/findings.ts",
    old: "    if (n.fit && truncated(n.fit)) {",
    new: "    if (n.fit && truncated(n.fit) && false) {",
    test: ["tests/catalog.test.ts", "G8"],
  },
  {
    name: "a bottomed-out ladder is not truncation",
    file: "src/render/text-fit.ts",
    old: "  return fit.dropped > 0 || (fit.declaredLadder && !fit.fitted);",
    new: "  return fit.dropped > 0;",
    test: ["tests/catalog.test.ts", "G8"],
  },
  {
    name: "the sweep records no truncation",
    file: "src/cli/commands/assert.ts",
    old: "          entry.truncated.push(frame);",
    new: "          void frame;",
    test: ["tests/text-fit.test.ts", "untruncated FAILS"],
  },
  {
    name: "untruncated is not parsed",
    file: "src/manifest/sidecar.ts",
    old: "      if (raw !== true) {\n        diagnostics.push(\n          diag(\n            \"sidecar.assertions.untruncated\",",
    new: "      if (false) {\n        diagnostics.push(\n          diag(\n            \"sidecar.assertions.untruncated\",",
    test: ["tests/catalog.test.ts", "G3"],
  },
  {
    name: "readCmap reads format 4 alone",
    file: "src/text/coverage.ts",
    old: "    } else if (format === 12) {",
    new: "    } else if (format === -12) {",
    test: ["tests/text-fit.test.ts", "readCmap reads what opentype.js reads"],
  },
  {
    name: "captions checked as written, not as drawn",
    file: "src/text/coverage.ts",
    old: "        text: displayText(w.text, spec.style.case, spec.transcript.language),",
    new: "        text: w.text,",
    test: ["tests/text-fit.test.ts", "captions are checked in the case the style draws"],
  },
  {
    name: "a directory of jobs is not checked up front",
    file: "src/cli/commands/render.ts",
    old: "    const coverage = jobCoverage(parsed.value, root);",
    new: "    const coverage = { missing: [] as ReturnType<typeof jobCoverage>[\"missing\"] };",
    test: ["tests/text-fit.test.ts", "a directory of jobs is refused before any renders"],
  },
  {
    name: "a job is staged before its characters are read",
    file: "src/cli/commands/render.ts",
    old: "    if (refusal !== null) return refusal;",
    new: "    if (refusal !== null && false) return refusal;",
    test: ["tests/mcp.test.ts", "render refuses a job whose faces lack a character"],
  },
  {
    name: "paint draws the style's slot",
    file: "vendor/pocketjs/engine/core/src/draw.rs",
    old: "            slot = fit.slot;\n",
    new: "",
    test: ["tests/text-fit.test.ts", "a fitted run draws the pixels a run declared at its rung draws"],
    wasm: true,
  },
];

async function sh(cmd: string[], cwd = ROOT, env?: Record<string, string>): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", ...(env ? { env } : {}) });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out + err };
}

/** The wasm from the vendored core, the way `scripts/vendor.ts` builds it. */
async function buildWasm(): Promise<void> {
  const cargo = (await sh(["rustup", "which", "cargo"])).out.trim();
  const home = process.env.CARGO_HOME ?? join(process.env.HOME!, ".cargo");
  const config = `target.wasm32-unknown-unknown.rustflags=${JSON.stringify([`--remap-path-prefix=${home}=cargo`])}`;
  const wasmDir = join(ROOT, "vendor/pocketjs/engine/wasm");
  // rustup's toolchain first on PATH, so its rustc is the one cargo runs
  // (`scripts/vendor.ts` says why).
  const env = { ...process.env, PATH: `${cargo.slice(0, cargo.lastIndexOf("/"))}:${process.env.PATH ?? ""}` } as Record<string, string>;
  const r = await sh([cargo, "build", "--offline", "--release", "--target", "wasm32-unknown-unknown", "--config", config], wasmDir, env);
  if (r.code !== 0) throw new Error(`wasm build failed\n${r.out}`);
  const built = join(wasmDir, "target/wasm32-unknown-unknown/release/pocketjs_wasm.wasm");
  await Bun.write(join(ROOT, "vendor/pocketjs/hosts/web/pocketjs.wasm"), Bun.file(built));
}

async function verdict(test: readonly [string, string]): Promise<string> {
  const r = await sh(["bun", "test", `./${test[0]}`, "-t", test[1]]);
  if (/ 0 pass\n/.test(r.out) && / 0 fail\n/.test(r.out)) return "NO-TEST";
  return r.code === 0 ? "GREEN" : "RED";
}

const only = new Set(process.argv.slice(2));
for (const m of MUTATIONS) {
  if (only.size > 0 && !only.has(m.name)) continue;
  const path = join(ROOT, m.file);
  const src = readFileSync(path, "utf8");
  if (src.split(m.old).length !== 2) {
    console.log(`SKIP  ${m.name}: anchor found ${src.split(m.old).length - 1} times`);
    continue;
  }
  writeFileSync(path, src.replace(m.old, m.new));
  let v: string;
  try {
    if (m.wasm) await buildWasm();
    v = await verdict(m.test);
  } finally {
    writeFileSync(path, src);
    if (m.wasm) await buildWasm();
  }
  console.log(`${v.padEnd(5)} ${m.name}  [${m.test[0]} -t ${m.test[1]}]`);
}
