/**
 * The reel's sound, in one table.
 *
 * Sound is a timeline asset, not a shot asset — the shots contain no audio
 * references at all, so a shot can be re-cut without invalidating the mix, and
 * the whole mix can be read at a glance. (The discipline is borrowed from
 * video-shotcraft's `references/sound-design.md`, which arrived at it after a
 * round of picture changes wiped an entire SFX pass.)
 *
 * Every cue is pinned to the beat grid in `beats.ts`, because the picture is.
 */

import { BAR, beat, bar } from "./beats.ts";

export interface Cue {
  /** ms from the first frame */
  readonly at: number;
  /** file under assets/audio/sfx/, without the extension */
  readonly src: string;
  readonly gain: number;
  /** what it is on for — a cue with no picture action behind it is padding */
  readonly note: string;
}

/**
 * The bed. Starts at 15.46 s into the track, which is bar 8 — the point where
 * the groove is fully in. That entry also puts the track's drop (28.61 s) at
 * video 13.16 s, the reel's midpoint, where the room turns.
 *
 * 0.30 gain leaves headroom for the cues to read without ducking.
 */
export const BGM = {
  src: "assets/audio/cat-walk.mp3",
  startAt: 15.46,
  gain: 0.3,
  fadeInMs: 600,
  fadeOutMs: 1800,
} as const;

/**
 * No cues.
 *
 * There were 18, pinned to picture actions and mixed at measured levels, and
 * they were still wrong: whooshes and hits on a piece whose motion is already
 * carried by a driving house track read as an impression of sound design
 * rather than sound design. The bed lands the cuts on its own — the reel's
 * beats and the track's beats are the same grid — and a cue that only tells
 * you a thing moved, when you can already see it move, is padding with a
 * volume control.
 *
 * The mixer still takes cues (`scripts/build-reel.ts`), so this is a decision
 * rather than a missing feature. Anything added back needs a picture action
 * that the music does not already mark.
 */
export const SFX: readonly Cue[] = [];
