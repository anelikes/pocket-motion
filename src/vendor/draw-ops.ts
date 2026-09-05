/**
 * The draw-list op codes this repository owns, and where they live.
 *
 * `contracts/spec/spec.ts` in the vendored tree pins `DRAW_OP`, and every
 * backend upstream ships parses the stream by those numbers with a closed set
 * — an op it does not know stops the frame (`raster.rs`: "anything else means
 * corrupt data"). Upstream allocates its codes densely from 1. So an op this
 * repository adds for its own rasteriser (a mask, a blur — things a PSP or an
 * ESP32 will never draw and upstream will never take) has to sit where
 * upstream's next allocation cannot land on it.
 *
 * The reason is measured, not imagined: `patches/0008` gave POLY the code 10,
 * the next free number at the pin, and upstream main has since given 10 to
 * `surfaceQuad`. Two backends reading the same word as two different ops is
 * the outcome the range exists to rule out.
 *
 * `tests/patches.test.ts` holds it from both sides: every `DRAW_OP` key in the
 * vendored spec that is named here is at or above the base, every other one
 * is below it, and no two keys share a number.
 */

/** First op code this repository may allocate; upstream stays below it. */
export const MOTION_DRAW_OP_BASE = 64;

/**
 * `DRAW_OP` keys in the vendored spec that a pocket-motion-only patch added.
 * `patches/README.md` says which patches are that class; today it is 0013,
 * the mask op.
 */
export const MOTION_DRAW_OPS: readonly string[] = ["maskPush", "maskPop"];
