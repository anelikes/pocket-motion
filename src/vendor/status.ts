/**
 * Is the vendored tree there, at the pin, with this repository's patches in
 * front of it — as data rather than as printed lines.
 *
 * `scripts/vendor.ts --status` renders this, and `doctor` reads the same
 * fields. Two readers of one answer: a `doctor` that re-derived "is the
 * vendor ready" would be a second opinion about the tree that builds every
 * pak, and the two would disagree the first time either moved.
 *
 * It reports and never repairs. The script is what clones, patches and
 * builds; this only looks.
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { UPSTREAM } from "./upstream.ts";

/** The repository root — this module sits at `src/vendor/`. */
const ROOT = resolve(import.meta.dir, "../..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const PATCHES = join(ROOT, "patches");

export interface VendorStatus {
  /** Absolute path of the vendored tree, whether or not it exists. */
  readonly path: string;
  readonly present: boolean;
  /** Short HEAD of the vendored tree, or null when it could not be read. */
  readonly head: string | null;
  /** `UPSTREAM.commit` — what `scripts/vendor.ts` would clone to. */
  readonly pinned: string;
  /** `patches/*.patch` in sorted order — what the script applies. */
  readonly patches: readonly string[];
  /**
   * `git status --porcelain` lines inside the vendored tree.
   *
   * A patched tree is DIRTY by construction: the patches are applied with
   * `git apply` and never committed, so this is how many files they touched,
   * not a fault. A tree with none is a tree the patches did not reach.
   */
  readonly dirtyLines: readonly string[];
  /** The wasm the web host loads. A patch touching Rust does not reach it until rebuilt. */
  readonly wasmPath: string;
  readonly wasmPresent: boolean;
}

/** Every `patches/*.patch`, sorted — the order `scripts/vendor.ts` applies them in. */
export async function patchFiles(): Promise<string[]> {
  if (!existsSync(PATCHES)) return [];
  return (await readdir(PATCHES)).filter((f) => f.endsWith(".patch")).sort();
}

async function git(args: readonly string[], cwd: string): Promise<string | null> {
  try {
    const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    return code === 0 ? out.trim() : null;
  } catch {
    return null;
  }
}

export async function vendorStatus(): Promise<VendorStatus> {
  const wasmPath = join(VENDOR, "hosts", "web", "pocketjs.wasm");
  const patches = await patchFiles();
  if (!existsSync(VENDOR)) {
    return {
      path: VENDOR,
      present: false,
      head: null,
      pinned: UPSTREAM.commit,
      patches,
      dirtyLines: [],
      wasmPath,
      wasmPresent: false,
    };
  }
  const head = await git(["rev-parse", "--short", "HEAD"], VENDOR);
  const dirty = await git(["status", "--porcelain"], VENDOR);
  return {
    path: VENDOR,
    present: true,
    head,
    pinned: UPSTREAM.commit,
    patches,
    dirtyLines: dirty ? dirty.split("\n").filter(Boolean) : [],
    wasmPath,
    wasmPresent: existsSync(wasmPath),
  };
}

/**
 * What is wrong with the tree, as sentences, or an empty list.
 *
 * `head !== pinned` is a real mismatch and not a formatting difference:
 * `UPSTREAM.commit` is stored short and `rev-parse --short` returns a short
 * hash, so the two are comparable by prefix in either direction.
 *
 * A CLEAN tree is a fault here rather than a virtue. Twelve patches are
 * applied with `git apply` and never committed, so a tree reporting no
 * modified files is a tree the patches did not reach — which is the state a
 * `--refresh` leaves behind if it is interrupted, and it builds a pak this
 * repository's commands cannot read.
 */
export function vendorProblems(status: VendorStatus): string[] {
  if (!status.present) return [`no vendored tree at ${status.path}`];
  const out: string[] = [];
  if (status.head === null) {
    out.push(`${status.path} is not a git checkout, so its commit cannot be read`);
  } else if (!status.head.startsWith(status.pinned) && !status.pinned.startsWith(status.head)) {
    out.push(`vendored HEAD is ${status.head}; the pin is ${status.pinned}`);
  }
  if (status.patches.length > 0 && status.dirtyLines.length === 0) {
    out.push(
      `${status.patches.length} patch(es) in patches/ but the vendored tree has no ` +
        "modified file, so none of them is applied",
    );
  }
  if (!status.wasmPresent) {
    out.push(`${status.wasmPath} is missing, so nothing can rasterise`);
  }
  return out;
}
