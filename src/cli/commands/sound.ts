/**
 * `sound <composition-dir>`
 * Question: what does this composition declare for sound, and does every
 * declared file resolve?
 *
 * `--verify <file>` adds a second question: did each declared element
 * contribute to this mix, at its offset? The check builds the mix without
 * that element and measures the residual, so a bed already playing at
 * the offset cannot hide an absent line. It reads only the windows where
 * the source itself has something to contribute — a pause inside a line
 * is not evidence the line is missing. It does not check levels, ducking
 * depth, overlap, or that the file is the right audio.
 *
 * Dialogue lines also report the composition frame they land on — that is
 * the mapping the mixer uses, and the reason dialogue is clip-relative.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSound } from "../../sound/resolve.ts";
import { verifyMix } from "../../sound/verify.ts";
import {
  UsageError,
  optionalString,
  parseArgs,
  requirePositional,
} from "../args.ts";
import { resolveComposition } from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";

export interface SoundOptions {
  readonly dir: string;
  readonly flags: GlobalFlags;
  /** Produced mix to check, when set. */
  readonly verify?: string;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

export async function run(options: SoundOptions): Promise<CommandResult> {
  const resolved = await resolveComposition({
    dir: options.dir,
    flags: options.flags,
    requireBundle: false,
  });

  if (!resolved.ok && resolved.kind === "usage") {
    throw new UsageError(resolved.message);
  }

  if (!resolved.ok && resolved.kind === "sidecar") {
    const diagnostics = resolved.diagnostics ?? [];
    return {
      exitCode: EXIT_FAIL,
      json: {
        ok: false,
        diagnostics,
        elements: [],
        sidecarPath: resolved.sidecarPath ?? null,
      },
      stdoutLines: [
        `sound failed — ${diagnostics.length} sidecar diagnostic(s)`,
      ],
      stderrLines: diagnostics.map(
        (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
      ),
    };
  }

  if (!resolved.ok) {
    throw new UsageError(resolved.message);
  }

  const c = resolved.value;
  const sound = resolveSound(c.sidecar, c.dir);
  const declared = c.sidecar.sound;
  const payload = {
    ok: sound.ok,
    sound: {
      ...(declared.bed ? { bed: declared.bed } : {}),
      narration: declared.narration,
      dialogue: declared.dialogue,
      cues: declared.cues,
    },
    elements: sound.elements,
    diagnostics: sound.diagnostics,
    sidecarPath: c.sidecarPath,
  };

  const stderrLines = sound.diagnostics.map(
    (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
  );

  if (sound.elements.length === 0) {
    return {
      exitCode: EXIT_OK,
      json: payload,
      stdoutLines: ["sound ok — nothing declared"],
      stderrLines,
    };
  }

  const lines: string[] = [];
  for (const el of sound.elements) {
    const status = el.path === null ? "MISSING" : "ok";
    const who = el.id ?? "—";
    let extra = "";
    if (el.role === "dialogue") {
      extra =
        el.compositionFrame !== undefined
          ? `  ${el.track} sourceFrame ${el.sourceFrame} → composition ${el.compositionFrame}`
          : `  ${el.track} sourceFrame ${el.sourceFrame}`;
    }
    lines.push(
      `  ${pad(el.role, 10)} ${pad(who, 16)} ${status.padEnd(8)} ${el.src}${extra}`,
    );
  }

  if (!sound.ok) {
    return {
      exitCode: EXIT_FAIL,
      json: payload,
      stdoutLines: [
        `sound failed — ${sound.diagnostics.length} missing`,
        ...lines,
      ],
      stderrLines,
    };
  }

  if (options.verify !== undefined) {
    const produced = resolve(options.verify);
    if (!existsSync(produced)) {
      throw new UsageError(`--verify file not found: ${produced}`);
    }
    const checked = await verifyMix({
      sidecar: c.sidecar,
      elements: sound.elements,
      producedPath: produced,
      fps: c.fps,
    });
    const verifyPayload = {
      ...payload,
      ok: checked.ok,
      verify: checked,
    };
    const verifyLines = checked.elements.map((el) => {
      const who = el.id ?? "—";
      const src =
        el.sourceRmsDb === null
          ? "source —"
          : `source ${el.sourceRmsDb === Number.NEGATIVE_INFINITY ? "-inf" : el.sourceRmsDb.toFixed(1)} dB`;
      const residual =
        el.residualRmsDb === null
          ? "residual —"
          : `residual ${el.residualRmsDb === Number.NEGATIVE_INFINITY ? "-inf" : el.residualRmsDb.toFixed(1)} dB`;
      return `  ${el.status.padEnd(14)} ${who}  ${src}  ${residual}  @ ${el.offsetSec.toFixed(3)}s`;
    });
    const claim =
      "verify reports a residual against the mix without that element " +
      "(−50 dBFS over 100 ms), in the sampled windows where the source " +
      "itself is above that floor; it does not check levels, ducking, " +
      "overlap, or that the file is the right audio";
    if (!checked.ok) {
      return {
        exitCode: EXIT_FAIL,
        json: verifyPayload,
        stdoutLines: [
          `sound verify failed — ${checked.elements.filter((e) => e.status !== "present").length} of ${checked.elements.length} not present`,
          ...lines,
          ...verifyLines,
          claim,
        ],
        stderrLines,
      };
    }
    return {
      exitCode: EXIT_OK,
      json: verifyPayload,
      stdoutLines: [
        `sound verify ok — ${checked.elements.length} present at declared offset`,
        ...lines,
        ...verifyLines,
        claim,
      ],
      stderrLines,
    };
  }

  return {
    exitCode: EXIT_OK,
    json: payload,
    stdoutLines: [
      `sound ok — ${sound.elements.length} declared, all on disk`,
      ...lines,
    ],
    stderrLines,
  };
}

export async function runFromArgv(
  argv: readonly string[],
): Promise<CommandResult> {
  const parsed = parseArgs(["sound", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  const verify = optionalString(parsed.flags, "verify");
  return run({ dir, flags: parsed.global, verify });
}
