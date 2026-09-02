/**
 * CLI acceptance tests — drive commands as functions; one e2e spawn for wiring.
 *
 * Build outputs live under /tmp (same convention as existing suites). No
 * committed binaries.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { run as runCheck } from "../src/cli/commands/check.ts";
import { run as runDiff } from "../src/cli/commands/diff.ts";
import { run as runLint } from "../src/cli/commands/lint.ts";
import {
  CODE_IMAGE_MISSING,
  lintImages,
  stringLiterals,
} from "../src/lint/images.ts";
import { discoverCompositions } from "../src/cli/discover.ts";
import { runGenerators } from "../src/cli/generators.ts";
import {
  flattenTree,
  isNotInPicture,
  run as runLayout,
} from "../src/cli/commands/layout.ts";
import { encodeScaleTo } from "../src/cli/commands/render.ts";
import { run as runTrace } from "../src/cli/commands/trace.ts";
import { helpText, main } from "../src/cli/main.ts";
import {
  buildSpawn,
  densityMismatch,
  quoteArg,
  repoRootOf,
  resolveComposition,
} from "../src/cli/resolve.ts";
import { writeBuildRecord } from "../src/render/build-record.ts";
import { createEncodeSink, ffmpegArgs } from "../src/render/encode.ts";
import { FINDING_CODES } from "../src/render/findings.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  isTraceJson,
  type TraceJson,
} from "../src/cli/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const SMOKE_DIR = join(ROOT, "compositions", "smoke");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const TMP = "/tmp/pocketjs-motion-cli-test";
const DIST = join(TMP, "dist");
const BUNDLE = join(DIST, "main.js");
const PAK = join(DIST, "main.pak");

/** Negative fixture for the pending-work half of the verdict. */
const LATE_TIMER_DIR = join(ROOT, "compositions", "late-timer");
const LATE_TIMER_DIST = join(TMP, "dist-late-timer");
const LATE_TIMER_BUNDLE = join(LATE_TIMER_DIST, "main.js");
const LATE_TIMER_PAK = join(LATE_TIMER_DIST, "main.pak");

/** A buried caption in three nodes: one named Text under an opaque lid. */
const OCCLUDED_DIR = join(ROOT, "compositions", "occluded");
const OCCLUDED_DIST = join(TMP, "dist-occluded");
const OCCLUDED_BUNDLE = join(OCCLUDED_DIST, "main.js");
const OCCLUDED_PAK = join(OCCLUDED_DIST, "main.pak");

/** One named node per `src/render/findings.ts` code, plus one excused. */
const LAYOUT_CODES_DIR = join(ROOT, "compositions", "layout-codes");
const LAYOUT_CODES_DIST = join(TMP, "dist-layout-codes");
const LAYOUT_CODES_BUNDLE = join(LAYOUT_CODES_DIST, "main.js");
const LAYOUT_CODES_PAK = join(LAYOUT_CODES_DIST, "main.pak");

// Point boot at the vendored tree (patched) rather than a sibling checkout.
process.env.POCKETJS_ROOT = VENDOR;

