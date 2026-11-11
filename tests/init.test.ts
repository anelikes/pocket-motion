/**
 * `init` — does a copied fixture actually work, and does it refuse the two
 * things that would leave a mess?
 *
 * The green case is the whole point and is therefore run for real: `init`,
 * then the generator, then `build`, `lint`, `check` and `trace`, on a
 * composition created seconds earlier. Anything less would be asserting that
 * files were written, which is not the claim — the claim is that what was
 * written is a composition this repository's own commands accept.
 *
 * `copy` is the example driven end to end because it is the one that
 * exercises everything init has to get right and still costs one frame: a
 * generator with `../../src/…` imports, a `new URL("../..")` repository root,
 * repo-relative CJK faces, an `images.json`, a spec, and an `app.tsx` that
 * must NOT be copied. `smoke` is driven too, as the other shape — no
 * generator, so `app.tsx` must be.
 *
 * The probe directories are inside `compositions/`, which is where init is
 * allowed to write and nowhere else, so they are removed in `afterAll`. They
 * are named with a prefix nothing else uses, and the ledgers never see them:
 * both walk the tree with `git ls-files --cached --others`, and an untracked
 * directory removed before the run is over is not there to be walked.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  EXAMPLE_NAMES,
  declaredAssets,
  rebaseSpecifier,
  rewritePocketJson,
  rewriteSource,
  run as runInit,
  slugOf,
} from "../src/cli/commands/init.ts";
import { parseSidecar } from "../src/manifest/sidecar.ts";
import { EXIT_OK, EXIT_USAGE } from "../src/cli/types.ts";
import { scratchDir } from "./scratch.ts";

const ROOT = resolve(import.meta.dir, "..");
const PROBE = "init-probe";

const made: string[] = [];

function probeDir(name: string): string {
  const dir = join(ROOT, "compositions", `${PROBE}-${name}`);
  made.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  for (const dir of made) {
    rmSync(join(ROOT, "dist", "compositions", dir.split("/").at(-1)!), {
      recursive: true,
      force: true,
    });
  }
});

async function cli(argv: readonly string[]): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn(["bun", "src/cli/main.ts", ...argv], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out: stdout + stderr, code };
}

// ---------------------------------------------------------------------------
// The pure halves
// ---------------------------------------------------------------------------

describe("rebasing", () => {
  const from = join(ROOT, "compositions/copy");

  test("a specifier that does not escape the directory is left alone", () => {
    // `./app.tsx` and `new URL(".", import.meta.url)` both still mean
    // "beside me" in the new location, so rewriting them would be wrong.
    expect(rebaseSpecifier("./app.tsx", from, join(ROOT, "compositions/deep/x"))).toBeNull();
    expect(rebaseSpecifier(".", from, join(ROOT, "compositions/deep/x"))).toBeNull();
  });

  test("equal depth needs no change at all", () => {
    expect(
      rebaseSpecifier("../../src/text/fit.ts", from, join(ROOT, "compositions/other")),
    ).toBeNull();
  });

  test("one level deeper grows every escaping specifier", () => {
    const to = join(ROOT, "compositions/deep/x");
    expect(rebaseSpecifier("../../src/text/fit.ts", from, to)).toBe("../../../src/text/fit.ts");
    // `new URL("../..")` is the repository root from a depth-1 composition and
    // `compositions/` from a depth-2 one, so it moves too — and the trailing
    // shape is preserved because `new URL` reads it as a directory.
    expect(rebaseSpecifier("../..", from, to)).toBe("../../..");
  });

  test("the fixture's own path is replaced, but not inside a longer name", () => {
    const text = [
      'import { x } from "../../src/a.ts";',
      "// bun compositions/copy/gen.ts",
      "// compositions/copy-of-something stays",
    ].join("\n");
    const out = rewriteSource(text, {
      fromDir: from,
      toDir: join(ROOT, "compositions/deep/x"),
      fromRel: "compositions/copy",
      toRel: "compositions/deep/x",
    });
    expect(out).toContain('"../../../src/a.ts"');
    expect(out).toContain("bun compositions/deep/x/gen.ts");
    expect(out).toContain("compositions/copy-of-something stays");
  });
});

describe("pocket.json identity", () => {
  test("id, name, title, output and entry are re-derived, not copied", () => {
    const source = readFileSync(join(ROOT, "compositions/copy/pocket.json"), "utf8");
    const out = JSON.parse(rewritePocketJson(source, "deep/x")) as {
      id: string;
      name: string;
      title: string;
      app: { entry: string; output: string };
    };
    expect(out.id).toBe("dev.pocket-stack.motion-deep-x");
    expect(out.name).toBe("pocketjs-motion-deep-x");
    expect(out.app.entry).toBe("compositions/deep/x/main.tsx");
    expect(out.app.output).toBe("motion-deep-x");
    // Two compositions sharing a compositionId is a real state in this tree
    // and the reason preview's rail is keyed by path. A copy should not add
    // another pair.
    expect(out.id).not.toBe(
      (JSON.parse(source) as { id: string }).id,
    );
  });

  test("slugOf flattens a nested path", () => {
    expect(slugOf("a/b/9x16")).toBe("a-b-9x16");
  });
});

describe("declaredAssets", () => {
  test("reaches fonts, footage and all four sound roles, and not an optional element", () => {
    const parsed = parseSidecar(
      JSON.parse(readFileSync(join(ROOT, "compositions/sound-roles/pocket-motion.json"), "utf8")),
    );
    if (!parsed.ok) throw new Error("the sound-roles fixture's sidecar does not parse");
    const assets = declaredAssets(parsed.value);
    expect(assets).toContain("assets/fonts/HarmonyOS_Sans_Regular.ttf");
    expect(assets).toContain("assets/synthetic/bars-16x9-24fps.mp4");
    expect(assets).toContain("assets/synthetic/bed-220hz-8000ms.wav");
    expect(assets).toContain("assets/synthetic/narration-440hz-2000ms.wav");
    expect(assets).toContain("assets/synthetic/dialogue-660hz-1500ms.wav");
    expect(assets).toContain("assets/synthetic/cue-880hz-300ms.wav");
    // Declared `optional` and absent on purpose: mixed when present, skipped
    // when not, so it is not a file the copy needs.
    expect(assets).not.toContain("assets/synthetic/sting-not-shipped.wav");
    for (const rel of assets) {
      expect(existsSync(join(ROOT, rel)), rel).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

describe("init refuses", () => {
  test("a target outside compositions/, naming why a composition lives there", async () => {
    const elsewhere = join(scratchDir("init"), "elsewhere");
    const { out, code } = await cli(["init", elsewhere, "--example", "smoke"]);
    expect(code).toBe(EXIT_USAGE);
    expect(out).toContain("compositions/ tree");
    expect(out).toContain("init compositions/<name>");
    expect(existsSync(elsewhere)).toBe(false);
  });

  test("an existing non-empty directory, and writes nothing into it", async () => {
    const before = readFileSync(join(ROOT, "compositions/smoke/app.tsx"), "utf8");
    const { out, code } = await cli(["init", "compositions/smoke", "--example", "copy"]);
    expect(code).toBe(EXIT_USAGE);
    expect(out).toContain("already exists and is not empty");
    expect(readFileSync(join(ROOT, "compositions/smoke/app.tsx"), "utf8")).toBe(before);
    expect(existsSync(join(ROOT, "compositions/smoke/gen.ts"))).toBe(false);
  });

  test("a missing --example, differently for a terminal and for a script", async () => {
    const script = await runInit({ dir: "compositions/whatever", example: undefined, tty: false });
    expect(script.exitCode).toBe(EXIT_USAGE);
    expect(script.stdoutLines!.join("\n")).toContain("requires --example");
    for (const name of EXAMPLE_NAMES) {
      expect(script.stdoutLines!.join("\n")).toContain(name);
    }

    const terminal = await runInit({ dir: "compositions/whatever", example: undefined, tty: true });
    expect(terminal.exitCode).toBe(EXIT_USAGE);
    expect(terminal.stdoutLines!.join("\n")).toContain("needs an example to start from");
    expect(terminal.stdoutLines!.join("\n")).not.toContain("not a terminal");
  });

  test("an example that is not one of the four", async () => {
    const { out, code } = await cli(["init", "compositions/whatever", "--example", "nope"]);
    expect(code).toBe(EXIT_USAGE);
    expect(out).toContain("unknown example");
  });
});

// ---------------------------------------------------------------------------
// The green case, run for real
// ---------------------------------------------------------------------------

describe("a composition made by init", () => {
  test(
    "copy: gen, build, lint, check and trace all pass on it",
    async () => {
      const dir = probeDir("copy");
      const rel = `compositions/${PROBE}-copy`;

      const init = await runInit({ dir, example: "copy", tty: false });
      expect(init.exitCode).toBe(EXIT_OK);
      const payload = init.json as { files: string[]; generated: string[]; next: string[] };
      // app.tsx is generated by this fixture, so it is not seeded.
      expect(payload.files).not.toContain("app.tsx");
      expect(payload.generated).toEqual(["app.tsx"]);
      expect(payload.files).toEqual([
        "gen.ts",
        "images.json",
        "main.tsx",
        "pocket-motion.json",
        "pocket.json",
        "spec.default.json",
      ]);
      expect(payload.next[0]).toBe(`bun ${rel}/gen.ts`);

      // The generator runs from the new location, which is the whole test of
      // the specifier rebasing: `../../src/text/measure.ts` and
      // `new URL("../..")` both have to still mean what they meant.
      const gen = Bun.spawn(["bun", `${rel}/gen.ts`], {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      });
      expect(await gen.exited).toBe(0);
      expect(existsSync(join(dir, "app.tsx"))).toBe(true);

      for (const command of ["build", "lint", "check", "trace"]) {
        const { out, code } = await cli([command, rel]);
        expect(`${command}: ${code}\n${out}`).toBe(`${command}: 0\n${out}`);
      }

      // And the picture is the fixture's own: init copied a composition, not
      // an approximation of one.
      const { out } = await cli(["trace", rel, "--json"]);
      const trace = JSON.parse(out) as { digest: string };
      const ledger = JSON.parse(
        readFileSync(join(ROOT, "baselines/digests.json"), "utf8"),
      ) as { compositions: Record<string, { digest: string }> };
      expect(trace.digest).toBe(ledger.compositions["compositions/copy"]!.digest);
    },
    600_000,
  );

  test(
    "copy one level deeper: the rebased specifiers are what let the generator run",
    async () => {
      // At equal depth every source is copied byte for byte, so the test
      // above says nothing about rebasing. Here `../../src/text/measure.ts`
      // and `new URL("../..", import.meta.url)` are both wrong as written and
      // the generator is what proves they were fixed: it imports the first
      // and resolves the declared faces against the second.
      const dir = probeDir("deep");
      const rel = `compositions/${PROBE}-deep/cut`;
      const init = await runInit({ dir: join(dir, "cut"), example: "copy", tty: false });
      expect(init.exitCode).toBe(EXIT_OK);

      const source = readFileSync(join(dir, "cut", "gen.ts"), "utf8");
      expect(source).toContain('"../../../src/text/measure.ts"');
      expect(source).toContain('new URL("../../..", import.meta.url)');
      expect(source).not.toContain('"../../src/');

      const gen = Bun.spawn(["bun", `${rel}/gen.ts`], {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      });
      const genErr = await new Response(gen.stderr).text();
      expect(`${await gen.exited}\n${genErr}`.slice(0, 400)).toStartWith("0\n");

      for (const command of ["build", "lint", "check", "trace"]) {
        const { out, code } = await cli([command, rel]);
        expect(`${command}: ${code}\n${out}`).toBe(`${command}: 0\n${out}`);
      }
      expect(existsSync(join(ROOT, "dist", rel, "main.js"))).toBe(true);
    },
    600_000,
  );

  test(
    "smoke: no generator, so app.tsx IS copied, and it builds and traces",
    async () => {
      const dir = probeDir("smoke");
      const rel = `compositions/${PROBE}-smoke`;
      const init = await runInit({ dir, example: "smoke", tty: false });
      expect(init.exitCode).toBe(EXIT_OK);
      const payload = init.json as { files: string[]; generated: string[]; next: string[] };
      expect(payload.files).toEqual(["app.tsx", "main.tsx", "pocket-motion.json", "pocket.json"]);
      expect(payload.generated).toEqual([]);
      expect(payload.next[0]).toBe(`bun src/cli/main.ts build ${rel}`);

      for (const command of ["build", "lint", "check"]) {
        const { out, code } = await cli([command, rel]);
        expect(`${command}: ${code}\n${out}`).toBe(`${command}: 0\n${out}`);
      }
      // 450 frames of 1920x1080 is a ledger-sized run; eight is enough to
      // prove the artifact seeks and hashes.
      const { code } = await cli(["trace", rel, "--frames", "8"]);
      expect(code).toBe(EXIT_OK);
    },
    600_000,
  );
});
