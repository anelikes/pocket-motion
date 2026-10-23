#!/usr/bin/env bun
/**
 * Assemble the npm package in a staging directory, then pack it.
 *
 *   bun scripts/pack.ts            # stage dist/pack/pocket-motion, write dist/pack/pocket-motion-<v>.tgz
 *   bun scripts/pack.ts --dry-run  # stage, then print what `npm pack --dry-run` would put in it
 *   bun scripts/pack.ts --json     # either of the above as one JSON object
 *
 * It never publishes. Publishing is `npm publish dist/pack/pocket-motion-<v>.tgz`,
 * run by a person.
 *
 * WHY A STAGING DIRECTORY. `npm pack` at the repository root cannot produce a
 * package that renders, and the reason is measured rather than suspected: npm
 * honours every `.gitignore` under a directory `files` names, and upstream's
 * own `.gitignore` inside `vendor/pocketjs` ignores both `node_modules` and
 * `hosts/web/pocketjs.wasm`. Naming those paths in `files` explicitly does not
 * override it — tried, both are still dropped. So the package is assembled
 * here from an explicit list, with no `.gitignore` in it, and the root
 * `package.json`'s `prepack` refuses to pack the checkout itself.
 *
 * WHY PREBUILT RATHER THAN FETCHED AT INSTALL. `vendor/` is rebuilt here by
 * `scripts/vendor.ts` from upstream plus `patches/`, which needs git, rustup
 * and the wasm32 target. A consumer gets the result instead, in the tarball:
 *
 * - Bun does not run a dependency's lifecycle scripts unless the consuming
 *   project lists it in `trustedDependencies`. A `postinstall` that fetched the
 *   compiler and the wasm would not run on a plain `bun add`, and the package
 *   is Bun-only — its default install would be its broken one.
 * - A fetch verified by sha256 needs bytes hosted somewhere stable, which this
 *   repository does not publish; the digest would pin an upload nobody made.
 * - The bytes that reach a bundle should not float. The compiler's npm
 *   packages are shipped exactly as `bun install --frozen-lockfile` laid them
 *   out against upstream's `bun.lock`. Declared as ordinary dependencies
 *   instead, every transitive version would be the consumer's resolver's
 *   choice, and the JSX transform that writes the guest bundle — whose bytes
 *   are input identity's `bundle` component — would be an undeclared input.
 * - One wasm for every consumer, recorded by sha256 in `vendor/prebuilt.json`,
 *   instead of one per machine from whichever rustc that machine runs.
 *
 * WHAT IS NOT SHIPPED, AND WHAT STANDS IN FOR IT. The compiler imports
 * `vue-jsx-vapor` at module scope for every framework, and that loads a
 * platform-native binding (`@vue-jsx-vapor/compiler-rs-<platform>`) — the
 * only platform-specific package in the closure. Shipping the one this machine
 * installed would make the tarball depend on where it was packed. So platform
 * packages are left out of the copy and declared as `optionalDependencies` of
 * pocket-motion at the exact version the compiler asks for, which is how the
 * consumer's package manager picks the one for its platform; Bun installs
 * those with no lifecycle script. `doctor` loads the compiler to say whether
 * that worked (`src/package/prebuilt.ts`).
 *
 * Also not shipped: `compositions/`, `tests/`, `scripts/`, `baselines/`,
 * every byte under `assets/` — the HarmonyOS Sans faces, the fetched Noto Sans
 * SC pair, the Mixkit audio and the synthetic clips — and of upstream, its
 * engine source, apps, site, docs and git history. Nothing in `src/` reads any
 * of them at run time for a composition outside this repository; a
 * composition's faces and sound are its own project's files.
 */

import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { PREBUILT_FILE, fileSha256, type PrebuiltManifest } from "../src/package/prebuilt.ts";
import { patchDigests } from "../src/render/build-record.ts";
import { UPSTREAM } from "../src/vendor/upstream.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
export const PACK_DIR = join(ROOT, "dist", "pack");
export const STAGE = join(PACK_DIR, "pocket-motion");
/** Package-relative path of the licence inventory of the copied npm packages. */
export const THIRD_PARTY_FILE = "vendor/third-party.json";

/** Top-level files beside `src/`, copied as they are. README and LICENSE npm adds on its own. */
const TOP_FILES = ["README.md", "LICENSE", "NOTICE", "CHANGELOG.md"] as const;

