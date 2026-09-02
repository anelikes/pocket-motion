/**
 * The beat grid the whole reel is pinned to — picture and sound both.
 *
 * Measured from the track rather than taken from its metadata: energy-envelope
 * onset detection, then autocorrelation over 60–190 BPM, then a phase search
 * (`scripts/beatgrid.ts`). The library that supplied the track states ~129 BPM;
 * the measurement says 127.7, and a 1.3 BPM error accumulates to most of a beat
 * over a 34 s reel, so the difference is not academic.
 *
 * A beat is 14.1 frames at 30 fps, so cuts land within half a frame of the
 * grid rather than exactly on it. That is inaudible; forcing an integer by
 * pretending the track is 128 BPM would not be.
 */

export const BPM = 127.7;
export const BEAT = 60_000 / BPM; // 469.85 ms
export const BAR = BEAT * 4; // 1879.4 ms

/** ms at beat n (fractional beats allowed — `beat(2.5)` is the and-of-3) */
export const beat = (n: number): number => Math.round(n * BEAT);

/** ms at bar n */
export const bar = (n: number): number => Math.round(n * BAR);

/**
 * 19 bars.
 *
 * 18 was tried and left dead air the content could not fill, so the cut came
 * back to 15. It is 19 now because two shots the storyboard had listed as still
 * open finally landed — the cross-platform hash and the sub-pixel beat — and
 * both were inserted AFTER bar 7. That matters more than the count: the track's
 * drop is pinned to bar 7, so anything added ahead of it would have pulled the
 * drop off the turn it was chosen to land on.
 */
export const BARS = 19;
export const END_MS = bar(BARS);
export const FPS = 30;
export const FRAMES = Math.round((END_MS / 1000) * FPS);
