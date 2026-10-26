/**
 * A build's bytes and its input identity do not depend on the directory it
 * ran in.
 *
 * One composition is built from three places: where it sits in this checkout,
 * a randomly named staging directory under `dist/` — what `render --spec`
 * builds in — and a project outside this repository reached through a
 * symlink, which is where an installed package's consumer stands. The three
 * must write the same bundle, pak and `build.json` byte for byte and report
 * one identity.
 *
 * Before `patches/0051-location-free-bundle-names.patch` and the location-free
 * argv in `src/render/build-record.ts`, Bun named every module in the bundle
 * by its path relative to the build's cwd — `// dist/location-Xq3/main.tsx`,
 * `// ../../../Users/…/vendor/pocketjs/framework/src/index.ts` — and the
 * record carried the entry and `--outdir` relative to the repository, so the
 * staged copy differed in `bundle` and `toolchain` and the symlinked project
 * in `bundle`, with every frame equal.
 */

import { afterAll, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runBuild } from "../src/cli/build.ts";
import { runFromArgv as renderFromArgv } from "../src/cli/commands/render.ts";
import { compositionIdentity } from "../src/cli/commands/trace.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import type { GlobalFlags } from "../src/cli/types.ts";
import { EXIT_OK } from "../src/cli/types.ts";
import { buildRecordPath } from "../src/render/build-record.ts";
import type { InputIdentity } from "../src/render/identity.ts";

const ROOT = resolve(import.meta.dir, "..");

/**
 * A theme from `pocket.config.ts`, a path table, text in the default faces:
 * three routes into the pak, and a config module the build imports from the
 * composition's own directory.
 */
const FIXTURE = join(ROOT, "compositions/vector-paths");

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function copyFiles(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (statSync(join(from, name)).isFile()) copyFileSync(join(from, name), join(to, name));
  }
}

interface Built {
  readonly bundle: Buffer;
  readonly pak: Buffer;
  readonly record: string;
  readonly identity: InputIdentity;
}

async function buildAt(dir: string, outdir?: string): Promise<Built> {
  const flags: GlobalFlags = outdir
    ? { json: false, bundle: join(outdir, "main.js"), pak: join(outdir, "main.pak") }
    : { json: false };
  const unbuilt = await resolveComposition({ dir, flags, requireBundle: false });
  if (!unbuilt.ok) throw new Error(unbuilt.message);
  await runBuild(unbuilt.value);
  const built = await resolveComposition({ dir, flags, requireBundle: true });
  if (!built.ok) throw new Error(built.message);
  const c = built.value;
  return {
    bundle: readFileSync(c.bundlePath),
    pak: readFileSync(c.pakPath),
    record: readFileSync(buildRecordPath(c.bundlePath), "utf8"),
    identity: await compositionIdentity(c, undefined),
  };
}

/** The lines of `b` that are not in `a`, for a failure that names them. */
function linesOnlyIn(a: Buffer, b: Buffer): string {
  const seen = new Set(a.toString("utf8").split("\n"));
  return b
    .toString("utf8")
    .split("\n")
    .filter((l) => !seen.has(l))
    .slice(0, 8)
    .join("\n");
}

describe("where a build runs is not an input", () => {
  test("a checkout, a random staging directory and a symlinked project build the same bytes", async () => {
    // What `render --spec` does: a `mkdtemp` under `dist/`, building into its
    // own `dist/`. Its pocket.config.ts reaches the framework through the
    // same two `..` as the checkout's, because the directory sits at the
    // same depth.
    const staged = mkdtempSync(join(ROOT, "dist", "location-"));
    scratch.push(staged);
    copyFiles(FIXTURE, staged);

    // A project that is not this repository, at a path that is not its
    // realpath: the cwd a build spawns in is the symlink, and Bun hands every
    // module over by its realpath. `vendor` is linked in for the config
    // module's relative import, as an installed package's consumer would
    // reach the framework from its own tree.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "pocket-motion-location-")));
    scratch.push(outside);
    const real = join(outside, "real");
    copyFiles(FIXTURE, join(real, "compositions", "vector-paths"));
    symlinkSync(join(ROOT, "vendor"), join(real, "vendor"));
    symlinkSync(real, join(outside, "via"));

    const checkout = await buildAt(FIXTURE);
    const places = {
      staged: await buildAt(staged, join(staged, "dist")),
      symlinked: await buildAt(join(outside, "via", "compositions", "vector-paths")),
    };

    // Every difference at once, so a red run says which artefact moved and
    // which lines or components moved it.
    const differences: string[] = [];
    for (const [where, b] of Object.entries(places)) {
      if (!b.bundle.equals(checkout.bundle)) {
        differences.push(`${where}: bundle — lines not in the checkout's:\n${linesOnlyIn(checkout.bundle, b.bundle)}`);
      }
      if (!b.pak.equals(checkout.pak)) differences.push(`${where}: pak`);
      if (b.record !== checkout.record) {
        differences.push(`${where}: build.json — argv ${JSON.stringify(JSON.parse(b.record).argv)}`);
      }
      const moved = Object.keys({ ...checkout.identity.components, ...b.identity.components })
        .filter((k) => b.identity.components[k] !== checkout.identity.components[k]);
      if (moved.length > 0 || b.identity.digest !== checkout.identity.digest) {
        differences.push(`${where}: identity — components ${moved.join(", ") || "(none)"}`);
      }
    }
    expect(differences.join("\n") || "none").toBe("none");
    // The bundle names no directory of this machine's.
    for (const path of [ROOT, outside, staged, realpathSync(tmpdir())]) {
      expect(checkout.bundle.toString("utf8")).not.toContain(path);
      expect(places.symlinked.bundle.toString("utf8")).not.toContain(path);
    }
  }, 300_000);
});

describe("a render --spec job has an identity", () => {
  test("one spec staged twice reports one identity, and another spec another", async () => {
    // Each render stages the job into its own `dist/copy-job-<random>/`, so
    // the two renders of `spec.default.json` built from two directories.
    // Before, `render --spec` reported no identity at all, because the staged
    // directory's name reached the bundle and `build.json`.
    const work = mkdtempSync(join(tmpdir(), "pocket-motion-location-spec-"));
    scratch.push(work);
    const copy = join(ROOT, "compositions/copy");
    const spec = join(copy, "spec.default.json");
    const other = join(work, "other.json");
    const base = (await Bun.file(spec).json()) as { copy: Record<string, string> };
    await Bun.write(other, JSON.stringify({ ...base, copy: { ...base.copy, headline: "另一份标题" } }) + "\n");

    const render = async (path: string, out: string) => {
      const r = await renderFromArgv([copy, "--spec", path, "--out", join(work, out), "--json"]);
      expect(r.exitCode).toBe(EXIT_OK);
      return r.json as { digest: string; identity: InputIdentity };
    };
    const first = await render(spec, "a.mp4");
    const second = await render(spec, "b.mp4");
    const changed = await render(other, "c.mp4");

    expect(first.identity.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(second.identity).toEqual(first.identity);
    expect(second.digest).toBe(first.digest);
    expect(changed.identity.digest).not.toBe(first.identity.digest);
    expect(changed.digest).not.toBe(first.digest);
  }, 300_000);
});
