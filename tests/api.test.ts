/**
 * `src/api.ts` is the CLI's `--json`, returned instead of written.
 *
 * Each case runs the CLI as a separate process — `bun src/cli/main.ts … --json`,
 * the argv typed by hand rather than produced by `argvOf` — and the API
 * function in this process, on the same composition, with the same
 * `MOTION_RUN_ID`, and requires the two objects to be equal. Typing the argv by
 * hand is what makes the option mapping part of the claim: an option the API
 * spelled wrongly reaches the parser as an unknown flag and comes back as a
 * usage error, which is not equal to the CLI's result.
 *
 * Two fields are allowed to differ and nothing else is: `render`'s `elapsedMs`
 * and `msPerFrame`, which are wall-clock readings of two different runs. The
 * render case names them and asserts every other field equal. `doctor`'s disk
 * line quotes free space, which moves when anything on the volume writes
 * between the two runs; that number is the only thing replaced before the
 * comparison.
 *
 * RED, measured: `call` returning `jsonPayload(result)` without `envelope()` —
 * the shape a hand-written API would most plausibly have — fails eight of the
 * nine parity cases (build, trace, render, verify, assert, layout, doctor, the
 * usage error) and both cancellation cases, because the CLI's object has
 * `$REPO` where the API's has the checkout path, and a `runId` the API's
 * lacks. `render` deriving its identity from
 * `{ ...c, supersample: 2 }` instead of `c` fails "render reports trace's
 * digest and trace's identity" and nothing else: CLI and API agree with each
 * other, so only the cross-command case can see it.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { argvOf, assert, build, concat, doctor, layout, render, trace, verify } from "../src/api.ts";
import { RUN_ID_ENV } from "../src/cli/emit.ts";

const ROOT = resolve(import.meta.dir, "..");
const CLI = join(ROOT, "src/cli/main.ts");
const SMOKE = "compositions/smoke";
/** A composition whose sidecar declares assertions. */
const CODES = "compositions/layout-codes";
const RUN = "api-parity";

const scratch = mkdtempSync(join(tmpdir(), "motion-api-"));
let previousRunId: string | undefined;
let previousCwd: string;

beforeAll(() => {
  previousRunId = process.env[RUN_ID_ENV];
  process.env[RUN_ID_ENV] = RUN;
  // The CLI runs with the checkout as its cwd, so the API does too: a relative
  // composition path means the same directory to both.
  previousCwd = process.cwd();
  process.chdir(ROOT);
});

afterAll(() => {
  if (previousRunId === undefined) delete process.env[RUN_ID_ENV];
  else process.env[RUN_ID_ENV] = previousRunId;
  process.chdir(previousCwd);
  rmSync(scratch, { recursive: true, force: true });
});