/** This repository's trees, every tracked or not-yet-committed file in them. */
const OWN_TREES = ["src", "patches"] as const;

/**
 * The part of the vendored tree a build and a render read, by path under
 * `vendor/pocketjs`.
 *
 * TREES ship whole, from git's view of the tree (so a file a patch added is
 * in and an upstream-ignored one is out): `framework/src` because a
 * composition may import any of the framework's subpaths, `contracts` because
 * the framework and the compiler both read it, and the default faces and
 * images because the builder and `lint` look there by name.
 *
 * ENTRIES are the vendored modules this repository's `src/` loads or spawns.
 * Each is shipped with every local module its imports reach, and nothing else
 * of `framework/compiler`, `tools/` or `microts/`. The graph is what decides,
 * not a list: at 66caf4e5 `tools/build.ts` and `jsx-plugin.ts` import
 * microts' AOT compiler at module scope and it imports `typescript`, so every
 * build loads `typescript` (23 MB) and it ships; upstream's `app-check.ts`,
 * which nothing a build loads imports, does not.
 *
 *   tools/build.ts                the builder `buildSpawn` runs
 *   framework/compiler/pak.ts     `keyframes` reads the anim table through it
 *   framework/compiler/bake-font.ts  `src/text/measure.ts` keys its cache on it
 *   hosts/web/wasm-ops.js         the op table the harness boots the wasm with
 *   tools/png.ts                  the PNG encoder `frame`, `snapshot` and png-seq use
 *
 * FILES are the rest, which are not modules:
 *
 *   hosts/web/pocketjs.wasm   the rasteriser; upstream-ignored, built by scripts/vendor.ts
 *   package.json              the builder reads its package name for the framework alias
 *   pocket.config.ts          the builder's default config
 *   tsconfig.json             how Bun transpiles the builder and the framework
 *   bun.lock                  the record of the node_modules shipped beside it
 *   LICENSE                   upstream's MIT notice, which travels with its code
 */
const VENDOR_TREES = ["framework/src", "contracts", "assets/fonts", "assets/images"] as const;
const VENDOR_ENTRIES = [
  "tools/build.ts",
  "framework/compiler/pak.ts",
  "framework/compiler/bake-font.ts",
  "hosts/web/wasm-ops.js",
  "tools/png.ts",
] as const;
const VENDOR_FILES = [
  "hosts/web/pocketjs.wasm",
  "hosts/web/wasm-ops.d.ts",
  "package.json",
  "pocket.config.ts",
  "tsconfig.json",
  "bun.lock",
  "LICENSE",
] as const;

/** Never copied: npm drops the first two and acts on them; the rest are machine litter. */
const NEVER = new Set([".gitignore", ".npmignore", ".DS_Store", ".git", "npm-debug.log"]);

async function git(args: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed (${code})\n${err.trim()}`);
  return out;
}

/** Tracked and not-yet-committed files under `paths`, minus ignored and deleted ones. */
async function gitFiles(cwd: string, paths: readonly string[]): Promise<string[]> {
  const listed = await git(
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...paths],
    cwd,
  );
  return [...new Set(listed.split("\n").filter(Boolean))]
    .filter((f) => existsSync(join(cwd, f)) && !NEVER.has(basename(f)))
    .sort();
}

/** Every file under `dir`, relative to it, skipping nested `node_modules`. */
async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await readdir(dir)).sort()) {
    if (NEVER.has(name)) continue;
    const path = join(dir, name);
    const st = await stat(path);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      out.push(...(await walk(path, base)));
    } else if (st.isFile()) {
      out.push(relative(base, path));
    }
  }
  return out;
}

/** The package directory `name` resolves to from `fromDir`, Node's walk up, stopping at the vendored root. */
function findPackage(fromDir: string, name: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dir === VENDOR || dir === dirname(dir)) return null;
    dir = dirname(dir);
  }
}

interface PackageJson {
  readonly name: string;
  readonly version: string;
  readonly license?: unknown;
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

async function readPackage(dir: string): Promise<PackageJson> {
  return (await Bun.file(join(dir, "package.json")).json()) as PackageJson;
}

const BUILTIN = /^(node:|bun:|bun$)/;
const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "module",
  "net", "os", "path", "perf_hooks", "process", "readline", "stream", "tty", "url", "util", "vm",
  "worker_threads", "zlib",
]);

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

const transpiler = new Bun.Transpiler({ loader: "tsx" });

/**
 * The specifiers a vendored module imports, as it spells them.
 *
 * The transpiler also reports the JSX runtime it would inject into any .tsx
 * file — `react/jsx-dev-runtime` and `react`, whatever the tsconfig says —
 * and the framework's .tsx is compiled by the build's own JSX plugin instead.
 * A specifier the file does not spell is not an import.
 */
async function importsOf(rel: string): Promise<string[]> {
  if (!/\.(m?[jt]sx?)$/.test(rel) || rel.endsWith(".d.ts")) return [];
  const source = await Bun.file(join(VENDOR, rel)).text();
  let imports: { path: string }[];
  try {
    imports = transpiler.scanImports(source);
  } catch {
    return [];
  }
  return imports
    .map((i) => i.path)
    .filter((path) => [`"${path}"`, `'${path}'`, `\`${path}\``].some((q) => source.includes(q)));
}

