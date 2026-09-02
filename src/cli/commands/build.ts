/**
 * `build <composition-dir>`
 * Question: produce the artifacts, and record what produced them.
 *
 * Upstream's `tools/build.ts` is what actually runs — this command spawns the
 * exact argv every other command prints. What it adds is `build.json` beside
 * the bundle (`src/render/build-record.ts`), which every command that reads a
 * bundle requires. So this is the supported way to build one by hand: the raw
 * upstream invocation leaves an artifact nothing here will render, and the
 * refusal says so rather than reprinting a command that cannot fix it.
 */

import { existsSync } from "node:fs";

import { BUILD_RECORD_FILE, buildRecordPath } from "../../render/build-record.ts";
import { UsageError, parseArgs, requirePositional } from "../args.ts";
import { runBuild } from "../build.ts";
import { errMsg, resolveComposition } from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";

export interface BuildOptions {
  readonly dir: string;
  readonly flags: GlobalFlags;
}

export async function run(options: BuildOptions): Promise<CommandResult> {
  // requireBundle: false — building is how the bundle comes to exist, so its
  // absence is the reason this command was run.
  const resolved = await resolveComposition({
    dir: options.dir,
    flags: options.flags,
    requireBundle: false,
  });
  if (!resolved.ok) {
    if (resolved.kind === "usage") throw new UsageError(resolved.message);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: "invalid pocket-motion.json", diagnostics: resolved.diagnostics },
      stderrLines: (resolved.diagnostics ?? []).map(
        (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
      ),
      stdoutLines: ["build failed — invalid sidecar"],
    };
  }

  const c = resolved.value;
  try {
    const record = await runBuild(c);
    const pak = existsSync(c.pakPath) ? c.pakPath : null;
    return {
      exitCode: EXIT_OK,
      json: {
        ok: true,
        distDir: c.distDir,
        bundlePath: c.bundlePath,
        pakPath: pak,
        buildRecordPath: buildRecordPath(c.bundlePath),
        buildRecord: record,
      },
      stdoutLines: [
        `build ok — ${c.distDir}`,
        `bundle ${c.bundlePath}`,
        ...(pak ? [`pak    ${pak}`] : ["pak    (none — this composition bakes no assets)"]),
        `${BUILD_RECORD_FILE}  bun ${record.bun}, upstream ${record.upstream}, ` +
          `${record.patches.length} patch(es)`,
      ],
    };
  } catch (e) {
    const message = errMsg(e);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: message },
      stderrLines: [message],
      stdoutLines: [`build failed — ${message}`],
    };
  }
}

export async function runFromArgv(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseArgs(["build", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  return run({ dir, flags: parsed.global });
}
