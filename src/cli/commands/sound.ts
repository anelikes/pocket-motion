/**
 * `sound <composition-dir>`
 * Question: what does this composition declare for sound, and does every
 * declared file resolve?
 *
 * `--verify <file>` adds a second question: did each declared element
 * contribute to this mix, at its offset? The check builds the mix without
 * that element and measures the residual, so a bed already playing at
 * the offset cannot hide an absent line. It reads only the windows where
 * the source and the declared level together have something to contribute
 * — a pause inside a line, or an envelope at 0, is not evidence the line is
 * missing. Where the declaration varies a level (an envelope, a duck) it
 * also measures that level once per piece; a constant level is not checked.
 * A declared silent tail is read sample by sample. It does not check
 * overlap, or that the file is the right audio. An optional element whose
 * file is not on disk is reported `skipped`, here and under `--verify`.
 *
 * Dialogue lines also report the composition frame they land on — that is
 * the mapping the mixer uses, and the reason dialogue is clip-relative.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SILENT_TAIL_GUARD_MS } from "../../manifest/sidecar.ts";
import { resolveSound } from "../../sound/resolve.ts";
import { describeTail } from "../../sound/tail.ts";
import { VERIFY_LEVEL_TOLERANCE_DB, verifyMix } from "../../sound/verify.ts";
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
      ...(declared.silentTailMs !== undefined ? { silentTailMs: declared.silentTailMs } : {}),
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
    const status =
      el.path !== null ? "ok" : el.optional === true ? "SKIPPED" : "MISSING";
    const who = el.id ?? "—";
    let extra = "";
    if (el.role === "dialogue") {
      extra =
        el.compositionFrame !== undefined
          ? `  ${el.track} sourceFrame ${el.sourceFrame} → composition ${el.compositionFrame}`
          : `  ${el.track} sourceFrame ${el.sourceFrame}`;
    }
    if (el.optional === true) {
      extra += el.path === null ? "  (optional, not on disk: render skips it)" : "  (optional)";
    }
    lines.push(
      `  ${pad(el.role, 10)} ${pad(who, 16)} ${status.padEnd(8)} ${el.src}${extra}`,
    );
  }
  if (declared.silentTailMs !== undefined) {
    lines.push(
      `  ${pad("tail", 10)} ${pad("—", 16)} ${"".padEnd(8)} last ${declared.silentTailMs} ms digital silence; ` +
        `sound stops ${SILENT_TAIL_GUARD_MS} ms before it and the bed's fade-out completes there`,
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
    const db = (n: number): string =>
      n === Number.NEGATIVE_INFINITY ? "-inf" : n === Number.POSITIVE_INFINITY ? "+inf" : n.toFixed(1);
    const verifyLines: string[] = [];
    for (const el of checked.elements) {
      const who = el.id ?? "—";
      const src = el.sourceRmsDb === null ? "source —" : `source ${db(el.sourceRmsDb)} dB`;
      const residual =
        el.residualRmsDb === null ? "residual —" : `residual ${db(el.residualRmsDb)} dB`;
      verifyLines.push(
        `  ${el.status.padEnd(15)} ${who}  ${src}  ${residual}  @ ${el.offsetSec.toFixed(3)}s`,
      );
      if (el.level !== undefined) {
        for (const w of el.level.windows) {
          verifyLines.push(
            `    level ${w.ok ? "ok      " : "MISMATCH"} @ ${w.atSec.toFixed(3)}s  measured ${db(w.measuredDb)} dB  ` +
              `declared ${db(w.expectedMinDb)}..${db(w.expectedMaxDb)} dB`,
          );
        }
        if (el.level.unexamined > 0) {
          verifyLines.push(
            `    level: ${el.level.unexamined} piece(s) not examined — shorter than a window and its margins, or nothing above the floor there`,
          );
        }
      }
    }
    if (checked.tail !== undefined) verifyLines.push(`  ${describeTail(checked.tail)}`);
    const claim =
      "verify reports a residual against the mix without that element " +
      "(−50 dBFS over 100 ms), in the sampled windows where the source and " +
      "its declared level are above that floor, and the level itself (±" +
      `${VERIFY_LEVEL_TOLERANCE_DB} dB) once per piece where the declaration varies it; ` +
      "it does not check a constant level, overlap, or that the file is the right audio";
    const skipped = checked.elements.filter((e) => e.status === "skipped").length;
    if (!checked.ok) {
      return {
        exitCode: EXIT_FAIL,
        json: verifyPayload,
        stdoutLines: [
          `sound verify failed — ${checked.elements.filter((e) => e.status !== "present" && e.status !== "skipped").length} of ${checked.elements.length} not present` +
            (checked.tail !== undefined && !checked.tail.ok ? ", silent tail not met" : ""),
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
        `sound verify ok — ${checked.elements.filter((e) => e.status === "present").length} present at declared offset` +
          (skipped > 0 ? `, ${skipped} optional skipped (not on disk, nothing examined)` : "") +
          (checked.tail !== undefined ? ", silent tail met" : ""),
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
      sound.elements.some((e) => e.path === null)
        ? `sound ok — ${sound.elements.length} declared, ` +
          `${sound.elements.filter((e) => e.path === null).length} optional not on disk (render skips it), the rest on disk`
        : `sound ok — ${sound.elements.length} declared, all on disk`,
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
