/**
 * Resolve every declared sound `src` to a path on disk.
 *
 * A declared file that is not on disk is an error. There is no candidate
 * list and no bed-only fallback: that is the shape that let a film ship
 * without the voice its brief called load-bearing.
 *
 * Paths are repo-relative, the same way `footage[].src` and `fonts.*` are.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { repoRootOf } from "../cli/resolve.ts";
import {
  dialogueCompositionFrame,
  type Diagnostic,
  type MotionSidecar,
} from "../manifest/sidecar.ts";

export type ResolvedSoundRole = "bed" | "narration" | "dialogue" | "cue";

export interface ResolvedSoundElement {
  readonly id: string | null;
  readonly role: ResolvedSoundRole;
  readonly src: string;
  /** Absolute path when the file is on disk; null when it is not. */
  readonly path: string | null;
  /** JSON pointer to the `src` that produced this element. */
  readonly pointer: string;
  /** Dialogue only: composition frame the line starts at. */
  readonly compositionFrame?: number;
  readonly track?: string;
  readonly sourceFrame?: number;
  /**
   * Source duration in seconds, from ffprobe. Set by `probeSoundDurations`.
   * The graph builder uses this for duck windows; it does not probe itself.
   */
  readonly durationSec?: number;
}

export interface ResolveSoundResult {
  readonly ok: boolean;
  readonly elements: readonly ResolvedSoundElement[];
  readonly diagnostics: readonly Diagnostic[];
  readonly repoRoot: string;
}

function diag(code: string, path: string, message: string): Diagnostic {
  return { code, path, message };
}

function missingMessage(label: string, abs: string, src: string): string {
  const head = `${label} this composition declares is not on disk: ${abs}`;
  if (src === "assets" || src.startsWith("assets/") || src.startsWith("assets\\")) {
    return (
      `${head}\n` +
      "Fetch the digest-pinned assets with:\n  bun scripts/assets.ts"
    );
  }
  return head;
}

function resolveOne(
  repoRoot: string,
  src: string,
  pointer: string,
  label: string,
  diagnostics: Diagnostic[],
): string | null {
  const abs = resolve(repoRoot, src);
  if (existsSync(abs)) return abs;
  diagnostics.push(
    diag("sound.src.missing", pointer, missingMessage(label, abs, src)),
  );
  return null;
}

export function resolveSound(
  sidecar: MotionSidecar,
  compositionDir: string,
): ResolveSoundResult {
  const repoRoot = repoRootOf(compositionDir);
  const diagnostics: Diagnostic[] = [];
  const elements: ResolvedSoundElement[] = [];
  const sound = sidecar.sound;
  const footageById = new Map(sidecar.footage.map((t) => [t.id, t]));

  if (sound.bed) {
    const path = resolveOne(
      repoRoot,
      sound.bed.src,
      "/sound/bed/src",
      "the bed",
      diagnostics,
    );
    elements.push({
      id: null,
      role: "bed",
      src: sound.bed.src,
      path,
      pointer: "/sound/bed/src",
    });
  }

  for (let i = 0; i < sound.narration.length; i++) {
    const line = sound.narration[i]!;
    const pointer = `/sound/narration/${i}/src`;
    const path = resolveOne(
      repoRoot,
      line.src,
      pointer,
      `the narration line ${JSON.stringify(line.id)}`,
      diagnostics,
    );
    elements.push({
      id: line.id,
      role: "narration",
      src: line.src,
      path,
      pointer,
    });
  }

  for (let i = 0; i < sound.dialogue.length; i++) {
    const line = sound.dialogue[i]!;
    const pointer = `/sound/dialogue/${i}/src`;
    const path = resolveOne(
      repoRoot,
      line.src,
      pointer,
      `the dialogue line ${JSON.stringify(line.id)}`,
      diagnostics,
    );
    const track = footageById.get(line.track);
    const compositionFrame = track
      ? dialogueCompositionFrame(line, track)
      : undefined;
    elements.push({
      id: line.id,
      role: "dialogue",
      src: line.src,
      path,
      pointer,
      ...(compositionFrame !== undefined ? { compositionFrame } : {}),
      track: line.track,
      sourceFrame: line.sourceFrame,
    });
  }

  for (let i = 0; i < sound.cues.length; i++) {
    const cue = sound.cues[i]!;
    const pointer = `/sound/cues/${i}/src`;
    const path = resolveOne(
      repoRoot,
      cue.src,
      pointer,
      `the cue ${JSON.stringify(cue.id)}`,
      diagnostics,
    );
    elements.push({
      id: cue.id,
      role: "cue",
      src: cue.src,
      path,
      pointer,
    });
  }

  return {
    ok: diagnostics.length === 0,
    elements,
    diagnostics,
    repoRoot,
  };
}

/**
 * Probe each on-disk element's duration with ffprobe.
 *
 * This is a Provider fact: the mixer needs the length of a narration file
 * to build a duck envelope, and it must not spawn a process to find out.
 * A file that is not on disk is left without a duration; a file that is
 * on disk but cannot be probed is an error.
 */
export async function probeSoundDurations(
  elements: readonly ResolvedSoundElement[],
): Promise<readonly ResolvedSoundElement[]> {
  const out: ResolvedSoundElement[] = [];
  for (const el of elements) {
    if (el.path === null) {
      out.push(el);
      continue;
    }
    out.push({ ...el, durationSec: await probeAudioDuration(el.path) });
  }
  return out;
}

export async function probeAudioDuration(path: string): Promise<number> {
  const p = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const text = (await new Response(p.stdout).text()).trim();
  const err = (await new Response(p.stderr).text()).trim();
  if ((await p.exited) !== 0) {
    throw new Error(
      `PocketJS Motion: ffprobe failed on ${path}${err ? `\n${err}` : ""}`,
    );
  }
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(
      `PocketJS Motion: ffprobe returned a non-duration for ${path}: ${JSON.stringify(text)}`,
    );
  }
  return n;
}
