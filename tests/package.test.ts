/**
 * The npm package: what `npm pack` puts in it, and that an install of it
 * reproduces a recorded digest.
 *
 * `scripts/pack.ts` stages the package from an explicit list and its header
 * says why; this holds the result. The file list is read from
 * `npm pack --dry-run --json` over the staged directory — npm's own answer,
 * not the stage's — and four things are asserted against it:
 *
 * - NPM PACKS EXACTLY WHAT WAS STAGED. npm honours a `.gitignore` anywhere
 *   under a directory `files` names, and upstream's ignores both
 *   `node_modules` and `hosts/web/pocketjs.wasm`. Red, measured at
 *   66caf4e5: adding upstream's `.gitignore` to `VENDOR_FILES` makes npm drop
 *   4054 of the 4410 staged files — all 4052 under `node_modules`, the wasm
 *   and the ignore file itself — while the stage still holds them.
 * - What a build and a render read is in it, by name.
 * - What must not ship is not: this repository's compositions, tests,
 *   scripts, ledgers and assets — the HarmonyOS faces, the Noto Sans SC pair,
 *   the Mixkit audio — and of upstream, its engine source and history.
 * - The manifest and the inventory describe the tarball they are in.
 *
 * Then one install: the real tarball, `bun add`ed into an empty project, a
 * copy of `compositions/smoke` built and traced there through the package's
 * own bin, and the digest compared with `baselines/digests.json`. That is the
 * claim a consumer is being sold, measured where a consumer stands — and the
 * identity compared with the checkout's build of the same sources, which is
 * the claim a cache keyed on identity is being sold. It needs
 * the registry for one optional package — the compiler's native binding for
 * this platform — which is why it lives here and not in a unit test. Red,
 * measured: staging with `optionalDependencies` emptied installs no binding,
 * and `doctor`'s vendor check fails with "the vendored compiler does not load
 * on darwin-arm64: error: Cannot find native binding" before any build runs.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runBuild } from "../src/cli/build.ts";
import { compositionIdentity } from "../src/cli/commands/trace.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { PREBUILT_FILE, prebuiltProblems } from "../src/package/prebuilt.ts";
import { patchDigests } from "../src/render/build-record.ts";
import type { InputIdentity } from "../src/render/identity.ts";
import { UPSTREAM } from "../src/vendor/upstream.ts";
import {
  THIRD_PARTY_FILE,
  npmPack,
  stage,
  type Packed,
  type Staged,
  type ThirdParty,
} from "../scripts/pack.ts";

const ROOT = resolve(import.meta.dir, "..");
/** The framework module a build substitutes its own table for (`jsxPlugin`). */
const STYLE_TABLE = "vendor/pocketjs/framework/src/styles.generated.ts";

let staged: Staged;
let listed: Packed;

beforeAll(async () => {
  staged = await stage();
  listed = await npmPack(staged.dir, true);
}, 300_000);

