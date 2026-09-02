/**
 * The `--json` envelope: what leaves this process, and what does not.
 *
 * Two properties, both enforced in `src/cli/emit.ts` at the one boundary
 * every command's payload passes through:
 *
 * - no absolute path survives. `$REPO` for the checkout, `$HOME` for
 *   anything else under the operator's home directory. The unit cases below
 *   pin the order (the checkout is normally INSIDE the home directory, so
 *   redacting home first would lose the more useful answer) and the spawn
 *   case proves it on a real envelope rather than on a hand-built one.
 * - `MOTION_RUN_ID` is echoed as `runId` when it is set, and the key is
 *   absent when it is not. An absent-vs-empty distinction matters: a shell
 *   exporting an empty variable is not naming a run.
 */

import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { envelope, redactPaths, redactString } from "../src/cli/emit.ts";
import { EXIT_OK } from "../src/cli/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const ROOTS = { repoRoot: "/home/u/checkout", home: "/home/u" };

describe("redaction", () => {
  test("the checkout wins over the home directory it sits in", () => {
    expect(redactString("/home/u/checkout/dist/main.js", ROOTS)).toBe(
      "$REPO/dist/main.js",
    );
    expect(redactString("/home/u/Downloads/clip.mp4", ROOTS)).toBe(
      "$HOME/Downloads/clip.mp4",
    );
  });

  test("a path inside a sentence is redacted too", () => {
    expect(
      redactString("bundle not found: /home/u/checkout/dist/main.js", ROOTS),
    ).toBe("bundle not found: $REPO/dist/main.js");
  });

  test("a path that names neither root is left alone", () => {
    // /usr/local/bin/ffmpeg says what software the machine has, not who runs
    // it. Rewriting it would lose a fact worth reporting and hide nothing.
    expect(redactString("/usr/local/bin/ffmpeg", ROOTS)).toBe("/usr/local/bin/ffmpeg");
    expect(redactString("/tmp/scratch/out.mp4", ROOTS)).toBe("/tmp/scratch/out.mp4");
  });

  test("nested values and object keys are both reached", () => {
    const payload: Record<string, unknown> = {
      files: ["/home/u/checkout/compositions/smoke/main.tsx"],
      byPath: { "/home/u/elsewhere/x.wav": { src: "/home/u/elsewhere/x.wav" } },
      frames: 8,
      ok: true,
      nothing: null,
    };
    expect(redactPaths(payload, ROOTS)).toEqual({
      files: ["$REPO/compositions/smoke/main.tsx"],
      byPath: { "$HOME/elsewhere/x.wav": { src: "$HOME/elsewhere/x.wav" } },
      frames: 8,
      ok: true,
      nothing: null,
    });
  });
});

describe("runId", () => {
  test("absent when the variable is unset or empty", () => {
    expect(envelope({ ok: true }, {}, ROOTS)).toEqual({ ok: true });
    expect(envelope({ ok: true }, { MOTION_RUN_ID: "" }, ROOTS)).toEqual({ ok: true });
  });

  test("echoed verbatim when set", () => {
    expect(envelope({ ok: true }, { MOTION_RUN_ID: "turn-7" }, ROOTS)).toEqual({
      ok: true,
      runId: "turn-7",
    });
  });

  test("a non-object envelope is left as it is", () => {
    // Nothing emits one today; a `runId` grafted onto an array would be a
    // field no reader can address.
    expect(envelope([1, 2], { MOTION_RUN_ID: "turn-7" }, ROOTS)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// The property on a real envelope
// ---------------------------------------------------------------------------

async function jsonOf(
  argv: readonly string[],
  env: Record<string, string> = {},
): Promise<{ text: string; value: Record<string, unknown>; code: number }> {
  const proc = Bun.spawn(["bun", "src/cli/main.ts", ...argv], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, POCKETJS_ROOT: VENDOR, ...env },
  });
  const [text, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return { text, value: JSON.parse(text) as Record<string, unknown>, code };
}

describe("a real --json envelope", () => {
  test("lint --json names no path under the home directory", async () => {
    const { text, value, code } = await jsonOf(["lint", "compositions/smoke", "--json"]);
    expect(code).toBe(EXIT_OK);
    expect(value.ok).toBe(true);
    // The unredacted payload carries the composition's sources and its
    // sidecar as absolute paths, so this is a claim about work being done
    // rather than about there being nothing to redact.
    expect(text).toContain("$REPO/compositions/smoke");
    expect(text).not.toContain(homedir());
    expect(text).not.toContain(ROOT);
  });

  test("a usage refusal is redacted too — the path is inside the message", async () => {
    const { text, value } = await jsonOf([
      "check",
      "compositions/smoke",
      "--bundle=/tmp/pocketjs-motion-emit-test/nope.js",
      "--json",
    ]);
    expect(value.ok).toBe(false);
    expect(String(value.error)).toContain("bundle not found");
    expect(text).not.toContain(homedir());
  });

  test("MOTION_RUN_ID rides along, and is absent without it", async () => {
    const withId = await jsonOf(["lint", "compositions/smoke", "--json"], {
      MOTION_RUN_ID: "phase-g-1",
    });
    expect(withId.value.runId).toBe("phase-g-1");
    const without = await jsonOf(["lint", "compositions/smoke", "--json"]);
    expect("runId" in without.value).toBe(false);
  });
});