/** A relative specifier to the vendored file it names, the way Bun probes. */
function resolveLocal(fromRel: string, specifier: string): string | null {
  const base = join(dirname(join(VENDOR, fromRel)), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    join(base, "index.ts"),
    join(base, "index.js"),
  ]) {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    const rel = relative(VENDOR, candidate);
    if (!rel.startsWith("..") && !rel.split("/").includes("node_modules")) return rel;
  }
  return null;
}

/** Every vendored module reachable from `entries` through relative imports. */
async function reached(entries: readonly string[]): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const specifier of await importsOf(rel)) {
      if (!specifier.startsWith(".")) continue;
      const found = resolveLocal(rel, specifier);
      if (found !== null && !seen.has(found)) queue.push(found);
    }
  }
  return [...seen].sort();
}

export interface Closure {
  /** Package directories to copy, relative to `vendor/pocketjs`. */
  readonly dirs: readonly string[];
  /** Platform packages left out: name to exact version, for `optionalDependencies`. */
  readonly platform: Readonly<Record<string, string>>;
  /** Bare imports in shipped source that no installed package satisfies. */
  readonly unresolved: readonly string[];
  /** Each copied package: where it sits and the licence its package.json declares. */
  readonly packages: readonly ThirdParty[];
}

export interface ThirdParty {
  readonly name: string;
  readonly version: string;
  /** The `license` field, verbatim; `null` when the package declares none. */
  readonly license: string | null;
  /** Package-relative directory. */
  readonly path: string;
  /** The licence text the package ships, relative to `path`, or null when it ships none. */
  readonly licenseFile: string | null;
}

/**
 * The npm packages the shipped vendored source imports, and everything they
 * depend on, as installed under `vendor/pocketjs/node_modules`.
 *
 * Roots are the bare specifiers in the shipped files themselves rather than a
 * list kept here, so a framework file that starts importing a new package
 * brings it in. `dependencies` and installed `optionalDependencies` are
 * followed; `peerDependencies` are not — a peer is the importer's to provide,
 * and one a shipped file needs is a root here already. Measured at 66caf4e5,
 * following them as well stages the same 119 packages.
 */
