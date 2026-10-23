/**
 * `doctor`
 * Question: is this checkout able to build and render at all, and if not,
 * which command fixes it?
 *
 * Every other command in this CLI answers a question about a composition.
 * This one answers a question about the machine, and it exists because the
 * failures it finds surface much later and much further down: a missing
 * `wasm32-unknown-unknown` target fails inside cargo, an unfetched CJK face
 * fails inside `resolveComposition`, a full volume surfaces as ffmpeg's
 * `No space left on device` with nothing above it mentioning capacity, and a
 * Bun that is not the one an artifact was built by is refused by
 * `assertBuildRecord` after the build has already been paid for.
 *
 * TWO EXIT CONVENTIONS, on purpose:
 *
 * - `--json` ALWAYS exits 0, and the verdict is the `ok` field. An agent
 *   running this to decide what to do next needs the report, and a non-zero
 *   exit from a reporting command is the thing that makes a shell pipeline
 *   throw away the payload it was asking for.
 * - human mode exits 1 when any check failed, because a person running it in
 *   a terminal is asking a yes/no question and a script wrapping it expects
 *   the usual meaning.
 *
 * WHAT IT REUSES, and why none of it is re-derived here: the vendored tree's
 * state comes from `src/vendor/status.ts` (which `scripts/vendor.ts --status`
 * also renders), the asset check is `bun scripts/assets.ts --check` spawned
 * verbatim, and the disk figures are the digest ledger's own
 * (`src/cli/disk.ts`). A second opinion about any of them would disagree with
 * the first the moment either moved, and the disagreement would be between
 * this command and the gate it is supposed to be predicting.
 *
 * IN AN INSTALLED PACKAGE the same seven checks answer for a different tree.
 * There is no clone to ask git about and no Rust to need: `vendor/prebuilt.json`
 * is present, `vendor` hashes every prebuilt file against it and loads the
 * compiler in a child process — its native binding is an optional dependency,
 * so this is where a platform the package does not cover shows up — while
 * `rustup` and `assets` say they do not apply rather than fail on tools and
 * files a consumer was never meant to have (`src/package/prebuilt.ts`).
 *
 * WHAT IT DOES NOT CLAIM: nothing here renders. A green `doctor` says the
 * tools are present and the pins agree; it says nothing about whether any
 * composition in the tree builds, which is what `lint`, `build` and `check`
 * are for.
 */

import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  PREBUILT_FILE,
  compilerLoadError,
  isPrebuilt,
  prebuiltProblems,
  readPrebuilt,
} from "../../package/prebuilt.ts";
import { readBuildRecord } from "../../render/build-record.ts";
import { vendorProblems, vendorStatus } from "../../vendor/status.ts";
import { parseArgs } from "../args.ts";
import {
  FULL_RUN_COMFORTABLE_GIB,
  FULL_RUN_NEED_GIB,
  FULL_RUN_RGBA_FILES,
  FULL_RUN_RGBA_MEASURED,
  HEADROOM_MULTIPLE,
  RECLAIM_COMMAND,
  formatGiB,
  freeGiB,
  strayRgba,
} from "../disk.ts";
import { EXIT_FAIL, EXIT_OK, type CommandResult } from "../types.ts";

/** The repository root — this module sits at `src/cli/commands/`. */
const ROOT = resolve(import.meta.dir, "../../..");
const LEDGER = join(ROOT, "baselines/digests.json");

/** The wasm target `vendor/pocketjs/engine/wasm` is built for. */
export const WASM_TARGET = "wasm32-unknown-unknown";

export interface DoctorCheck {
  /** Stable name an agent can branch on. */
  readonly name: string;
  readonly ok: boolean;
  /** What was observed. A sentence, always present, green or red. */
  readonly detail: string;
  /** The command that would fix it, or null when there is nothing to run. */
  readonly fix: string | null;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
}

