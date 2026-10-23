/**
 * The envelope, and the one property that makes it worth having.
 *
 * A section is the sub-command's own JSON, verbatim. If it were a summary, or
 * a re-shaped version, the envelope would be a second implementation of every
 * gate inside it — and the second implementation is the one nobody tests. So
 * these compare `verify --json`'s sections against the same commands run
 * alone, object for object.
 *
 * The other property is the exit code: any section red makes `ok:false`, and
 * `--strict` makes an active layout finding count too.
 */

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

import { run as runVerify, countWarnings } from "../src/cli/commands/verify.ts";
import { run as runLint } from "../src/cli/commands/lint.ts";
import { run as runCheck } from "../src/cli/commands/check.ts";
import { run as runKeyframes } from "../src/cli/commands/keyframes.ts";
import { run as runVisibility } from "../src/cli/commands/visibility.ts";
import { run as runLayout } from "../src/cli/commands/layout.ts";
import { run as runAssert } from "../src/cli/commands/assert.ts";
import { applyEmit, envelope } from "../src/cli/emit.ts";
import { runBuild } from "../src/cli/build.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { EXIT_FAIL, EXIT_OK } from "../src/cli/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
process.env.POCKETJS_ROOT = VENDOR;

const FIXTURE = join(ROOT, "compositions", "layout-codes");
const flags = { json: true } as const;

async function build(dir: string): Promise<void> {
  const resolved = await resolveComposition({ dir, flags: { json: false }, requireBundle: false });
  if (!resolved.ok) throw new Error(`${dir} did not resolve`);
  await runBuild(resolved.value);
}

let built = false;
async function ensureBuilt(): Promise<void> {
  if (built) return;
  await build(FIXTURE);
  built = true;
}

interface Envelope {
  ok: boolean;
  runId?: string;
  strict: boolean;
  errors: string[];
  warnings: number;
  layoutFrames: number[];
  lint: unknown;
  realm: unknown;
  keyframes: unknown;
  visibility: unknown;
  layout: unknown[];
  assertions: unknown;
}

describe("verify — the envelope", () => {
  test("every section is the sub-command's own JSON, field for field", async () => {
    await ensureBuilt();
    const result = await runVerify({ dir: FIXTURE, strict: false, flags });
    const env = result.json as Envelope;

    expect(env.lint).toEqual((await runLint({ dir: FIXTURE, flags })).json);
    expect(env.realm).toEqual((await runCheck({ dir: FIXTURE, flags })).json);
    expect(env.keyframes).toEqual(
      (await runKeyframes({ dir: FIXTURE, flags, all: false })).json,
    );
    // `visibility` and `assert` sweep their own default grid, which is why
    // these are comparable without passing a sample count through.
    expect(env.visibility).toEqual(
      (await runVisibility({ dir: FIXTURE, all: false, flags })).json,
    );
    expect(env.assertions).toEqual((await runAssert({ dir: FIXTURE, flags })).json);

    expect(env.layout.length).toBe(env.layoutFrames.length);
    for (const [i, at] of env.layoutFrames.entries()) {
      expect(env.layout[i]).toEqual(
        (await runLayout({ dir: FIXTURE, at, all: false, flags })).json,
      );
    }
  }, 600_000);

  test("a red sub-gate makes the envelope red, and names which one", async () => {
    await ensureBuilt();
    const result = await runVerify({ dir: FIXTURE, strict: false, flags });
    const env = result.json as Envelope;
    // `compositions/layout-codes` buries a named node on purpose, so
    // `visibility` is the red section and the other five are green.
    expect(env.errors).toEqual(["visibility"]);
    expect(env.ok).toBe(false);
    expect(result.exitCode).toBe(EXIT_FAIL);
    // The section's own verdict is what decided it — not a second reading.
    expect((env.visibility as { ok: boolean }).ok).toBe(false);
  }, 600_000);

  test("--strict counts an active layout finding as well", async () => {
    await ensureBuilt();
    const loose = (await runVerify({ dir: FIXTURE, strict: false, flags })).json as Envelope;
    const strict = (await runVerify({ dir: FIXTURE, strict: true, flags })).json as Envelope;
    expect(loose.warnings).toBeGreaterThan(0);
    expect(strict.warnings).toBe(loose.warnings);
    expect(strict.strict).toBe(true);
    expect(loose.strict).toBe(false);
    // Both are red here because `visibility` is; the difference `--strict`
    // makes is proved on `compositions/smoke`, which has no red section.
    expect(strict.ok).toBe(false);
  }, 600_000);

  test("on a clean composition --strict is the only thing warnings can change", async () => {
    await build(join(ROOT, "compositions", "smoke"));
    const dir = join(ROOT, "compositions", "smoke");
    const loose = await runVerify({ dir, strict: false, samples: 2, flags });
    expect((loose.json as Envelope).errors).toEqual([]);
    expect(loose.exitCode).toBe(EXIT_OK);
    const env = loose.json as Envelope;
    // Recorded rather than asserted to be nonzero: `smoke` has no findings at
    // these frames, and that is the state this line exists to notice changing.
    expect(env.warnings).toBe(0);
    const strict = await runVerify({ dir, strict: true, samples: 2, flags });
    expect(strict.exitCode).toBe(EXIT_OK);
  }, 600_000);

  test("MOTION_RUN_ID is echoed by the emit layer, not by this command", async () => {
    await ensureBuilt();
    const env = (await runVerify({ dir: FIXTURE, strict: false, samples: 1, flags }))
      .json as Envelope;
    // Not in the payload the command builds: `applyEmit` attaches it to every
    // `--json` envelope this CLI writes, and a second copy here would be the
    // same rule in two places.
    expect("runId" in env).toBe(false);
    expect(envelope(env, { MOTION_RUN_ID: "run-42" })).toMatchObject({ runId: "run-42" });
    expect("runId" in (envelope(env, {}) as object)).toBe(false);
  }, 600_000);

  test("--at and --samples together is a usage error", async () => {
    await expect(
      runVerify({ dir: FIXTURE, at: [0], samples: 2, strict: false, flags }),
    ).rejects.toThrow(/name the same thing two ways/);
  });

  test("--at decides the layout frames and nothing else", async () => {
    await ensureBuilt();
    const env = (await runVerify({ dir: FIXTURE, at: [0, 29], strict: false, flags }))
      .json as Envelope;
    expect(env.layoutFrames).toEqual([0, 29]);
    expect(env.layout.length).toBe(2);
  }, 600_000);

  test("--read tick reaches every pixel section, and each says it read the tick", async () => {
    // `compositions/shutter-blur` declares a shutter, and its `peek` is in every
    // exposure and covered at every tick — so a section that ignored `read`
    // would come back green where a tick reading is red.
    const dir = join(ROOT, "compositions", "shutter-blur");
    await build(dir);
    const env = (await runVerify({ dir, at: [45], strict: false, read: "tick", flags }))
      .json as Envelope & { read?: string };
    const readOf = (section: unknown) => (section as { read?: string }).read;
    expect(env.read).toBe("tick");
    expect([readOf(env.visibility), readOf(env.layout[0]), readOf(env.assertions)]).toEqual([
      "tick",
      "tick",
      "tick",
    ]);
    expect(env.errors).toEqual(["visibility", "assertions"]);
    expect((env.assertions as { failures: string[] }).failures).toEqual(["peek inPicture"]);
  }, 600_000);
});

