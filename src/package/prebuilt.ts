/**
 * `vendor/prebuilt.json` — what an installed package carries in place of a
 * vendored checkout, and how `doctor` reads it.
 *
 * In this repository `vendor/pocketjs` is a git clone at `UPSTREAM.commit`
 * with `patches/` applied and the wasm built on the machine, and
 * `src/vendor/status.ts` asks git whether it is still that. A package has no
 * clone, no git and no Rust: `scripts/pack.ts` copies the part of the tree a
 * build and a render read — the compiler, the framework source, the wasm, the
 * PNG encoder, upstream's default faces and images, and the npm packages the
 * compiler imports, as `bun install --frozen-lockfile` laid them out — and
 * writes this manifest beside it. So the question "is the vendored tree the
 * one the pins name" has a second form, answered from bytes instead of git:
 *
 * - `upstream` is the commit the tree was cloned at, and must be this
 *   package's `UPSTREAM.commit`;
 * - `patches` is every `patches/*.patch` by sha256 when the tree was staged,
 *   and must equal the files this package ships — `assertBuildRecord` holds
 *   every build to the same list, so a drift here would be refused later
 *   anyway, after a build had been paid for;
 * - `files` is every staged file under `vendor/` by sha256, and each must be
 *   on disk with those bytes. The wasm is one of them: it is not in input
 *   identity, and this is the record of which bytes rasterise.
 *
 * ONE FILE IS LEFT OUT ON PURPOSE: `framework/src/styles.generated.ts`. Every
 * build rewrites it (`src/vendor/mirror.ts`), so its bytes after the first
 * build are a build's, not the package's. It ships as the placeholder seed.
 *
 * What the manifest does NOT record is the rustc that compiled the wasm.
 * `scripts/vendor.ts` builds it with whatever toolchain rustup runs and keeps
 * no note of it, so a version written here at pack time would be a claim
 * about a compile this script never saw.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { patchDigests, type PatchDigest } from "../render/build-record.ts";
import { UPSTREAM } from "../vendor/upstream.ts";

/** This package's root: the module sits at `src/package/`. */
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Package-relative path of the manifest. */
export const PREBUILT_FILE = "vendor/prebuilt.json";

/** Package-relative path of the one staged file whose bytes a build replaces. */
export const PREBUILT_MUTABLE = "vendor/pocketjs/framework/src/styles.generated.ts";

export interface PrebuiltManifest {
  readonly prebuilt: 1;
  /** `UPSTREAM.commit` the vendored tree was cloned at. */
  readonly upstream: string;
  /** `patches/*.patch` by sha256, as applied to the staged tree. */
  readonly patches: readonly PatchDigest[];
  /** `Bun.version` of the process that staged the tree. */
  readonly stagedBy: string;
  /**
   * Platform packages the compiler imports and the package declares as
   * `optionalDependencies` instead of shipping: name to exact version.
   */
  readonly platformPackages: Readonly<Record<string, string>>;
  /** Every staged file under `vendor/` but `PREBUILT_MUTABLE`, package-relative, by sha256. */
  readonly files: Readonly<Record<string, string>>;
}

export function prebuiltPath(root: string = ROOT): string {
  return join(root, PREBUILT_FILE);
}

/** True when `root` is an installed package rather than a checkout. */
export function isPrebuilt(root: string = ROOT): boolean {
  return existsSync(prebuiltPath(root));
}

export async function readPrebuilt(root: string = ROOT): Promise<PrebuiltManifest | null> {
  const path = prebuiltPath(root);
  if (!existsSync(path)) return null;
  try {
    const raw = (await Bun.file(path).json()) as PrebuiltManifest;
    return raw?.prebuilt === 1 ? raw : null;
  } catch {
    return null;
  }
}

export async function fileSha256(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer();
  return new Bun.CryptoHasher("sha256").update(new Uint8Array(bytes)).digest("hex");
}

/**
 * What is wrong with an installed tree, as sentences, or an empty list.
 *
 * Every file is hashed, not sampled: a package is ~45 MB and a few thousand
 * files, which is well under a second, and a partial check would say nothing
 * about the files it skipped. Missing and changed files are counted and the
 * first of each is named, which is what a person needs to go and look.
 */
export async function prebuiltProblems(
  manifest: PrebuiltManifest,
  root: string = ROOT,
  patches: readonly PatchDigest[] | null = null,
): Promise<string[]> {
  const out: string[] = [];
  if (manifest.upstream !== UPSTREAM.commit) {
    out.push(
      `the prebuilt tree was cloned at upstream ${manifest.upstream}; this package pins ${UPSTREAM.commit}`,
    );
  }
  const shipped = patches ?? (await patchDigests());
  const recorded = new Map(manifest.patches.map((p) => [p.file, p.sha256]));
  const onDisk = new Map(shipped.map((p) => [p.file, p.sha256]));
  for (const [file, sha] of recorded) {
    if (onDisk.get(file) !== sha) {
      out.push(
        onDisk.has(file)
          ? `patches/${file} is not the patch the prebuilt tree was staged with`
          : `the prebuilt tree was staged with patches/${file}, which this package does not carry`,
      );
      break;
    }
  }
  for (const file of onDisk.keys()) {
    if (!recorded.has(file)) {
      out.push(`patches/${file} was not applied to the prebuilt tree`);
      break;
    }
  }

  const missing: string[] = [];
  const changed: string[] = [];
  for (const [rel, sha] of Object.entries(manifest.files)) {
    const path = join(root, rel);
    if (!existsSync(path)) missing.push(rel);
    else if ((await fileSha256(path)) !== sha) changed.push(rel);
  }
  if (missing.length > 0) {
    out.push(`${missing.length} file(s) the manifest lists are not on disk, first ${missing[0]}`);
  }
  if (changed.length > 0) {
    out.push(`${changed.length} file(s) differ from the manifest, first ${changed[0]}`);
  }
  return out;
}

/**
 * Whether the vendored compiler's module graph loads on this platform, as the
 * error a build would hit first, or null.
 *
 * Loaded in a child process, because loading is the check: the compiler
 * imports `vue-jsx-vapor` at module scope whatever framework a composition
 * uses, and that loads a native binding which the package declares per
 * platform rather than ships. On a platform none of those packages covers —
 * or an install that skipped optional dependencies — every build fails with
 * `Cannot find native binding` from three packages down; this says it first.
 */
export async function compilerLoadError(root: string = ROOT): Promise<string | null> {
  const plugin = join(root, "vendor", "pocketjs", "framework", "compiler", "jsx-plugin.ts");
  try {
    const proc = Bun.spawn(["bun", "-e", `await import(${JSON.stringify(plugin)})`], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (code === 0) return null;
    const lines = stderr.split("\n").map((l) => l.trim());
    return lines.find((l) => /^(error|Error|TypeError|ResolveMessage)\b/.test(l)) ?? lines.find(Boolean) ?? `exited ${code}`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
