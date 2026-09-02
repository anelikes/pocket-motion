/**
 * `lint <composition-dir>`
 * Question: is the sidecar valid and is the source mount-only?
 */

import { basename, resolve } from "node:path";
import { lintImages } from "../../lint/images.ts";
import { lintSource, type LintFinding } from "../../lint/mount-only.ts";
import { lintTileNames, type TileWarning } from "../../lint/tiles.ts";
import type { Diagnostic } from "../../manifest/sidecar.ts";
import { resolveSound } from "../../sound/resolve.ts";
import { UsageError, parseArgs, requirePositional } from "../args.ts";
import {
  listCompositionSources,
  resolveComposition,
} from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";

export interface LintOptions {
  readonly dir: string;
  readonly flags: GlobalFlags;
}

export async function run(options: LintOptions): Promise<CommandResult> {
  const resolved = await resolveComposition({
    dir: options.dir,
    flags: options.flags,
    requireBundle: false,
  });

  if (!resolved.ok && resolved.kind === "usage") {
    throw new UsageError(resolved.message);
  }

  const diagnostics: Diagnostic[] =
    !resolved.ok && resolved.kind === "sidecar"
      ? [...(resolved.diagnostics ?? [])]
      : [];
  // A declared sound file that is not on disk is a contract violation.
  // The frame path does not run this check: sound cannot move a pixel.
  if (resolved.ok) {
    const sound = resolveSound(resolved.value.sidecar, resolved.value.dir);
    diagnostics.push(...sound.diagnostics);
  }
  const sidecarPath =
    !resolved.ok && resolved.kind === "sidecar"
      ? resolved.sidecarPath
      : resolved.ok
        ? resolved.value.sidecarPath
        : undefined;

  const dir = resolved.ok ? resolved.value.dir : resolve(options.dir);
  const sources = await listCompositionSources(dir);
  const findings: LintFinding[] = [];
  const texts: { file: string; name: string; text: string }[] = [];
  for (const file of sources) {
    const text = await Bun.file(file).text();
    texts.push({ file, name: basename(file), text });
    findings.push(...lintSource(text, file));
  }
  // A footage tile name the source text says was written by hand. A WARNING,
  // not a finding: it is a claim about what the text says rather than about
  // what the composition does, and the module states in its own header what
  // it cannot see. `openFootage` is what refuses a track whose tiles are
  // actually absent or the wrong size.
  const warnings: TileWarning[] = lintTileNames(
    texts,
    resolved.ok ? resolved.value.sidecar.footage.map((t) => t.nodePrefix) : [],
  );
  // A referenced still picture with no file behind it. Upstream bakes a
  // placeholder and succeeds, so this is the only place the loss is refused
  // rather than logged. It reads the build's module graph, not `sources`
  // above — see `src/lint/images.ts`.
  if (resolved.ok) {
    findings.push(
      ...(await lintImages({
        entryPath: resolved.value.entryPath,
        compositionDir: resolved.value.dir,
      })),
    );
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  warnings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const ok = diagnostics.length === 0 && findings.length === 0;
  const payload = {
    ok,
    diagnostics,
    findings,
    warnings,
    files: sources,
    sidecarPath: sidecarPath ?? null,
  };

  const stderrLines: string[] = [];
  for (const d of diagnostics) {
    stderrLines.push(
      `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
    );
  }
  for (const f of findings) {
    stderrLines.push(
      `${f.file}:${f.line}:${f.column}: ${f.code}: ${f.message}`,
    );
  }
  for (const w of warnings) {
    stderrLines.push(
      `${w.file}:${w.line}:${w.column}: warning: ${w.code}: ${w.message}`,
    );
  }

  // A warning is counted in the line, so a clean-looking `lint ok` cannot
  // hide one, and does not change the verdict.
  const warned = warnings.length > 0 ? `, ${warnings.length} warning(s)` : "";

  if (ok) {
    return {
      exitCode: EXIT_OK,
      json: payload,
      stdoutLines: [
        `lint ok — ${sources.length} file(s), sidecar valid, mount-only, every referenced image on disk${warned}`,
      ],
      stderrLines,
    };
  }

  return {
    exitCode: EXIT_FAIL,
    json: payload,
    stdoutLines: [
      `lint failed — ${diagnostics.length} sidecar diagnostic(s), ${findings.length} finding(s)${warned}`,
    ],
    stderrLines,
  };
}

/** argv form used by main.ts */
export async function runFromArgv(
  argv: readonly string[],
): Promise<CommandResult> {
  const parsed = parseArgs(["lint", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  return run({ dir, flags: parsed.global });
}