describe("verify — the --json write survives a reader that does not drain", () => {
  /**
   * The envelope is a multi-hundred-KB object and a pipe accepts 64 KiB before
   * exerting backpressure. `process.stdout.write` queues the rest and returns,
   * so a `process.exit` at that moment truncates the object mid-string — which
   * is what happened to `trace` on a composition of film length, and to the
   * digest ledger reading it. `src/cli/emit.ts` awaits the write to the OS
   * before the caller may exit; this holds the envelope to that path by not
   * reading until the pipe has had time to fill.
   */
  test("the whole object arrives and parses", async () => {
    await ensureBuilt();
    const proc = Bun.spawn(
      ["bun", "src/cli/main.ts", "verify", "compositions/layout-codes", "--samples", "24", "--json"],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, POCKETJS_ROOT: VENDOR } },
    );
    // Long enough for the writer to fill the pipe buffer and block.
    await Bun.sleep(400);
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(code).toBe(1); // `visibility` is red on this fixture by construction
    // The claim is only worth making if the payload is bigger than one pipe
    // buffer. If this ever shrinks below 64 KiB the test is not testing the
    // thing it says it is.
    expect(out.length).toBeGreaterThan(65_536);
    const env = JSON.parse(out) as Envelope;
    expect(env.errors).toEqual(["visibility"]);
    expect(env.layout.length).toBeGreaterThan(0);
  }, 600_000);
});

/**
 * The property the spawn test above cannot reach on this platform.
 *
 * Tried and recorded rather than assumed: removing the `await` from
 * `applyEmit` and re-running the spawn test leaves it GREEN on Bun 1.3.11 /
 * darwin, because the write to a pipe blocks there rather than queuing. So the
 * spawn test proves the envelope arrives whole and proves nothing about WHY —
 * and a guard whose regression cannot be made to fail it is an assertion about
 * a guard. This is the seam that can: `applyEmit` must not resolve until the
 * write has been acknowledged, whatever the platform does with the pipe.
 */
describe("emit — the write is awaited before a caller may exit", () => {
  test("applyEmit does not resolve until the write callback fires", async () => {
    const real = process.stdout.write.bind(process.stdout);
    let fire: (() => void) | null = null;
    let resolved = false;
    try {
      (process.stdout as unknown as { write: unknown }).write = (
        _chunk: string,
        cb?: (err?: Error | null) => void,
      ): boolean => {
        fire = () => cb?.(null);
        return false; // queued: exactly what a full pipe buffer reports
      };
      const pending = applyEmit({ exitCode: 0, json: { ok: true } }, true).then(() => {
        resolved = true;
      });
      await Bun.sleep(20);
      expect(resolved).toBe(false);
      expect(fire).not.toBeNull();
      fire!();
      await pending;
      expect(resolved).toBe(true);
    } finally {
      (process.stdout as unknown as { write: unknown }).write = real;
    }
  });
});

describe("countWarnings", () => {
  test("sums the active findings over the sampled frames", () => {
    expect(
      countWarnings([
        { findingCounts: { content_overlap: 2, clipped_text: 1 } },
        { findingCounts: {} },
        { findingCounts: { text_occluded: 3 } },
      ]),
    ).toBe(6);
  });

  test("a section that failed before it could count carries none", () => {
    expect(countWarnings([{ ok: false, error: "no bundle" }, null])).toBe(0);
  });
});