interface Ran {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run a command, or report the spawn failure — a binary not on PATH throws. */
async function sh(argv: readonly string[], cwd = ROOT): Promise<Ran> {
  try {
    const proc = Bun.spawn([...argv], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, stdout, stderr };
  } catch (e) {
    return { ok: false, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
  }
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * The Bun this process is, against the two places a Bun is recorded.
 *
 * `baselines/digests.json` says which Bun the ledger's digests were taken on,
 * and every `dist/**\/build.json` says which Bun built those artifacts. The
 * second is the one that bites first: `assertBuildRecord` refuses a bundle
 * whose recorded Bun is not the running one, so a tree built by another Bun
 * fails every command that reads a bundle, and the fix is a rebuild rather
 * than anything about the environment.
 *
 * Neither absence is a fault. A fresh clone has no `dist/`, and a ledger
 * recorded before this field existed does not carry one; both say so.
 */
export async function checkBun(): Promise<DoctorCheck> {
  const running = Bun.version;
  const notes: string[] = [];
  let ok = true;
  let fix: string | null = null;

  let ledgerBun: string | undefined;
  if (existsSync(LEDGER)) {
    try {
      ledgerBun = (await Bun.file(LEDGER).json())?.bun;
    } catch {
      ledgerBun = undefined;
    }
  }
  if (typeof ledgerBun === "string" && ledgerBun !== running) {
    ok = false;
    notes.push(`the digest ledger was recorded on Bun ${ledgerBun}`);
    fix = `bun upgrade --to ${ledgerBun}`;
  } else if (typeof ledgerBun === "string") {
    notes.push(`matches the digest ledger's ${ledgerBun}`);
  } else {
    notes.push("the digest ledger records no Bun");
  }

  // Every build.json under the one dist root. Distinct values only: twenty
  // artifacts built by the same wrong Bun is one problem, not twenty.
  const stale = new Map<string, string>();
  let records = 0;
  try {
    const glob = new Bun.Glob("**/build.json");
    for await (const rel of glob.scan({ cwd: join(ROOT, "dist") })) {
      const outDir = join(ROOT, "dist", rel, "..");
      const record = await readBuildRecord(join(outDir, "main.js"));
      if (!record) continue;
      records++;
      if (record.bun !== running && !stale.has(record.bun)) {
        stale.set(record.bun, relative(ROOT, outDir));
      }
    }
  } catch {
    /* no dist yet */
  }
  if (stale.size > 0) {
    ok = false;
    for (const [version, where] of stale) {
      notes.push(`artifacts under ${where} were built by Bun ${version}`);
    }
    fix = fix ?? "bun src/cli/main.ts build <composition-dir>";
  } else if (records > 0) {
    notes.push(`${records} built artifact(s) in dist/ record this Bun`);
  } else {
    notes.push("nothing is built yet, so no artifact records a Bun");
  }

  return { name: "bun", ok, detail: `Bun ${running}: ${notes.join("; ")}`, fix };
}

/**
 * rustup, and the wasm target `bun run vendor` compiles the rasteriser for.
 *
 * `rustup which cargo` rather than `cargo` off PATH, for the reason
 * `scripts/vendor.ts` gives at length: on a machine with both a Homebrew
 * cargo and a rustup one, only the rustup toolchain carries the wasm32 std,
 * and the plausible invocation fails with "can't find crate for `core`".
 */
export async function checkRust(): Promise<DoctorCheck> {
  if (isPrebuilt(ROOT)) {
    return {
      name: "rustup",
      ok: true,
      detail:
        "not needed: this is an installed package, and hosts/web/pocketjs.wasm ships " +
        `prebuilt with its sha256 in ${PREBUILT_FILE}`,
      fix: null,
    };
  }
  const which = await sh(["rustup", "which", "cargo"]);
  if (!which.ok) {
    return {
      name: "rustup",
      ok: false,
      detail:
        "rustup is not on PATH. `bun run vendor` builds the wasm rasteriser " +
        "with the rustup toolchain's cargo, not with any cargo on PATH.",
      fix: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
    };
  }
  const targets = await sh(["rustup", "target", "list", "--installed"]);
  const installed = targets.stdout.split("\n").map((l) => l.trim());
  if (!installed.includes(WASM_TARGET)) {
    return {
      name: "rustup",
      ok: false,
      detail:
        `rustup is installed (${firstLine(which.stdout)}) but the ${WASM_TARGET} ` +
        `target is not: installed targets are ${installed.filter(Boolean).join(", ") || "(none)"}.`,
      fix: `rustup target add ${WASM_TARGET}`,
    };
  }
  return {
    name: "rustup",
    ok: true,
    detail: `${WASM_TARGET} installed; cargo at ${firstLine(which.stdout)}`,
    fix: null,
  };
}

/**
 * One of ffmpeg / ffprobe, with the version line.
 *
 * Both, separately, because they are separately load-bearing and a tarball
 * carrying only one is a real shape: `src/cli/footage.ts` reads a source's
 * dimensions and duration with ffprobe BEFORE paying for the ingest, so a
 * tree with ffmpeg alone fails later and further in. The version is reported
 * because it is an input to every frozen footage artifact —
 * `baselines/ingest-bytes.json` records `ffmpeg version 8.0` against all of
 * them — and identity leaves it out (`DELIBERATELY_ABSENT`) on the grounds
 * that the artifact stands in front of it.
 */
async function checkFfTool(tool: "ffmpeg" | "ffprobe"): Promise<DoctorCheck> {
  const ran = await sh([tool, "-version"]);
  if (!ran.ok) {
    return {
      name: tool,
      ok: false,
      detail: `${tool} is not on PATH; footage cannot be ingested and nothing can be encoded.`,
      fix: "brew install ffmpeg",
    };
  }
  return { name: tool, ok: true, detail: firstLine(ran.stdout), fix: null };
}

/**
 * The vendored tree, through the one module that reports on it — or, in an
 * installed package, through the manifest that stands in for git there
 * (`src/package/prebuilt.ts`), plus whether the compiler loads on this
 * platform, which is the first thing a package can get wrong that a checkout
 * cannot: its native binding is an optional dependency, not a shipped file.
 */
export async function checkVendor(): Promise<DoctorCheck> {
  const manifest = isPrebuilt(ROOT) ? await readPrebuilt(ROOT) : null;
  if (isPrebuilt(ROOT)) {
    const problems = manifest
      ? await prebuiltProblems(manifest, ROOT)
      : [`${PREBUILT_FILE} is present but is not a manifest this version can read`];
    const loadError = await compilerLoadError(ROOT);
    if (loadError !== null) {
      problems.push(
        `the vendored compiler does not load on ${process.platform}-${process.arch}: ${loadError}`,
      );
    }
    if (problems.length > 0) {
      return {
        name: "vendor",
        ok: false,
        detail: problems.join("; "),
        fix:
          loadError !== null
            ? "reinstall pocket-motion with optional dependencies, on a platform its package.json lists"
            : "reinstall pocket-motion",
      };
    }
    return {
      name: "vendor",
      ok: true,
      detail:
        `prebuilt at ${manifest!.upstream} + ${manifest!.patches.length} patch(es); ` +
        `${Object.keys(manifest!.files).length} file(s) match ${PREBUILT_FILE}, ` +
        "and the compiler loads on this platform",
      fix: null,
    };
  }
  const status = await vendorStatus();
  const problems = vendorProblems(status);
  if (problems.length > 0) {
    return {
      name: "vendor",
      ok: false,
      detail: problems.join("; "),
      fix: status.present
        ? "POCKETJS_ROOT=<a pocketjs checkout> bun run vendor --refresh"
        : "POCKETJS_ROOT=<a pocketjs checkout> bun run vendor",
    };
  }
  return {
    name: "vendor",
    ok: true,
    detail:
      `${status.head} (pinned ${status.pinned}) + ${status.patches.length} patch(es), ` +
      `${status.dirtyLines.length} file(s) modified by them; ` +
      "hosts/web/pocketjs.wasm present",
    fix: null,
  };
}

/**
 * The fetched assets, by spawning the script that owns the manifests.
 *
 * Spawned rather than imported: `scripts/assets.ts` does its work at module
 * scope, so importing it would fetch rather than check. `--check` never
 * touches the network.
 */
export async function checkAssets(): Promise<DoctorCheck> {
  if (isPrebuilt(ROOT)) {
    return {
      name: "assets",
      ok: true,
      detail:
        "not applicable: an installed package carries none of this repository's fetched " +
        "assets; a composition's fonts and sound are files in its own project, and lint " +
        "and check refuse a declared one that is missing",
      fix: null,
    };
  }
  const ran = await sh(["bun", "scripts/assets.ts", "--check"]);
  if (!ran.ok) {
    return {
      name: "assets",
      ok: false,
      detail: (ran.stderr.trim() || ran.stdout.trim() || "assets --check failed").split("\n")[0]!,
      fix: "bun scripts/assets.ts",
    };
  }
  return {
    name: "assets",
    ok: true,
    detail: firstLine(ran.stdout) || "every file in assets/*/manifest.json matches its sha256",
    fix: null,
  };
}

/**
 * Room for a full ledger run, against what one actually leaves.
 *
 * FAILS only below the NEED — the bytes a full run was measured to decode —
 * and passes with a thinner sentence below `HEADROOM_MULTIPLE` times it. Both
 * numbers are named, because "not enough" and "enough but tight" are different
 * things to be told and a single threshold said neither: this check used to
 * fail against a 64 GiB high-water mark carried from a tree that no longer
 * exists, which made it red on every hosted runner (11.6 GiB free) and took
 * the `AUTHORING.md` and `SKILL.md` command gates down with it, since both run
 * `doctor` out of a documented fence.
 *
 * Split from `checkDisk` because the verdict is a pure function of what was
 * observed, so the states this machine is not in can still be asserted — the
 * same reason `vendorProblems` is separate from `checkVendor`. A seam for a
 * fake free-space value in the command itself would be a backdoor in shipped
 * code; this is the same evidence with no way to reach it from argv.
 */
export function diskVerdict(
  free: number | null,
  stray: { count: number; gib: number },
): DoctorCheck {
  const held =
    stray.count > 0
      ? ` ${stray.count} .rgba file(s) already under dist/ hold ${formatGiB(stray.gib)} and are re-derivable.`
      : "";
  if (free === null) {
    return {
      name: "disk",
      ok: true,
      detail: `free space could not be read (df said nothing usable).${held}`,
      fix: null,
    };
  }
  const need =
    `a full ledger run decodes ${formatGiB(FULL_RUN_NEED_GIB)} of RGBA under dist/ ` +
    `(${FULL_RUN_RGBA_FILES} files, measured ${FULL_RUN_RGBA_MEASURED}), and ` +
    `${formatGiB(FULL_RUN_COMFORTABLE_GIB)} is ${HEADROOM_MULTIPLE}x that`;
  const fix = stray.count > 0 ? RECLAIM_COMMAND : null;
  if (free < FULL_RUN_NEED_GIB) {
    return {
      name: "disk",
      ok: false,
      detail:
        `${formatGiB(free)} free — ${need}. This volume cannot hold one. ` +
        `ffmpeg reports running out as \`No space left on device\`, and nothing above it ` +
        `mentions capacity.${held}`,
      fix,
    };
  }
  if (free < FULL_RUN_COMFORTABLE_GIB) {
    return {
      name: "disk",
      ok: true,
      detail:
        `${formatGiB(free)} free — ${need}, so this fits but leaves little room ` +
        `for a second run's decode beside the first.${held}`,
      fix,
    };
  }
  return {
    name: "disk",
    ok: true,
    detail: `${formatGiB(free)} free — ${need}.${held}`,
    fix: null,
  };
}

/** `diskVerdict` over what this machine reports. */
export async function checkDisk(): Promise<DoctorCheck> {
  return diskVerdict(await freeGiB(ROOT), await strayRgba(ROOT));
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

export async function report(): Promise<DoctorReport> {
  const checks = [
    await checkBun(),
    await checkRust(),
    await checkFfTool("ffmpeg"),
    await checkFfTool("ffprobe"),
    await checkVendor(),
    await checkAssets(),
    await checkDisk(),
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

export interface DoctorOptions {
  /** `--json` never exits non-zero; the verdict is in the payload. */
  readonly json: boolean;
}

export async function run(options: DoctorOptions): Promise<CommandResult> {
  const payload = await report();
  const stdoutLines: string[] = [];
  for (const check of payload.checks) {
    stdoutLines.push(`${check.ok ? "ok  " : "FAIL"} ${check.name.padEnd(8)} ${check.detail}`);
    if (!check.ok && check.fix !== null) stdoutLines.push(`         fix: ${check.fix}`);
  }
  const failed = payload.checks.filter((c) => !c.ok);
  stdoutLines.push(
    failed.length === 0
      ? `doctor ok — ${payload.checks.length} check(s) passed`
      : `doctor failed — ${failed.length} of ${payload.checks.length} check(s): ${failed
          .map((c) => c.name)
          .join(", ")}`,
  );

  return {
    exitCode: options.json || payload.ok ? EXIT_OK : EXIT_FAIL,
    json: payload,
    stdoutLines,
  };
}

export async function runFromArgv(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseArgs(["doctor", ...argv]);
  return run({ json: parsed.global.json });
}