describe("npm pack --dry-run over the staged package", () => {
  test("npm packs every staged file and nothing else", () => {
    expect(listed.files).toEqual([...staged.files]);
  });

  test("the top level is the package, not the repository", () => {
    const top = new Set(listed.files.map((f) => f.split("/")[0]!));
    expect([...top].sort()).toEqual(
      ["CHANGELOG.md", "LICENSE", "NOTICE", "README.md", "package.json", "patches", "src", "vendor"].sort(),
    );
  });

  test("what a build and a render read is in it", () => {
    const required = [
      "src/api.ts",
      "src/cli/main.ts",
      "src/runtime/boot.ts",
      PREBUILT_FILE,
      THIRD_PARTY_FILE,
      "vendor/pocketjs/LICENSE",
      "vendor/pocketjs/package.json",
      "vendor/pocketjs/pocket.config.ts",
      "vendor/pocketjs/tools/build.ts",
      "vendor/pocketjs/hosts/web/pocketjs.wasm",
      "vendor/pocketjs/hosts/web/wasm-ops.js",
      "vendor/pocketjs/tools/png.ts",
      "vendor/pocketjs/framework/compiler/jsx-plugin.ts",
      "vendor/pocketjs/framework/compiler/bake-font.ts",
      "vendor/pocketjs/framework/src/components.ts",
      STYLE_TABLE,
      "vendor/pocketjs/contracts/spec/spec.ts",
      "vendor/pocketjs/assets/fonts/Inter-Regular.ttf",
      "vendor/pocketjs/assets/fonts/LICENSE.txt",
      "vendor/pocketjs/assets/fonts/LICENSE-JetBrainsMono.txt",
      "vendor/pocketjs/node_modules/@babel/core/package.json",
      "vendor/pocketjs/node_modules/babel-preset-solid/package.json",
      "vendor/pocketjs/node_modules/solid-js/package.json",
      "vendor/pocketjs/node_modules/opentype.js/package.json",
      "vendor/pocketjs/node_modules/@vue-jsx-vapor/compiler-rs/index.js",
      // The builder imports microts' AOT compiler at module scope, and that
      // imports `typescript`: every build loads it, so it has to be here.
      "vendor/pocketjs/microts/compiler/aot-solid-browser.ts",
      "vendor/pocketjs/node_modules/typescript/package.json",
    ];
    const files = new Set(listed.files);
    expect(required.filter((f) => !files.has(f))).toEqual([]);
  });

  test("every patch ships, so assertBuildRecord has the set it compares against", async () => {
    const patches = (await patchDigests()).map((p) => `patches/${p.file}`);
    expect(patches.length).toBeGreaterThan(0);
    const files = new Set(listed.files);
    expect(patches.filter((p) => !files.has(p))).toEqual([]);
  });

  test("what must not ship does not", () => {
    const forbidden: [string, RegExp][] = [
      ["this repository's trees", /^(compositions|tests|scripts|baselines|skills|assets)\//],
      ["media bytes", /\.(mp3|wav|mp4|mov|webm)$/],
      ["the HarmonyOS and Noto Sans SC faces", /(HarmonyOS|NotoSansSC)/],
      ["a native binary built for the packing machine", /\.node$/],
      ["upstream's engine, apps, site and history", /^vendor\/pocketjs\/(engine|apps|site|docs|\.git)\//],
      ["an ignore file npm would act on", /(^|\/)\.(git|npm)ignore$/],
    ];
    const hits = forbidden.flatMap(([why, re]) =>
      listed.files.filter((f) => re.test(f)).map((f) => `${why}: ${f}`),
    );
    expect(hits).toEqual([]);
  });

  test("the framework's style table ships as the vendored tree has it, not a table a build left", async () => {
    // No build writes it since upstream #591 — a build's table goes into its
    // own --outdir — so the staged bytes are the vendored file's: the pinned
    // commit's plus what patches add to it (0043 adds an empty PATH_IDS), which
    // is why this compares against the vendored copy and not `git show HEAD:`.
    const vendored = await Bun.file(join(ROOT, STYLE_TABLE)).text();
    expect(await Bun.file(join(staged.dir, STYLE_TABLE)).text()).toBe(vendored);
    // A build that wrote here would have written the vendored copy too, so the
    // comparison alone cannot see one: every table in it must still be empty.
    const tables = [...vendored.matchAll(/export const (\w+): Record<[^>]+> = (\{[^;]*\});/g)];
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter(([, , body]) => body !== "{}").map(([, name]) => name)).toEqual([]);
    expect(vendored).toMatch(/export const STYLE_COUNT = 0;/);
  });
});

describe("package.json as it ships", () => {
  test("the bin is the CLI, the export is the API, and only under the bun condition", async () => {
    const pkg = staged.packageJson as {
      name: string;
      bin: Record<string, string>;
      exports: Record<string, unknown>;
      engines: Record<string, string>;
      private?: boolean;
      scripts?: unknown;
      dependencies?: unknown;
    };
    expect(pkg.name).toBe("pocket-motion");
    expect(pkg.bin).toEqual({ "pocket-motion": "src/cli/main.ts" });
    expect((await Bun.file(join(staged.dir, "src/cli/main.ts")).text()).startsWith("#!/usr/bin/env bun\n")).toBe(true);
    // Bun only: no `node`, `import`, `require` or `default` condition for a
    // resolver to fall back to.
    expect(pkg.exports["."]).toEqual({ types: "./src/api.ts", bun: "./src/api.ts" });
    expect(Object.keys(pkg.engines)).toEqual(["bun"]);
    expect(pkg.private).toBeUndefined();
    expect(pkg.scripts).toBeUndefined();
    // Everything the compiler imports is in the tarball; nothing floats.
    expect(pkg.dependencies).toBeUndefined();
  });

  test("platform packages are the compiler's own, at its exact versions", async () => {
    const declared = (staged.packageJson as { optionalDependencies: Record<string, string> })
      .optionalDependencies;
    const compilerRs = (await Bun.file(
      join(ROOT, "vendor/pocketjs/node_modules/@vue-jsx-vapor/compiler-rs/package.json"),
    ).json()) as { optionalDependencies: Record<string, string> };
    expect(declared).toEqual(compilerRs.optionalDependencies);
    expect(Object.values(declared).every((v) => /^\d+\.\d+\.\d+$/.test(v))).toBe(true);
  });
});

describe("the manifest and the inventory describe the tarball they are in", () => {
  test("every vendored file is in the manifest by sha256", () => {
    const vendored = listed.files.filter((f) => f.startsWith("vendor/pocketjs/"));
    expect(Object.keys(staged.manifest.files).sort()).toEqual(vendored);
    expect(staged.manifest.upstream).toBe(UPSTREAM.commit);
  });

  test("the staged tree passes the check doctor runs on an install", async () => {
    expect(await prebuiltProblems(staged.manifest, staged.dir)).toEqual([]);
  });

  test("every copied package has a licence NOTICE accounts for, and is in the inventory", async () => {
    const inventory = (await Bun.file(join(staged.dir, THIRD_PARTY_FILE)).json()) as {
      packages: ThirdParty[];
    };
    // A package's root is the path through its LAST `node_modules/` segment,
    // so `parse5/node_modules/entities` is its own package and not parse5's.
    const shippedPackages = new Set(
      listed.files
        .map((f) => /^(vendor\/pocketjs\/(?:.*\/)?node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(f)?.[1])
        .filter((p): p is string => p !== undefined),
    );
    expect([...shippedPackages].sort()).toEqual(inventory.packages.map((p) => p.path).sort());
    const notice = await Bun.file(join(ROOT, "NOTICE")).text();
    const unaccounted = inventory.packages.filter(
      (p) => p.license === null || !notice.includes(p.license),
    );
    expect(unaccounted.map((p) => `${p.name}@${p.version}: ${p.license}`)).toEqual([]);
  });
});

describe("the checkout itself is not the package", () => {
  test("npm pack at the repository root refuses, naming the command that packs", async () => {
    const proc = Bun.spawn(["npm", "pack", "--dry-run"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("bun scripts/pack.ts");
  }, 60_000);
});

describe("prebuiltProblems", () => {
  const dir = mkdtempSync(join(tmpdir(), "motion-prebuilt-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function manifestOver(files: Record<string, string>) {
    const hashed: Record<string, string> = {};
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), text);
      hashed[rel] = new Bun.CryptoHasher("sha256").update(text).digest("hex");
    }
    return {
      prebuilt: 1 as const,
      upstream: UPSTREAM.commit,
      patches: await patchDigests(),
      stagedBy: Bun.version,
      platformPackages: {},
      files: hashed,
    };
  }

  test("a tree that matches says nothing", async () => {
    const m = await manifestOver({ "vendor/pocketjs/a.ts": "a", "vendor/pocketjs/b.wasm": "b" });
    expect(await prebuiltProblems(m, dir)).toEqual([]);
  });

  test("a changed file and a missing one are counted and the first of each is named", async () => {
    const m = await manifestOver({ "vendor/pocketjs/c.ts": "c", "vendor/pocketjs/d.ts": "d" });
    writeFileSync(join(dir, "vendor/pocketjs/c.ts"), "changed");
    rmSync(join(dir, "vendor/pocketjs/d.ts"));
    expect(await prebuiltProblems(m, dir)).toEqual([
      "1 file(s) the manifest lists are not on disk, first vendor/pocketjs/d.ts",
      "1 file(s) differ from the manifest, first vendor/pocketjs/c.ts",
    ]);
  });

  test("a tree staged at another upstream, or with another patch set, is named", async () => {
    const m = await manifestOver({});
    const [first, ...rest] = m.patches;
    expect(
      await prebuiltProblems({ ...m, upstream: "0000000", patches: rest }, dir),
    ).toEqual([
      `the prebuilt tree was cloned at upstream 0000000; this package pins ${UPSTREAM.commit}`,
      `patches/${first!.file} was not applied to the prebuilt tree`,
    ]);
  });
});

describe("installed from the tarball", () => {
  const project = mkdtempSync(join(tmpdir(), "motion-consumer-"));
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  async function run(argv: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn([...argv], { cwd: project, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  }

  test("an empty project reproduces smoke's ledger digest through the package's bin", async () => {
    const tarball = (await npmPack(staged.dir, false)).filename;
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ name: "consumer", private: true, type: "module" }),
    );
    const added = await run(["bun", "add", tarball]);
    expect(added.code, added.stderr).toBe(0);
    cpSync(join(ROOT, "compositions/smoke"), join(project, "compositions/smoke"), { recursive: true });

    const doctor = JSON.parse((await run(["bunx", "pocket-motion", "doctor", "--json"])).stdout) as {
      checks: { name: string; ok: boolean; detail: string }[];
    };
    const vendor = doctor.checks.find((c) => c.name === "vendor")!;
    expect(vendor.ok, vendor.detail).toBe(true);
    expect(vendor.detail).toContain("the compiler loads on this platform");

    const built = await run(["bunx", "pocket-motion", "build", "compositions/smoke", "--json"]);
    expect(built.code, built.stderr).toBe(0);
    // The record names the composition relative to the project, not to
    // node_modules/pocket-motion and not by where the project sits.
    const record = (await Bun.file(join(project, "dist/compositions/smoke/build.json")).json()) as {
      argv: string[];
    };
    expect(record.argv.filter((t) => t.includes(project))).toEqual([]);

    const traced = await run(["bunx", "pocket-motion", "trace", "compositions/smoke", "--json"]);
    expect(traced.code, traced.stderr).toBe(0);
    const ledger = (await Bun.file(join(ROOT, "baselines/digests.json")).json()) as {
      compositions: Record<string, { digest: string }>;
    };
    expect((JSON.parse(traced.stdout) as { digest: string }).digest).toBe(
      ledger.compositions["compositions/smoke"]!.digest,
    );
    // And the checkout's identity for the same sources, component for
    // component. The bundle names the framework by its place in the PocketJS
    // tree (patches/0051) rather than as
    // `node_modules/pocket-motion/vendor/pocketjs/…`, and `build.json` names
    // nothing the project's location decides. Red with 0051's rename
    // disabled in `tools/build.ts`: the `bundle` component differs and
    // nothing else does.
    const flags = { json: false };
    const unbuilt = await resolveComposition({ dir: join(ROOT, "compositions/smoke"), flags, requireBundle: false });
    if (!unbuilt.ok) throw new Error(unbuilt.message);
    await runBuild(unbuilt.value);
    const here = await resolveComposition({ dir: join(ROOT, "compositions/smoke"), flags, requireBundle: true });
    if (!here.ok) throw new Error(here.message);
    const checkout = await compositionIdentity(here.value, undefined);
    const installed = (JSON.parse(traced.stdout) as { identity: InputIdentity }).identity;
    expect(installed.components).toEqual(checkout.components);
    expect(installed.digest).toBe(checkout.digest);

    const imported = await run([
      "bun",
      "-e",
      'const m = await import("pocket-motion"); console.log(Object.keys(m).sort().join(","))',
    ]);
    expect(imported.stdout.trim()).toBe("argvOf,build,doctor,render,trace,verify");
  }, 600_000);
});