export async function closure(vendorFiles: readonly string[]): Promise<Closure> {
  const roots = new Set<string>();
  for (const rel of vendorFiles) {
    for (const path of await importsOf(rel)) {
      if (path.startsWith(".") || path.startsWith("/") || BUILTIN.test(path)) continue;
      if (NODE_BUILTINS.has(path)) continue;
      roots.add(packageOf(path));
    }
  }

  const seen = new Map<string, PackageJson>();
  const platform: Record<string, string> = {};
  const unresolved: string[] = [];
  const queue: [string, string][] = [...roots].sort().map((name) => [VENDOR, name]);
  // The framework's own name resolves to the framework, not to node_modules.
  const self = (await readPackage(VENDOR)).name;
  while (queue.length > 0) {
    const [from, name] = queue.shift()!;
    if (name === self) continue;
    const dir = findPackage(from, name);
    if (dir === null) {
      if (from === VENDOR) unresolved.push(name);
      continue;
    }
    if (seen.has(dir)) continue;
    const pkg = await readPackage(dir);
    if (pkg.os !== undefined || pkg.cpu !== undefined) continue; // declared below, never copied
    seen.set(dir, pkg);
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push([dir, dep]);
    for (const [dep, version] of Object.entries(pkg.optionalDependencies ?? {})) {
      const found = findPackage(dir, dep);
      const depPkg = found ? await readPackage(found) : null;
      if (depPkg === null || depPkg.os !== undefined || depPkg.cpu !== undefined) {
        if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
          throw new Error(
            `${pkg.name} asks for platform package ${dep} as ${JSON.stringify(version)}; only an ` +
              "exact version pins the bytes, so this cannot be declared on its behalf",
          );
        }
        platform[dep] = version;
      } else {
        queue.push([dir, dep]);
      }
    }
  }

  const packages: ThirdParty[] = [];
  for (const [dir, pkg] of seen) {
    const licenseFile =
      (await readdir(dir)).sort().find((n) => /^(licen[cs]e|copying)(\.|-|$)/i.test(n)) ?? null;
    packages.push({
      name: pkg.name,
      version: pkg.version,
      license: typeof pkg.license === "string" ? pkg.license : null,
      path: join("vendor", "pocketjs", relative(VENDOR, dir)),
      licenseFile,
    });
  }
  packages.sort((a, b) => a.path.localeCompare(b.path));
  return {
    dirs: [...seen.keys()].map((d) => relative(VENDOR, d)).sort(),
    platform: Object.fromEntries(Object.entries(platform).sort()),
    unresolved: unresolved.sort(),
    packages,
  };
}

export interface Staged {
  readonly dir: string;
  /** Every file staged, package-relative, sorted. */
  readonly files: readonly string[];
  readonly manifest: PrebuiltManifest;
  readonly packageJson: Record<string, unknown>;
  readonly closure: Closure;
}

