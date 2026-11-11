/**
 * Two checkouts run `bun test ./tests/` at the same moment, and neither one's
 * result depends on the other or on which checkout's engine happened to load.
 *
 * Both used to be false. Tests wrote to fixed `/tmp/pocketjs-motion-*` paths,
 * so one run's `beforeAll` deleted the other's builds mid-file — 14 to 34 false
 * failures a run, each gone when the suite ran alone. And `POCKETJS_ROOT`, when
 * the shell carried it, decided which vendored tree every boot loaded, so a
 * worktree's suite could pass or fail on another checkout's patches. The
 * mechanisms are `tests/scratch.ts` and `tests/preload.ts`; this file holds
 * them from outside, by running `bun test` on a probe the way a person would.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { SCRATCH_ROOT } from "./scratch.ts";

const ROOT = resolve(import.meta.dir, "..");
const PROBE = "./tests/fixtures/isolation-probe.ts";

async function probe(env: Record<string, string | undefined>): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["bun", "test", PROBE], { cwd: ROOT, stdout: "pipe", stderr: "pipe", env });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: `${stdout}\n${stderr}` };
}

describe("scratch", () => {
  test("every run has its own root, under the system temp directory, removed when it ends", async () => {
    const runs = await Promise.all([probe({ ...process.env }), probe({ ...process.env })]);
    const roots = runs.map(({ code, out }) => {
      expect(code, out).toBe(0);
      const root = /scratch root (\S+);/.exec(out)?.[1];
      expect(root, out).toBeDefined();
      return root!;
    });
    expect(new Set([...roots, SCRATCH_ROOT]).size).toBe(3);
    for (const root of roots) {
      expect(root.startsWith(realpathSync(tmpdir()) + "/")).toBe(true);
      expect(existsSync(root), `${root} outlived its run`).toBe(false);
    }
  }, 60_000);

  /**
   * The standing guard. The concurrent run above cannot see a fixed path a
   * test file names, because the probe does not load the test files; reading
   * them can. A string literal naming `/tmp`, or `tmpdir()` used other than as
   * the parent of a `mkdtemp`, is a path two runs share. The literals below
   * are never created — each says why — and an excuse whose literal is gone
   * fails too, so the list cannot outlive what it excuses.
   */
  test("no test names a temp path two runs could share", () => {
    const NEVER_ON_DISK: ReadonlyArray<{ file: string; literal: string; why: string }> = [
      { file: "tests/emit.test.ts", literal: "/tmp/scratch/out.mp4", why: "input to a redaction that must leave it alone" },
      { file: "tests/preview.test.ts", literal: "/tmp/pocketjs-motion-watch-x", why: "text of a faked rm error" },
      { file: "tests/sound.test.ts", literal: "/tmp/fake.wav", why: "a path the mix graph prints and never opens" },
      { file: "tests/spec.test.ts", literal: "/tmp/nope.json", why: "an --out refused before anything is written" },
      { file: "tests/spec.test.ts", literal: "/tmp/copy-job", why: "an --out-dir that is parsed and not used" },
      { file: "tests/tick-rate.test.ts", literal: "/tmp/whatever/main.js", why: "a bundle path a message names" },
    ];
    const self = relative(ROOT, import.meta.path);
    const found = new Set<string>();
    const parts: string[] = [];
    for (const name of readdirSync(join(ROOT, "tests"), { recursive: true }) as string[]) {
      if (!name.endsWith(".ts")) continue;
      const file = join("tests", name);
      if (file === self) continue;
      const src = readFileSync(join(ROOT, file), "utf8");
      const lineOf = (at: number) => src.slice(0, at).split("\n").length;
      // Prose may name a path; only code can write to one.
      const inComment = (at: number) => /^\s*(\*|\/\/|\/\*)/.test(src.split("\n")[lineOf(at) - 1]!);
      for (const m of src.matchAll(/(["'`])((?:\/private)?\/tmp(?:\/[^"'`\n]*)?)\1/g)) {
        if (inComment(m.index)) continue;
        const excuse = NEVER_ON_DISK.find((e) => e.file === file && e.literal === m[2]);
        if (excuse) found.add(`${file} ${m[2]}`);
        else parts.push(`${file}:${lineOf(m.index)}: ${m[0]} — use scratchDir() from tests/scratch.ts`);
      }
      for (const m of src.matchAll(/tmpdir\(\)/g)) {
        if (inComment(m.index)) continue;
        if (/mkdtemp(Sync)?\(join\($/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
        parts.push(`${file}:${lineOf(m.index)}: tmpdir() outside a mkdtemp — use scratchDir() from tests/scratch.ts`);
      }
    }
    for (const e of NEVER_ON_DISK) {
      if (!found.has(`${e.file} ${e.literal}`)) parts.push(`${e.file}: excuses "${e.literal}", which it no longer names`);
    }
    expect(parts, parts.join("\n") || "clean").toEqual([]);
  });
});

describe("POCKETJS_ROOT", () => {
  test("a run that inherits it stops before any test, saying how to run unset", async () => {
    for (const value of [join(SCRATCH_ROOT, "another-checkout", "vendor", "pocketjs"), ""]) {
      const { code, out } = await probe({ ...process.env, POCKETJS_ROOT: value });
      expect(code, out).toBe(1);
      expect(out).toContain(`POCKETJS_ROOT is set (${JSON.stringify(value)})`);
      expect(out).toContain("env -u POCKETJS_ROOT bun test ./tests/");
      expect(out).not.toContain("probe ran");
    }
  }, 60_000);
});