/** The CLI as another process: exit code and the one object it printed. */
async function cli(argv: readonly string[]): Promise<{ code: number; json: Record<string, unknown> }> {
  const proc = Bun.spawn(["bun", CLI, ...argv], {
    cwd: ROOT,
    env: { ...process.env, [RUN_ID_ENV]: RUN },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, json: JSON.parse(stdout) as Record<string, unknown> };
}

describe("api — each function returns the object its --json command prints", () => {
  test("build", async () => {
    const fromCli = await cli(["build", SMOKE, "--json"]);
    expect(fromCli.code).toBe(0);
    expect(await build(SMOKE)).toEqual(fromCli.json as never);
  }, 120_000);

  test("trace", async () => {
    const fromCli = await cli(["trace", SMOKE, "--frames", "30", "--json"]);
    expect(fromCli.code).toBe(0);
    expect(fromCli.json.runId).toBe(RUN);
    expect(await trace(SMOKE, { frames: 30 })).toEqual(fromCli.json as never);
  }, 120_000);

  test("render: every field but the two wall-clock readings", async () => {
    const out = join(scratch, "smoke.mp4");
    const fromCli = await cli(["render", SMOKE, "--frames", "30", "--out", out, "--json"]);
    expect(fromCli.code).toBe(0);
    const fromApi = (await render(SMOKE, { frames: 30, out })) as Record<string, unknown>;

    const timing = ["elapsedMs", "msPerFrame"];
    for (const key of timing) {
      expect(typeof fromCli.json[key]).toBe("number");
      expect(typeof fromApi[key]).toBe("number");
    }
    const without = (o: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => !timing.includes(k)));
    expect(without(fromApi)).toEqual(without(fromCli.json));
  }, 120_000);

  test("render reports trace's digest and trace's identity", async () => {
    const traced = (await trace(SMOKE, { frames: 30 })) as Record<string, unknown>;
    const rendered = (await render(SMOKE, {
      frames: 30,
      out: join(scratch, "again.mp4"),
    })) as Record<string, unknown>;
    expect(rendered.ok).toBe(true);
    expect(rendered.digest).toBe(traced.digest as string);
    expect(rendered.identity).toEqual(traced.identity);
  }, 120_000);

  test("render with range, then concat: every field but the wall-clock readings", async () => {
    const timing = ["elapsedMs", "msPerFrame"];
    const without = (o: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => !timing.includes(k)));
    const parts: string[] = [];
    for (const [first, last] of [[0, 14], [15, 29]] as const) {
      const out = join(scratch, `part-${first}.mp4`);
      parts.push(out);
      const fromCli = await cli(["render", SMOKE, "--frames", "30", "--range", `${first}..${last}`, "--out", out, "--json"]);
      expect(fromCli.code).toBe(0);
      const fromApi = (await render(SMOKE, { frames: 30, range: [first, last], out })) as Record<string, unknown>;
      expect(without(fromApi)).toEqual(without(fromCli.json));
    }
    const out = join(scratch, "joined.mp4");
    const fromCli = await cli(["concat", SMOKE, ...parts, "--frames", "30", "--out", out, "--json"]);
    expect(fromCli.code).toBe(0);
    const fromApi = (await concat(SMOKE, parts, { frames: 30, out })) as Record<string, unknown>;
    expect(without(fromApi)).toEqual(without(fromCli.json));
    expect(fromApi.digest).toBe(((await trace(SMOKE, { frames: 30 })) as Record<string, unknown>).digest as string);
  }, 300_000);

  test("verify", async () => {
    const fromCli = await cli(["verify", SMOKE, "--samples", "2", "--strict", "--json"]);
    expect(fromCli.code).toBe(0);
    expect(await verify(SMOKE, { samples: 2, strict: true })).toEqual(fromCli.json as never);
  }, 300_000);

  test("assert", async () => {
    expect((await build(CODES)).ok).toBe(true);
    const fromCli = await cli(["assert", CODES, "--samples", "6", "--json"]);
    expect((fromCli.json.assertions as unknown[]).length).toBeGreaterThan(0);
    expect(await assert(CODES, { samples: 6 })).toEqual(fromCli.json as never);
  }, 120_000);

  test("layout", async () => {
    const fromCli = await cli(["layout", SMOKE, "--at", "12", "--json"]);
    expect(fromCli.code).toBe(0);
    expect(await layout(SMOKE, { at: 12 })).toEqual(fromCli.json as never);
  }, 120_000);

  test("doctor, with only the free-space figure normalised", async () => {
    const free = (o: unknown) =>
      JSON.parse(JSON.stringify(o).replace(/\d+(?:\.\d+)? GiB free/g, "N GiB free"));
    const fromCli = await cli(["doctor", "--json"]);
    // `--json` always exits 0; the verdict is the payload's.
    expect(fromCli.code).toBe(0);
    expect(free(await doctor())).toEqual(free(fromCli.json));
  }, 120_000);

  test("a usage error is the same refusal, exit code included", async () => {
    const fromCli = await cli(["trace", "compositions/no-such-composition", "--json"]);
    expect(fromCli.code).toBe(2);
    expect(fromCli.json.exitCode).toBe(2);
    expect(await trace("compositions/no-such-composition")).toEqual(fromCli.json as never);
  }, 60_000);
});

describe("api — a run that is stopped", () => {
  test("a cancelled render resolves with cancelled: true and leaves no file it wrote", async () => {
    const controller = new AbortController();
    const seen: unknown[] = [];
    const out = join(scratch, "cancelled.mp4");
    const result = (await render(
      SMOKE,
      { out },
      {
        signal: controller.signal,
        onProgress: (p) => {
          seen.push(p);
          if (p.done === 3) controller.abort(new Error("enough"));
        },
      },
    )) as Record<string, unknown>;
    expect(result).toEqual({ ok: false, cancelled: true, error: "render cancelled — enough", runId: RUN });
    expect(seen).toEqual([1, 2, 3].map((done) => ({ done, frames: 450 })));
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(scratch).filter((n) => n.includes(".partial-"))).toEqual([]);
  }, 120_000);

  test("a cancelled trace resolves in trace's failure shape, with cancelled: true", async () => {
    const controller = new AbortController();
    controller.abort("before it started");
    expect(await trace(SMOKE, {}, { signal: controller.signal })).toEqual({
      ok: false,
      frames: [],
      digest: "",
      error: "trace cancelled — before it started",
      cancelled: true,
      runId: RUN,
    } as never);
  }, 60_000);
});

describe("api — the argv a call stands for", () => {
  test("options become --name=value, camelCase becomes kebab-case, false is left out", () => {
    expect(argvOf("render", "c", { out: "o.mov", format: "mov", alpha: true, outDir: undefined })).toEqual([
      "render",
      "c",
      "--out=o.mov",
      "--format=mov",
      "--alpha",
      "--json",
    ]);
    expect(argvOf("verify", "c", { at: [0, 5, 9], strict: false })).toEqual([
      "verify",
      "c",
      "--at=0,5,9",
      "--json",
    ]);
    expect(argvOf("layout", "c", { at: 3, all: true, read: "tick" })).toEqual([
      "layout",
      "c",
      "--at=3",
      "--all",
      "--read=tick",
      "--json",
    ]);
    expect(argvOf("render", "c", { outDir: "jobs", spec: "specs" })).toEqual([
      "render",
      "c",
      "--out-dir=jobs",
      "--spec=specs",
      "--json",
    ]);
  });
});