async function copyInto(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

/** The `package.json` that ships: the root's publishable fields, plus what staging derived. */
function stagedPackageJson(
  root: Record<string, unknown>,
  platform: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const keep = [
    "name",
    "version",
    "description",
    "license",
    "type",
    "repository",
    "homepage",
    "keywords",
    "bin",
    "exports",
    "engines",
  ];
  const out: Record<string, unknown> = {};
  for (const key of keep) if (root[key] !== undefined) out[key] = root[key];
  out.files = ["src", "patches", "vendor", ...TOP_FILES.filter((f) => f !== "README.md" && f !== "LICENSE")];
  out.optionalDependencies = platform;
  return out;
}

export async function stage(): Promise<Staged> {
  if (!existsSync(join(VENDOR, "hosts", "web", "pocketjs.wasm"))) {
    throw new Error(
      `pack: ${join(VENDOR, "hosts/web/pocketjs.wasm")} is missing, so there is no rasteriser to ship. ` +
        "Build the vendored tree first:\n  bun run vendor",
    );
  }
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });

  const files: string[] = [];
  for (const name of TOP_FILES) {
    await copyInto(join(ROOT, name), join(STAGE, name));
    files.push(name);
  }
  for (const rel of await gitFiles(ROOT, OWN_TREES)) {
    await copyInto(join(ROOT, rel), join(STAGE, rel));
    files.push(rel);
  }

  const trees = await gitFiles(VENDOR, VENDOR_TREES);
  for (const f of [...VENDOR_ENTRIES, ...VENDOR_FILES]) {
    if (!existsSync(join(VENDOR, f))) throw new Error(`pack: vendor/pocketjs/${f} is missing`);
  }
  const vendorFiles = [
    ...new Set([...trees, ...(await reached([...VENDOR_ENTRIES, ...trees])), ...VENDOR_FILES]),
  ].sort();
  const found = await closure(vendorFiles);
  if (found.unresolved.length > 0) {
    throw new Error(
      `pack: the shipped vendored source imports ${found.unresolved.join(", ")}, which no package ` +
        "under vendor/pocketjs/node_modules provides. Re-vendor (`bun run vendor --refresh`).",
    );
  }
  const shippedVendor = new Set<string>(vendorFiles);
  for (const dir of found.dirs) {
    for (const rel of await walk(join(VENDOR, dir))) shippedVendor.add(join(dir, rel));
  }
  const vendorRel = [...shippedVendor].sort();
  for (const rel of vendorRel) {
    await copyInto(join(VENDOR, rel), join(STAGE, "vendor", "pocketjs", rel));
  }

  const hashed: Record<string, string> = {};
  for (const rel of vendorRel) {
    const pkgRel = join("vendor", "pocketjs", rel);
    hashed[pkgRel] = await fileSha256(join(STAGE, pkgRel));
  }
  const manifest: PrebuiltManifest = {
    prebuilt: 1,
    upstream: UPSTREAM.commit,
    patches: await patchDigests(),
    stagedBy: Bun.version,
    platformPackages: found.platform,
    files: hashed,
  };
  await Bun.write(join(STAGE, PREBUILT_FILE), JSON.stringify(manifest, null, 2) + "\n");
  await Bun.write(
    join(STAGE, THIRD_PARTY_FILE),
    JSON.stringify(
      {
        about:
          "The npm packages under vendor/pocketjs/node_modules, copied unmodified as " +
          "`bun install --frozen-lockfile` installed them against vendor/pocketjs/bun.lock. Each " +
          "keeps its own licence; `licenseFile` is the text it ships, null where the package " +
          "publishes none and `license` is all it declares. `platformPackages` are not copied: " +
          "they are optionalDependencies of pocket-motion, installed by the consumer's package manager.",
        packages: found.packages,
        platformPackages: found.platform,
      },
      null,
      2,
    ) + "\n",
  );

  const rootPkg = (await Bun.file(join(ROOT, "package.json")).json()) as Record<string, unknown>;
  const packageJson = stagedPackageJson(rootPkg, found.platform);
  await Bun.write(join(STAGE, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");

  files.push(
    "package.json",
    PREBUILT_FILE,
    THIRD_PARTY_FILE,
    ...vendorRel.map((rel) => join("vendor", "pocketjs", rel)),
  );
  return { dir: STAGE, files: [...new Set(files)].sort(), manifest, packageJson, closure: found };
}

export interface Packed {
  readonly filename: string;
  readonly files: readonly string[];
  readonly size: number;
  readonly unpackedSize: number;
}

/** `npm pack` over the staged directory, `--dry-run` or not. */
export async function npmPack(dir: string, dryRun: boolean): Promise<Packed> {
  const argv = ["npm", "pack", "--json", "--ignore-scripts", `--pack-destination=${PACK_DIR}`];
  if (dryRun) argv.push("--dry-run");
  const proc = Bun.spawn(argv, { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`npm pack failed (${code})\n${err.trim()}`);
  const [result] = JSON.parse(out) as {
    filename: string;
    size: number;
    unpackedSize: number;
    files: { path: string }[];
  }[];
  return {
    filename: join(PACK_DIR, result!.filename),
    files: result!.files.map((f) => f.path).sort(),
    size: result!.size,
    unpackedSize: result!.unpackedSize,
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const json = argv.includes("--json");
  const staged = await stage();
  const packed = await npmPack(staged.dir, dryRun);
  const dropped = staged.files.filter((f) => !packed.files.includes(f));
  if (json) {
    console.log(
      JSON.stringify({
        ok: dropped.length === 0,
        dryRun,
        stage: staged.dir,
        tarball: dryRun ? null : packed.filename,
        files: packed.files.length,
        size: packed.size,
        unpackedSize: packed.unpackedSize,
        platformPackages: staged.closure.platform,
        packages: staged.closure.dirs.length,
        dropped,
      }),
    );
  } else {
    console.log(`pack: staged ${staged.files.length} file(s) in ${relative(ROOT, staged.dir)}`);
    console.log(
      `pack: ${staged.closure.dirs.length} npm package(s) under vendor/pocketjs/node_modules; ` +
        `declared per platform: ${Object.keys(staged.closure.platform).length}`,
    );
    console.log(
      `pack: ${packed.files.length} file(s), ${(packed.size / 1048576).toFixed(1)} MiB packed, ` +
        `${(packed.unpackedSize / 1048576).toFixed(1)} MiB unpacked` +
        (dryRun ? " (dry run — nothing written)" : ` → ${relative(ROOT, packed.filename)}`),
    );
    for (const f of dropped) console.log(`pack: npm dropped ${f}`);
  }
  if (dropped.length > 0) process.exit(1);
}