function smokeFlags(extra: Record<string, string | number | boolean> = {}) {
  return {
    json: false,
    bundle: BUNDLE,
    pak: PAK,
    // Keep trace/check fast — the full 450 frames is a ledger-sized run.
    frames: 8,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Build smoke once
// ---------------------------------------------------------------------------

async function buildComposition(
  entryDir: string,
  outdir: string,
  bundle: string,
): Promise<void> {
  const argv = [
    "bun",
    join(VENDOR, "tools", "build.ts"),
    join(entryDir, "main.tsx"),
    `--outdir=${outdir}`,
    "--framework=solid",
    "--no-config",
  ];
  const proc = Bun.spawn(argv, {
    cwd: VENDOR,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, POCKETJS_ROOT: VENDOR },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 || !existsSync(bundle)) {
    throw new Error(
      `${entryDir} build failed (${code})\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
  }
  // Every command that reads a bundle refuses one with no `build.json` beside
  // it, so a fixture built by hand records what `runBuild` would have.
  await writeBuildRecord(outdir, argv);
}

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  mkdirSync(LATE_TIMER_DIST, { recursive: true });
  mkdirSync(OCCLUDED_DIST, { recursive: true });
  mkdirSync(LAYOUT_CODES_DIST, { recursive: true });

  if (!existsSync(join(VENDOR, "tools", "build.ts"))) {
    throw new Error(
      `vendor pocketjs missing at ${VENDOR} — run bun scripts/vendor.ts`,
    );
  }

  await buildComposition(SMOKE_DIR, DIST, BUNDLE);
  await buildComposition(LATE_TIMER_DIR, LATE_TIMER_DIST, LATE_TIMER_BUNDLE);
  await buildComposition(OCCLUDED_DIR, OCCLUDED_DIST, OCCLUDED_BUNDLE);
  await buildComposition(LAYOUT_CODES_DIR, LAYOUT_CODES_DIST, LAYOUT_CODES_BUNDLE);
}, 240_000);

afterAll(() => {
  // Leave /tmp artifacts for inspection on failure; always clean on success path.
  // Tests re-create on next run via beforeAll.
});

// ---------------------------------------------------------------------------
// lint
// ---------------------------------------------------------------------------

describe("lint", () => {
  test("good composition → exit 0, zero findings", async () => {
    const result = await runLint({
      dir: SMOKE_DIR,
      flags: { json: true },
    });
    expect(result.exitCode).toBe(EXIT_OK);
    const json = result.json as {
      ok: boolean;
      findings: unknown[];
      diagnostics: unknown[];
    };
    expect(json.ok).toBe(true);
    expect(json.findings).toHaveLength(0);
    expect(json.diagnostics).toHaveLength(0);
  });

  test("composition importing onFrame → exit 1, finding code present", async () => {
    const badDir = join(TMP, "bad-onframe");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(
      join(badDir, "pocket-motion.json"),
      JSON.stringify({ motion: 1, durationFrames: 30, fps: 30 }),
    );
    writeFileSync(
      join(badDir, "main.tsx"),
      `import { onFrame } from "@pocketjs/framework/frame";\nexport default function App() { return null; }\n`,
    );

    const result = await runLint({
      dir: badDir,
      flags: { json: true },
    });
    expect(result.exitCode).toBe(EXIT_FAIL);
    const json = result.json as {
      ok: boolean;
      findings: Array<{ code: string; message: string }>;
    };
    expect(json.ok).toBe(false);
    expect(json.findings.some((f) => f.code === "mountOnly.forbiddenImport")).toBe(
      true,
    );
    expect(json.findings.some((f) => f.message.includes("onFrame"))).toBe(true);
  });

  test("a referenced image with no file is a finding, and `check` refuses before booting", async () => {
    // The fixture is the red case: upstream bakes a 32×32 checkerboard for
    // `wordmark.png` and the build succeeds, so `trace` is green on it and the
    // digest is stable and reproducible with the mark missing. These two
    // commands are the only ones that refuse.
    const dir = join(ROOT, "compositions", "missing-image");
    const lint = await runLint({ dir, flags: { json: true } });
    expect(lint.exitCode).toBe(EXIT_FAIL);
    const lintJson = lint.json as {
      findings: Array<{ code: string; file: string; message: string }>;
    };
    const missing = lintJson.findings.filter((f) => f.code === CODE_IMAGE_MISSING);
    expect(missing).toHaveLength(1);
    expect(missing[0]!.file).toBe(join(dir, "main.tsx"));
    expect(missing[0]!.message).toContain("wordmark.png");
    // Every place the build would have looked, so the message is actionable.
    expect(missing[0]!.message).toContain(join(dir, "wordmark.png"));
    expect(missing[0]!.message).toContain(join(VENDOR, "assets/images/wordmark.png"));

    const missingDist = join(TMP, "dist-missing-image");
    mkdirSync(missingDist, { recursive: true });
    await buildComposition(dir, missingDist, join(missingDist, "main.js"));
    const check = await runCheck({
      dir,
      flags: {
        json: true,
        bundle: join(missingDist, "main.js"),
        pak: join(missingDist, "main.pak"),
        frames: 2,
      },
    });
    expect(check.exitCode).toBe(EXIT_FAIL);
    expect((check.json as { error?: string }).error).toBe("referenced image not on disk");
  });

  test("the same scan passes every other composition in the tree", async () => {
    // Every composition, from the same discovery the ledger and preview's rail
    // use — the list this swept used to be written out by hand, and
    // `compositions/glow` was not on it while carrying exactly the shape below.
    //
    // GENERATORS FIRST. `compositions/glow` and `compositions/glow-column`
    // bake their glow plates to PNG and `.gitignore` ignores `*.png`, so on a
    // fresh checkout those files exist only after `gen.ts` has run. CI run
    // 33606149934 is what assuming otherwise cost: `bun test` runs before
    // `bun scripts/digests.ts`, so this was the one red test on Linux while
    // every local tree had the plates from its last ledger run. The lint is
    // right that a referenced image with no file is a defect; what was wrong
    // was scanning a half-built tree. `runGenerators` is the ledger's own
    // invocation (`src/cli/generators.ts`), not a copy of it.
    const { dirs } = await discoverCompositions(ROOT);
    await runGenerators(ROOT, dirs);

    // The discovery is upstream's, and a stricter one would be red on
    // compositions that build and render correctly. Two shapes prove it:
    // `compositions/lower-third/gen.ts` names "logo.png" and "logo.svg" as job
    // template strings and is not in the build's module graph, and
    // `compositions/copy/images.json` carries metadata for glow plates that
    // exist only when a job asks for them. Both are swept below, and named
    // here so the sweep cannot stop covering them quietly.
    for (const name of ["lower-third", "copy", "probe", "glow", "glow-column", "reel"]) {
      expect(dirs, name).toContain(`compositions/${name}`);
    }

    // `missing-image` is the fixture the test above pins; every other
    // composition in the tree has a file behind every image it names.
    for (const dir of dirs) {
      if (dir === "compositions/missing-image") continue;
      const abs = join(ROOT, dir);
      const findings = await lintImages({
        entryPath: join(abs, "main.tsx"),
        compositionDir: abs,
      });
      expect(findings.map((f) => f.message), dir).toEqual([]);
    }
    // …and the literal scanner is the reason: a path in a comment, and one
    // assembled at runtime, are not declarations.
    const seen = stringLiterals(
      'const a = "real.png"; // "commented.png"\nconst b = `built-${x}.png`;\n',
    ).map((l) => l.value);
    expect(seen).toContain("real.png");
    expect(seen).not.toContain("commented.png");
    expect(seen.some((v) => v.includes("built-"))).toBe(false);
  });

  test("malformed sidecar → exit 1, diagnostic path present", async () => {
    const badDir = join(TMP, "bad-sidecar");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(
      join(badDir, "pocket-motion.json"),
      JSON.stringify({ motion: 1, durationFrames: 30, fps: 7 /* not divisor of 60 */ }),
    );
    writeFileSync(join(badDir, "main.tsx"), `export default function A() { return null; }\n`);

    const result = await runLint({
      dir: badDir,
      flags: { json: true },
    });
    expect(result.exitCode).toBe(EXIT_FAIL);
    const json = result.json as {
      ok: boolean;
      diagnostics: Array<{ code: string; path: string }>;
    };
    expect(json.ok).toBe(false);
    expect(json.diagnostics.length).toBeGreaterThan(0);
    expect(json.diagnostics.some((d) => d.path === "/fps")).toBe(true);
    expect(json.diagnostics.some((d) => d.code.includes("fps"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

describe("check", () => {
  test("smoke composition → exit 0, mountOnly: true", async () => {
    const result = await runCheck({
      dir: SMOKE_DIR,
      flags: smokeFlags({ json: true }),
    });
    expect(result.exitCode).toBe(EXIT_OK);
    const json = result.json as {
      ok: boolean;
      mountOnly: boolean;
      realmClean: boolean;
      totalOps: number;
      pendingWork: Record<string, number> | null;
    };
    expect(json.ok).toBe(true);
    expect(json.mountOnly).toBe(true);
    expect(json.realmClean).toBe(true);
    expect(json.totalOps).toBe(0);

    // The structural half. `null` would mean the bundle predates patches/0003,
    // which is "cannot tell" and must not read as clean.
    expect(json.pendingWork).not.toBeNull();
    expect(json.pendingWork).toEqual({
      frameHooks: 0,
      timers: 0,
      effectsPending: 0,
      effectsQueued: 0,
      servicePumps: 0,
    });
  }, 60_000);

  /**
   * The fixture that found two holes, now the regression test for both.
   *
   * A timer booked for frame 600 issues no ops in any window `check` observes —
   * not a tuning problem, since the deadline is a free parameter — and its
   * import sits in `app.tsx`, which `check` did not read until it linted the
   * whole composition rather than the entry alone.
   *
   * Both are closed, and the assertion is that they are closed INDEPENDENTLY:
   * the structural half and the static half each catch this on their own, so
   * neither is load-bearing for the other.
   */
  test("late timer in a non-entry module → caught twice, independently", async () => {
    const result = await runCheck({
      dir: LATE_TIMER_DIR,
      flags: {
        json: true,
        bundle: LATE_TIMER_BUNDLE,
        pak: LATE_TIMER_PAK,
        frames: 8,
      },
    });

    const json = result.json as {
      ok: boolean;
      mountOnly: boolean;
      totalOps: number;
      staticFindings: { code: string; file: string; message: string }[];
      pendingWork: Record<string, number> | null;
    };

    // The ops oracle still reports clean, and always will — this is the
    // property no finite observation window can decide.
    expect(json.mountOnly).toBe(true);
    expect(json.totalOps).toBe(0);

    // Structural half: the framework is holding a timer.
    expect(json.pendingWork?.timers).toBe(1);

    // Static half: the forbidden import, found in a module that is not the
    // entry, classified as an import rather than a bare identifier, and naming
    // the module it came from.
    expect(json.staticFindings).toHaveLength(1);
    expect(json.staticFindings[0]!.code).toBe("mountOnly.forbiddenImport");
    expect(json.staticFindings[0]!.file).toMatch(/app\.tsx$/);
    expect(json.staticFindings[0]!.message).toContain("@pocketjs/framework/clock");

    expect(json.ok).toBe(false);
    expect(result.exitCode).toBe(EXIT_FAIL);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// trace + diff
// ---------------------------------------------------------------------------

describe("trace + diff", () => {
  test("digest is stable across two runs of the same composition", async () => {
    const a = await runTrace({
      dir: SMOKE_DIR,
      flags: smokeFlags({ json: true }),
    });
    const b = await runTrace({
      dir: SMOKE_DIR,
      flags: smokeFlags({ json: true }),
    });
    expect(a.exitCode).toBe(EXIT_OK);
    expect(b.exitCode).toBe(EXIT_OK);
    const ta = a.json as TraceJson;
    const tb = b.json as TraceJson;
    expect(isTraceJson(ta)).toBe(true);
    expect(isTraceJson(tb)).toBe(true);
    expect(ta.digest).toBe(tb.digest);
    expect(ta.frames).toEqual(tb.frames);
    expect(ta.identity).toBeDefined();
    expect(tb.identity).toBeDefined();
    expect(ta.identity!.digest).toBe(tb.identity!.digest);
    expect(ta.identity!.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(ta.identity!.components.bundle).toBeDefined();
    expect(ta.identity!.components.params).toBeDefined();
    expect(ta.identity!.components.toolchain).toBeDefined();
    const keys = Object.keys(ta.identity!.components);
    expect(keys).toEqual([...keys].sort());
  }, 120_000);

  test("human trace prints identity after digest", async () => {
    const result = await runTrace({
      dir: SMOKE_DIR,
      flags: smokeFlags({ json: false }),
    });
    expect(result.exitCode).toBe(EXIT_OK);
    const lines = result.stdoutLines ?? [];
    expect(lines[0]).toMatch(/^trace ok — /);
    expect(lines[1]).toMatch(/^digest [0-9a-f]{64}$/);
    expect(lines[2]).toMatch(/^identity [0-9a-f]{64}$/);
  }, 60_000);

  test("trace --json feeds diff unchanged; identical traces exit 0", async () => {
    const traced = await runTrace({
      dir: SMOKE_DIR,
      flags: smokeFlags({ json: true }),
    });
    expect(traced.exitCode).toBe(EXIT_OK);
    const trace = traced.json as TraceJson;
    expect(isTraceJson(trace)).toBe(true);

    const pathA = join(TMP, "trace-a.json");
    const pathB = join(TMP, "trace-b.json");
    // Round-trip exactly what --json would print.
    writeFileSync(pathA, JSON.stringify(trace));
    writeFileSync(pathB, JSON.stringify(trace));

    const diff = await runDiff({
      aPath: pathA,
      bPath: pathB,
      flags: { json: true },
    });
    expect(diff.exitCode).toBe(EXIT_OK);
    const json = diff.json as { identical: boolean; firstDivergence: null };
    expect(json.identical).toBe(true);
    expect(json.firstDivergence).toBeNull();
  }, 60_000);

  test("diff on two traces that differ → exit 1, correct first divergent index", async () => {
    const traced = await runTrace({
      dir: SMOKE_DIR,
      flags: smokeFlags({ json: true, frames: 6 }),
    });
    expect(traced.exitCode).toBe(EXIT_OK);
    const base = traced.json as TraceJson;
    expect(base.frames.length).toBe(6);

    const divergeAt = 3;
    const mutated: TraceJson = {
      digest: "mutated-for-test",
      frames: base.frames.map((h, i) =>
        i === divergeAt ? "0".repeat(64) : h,
      ),
    };

    const pathA = join(TMP, "diff-a.json");
    const pathB = join(TMP, "diff-b.json");
    writeFileSync(pathA, JSON.stringify(base));
    writeFileSync(pathB, JSON.stringify(mutated));

    const diff = await runDiff({
      aPath: pathA,
      bPath: pathB,
      flags: { json: true },
    });
    expect(diff.exitCode).toBe(EXIT_FAIL);
    const json = diff.json as {
      identical: boolean;
      firstDivergence: number;
      hashA: string;
      hashB: string;
    };
    expect(json.identical).toBe(false);
    expect(json.firstDivergence).toBe(divergeAt);
    expect(json.hashA).toBe(base.frames[divergeAt]!);
    expect(json.hashB).toBe("0".repeat(64));
  }, 60_000);
});

// ---------------------------------------------------------------------------
// flags / --json contract / help
// ---------------------------------------------------------------------------

describe("invocation contract", () => {
  test("bad flag → exit 2", async () => {
    const code = await main(["lint", SMOKE_DIR, "--not-a-real-flag"]);
    expect(code).toBe(EXIT_USAGE);
  });

  test("missing command arg → exit 2", async () => {
    const code = await main(["lint"]);
    expect(code).toBe(EXIT_USAGE);
  });

  test("--json mode emits exactly one parseable object and no stray output", async () => {
    // Capture stdout by spawning so we see the true I/O contract.
    const proc = Bun.spawn(
      [
        "bun",
        join(ROOT, "src/cli/main.ts"),
        "lint",
        SMOKE_DIR,
        "--json",
      ],
      {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, POCKETJS_ROOT: VENDOR },
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code).toBe(EXIT_OK);
    // Exactly one JSON value: trim trailing newline, then parse once.
    const trimmed = stdout.replace(/\n$/, "");
    expect(() => JSON.parse(trimmed)).not.toThrow();
    const obj = JSON.parse(trimmed) as { ok: boolean };
    expect(obj.ok).toBe(true);
    // No second JSON document / no human lines mixed in.
    expect(trimmed.split("\n")).toHaveLength(1);
    // Diagnostics may be empty for a clean lint; stderr must not be JSON-mixed.
    if (stderr.length > 0) {
      expect(() => JSON.parse(stderr)).toThrow();
    }
  });

  test("--help lists every command with one line each", () => {
    const text = helpText();
    for (const name of ["lint", "check", "render", "trace", "frame", "diff", "sound", "preview"]) {
      expect(text).toContain(name);
    }
    // one descriptive fragment per command
    expect(text).toContain("mount-only");
    expect(text).toContain("frame-hash");
    expect(text).toContain("divergent");
  });
});

// ---------------------------------------------------------------------------
// supersample — the two rules that make it mean anything
// ---------------------------------------------------------------------------

describe("supersample", () => {
  test("the encode leg is told the declared viewport, and only when supersampled", () => {
    // The whole defect was that nobody passed this: renderScale reached the
    // frame source, scaleTo never reached ffmpeg, and the MP4 shipped at N×
    // under a sidecar that declared otherwise.
    expect(encodeScaleTo({ width: 1920, height: 1080, supersample: 2 })).toEqual([1920, 1080]);
    expect(encodeScaleTo({ width: 1920, height: 1080, supersample: 4 })).toEqual([1920, 1080]);
    expect(encodeScaleTo({ width: 1920, height: 1080, supersample: 1 })).toBeUndefined();
  });

  test("an abandoned encode does not leave ffmpeg holding the pipe", async () => {
    // ffmpeg reads frames from stdin, so a render that stops early leaves it
    // waiting on a pipe nobody will write to again. Measured before this
    // existed: SIGTERM then await exited hung past five seconds with the
    // process still resident, because it is blocked on the read.
    const out = join(TMP, "abandoned.mp4");
    const sink = createEncodeSink({
      width: 320,
      height: 180,
      fps: 30,
      outputPath: out,
      preset: "veryfast",
      crf: 23,
    });
    const frame = new Uint8Array(320 * 180 * 4).fill(64);
    for (let i = 0; i < 8; i++) await sink.write(frame);

    const raced = await Promise.race([
      sink.abort().then(() => "aborted"),
      Bun.sleep(10_000).then(() => "hung"),
    ]);
    expect(raced).toBe("aborted");

    const alive = Bun.spawnSync(["pgrep", "-f", out]).stdout.toString().trim();
    expect(alive).toBe("");
  }, 30_000);

  test("that viewport reaches ffmpeg as a pinned area downscale", () => {
    // area, not lanczos: `scaleTo` is only ever an exact integer downscale, and
    // lanczos rings on the hard edges this renderer emits. At an edge covering
    // 75% of its pixel, area gives the exact box average (128 + 0.75*127 = 223)
    // and lanczos gives 221 with 121 on both sides, against a 128 background.
    const args = ffmpegArgs({
      width: 3840,
      height: 2160,
      fps: 30,
      outputPath: "/dev/null",
      scaleTo: encodeScaleTo({ width: 1920, height: 1080, supersample: 2 }),
    });
    expect(args).toContain("-vf");
    expect(args).toContain("scale=1920:1080:flags=area");
    expect(args.join(" ")).not.toContain("lanczos");
    // The input is still the supersampled buffer — the hash covers that.
    expect(args.join(" ")).toContain("-s 3840x2160");
  });

  test("no filter at all when the render is not supersampled", () => {
    const args = ffmpegArgs({
      width: 1920,
      height: 1080,
      fps: 30,
      outputPath: "/dev/null",
      scaleTo: encodeScaleTo({ width: 1920, height: 1080, supersample: 1 }),
    });
    expect(args).not.toContain("-vf");
  });

  const header = (density: number, slot = 14) => ({
    slot,
    cellW: 37,
    cellH: 45,
    baseline: 35,
    lineHeight: 45,
    density,
    bold: false,
    codepoints: new Set<number>([0x41]),
  });

  test("a pak baked at another density is a mismatch; a pak with no atlas is not", () => {
    expect(densityMismatch(new Map([[14, header(1)]]), 1)).toBeNull();
    expect(densityMismatch(new Map([[14, header(2)]]), 2)).toBeNull();
    expect(densityMismatch(new Map([[14, header(1)]]), 2)?.density).toBe(1);
    expect(densityMismatch(new Map([[14, header(2)]]), 1)?.density).toBe(2);
    // A composition with no text has no atlas to disagree — geometry is free.
    expect(densityMismatch(new Map(), 4)).toBeNull();
  });

  test("resolve refuses a real density-1 pak at --supersample 2, naming --density", async () => {
    // The silent version of this renders fine, hashes stably, and draws every
    // glyph as a rescaled copy of a cell baked for another density.
    const result = await resolveComposition({
      dir: SMOKE_DIR,
      flags: smokeFlags({ supersample: 2 }),
      requireBundle: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("usage");
    expect(result.message).toContain("density 1");
    expect(result.message).toContain("supersample 2");
    expect(result.message).toContain("--density=2");
  });

  test("and accepts the same pak at the supersample it was baked for", async () => {
    const result = await resolveComposition({
      dir: SMOKE_DIR,
      flags: smokeFlags(),
      requireBundle: true,
    });
    expect(result.ok).toBe(true);
  });

  test("two compositions ending in the same segment do not share a dist directory", async () => {
    // Keyed on the last segment, two cuts whose paths differ only above it
    // resolve to ONE directory, so a build of either writes over the other's
    // bundle — and `trace` does not build, so the second one traced reports
    // the first one's pixels under its own name. `compositions/nested/a/9x16`
    // and `compositions/nested/b/9x16` are that shape on purpose: same
    // basename, same `compositionId`, same dist root, different pictures. The
    // ledger holds both digests, so the collision is visible from two sides.
    const REPO = resolve(import.meta.dir, "..");
    const dirs = [
      "compositions/nested/a/9x16",
      "compositions/nested/b/9x16",
      "compositions/footage-tracks",
      "compositions/sound-roles",
    ];
    const seen = new Map<string, string>();
    for (const d of dirs) {
      const result = await resolveComposition({
        dir: join(REPO, d),
        flags: { json: false },
        requireBundle: false,
      });
      expect(result.ok, `${d} resolves`).toBe(true);
      if (!result.ok) return;
      const dist = result.value.distDir;
      expect(
        seen.get(dist),
        `${d} shares a dist directory with ${seen.get(dist)}`,
      ).toBeUndefined();
      seen.set(dist, d);
    }
    expect(seen.size).toBe(dirs.length);

    // …and the pair really is the shape the key exists for. Without this the
    // test above passes on any four distinct compositions and says nothing
    // about the last segment at all.
    const [a, b] = await Promise.all(
      (["compositions/nested/a/9x16", "compositions/nested/b/9x16"] as const).map((d) =>
        resolveComposition({ dir: join(REPO, d), flags: { json: false }, requireBundle: false }),
      ),
    );
    if (a === undefined || b === undefined) throw new Error("both cuts resolve");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(basename(a.value.dir)).toBe(basename(b.value.dir));
    expect(a.value.compositionId).toBe(b.value.compositionId);
    expect(dirname(a.value.distDir)).not.toBe(dirname(b.value.distDir));
    // One dist ROOT for the whole repository, two directories under it.
    expect(resolve(a.value.distDir, "../../../..")).toBe(join(REPO, "dist"));
    expect(resolve(b.value.distDir, "../../../..")).toBe(join(REPO, "dist"));
  });

  test("a nested cut builds under the repository's dist, not inside compositions/", async () => {
    // The dist root used to be a fixed `<dir>/../../dist`, so it moved with
    // the composition's depth: `compositions/nested/a/9x16` built into
    // `compositions/nested/dist/a/9x16` — inside the source tree preview
    // watches, and not where any prose said. One root, keyed by the
    // composition's path relative to the repository.
    const REPO = resolve(import.meta.dir, "..");
    const result = await resolveComposition({
      dir: join(REPO, "compositions/nested/a/9x16"),
      flags: { json: false },
      requireBundle: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.distDir).toBe(
      join(REPO, "dist", "compositions", "nested", "a", "9x16"),
    );
    expect(relative(REPO, result.value.distDir).split(sep)[0]).toBe("dist");
    // …and the same for the flat shape, which this change must not move.
    const flat = await resolveComposition({
      dir: join(REPO, "compositions/smoke"),
      flags: { json: false },
      requireBundle: false,
    });
    expect(flat.ok).toBe(true);
    if (!flat.ok) return;
    expect(flat.value.distDir).toBe(join(REPO, "dist", "compositions", "smoke"));
    // The build command carries the same directory: an --outdir copied out of
    // prose is what sends an artifact to a root nothing reads.
    expect(result.value.buildArgs).toContain(`--outdir=${result.value.distDir}`);
  });
});

// ---------------------------------------------------------------------------
// build argv — a space is one token
// ---------------------------------------------------------------------------

describe("build argv", () => {
  test("quoteArg leaves a safe token unquoted", () => {
    expect(quoteArg("bun")).toBe("bun");
    expect(quoteArg("--hz=60")).toBe("--hz=60");
    expect(quoteArg("--outdir=/tmp/dist")).toBe("--outdir=/tmp/dist");
    expect(quoteArg("assets/fonts/NotoSansSC-Regular.otf")).toBe(
      "assets/fonts/NotoSansSC-Regular.otf",
    );
  });

  test("quoteArg quotes a space so the token survives a shell split", () => {
    expect(quoteArg("copy dist")).toBe("'copy dist'");
    expect(quoteArg("--outdir=/tmp/copy dist")).toBe("'--outdir=/tmp/copy dist'");
  });

  test("quoteArg POSIX-quotes an apostrophe", () => {
    expect(quoteArg("it's")).toBe(`'it'\\''s'`);
  });

  test("a path with a space is one argv token, not split on the space", async () => {
    // Splitting the printed command on spaces is how this used to fail
    // (`cannot resolve app "dist"`). buildArgs is the argv; buildCommand is
    // for humans.
    const parent = join(TMP, "space-argv");
    mkdirSync(parent, { recursive: true });
    const dir = join(parent, "smoke with space");
    const dist = join(parent, "dist with space");
    rmSync(dir, { recursive: true, force: true });
    symlinkSync(SMOKE_DIR, dir);

    const result = await resolveComposition({
      dir,
      flags: {
        json: false,
        bundle: join(dist, "main.js"),
        pak: join(dist, "main.pak"),
      },
      requireBundle: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.buildArgs).toContain(join(dir, "main.tsx"));
    expect(result.value.buildArgs).toContain(`--outdir=${dist}`);
    for (const token of result.value.buildArgs.filter((a) => a.includes(" "))) {
      expect(result.value.buildCommand).toContain(quoteArg(token));
    }
    expect(result.value.buildCommand.split(" ")).not.toEqual([...result.value.buildArgs]);
  });

  test("buildSpawn hands a spawn the argv, and every spaced token whole", async () => {
    // The four spawn sites take the composition, so `buildCommand` is not
    // reachable from any of them — `runBuild(c.buildCommand.split(" "))` is a
    // type error, which `bunx tsc --noEmit` is the gate for. What is left to
    // check at runtime is that what buildSpawn hands over is spawnable as is.
    const parent = join(TMP, "space-spawn");
    mkdirSync(parent, { recursive: true });
    const dir = join(parent, "smoke with space");
    const dist = join(parent, "dist with space");
    rmSync(dir, { recursive: true, force: true });
    symlinkSync(SMOKE_DIR, dir);

    const result = await resolveComposition({
      dir,
      flags: { json: false, bundle: join(dist, "main.js"), pak: join(dist, "main.pak") },
      requireBundle: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const spawn = buildSpawn(result.value);
    expect(spawn.argv).toEqual([...result.value.buildArgs]);
    expect(spawn.argv).toContain(join(dir, "main.tsx"));
    expect(spawn.argv).toContain(`--outdir=${dist}`);
    expect(spawn.argv.filter((a) => a.includes(" ")).length).toBeGreaterThan(0);
    expect(spawn.cwd).toBe(repoRootOf(result.value.dir));
    // The trap this replaces: the printed command has more tokens than the argv.
    expect(result.value.buildCommand.split(" ").length).toBeGreaterThan(spawn.argv.length);
  });

  test("a bundle with no build.json is refused, and the message says what to run", async () => {
    // The refusal `assertBakedTickRate` is modelled on: absent is refused
    // rather than defaulted, because "no toolchain declared" and "the declared
    // toolchain is the running one" would otherwise be one observation.
    const record = join(DIST, "build.json");
    const kept = await Bun.file(record).text();
    rmSync(record);
    try {
      const result = await resolveComposition({
        dir: SMOKE_DIR,
        flags: smokeFlags(),
        requireBundle: true,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("usage");
      expect(result.message).toContain("no readable build.json");
      // Not upstream's builder: it writes no record, so naming it as the fix
      // for a missing record would be a loop.
      expect(result.message).toContain("bun src/cli/main.ts build");
      expect(result.message).not.toContain("tools/build.ts writes a record");
    } finally {
      await Bun.write(record, kept);
    }
    // …and it resolves again once the record is back.
    const after = await resolveComposition({
      dir: SMOKE_DIR,
      flags: smokeFlags(),
      requireBundle: true,
    });
    expect(after.ok).toBe(true);
  });

  test("a build.json naming another Bun, or another patch set, is refused by name", async () => {
    const record = join(DIST, "build.json");
    const kept = await Bun.file(record).text();
    const parsed = JSON.parse(kept) as {
      bun: string;
      patches: Array<{ file: string; sha256: string }>;
    };
    try {
      await Bun.write(record, JSON.stringify({ ...parsed, bun: "1.2.0" }));
      const wrongBun = await resolveComposition({
        dir: SMOKE_DIR,
        flags: smokeFlags(),
        requireBundle: true,
      });
      expect(wrongBun.ok).toBe(false);
      if (wrongBun.ok) return;
      expect(wrongBun.message).toContain("built by Bun 1.2.0");
      expect(wrongBun.message).toContain(Bun.version);

      const flipped = structuredClone(parsed);
      const first = flipped.patches[0];
      expect(first, "the record lists the patches").toBeDefined();
      if (!first) return;
      first.sha256 = "0".repeat(64);
      await Bun.write(record, JSON.stringify(flipped));
      const wrongPatch = await resolveComposition({
        dir: SMOKE_DIR,
        flags: smokeFlags(),
        requireBundle: true,
      });
      expect(wrongPatch.ok).toBe(false);
      if (wrongPatch.ok) return;
      // Which patch, not just that one moved.
      expect(wrongPatch.message).toContain(first.file);
      expect(wrongPatch.message).toContain("has changed since");
    } finally {
      await Bun.write(record, kept);
    }
  });

  test("a --bundle path with a space is one --outdir token", async () => {
    const dist = join(TMP, "copy dist");
    const result = await resolveComposition({
      dir: SMOKE_DIR,
      flags: {
        json: false,
        bundle: join(dist, "main.js"),
        pak: join(dist, "main.pak"),
      },
      requireBundle: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.buildArgs).toContain(`--outdir=${dist}`);
    expect(result.value.buildCommand.split(" ")).not.toEqual([...result.value.buildArgs]);
  });
});

// ---------------------------------------------------------------------------
// layout — where things landed
// ---------------------------------------------------------------------------

describe("layout", () => {
  test("folds #text children into the node that owns the box", () => {
    // A Text node's characters are absorbed into its glyph run, so the child
    // `#text` nodes have no rect of their own. Reporting them separately is
    // how the first attempt at this command produced "rect unavailable" for
    // every string in the film.
    const tree = {
      i: 1,
      t: "root",
      k: [
        {
          i: 4,
          t: "text",
          c: "text-[76px]",
          k: [{ i: 5, t: "#text", x: "不是空的" }],
        },
        { i: 6, t: "view", c: "w-full", k: [{ i: 7, t: "text", n: "lockup", k: [] }] },
      ],
    };
    const kept = flattenTree(tree, false);
    expect(kept.map((k) => [k.node.i, k.text, k.depth])).toEqual([
      [4, "不是空的", 1],
      [7, undefined, 2],
    ]);
    // The root and the plain view carry neither text nor a name.
    expect(kept.some((k) => k.node.i === 1 || k.node.i === 6)).toBe(false);
    expect(flattenTree(tree, true).length).toBe(4);
  });

  test("reports every string of a real composition with a box", async () => {
    const result = await runLayout({
      dir: SMOKE_DIR,
      at: 3,
      all: false,
      flags: smokeFlags({ json: true }),
    });
    expect(result.exitCode).toBe(EXIT_OK);
    const json = result.json as {
      ok: boolean;
      viewport: [number, number];
      nodes: Array<{
        x: number;
        y: number;
        w: number;
        h: number;
        text?: string;
        inPicture: boolean;
      }>;
    };
    expect(json.ok).toBe(true);
    expect(json.nodes.length).toBeGreaterThan(0);
    for (const n of json.nodes) {
      // A box inside the viewport, with a real size. The point of the command
      // is that these are the renderer's numbers, not the author's arithmetic.
      expect({ ...n, ok: n.w > 0 && n.h > 0 }).toMatchObject({ ok: true });
      expect(n.x).toBeLessThanOrEqual(json.viewport[0]);
      expect(n.y).toBeLessThanOrEqual(json.viewport[1]);
      expect(n.inPicture).toBe(true);
    }
    const lines = result.stdoutLines ?? [];
    expect(lines.some((l) => l.includes("not in picture"))).toBe(false);
    expect(lines.some((l) => l.includes("A node is in the picture only if hiding it changes a pixel"))).toBe(
      true,
    );
  }, 60_000);

  test("a frame outside the composition is a usage error", async () => {
    await expect(
      runLayout({ dir: SMOKE_DIR, at: 99_999, all: false, flags: smokeFlags() }),
    ).rejects.toThrow(/out of range/);
  });

  test("only named-or-text nodes with no pixel count as not in picture", () => {
    const box = {
      id: 0,
      kind: "text",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      paints: false,
      visibility: "declared-invisible",
    } as const;
    expect(isNotInPicture({ ...box, name: "lockup", inPicture: false })).toBe(true);
    expect(isNotInPicture({ ...box, text: "字幕", inPicture: false })).toBe(true);
    expect(isNotInPicture({ ...box, name: "lockup", inPicture: true })).toBe(false);
    // Scaffolding the author never named is not a finding even when dark; it
    // is only in the report at all under `--all`.
    expect(isNotInPicture({ ...box, inPicture: false })).toBe(false);
  });

  test("the JSON carries the count the header line prints", async () => {
    const result = await runLayout({
      dir: SMOKE_DIR,
      at: 3,
      all: false,
      flags: smokeFlags({ json: true }),
    });
    const json = result.json as {
      notInPicture: number;
      nodes: Array<{ name?: string; text?: string; inPicture: boolean }>;
    };
    // Derived from the reported nodes, not counted a second time on the side:
    // the count and the per-node flags cannot disagree.
    expect(json.notInPicture).toBe(
      json.nodes.filter((n) => (n.name || n.text) && !n.inPicture).length,
    );
    expect(json.notInPicture).toBe(0);
    expect(result.exitCode).toBe(EXIT_OK);
  }, 60_000);

  test("a named node buried under an opaque lid is reported, and is not a failure", async () => {
    const result = await runLayout({
      dir: OCCLUDED_DIR,
      at: 0,
      all: false,
      flags: {
        json: true,
        bundle: OCCLUDED_BUNDLE,
        pak: OCCLUDED_PAK,
        frames: 1,
      },
    });
    const json = result.json as {
      notInPicture: number;
      nodes: Array<{ name?: string; inPicture: boolean }>;
    };
    const byName = new Map(json.nodes.map((n) => [n.name, n.inPicture]));
    // `buried` comes first in document order, so the lid paints over it.
    expect(byName.get("buried")).toBe(false);
    // `lid` and `shown` come after it and both reach the frame — proof the
    // count discriminates rather than darkening everything named.
    expect(byName.get("lid")).toBe(true);
    expect(byName.get("shown")).toBe(true);
    expect(json.notInPicture).toBe(1);
    // The buried-caption shape, and still exit 0. `layout` reports the
    // occlusion; it must not fail on it, because 46 of 114 frames sampled across the ledger
    // compositions hold a node with a box and no pixel for correct reasons
    // (outside its window, or a cut boundary). Which of the two this is now
    // reads off `visibility` — `tests/visibility.test.ts` asserts `covered`
    // here and `on-screen` for `shown` — and the command that FAILS on it is
    // `visibility`, which sweeps a span rather than looking at one frame.
    expect(result.exitCode).toBe(EXIT_OK);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// layout — finding codes
// ---------------------------------------------------------------------------

describe("layout findings", () => {
  /**
   * Every code, on the node the fixture put it on, from the real command.
   *
   * `tests/catalog.test.ts` G8 hands `findingsFor` geometries by hand and
   * proves what the predicate does with them; it says nothing about whether
   * the renderer produces those geometries. This is the other half — the boxes
   * and ink here came out of a boot — and the two together are what stop the
   * catalogue's numbers from becoming a description of a picture nothing draws.
   */
  const EXPECTED: ReadonlyArray<readonly [string, string]> = [
    ["text_not_painted", "faded"],
    ["text_not_painted", "offscreen"],
    ["text_occluded", "buried"],
    ["panel_out_of_canvas", "offscreen"],
    ["escaped_container", "escapee"],
    ["escaped_container", "cut-off"],
    ["content_overlap", "overlap-a"],
    ["content_overlap", "overlap-b"],
    ["text_box_overflow", "too-long"],
    ["clipped_text", "cut-off"],
  ];

  async function findings(): Promise<{
    findings: Array<{ code: string; name?: string; allowedBy?: string; detail: string }>;
    findingCounts: Record<string, number>;
    unusedAllow: Array<{ node: string; allow: string }>;
    nodes: Array<{ name?: string; findings?: Array<{ code: string }> }>;
    exitCode: number;
  }> {
    const result = await runLayout({
      dir: LAYOUT_CODES_DIR,
      at: 0,
      all: false,
      flags: { json: true, bundle: LAYOUT_CODES_BUNDLE, pak: LAYOUT_CODES_PAK, frames: 1 },
    });
    const json = result.json as {
      findings: Array<{ code: string; name?: string; allowedBy?: string; detail: string }>;
      findingCounts: Record<string, number>;
      unusedAllow: Array<{ node: string; allow: string }>;
      nodes: Array<{ name?: string; findings?: Array<{ code: string }> }>;
    };
    return { ...json, exitCode: result.exitCode };
  }

  test("every code fires on the node the fixture names, and only there", async () => {
    const json = await findings();
    const active = json.findings
      .filter((f) => f.allowedBy === undefined)
      .map((f) => [f.code, f.name ?? ""] as const);
    expect([...active].sort()).toEqual([...EXPECTED].sort());
    // Every code in the catalogue has a row here. A code that stopped firing
    // would leave this list short and the fixture green, which is the shape
    // this file exists to refuse.
    expect(new Set(active.map(([code]) => code)).size).toBe(FINDING_CODES.length);
  }, 60_000);

  test("a layoutAllow entry excuses its finding and keeps it readable", async () => {
    const json = await findings();
    const wing = json.findings.filter((f) => f.name === "wing");
    expect(wing.map((f) => f.code)).toEqual(["escaped_container"]);
    // Still in the payload, with the sentence that excused it. A suppressed
    // reading that vanished would be one nobody could audit.
    expect(wing[0]?.allowedBy).toContain("the cap is drawn wider");
    expect(json.findingCounts.escaped_container).toBe(2);
    expect(json.unusedAllow).toEqual([]);
  }, 60_000);

  test("findings are reported, and layout still exits 0", async () => {
    const json = await findings();
    expect(json.exitCode).toBe(EXIT_OK);
    // Per-node `findings` and the top-level list are one computation, not two.
    const perNode = json.nodes.flatMap((n) => (n.findings ?? []).map((f) => f.code));
    expect(perNode.length).toBe(json.findings.length);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// e2e spawn — entry wiring
// ---------------------------------------------------------------------------

describe("e2e spawn", () => {
  test("bun src/cli/main.ts lint compositions/smoke exits 0", async () => {
    const proc = Bun.spawn(
      ["bun", "src/cli/main.ts", "lint", "compositions/smoke"],
      {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, POCKETJS_ROOT: VENDOR },
      },
    );
    const code = await proc.exited;
    expect(code).toBe(EXIT_OK);
  });

  test("missing bundle names the build command (exit 2)", async () => {
    const emptyDist = join(TMP, "empty-dist");
    mkdirSync(emptyDist, { recursive: true });
    const proc = Bun.spawn(
      [
        "bun",
        "src/cli/main.ts",
        "check",
        "compositions/smoke",
        `--bundle=${join(emptyDist, "nope.js")}`,
        `--pak=${join(emptyDist, "nope.pak")}`,
      ],
      {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, POCKETJS_ROOT: VENDOR },
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code).toBe(EXIT_USAGE);
    const combined = stdout + stderr;
    expect(combined).toContain("bundle not found");
    expect(combined).toContain("tools/build.ts");
    expect(combined).toContain("Build it with:");
  });
});
