/**
 * `preview <composition-dir>`
 * Question: what does this composition look like, frame by frame, from the
 * same host that hashes it?
 *
 * The browser is a display. `/watch` is a normal player over an MP4 (`render`
 * encode + mux). `/` is the frame debugger: Bun seeks, presents footage, and
 * serves PNG / layout JSON. Of the four debugger pieces this command was
 * scoped for it ships three — load, scrub, overlay layout — plus play. The
 * fourth, a side-by-side of the first divergent frame of two traces, is not
 * here; `diff` reports that frame number without drawing it.
 */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  UsageError,
  optionalInt,
  optionalString,
  parseArgs,
  refuseJobPatches,
  requirePositional,
} from "../args.ts";
import { listenPreview } from "../../preview/host.ts";
import { errMsg, resolveComposition } from "../resolve.ts";
import { runBuild } from "../build.ts";
import { stageSpec } from "./render.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";

export const DEFAULT_PREVIEW_PORT = 8741;
export const DEFAULT_PREVIEW_BIND = "127.0.0.1";

export interface PreviewOptions {
  readonly dir: string;
  readonly flags: GlobalFlags;
  readonly port: number;
  readonly bind: string;
  readonly open: boolean;
  /** Rebuild and reopen on a source change. Default true. */
  readonly watch: boolean;
  readonly spec?: string;
}

export async function run(options: PreviewOptions): Promise<CommandResult> {
  let staged: { dir: string; dispose: () => Promise<void> } | undefined;
  if (options.spec) {
    try {
      staged = await stageSpec(options.dir, options.spec);
    } catch (e) {
      if (e instanceof UsageError) throw e;
      const message = errMsg(e);
      return {
        exitCode: EXIT_FAIL,
        json: { ok: false, error: message },
        stderrLines: [message],
        stdoutLines: [`preview failed — ${message}`],
      };
    }
  }

  const flags = staged
    ? {
        ...options.flags,
        bundle: join(staged.dir, "dist", "main.js"),
        pak: join(staged.dir, "dist", "main.pak"),
      }
    : options.flags;
  const resolved = await resolveComposition({
    dir: staged?.dir ?? options.dir,
    flags,
    requireBundle: options.spec ? false : true,
  });
  if (!resolved.ok) {
    await staged?.dispose();
    staged = undefined;
    if (resolved.kind === "usage") throw new UsageError(resolved.message);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: "invalid pocket-motion.json" },
      stderrLines: (resolved.diagnostics ?? []).map(
        (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
      ),
    };
  }

  try {
    if (options.spec) {
      await runBuild(resolved.value);
    }
    const host = await listenPreview({
      composition: resolved.value,
      // The flags this session was opened with, including the `--bundle` /
      // `--pak` a `--spec` staging put there. A reload re-resolves with them
      // rather than with an empty set, so an edit does not quietly drop the
      // person's `--frames` / `--supersample` / staged artefacts.
      flags,
      port: options.port,
      hostname: options.bind,
      watch: options.watch,
    });

    const onStop = () => {
      void host.stop();
    };
    process.once("SIGINT", onStop);
    process.once("SIGTERM", onStop);

    const playerUrl = `${host.url}/watch`;
    if (options.open) tryOpen(playerUrl);

    const payload = {
      ok: true as const,
      url: host.url,
      playerUrl,
      framesUrl: `${host.url}/`,
      port: host.port,
      bind: host.hostname,
      watching: host.watching,
      compositionId: host.meta.compositionId,
      durationFrames: host.meta.durationFrames,
      fps: host.meta.fps,
      width: host.meta.width,
      height: host.meta.height,
    };

    return {
      exitCode: EXIT_OK,
      json: payload,
      stdoutLines: [
        `preview ${playerUrl} — ${host.meta.durationFrames} frames @ ${host.meta.fps} fps · ${host.meta.width}×${host.meta.height}`,
        `  frame debugger ${payload.framesUrl}`,
        host.watching
          ? "  watching compositions/ — an edit rebuilds and both pages follow"
          : "  not watching — restart to pick up an edit",
      ],
      stderrLines: ["stop with Ctrl-C"],
      keepAlive: host.closed.finally(async () => {
        process.removeListener("SIGINT", onStop);
        process.removeListener("SIGTERM", onStop);
        await staged?.dispose();
      }),
    };
  } catch (e) {
    await staged?.dispose();
    const message = errMsg(e);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: message },
      stderrLines: [message],
      stdoutLines: [`preview failed — ${message}`],
    };
  }
}

export async function runFromArgv(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseArgs(["preview", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  const port = optionalInt(parsed.flags, "port") ?? DEFAULT_PREVIEW_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`--port must be an integer 0..65535; got ${port}`);
  }
  const bind = optionalString(parsed.flags, "bind") ?? DEFAULT_PREVIEW_BIND;
  const spec = optionalString(parsed.flags, "spec");
  refuseJobPatches(parsed.global, spec !== undefined);
  if (spec !== undefined) {
    const specPath = resolve(spec);
    if (!existsSync(specPath)) {
      throw new UsageError(`spec not found: ${specPath}`);
    }
    if (statSync(specPath).isDirectory()) {
      throw new UsageError(
        "preview --spec is one JSON file; a directory of jobs is render --spec <dir> --out-dir",
      );
    }
    let raw: unknown;
    try {
      raw = await Bun.file(specPath).json();
    } catch {
      raw = undefined;
    }
    if (Array.isArray(raw)) {
      throw new UsageError("a job is one JSON object; for many jobs pass a directory of .json files to render");
    }
  }
  return run({
    dir,
    flags: parsed.global,
    port,
    bind,
    open: parsed.flags["no-open"] !== true,
    watch: parsed.flags["no-watch"] !== true,
    ...(spec === undefined ? {} : { spec: resolve(spec) }),
  });
}

function tryOpen(url: string): void {
  if (process.platform !== "darwin") return;
  Bun.spawn(["open", url], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
}
