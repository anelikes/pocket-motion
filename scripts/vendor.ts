#!/usr/bin/env bun
/**
 * Vendor upstream PocketJS at a pinned commit, then apply our patches.
 *
 * Vendoring rather than forking is upstream's own convention for standalone
 * products (`docs/STRUCTURE.md`): "Standalone products keep the `pocket-<name>`
 * separate-repo convention and do not move in."
 *
 * Patches exist where upstream's shape and this project's needs genuinely
 * differ: Phase 1 needs the compiler to assign font slots from what a
 * composition actually uses instead of a fixed seven-entry table, and Phase 0's
 * mount-only oracle needs to read the framework's scheduled-work registries,
 * which have no exported accessor. Both are upstream-shaped and may go upstream
 * later; until they do they live in `patches/`, reviewable as diffs rather than
 * buried in a fork. Files there are discovered and applied in sorted order.
 *
 *   bun scripts/vendor.ts            # clone (or reuse) + apply patches + build wasm
 *   bun scripts/vendor.ts --refresh  # discard the tree and re-clone
 *   bun scripts/vendor.ts --status   # what is applied, and is the tree dirty
 *   bun scripts/vendor.ts --no-wasm  # skip the rasterizer build
 *
 * `hosts/web/pocketjs.wasm` is upstream-gitignored and built from
 * `engine/wasm/`, so a patch that touches Rust does not reach the running
 * rasterizer until it is recompiled. Patch 0004 is the first one that does, and
 * the ops it adds are feature-detected — a stale wasm would degrade silently
 * rather than fail. Building here is what keeps source and binary in step.
 */

import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { UPSTREAM } from "../src/vendor/upstream.ts";
import { seedMirror } from "../src/vendor/mirror.ts";
import { patchFiles, vendorStatus } from "../src/vendor/status.ts";

/**
 * Pinned upstream. The constant lives in `src/vendor/upstream.ts` because
 * `src/render/build-record.ts` writes the commit into every artifact's
 * `build.json`, and a `src/` module importing this script would run it.
 */
export { UPSTREAM } from "../src/vendor/upstream.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const PATCHES = join(ROOT, "patches");

async function sh(cmd: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const p = Bun.spawn(cmd, { cwd, env: env ?? Bun.env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed (${code})\n${err.trim()}`);
  return out.trim();
}

/**
 * The patch list and the tree's state come from `src/vendor/status.ts`, not
 * from here. `doctor` reports the same thing, and two derivations of "is the
 * vendored tree ready" would disagree the first time either moved.
 */

/**
 * Absolute path to the cargo of the active rustup toolchain.
 *
 * Not `cargo` off PATH, and not upstream's `tools/wasm.ts`, which prepends
 * `~/.cargo/bin`. On a Homebrew-rustup machine that directory is empty while
 * `/opt/homebrew/bin/cargo` is a *different* rustc than the one rustup manages,
 * and only the rustup toolchain here carries the wasm32 std — so the plausible
 * invocation fails with "can't find crate for `core`". Prepending the resolved
 * directory to PATH matters too: cargo spawns `rustc` by name, and mixing the
 * two toolchains is how a build silently changes compilers.
 */
async function cargoBin(): Promise<{ cargo: string; dir: string } | undefined> {
  try {
    const cargo = await sh(["rustup", "which", "cargo"], ROOT);
    return { cargo, dir: cargo.slice(0, cargo.lastIndexOf("/")) };
  } catch {
    return undefined;
  }
}

async function buildWasm(): Promise<void> {
  const found = await cargoBin();
  if (!found) {
    console.log("vendor: rustup not found — skipping wasm build (hosts/web/pocketjs.wasm may be stale)");
    return;
  }
  const wasmDir = join(VENDOR, "engine", "wasm");
  const out = join(VENDOR, "hosts", "web", "pocketjs.wasm");
  const built = join(wasmDir, "target/wasm32-unknown-unknown/release/pocketjs_wasm.wasm");
  console.log("vendor: building engine/wasm (release, wasm32-unknown-unknown)");
  await sh([found.cargo, "build", "--release", "--target", "wasm32-unknown-unknown"], wasmDir, {
    ...Bun.env,
    PATH: `${found.dir}:${Bun.env.PATH ?? ""}`,
  });
  const bytes = await Bun.file(built).arrayBuffer();
  await Bun.write(out, bytes);
  console.log(`vendor: hosts/web/pocketjs.wasm (${bytes.byteLength} bytes)`);
}

async function status(): Promise<void> {
  const s = await vendorStatus();
  if (!s.present) {
    console.log("vendor: absent — run `bun scripts/vendor.ts`");
    return;
  }
  console.log(`vendor: ${s.path}`);
  console.log(`  HEAD    ${s.head ?? "(unreadable)"} (pinned ${s.pinned})`);
  console.log(`  patches ${s.patches.join(", ") || "(none)"}`);
  console.log(
    `  tree    ${s.dirtyLines.length > 0 ? `${s.dirtyLines.length} file(s) modified` : "clean"}`,
  );
  for (const line of s.dirtyLines) console.log(`    ${line}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--status")) return status();

  if (args.includes("--refresh") && existsSync(VENDOR)) {
    console.log("vendor: discarding existing tree");
    await rm(VENDOR, { recursive: true, force: true });
  }

  if (!existsSync(VENDOR)) {
    await mkdir(join(ROOT, "vendor"), { recursive: true });
    // A local checkout, when present, is a far faster clone source than the
    // network and resolves to the same objects. It is named by `POCKETJS_ROOT`
    // and nowhere else: a path baked in here is one machine's layout, and on
    // every other machine it is a directory that does not exist, silently
    // falling back to the network — so the fast path worked for exactly one
    // person and nothing said why.
    const local = process.env.POCKETJS_ROOT;
    const source =
      local && existsSync(join(local, ".git")) ? local : UPSTREAM.repo;
    console.log(`vendor: cloning ${source}`);
    await sh(["git", "clone", "--quiet", source, VENDOR], ROOT);
  }

  await sh(["git", "checkout", "--quiet", "--force", UPSTREAM.commit], VENDOR);
  await sh(["git", "clean", "-qfd"], VENDOR);

  // The compiler this project drives is upstream's own, and it imports
  // upstream's dependencies (`opentype.js` in framework/compiler/bake-font.ts).
  // `git clean -fd` leaves ignored files alone, so this only bites after
  // --refresh — which is exactly when it is easiest to misread as a patch fault.
  if (!existsSync(join(VENDOR, "node_modules"))) {
    console.log("vendor: installing upstream dependencies");
    await sh(["bun", "install", "--frozen-lockfile"], VENDOR);
  }

  const patches = await patchFiles();
  for (const name of patches) {
    console.log(`vendor: applying ${name}`);
    await sh(["git", "apply", join(PATCHES, name)], VENDOR);
  }
  // A tree with no `framework/src/styles.generated.ts` is a tree whose FIRST
  // build has to resolve a path its own pass 1 creates, and upstream's
  // `tools/site-build.ts` seeds this same stub rather than depend on Bun
  // noticing. `src/vendor/mirror.ts` carries the mechanism and the CI run it
  // came from. `git clean -qfd` above leaves ignored files alone, so a re-run
  // over an existing tree keeps whatever table the last build wrote.
  if (seedMirror(VENDOR)) {
    console.log("vendor: seeded framework/src/styles.generated.ts (placeholder)");
  }

  if (!args.includes("--no-wasm")) await buildWasm();

  console.log(
    `vendor: ready at ${UPSTREAM.commit}` +
      (patches.length ? ` + ${patches.length} patch(es)` : " (unpatched)"),
  );
}

await main();
