/**
 * The decisions the preview pages make, as functions rather than as lines
 * inside a template string.
 *
 * A page's script is a string this process emits. Nothing in it can be
 * imported, so nothing in it can be run by a test — the suite could only ever
 * assert that a particular LINE APPEARS, which is an assertion about a guard
 * and not a guard. `tests/preview.test.ts:848` already carries one of those
 * and the review named it.
 *
 * These three are where that mattered: each was a one-line expression in the
 * page that was wrong, and each is now a function the tests call directly and
 * the pages get through `inlineDecisions`, which emits the function's own
 * source. One copy, and it is the copy under test. So each must close over
 * nothing — no imports, no module constants, no `EventSource` — because in
 * the page there is nothing around it.
 */

/**
 * The frame a transport box is asking for, or null to leave the picture where
 * it is.
 *
 * `Number("")` is 0. Clearing the box to type a number in it, or clearing it
 * and tabbing away, asked for frame 0 — so the film jumped to the start on
 * the way to somewhere else. Both pages had their own copy of this line and
 * both were wrong the same way.
 */
export function frameFromBox(value: string, last: number): number | null {
  const text = String(value).trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(last, Math.round(n)));
}

/**
 * Is the transport running — asked of the source that actually owns it.
 *
 * `enterFrames()` pauses the `<video>` on its way out, and a `pause` event
 * lands asynchronously: after `setPlaying(wasPlaying)` has already turned the
 * button back on. So a rebuild that dropped back to the session's own frames
 * left the picture moving under a Play icon, and the button's state was
 * decided by whichever event happened to fire last rather than by what was
 * playing.
 */
export function transportRunning(
  mode: string,
  playingFrames: boolean,
  videoPaused: boolean,
): boolean {
  return mode === "video" ? !videoPaused : playingFrames;
}

/**
 * Whether the pill should say the host is gone, when the event stream errors.
 *
 * The condition used to be `readyState === EventSource.CLOSED`. CLOSED means
 * the browser has GIVEN UP, and for a host that simply stopped answering it
 * never does: it retries on the `retry: 1000` this server sends, so
 * `readyState` sits at CONNECTING and the one message the pill exists to show
 * was unreachable. A dead preview looked exactly like a quiet one.
 *
 * `readyState` is EventSource's — 0 CONNECTING, 1 OPEN, 2 CLOSED — written as
 * numbers because this runs in the page with nothing around it.
 */
export function reportsDisconnected(
  readyState: number,
  errors: number,
  msSinceOpen: number,
): boolean {
  if (readyState === 1) return false; // a blip on a stream that is still up
  if (readyState === 2) return true; // the browser has given up for good
  // CONNECTING, so it is retrying. The host sends `retry: 1000`, which makes
  // a second failed attempt about two seconds of a host that is not there.
  // The elapsed time is the backstop for a browser that backs off further.
  return errors >= 2 || msSinceOpen >= 3000;
}

/**
 * The source of these functions, for pasting into a page script.
 *
 * Each `<script type="module">` has its own scope, so a block gets the ones it
 * uses. `Function.prototype.toString()` returns the transpiled source, types
 * already stripped.
 */
export function inlineDecisions(
  fns: ReadonlyArray<(...args: never[]) => unknown>,
): string {
  return fns.map((fn) => fn.toString()).join("\n");
}
