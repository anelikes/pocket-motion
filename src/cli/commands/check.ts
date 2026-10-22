/**
 * `check <composition-dir>`
 * Question: does it boot, is the realm clean, is it mount-only at runtime?
 */

import { existsSync } from "node:fs";
import { lintImages } from "../../lint/images.ts";
import { lintSource, type LintFinding } from "../../lint/mount-only.ts";
import { countingOps } from "../../lint/oracle.ts";
import { describeShutter, hardenedBootWorld, totalPendingWork } from "../../runtime/boot.ts";
import { UsageError, parseArgs, requirePositional } from "../args.ts";
import { openFootage, scratchTree } from "../footage.ts";
import { errMsg, listCompositionSources, resolveComposition } from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";

/** Default observation window when --frames is not set. Sidecar duration is
 *  often hundreds of frames; check only needs a short run to prove silence. */
const DEFAULT_CHECK_FRAMES = 30;

export interface CheckOptions {
  readonly dir: string;
  readonly flags: GlobalFlags;
}

export async function run(options: CheckOptions): Promise<CommandResult> {
  const resolved = await resolveComposition({
    dir: options.dir,
    flags: options.flags,
    requireBundle: true,
  });

  if (!resolved.ok) {
    if (resolved.kind === "usage") throw new UsageError(resolved.message);
    // Sidecar invalid → finding (exit 1)
    return {
      exitCode: EXIT_FAIL,
      json: {
        ok: false,
        mountOnly: false,
        diagnostics: resolved.diagnostics ?? [],
        error: "invalid pocket-motion.json",
      },
      stderrLines: (resolved.diagnostics ?? []).map(
        (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
      ),
      stdoutLines: ["check failed — invalid sidecar"],
    };
  }

  const c = resolved.value;

  // Before booting: a referenced image with no file behind it. The bundle
  // this is about to run was built with a 32×32 placeholder in its place, and
  // every question `check` asks after this point — realm clean, no guest ops,
  // no pending work — is answered the same way with the picture missing.
  const missingImages = await lintImages({
    entryPath: c.entryPath,
    compositionDir: c.dir,
  });
  if (missingImages.length > 0) {
    return {
      exitCode: EXIT_FAIL,
      json: {
        ok: false,
        mountOnly: false,
        staticFindings: missingImages,
        compositionId: c.compositionId,
        error: "referenced image not on disk",
      },
      stdoutLines: [
        `check failed — ${missingImages.length} referenced image(s) not on disk`,
        ...missingImages.map((f) => `  ${f.file}:${f.line}:${f.column} ${f.code} — ${f.message}`),
      ],
      stderrLines: [
        "the build bakes a 32×32 placeholder for each of these and succeeds, so the realm is clean and the digest is stable with the picture missing",
      ],
    };
  }

  const frames =
    options.flags.frames ?? Math.min(DEFAULT_CHECK_FRAMES, c.durationFrames);

  let counter: ReturnType<typeof countingOps> | undefined;
  let world: Awaited<ReturnType<typeof hardenedBootWorld>> | undefined;
  let footage: Awaited<ReturnType<typeof openFootage>> = null;

  try {
    // Tree from a throwaway world — getTree on THIS world would consume a
    // turn and count as guest work, both of which would lie about mount-only.
    const tree = c.sidecar.footage.length > 0 ? await scratchTree(c) : null;

    world = await hardenedBootWorld({
      bundlePath: c.bundlePath,
      pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
      width: c.width,
      height: c.height,
      hz: c.fps,
      renderScale: c.supersample,
      // Passed so a core that cannot expose is refused here as everywhere;
      // `check` renders nothing, and an exposure runs no guest code.
      shutter: c.shutter,
      buildCommand: c.buildCommand,
      wrapOps: (ops) => {
        counter = countingOps(ops);
        return counter.ops;
      },
    });

    // Realm must be clean before any frame is trusted.
    world.audit();

    // Mount: first guest turn builds the tree.
    world.frame(0);
    for (let t = 0; t < world.ticksPerFrame; t++) world.tick();

    if (!counter) {
      throw new Error("PocketJS Motion: countingOps was not installed");
    }

    // Bind during mount so setImageUv is mount work, not a post-mount guest op.
    footage =
      tree !== null
        ? await openFootage(c, world, tree, { asHost: (fn) => counter!.asHost(fn) })
        : null;

    // First beginFrame closes mount; subsequent ones finalise each observed frame.
    counter.beginFrame();
    for (let f = 0; f < frames; f++) {
      if (f > 0) counter.beginFrame();
      footage?.present(f);
      world.frame(0);
      for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
    }

    // Re-audit after the run — a dirty realm mid-sequence is a hard fail.
    world.audit();

    const report = counter.report(frames);

    // Structural half of the verdict. Read AFTER the run, not at mount: a
    // composition can register a hook or a timer on any frame, and what matters
    // is whether anything is still booked when observation stops.
    const pending = world.pendingWork();
    const pendingTotal = pending ? totalPendingWork(pending) : 0;

    // The runtime oracle only sees what reaches the core. A composition can
    // register an inert `onFrame` callback and still issue zero ops, so `check`
    // alone would report a misleading green. The static lint is conservative
    // where the oracle is empirical, so `check` runs both and fails on either.
    //
    // Every source in the composition, not just the entry. `check` read
    // `main.tsx` alone until 2026-08-13, and an entry is usually four lines that
    // render a component from somewhere else — so the file it read was the one
    // file that could not contain the violation. `compositions/late-timer` is
    // the fixture for that: a clean entry, `after` in `app.tsx`.
    const sources = await listCompositionSources(c.dir);
    const staticFindings: LintFinding[] = [];
    for (const file of sources) {
      staticFindings.push(...lintSource(await Bun.file(file).text(), file));
    }

    const payload = {
      ok: report.mountOnly && pendingTotal === 0 && staticFindings.length === 0,
      mountOnly: report.mountOnly,
      staticFindings,
      framesObserved: report.framesObserved,
      mountOps: report.mountOps,
      totalOps: report.totalOps,
      opsPerFrame: report.opsPerFrame,
      opsByName: report.opsByName,
      /** null when the bundle predates patches/0003 — unknown, not clean. */
      pendingWork: pending ?? null,
      compositionId: c.compositionId,
      realmClean: true,
    };

    if (staticFindings.length > 0) {
      return {
        exitCode: EXIT_FAIL,
        json: payload,
        stdoutLines: [
          `check failed — ${staticFindings.length} static mount-only finding(s)`,
          ...staticFindings.map((f) => `  ${f.file}:${f.line}:${f.column} ${f.code} — ${f.message}`),
        ],
        stderrLines: [
          "the runtime oracle saw no guest ops, but these imports put frame state in the JS heap",
        ],
      };
    }

    if (!report.mountOnly) {
      return {
        exitCode: EXIT_FAIL,
        json: payload,
        stdoutLines: [
          `check failed — not mount-only (${report.totalOps} guest ops after mount)`,
        ],
        stderrLines: [
          `mount-only oracle: ${report.totalOps} guest HostOps after mount across ${frames} frame(s)`,
          `opsByName: ${JSON.stringify(report.opsByName)}`,
        ],
      };
    }

    if (pending && pendingTotal > 0) {
      const held = Object.entries(pending)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}=${n}`);
      return {
        exitCode: EXIT_FAIL,
        json: payload,
        stdoutLines: [
          `check failed — ${pendingTotal} unit(s) of scheduled work outstanding after ${frames} frames`,
          `  ${held.join(", ")}`,
        ],
        stderrLines: [
          "the guest issued no ops in the window observed, but the framework is still holding work",
          "a booked timer or frame hook acts on a frame this run never reached — the composition is not mount-only",
        ],
      };
    }

    const structural = pending
      ? "no scheduled work"
      : "scheduled work UNKNOWN (bundle predates patches/0003 — rebuild to check)";

    return {
      exitCode: EXIT_OK,
      json: payload,
      stdoutLines: [
        `check ok — realm clean, mount-only (mountOps=${report.mountOps}, totalOps=0 over ${frames} frames), ${structural}`,
        // Said rather than left to be assumed either way: this run rendered no
        // exposure, and needed none — the samples run inside one core call
        // after the frame's guest turn and ticks.
        ...(c.shutter
          ? [
              `shutter ${describeShutter(c.shutter)} — outside this verdict: an exposure is one core call ` +
                "after a frame's guest turn and ticks, and runs no guest code",
            ]
          : []),
      ],
    };
  } catch (e) {
    const message = errMsg(e);
    return {
      exitCode: EXIT_FAIL,
      json: {
        ok: false,
        mountOnly: false,
        realmClean: false,
        error: message,
        compositionId: c.compositionId,
      },
      stderrLines: [message],
      stdoutLines: [`check failed — ${message}`],
    };
  } finally {
    await footage?.close();
  }
}

export async function runFromArgv(
  argv: readonly string[],
): Promise<CommandResult> {
  const parsed = parseArgs(["check", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  return run({ dir, flags: parsed.global });
}
