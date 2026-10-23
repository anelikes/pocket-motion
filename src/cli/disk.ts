/**
 * What a full ledger run costs in disk, and what this tree is already
 * holding — in one place, because two things ask.
 *
 * `scripts/digests.ts` asks before it starts, and prints the banner below its
 * own name. `doctor` asks so a fresh clone finds out before the first ingest
 * rather than from ffmpeg's `No space left on device`, which is the message
 * the wall actually produced and which mentions nothing about capacity.
 *
 * THE FIGURE IS NOW MEASURED FROM THIS TREE, which is what lets it be a gate
 * at all. It used to be a HIGH-WATER MARK carried from another one: 52 `.rgba`
 * files totalling 64 GiB on 2026-08-20, when the ledger still covered the
 * study deliveries, and 92 files totalling 120 GB during one merge. Phase B
 * removed that footage. Everything the ledger decodes today comes from the three
 * compositions that draw synthetic clips, and the number below was read off a full run rather
 * than remembered — so `doctor` can say "this volume cannot hold a full run"
 * and mean it, instead of failing every hosted runner against a tree that no
 * longer exists. A standard GitHub runner has about 14 GiB free; against 64
 * that was red on every push, and the sentence it printed was true about
 * 2026-08-20 and false about this repository.
 *
 * What the number CANNOT do is predict a tree it has not seen:
 * `baselines/ingest-bytes.json` pins each artifact's digest and frame count,
 * not its decoded size, so a composition added tomorrow moves the need and
 * nothing here would know. That is why `scripts/digests.ts` re-measures at the
 * end of a full run and says so when what it left disagrees with the constant
 * — the same shape as the ledger itself, where a figure that stops being true
 * is reported rather than believed.
 */

import { join, resolve } from "node:path";

/** The repository root — this module sits at `src/cli/`. */
const ROOT = resolve(import.meta.dir, "../..");

/**
 * Decoded RGBA a full `bun scripts/digests.ts` leaves under `dist/`.
 *
 * Measured on the date below by clearing `dist/**\/*.rgba`, running the whole
 * ledger serially (38 compositions, all matching; re-read 2026-10-23 at 40,
 * after the rebase onto pin 66caf4e5, to the byte), and totalling what was
 * left: six files — four `footage-tracks` windows, one `sound-roles` clip,
 * and the clip `captions/burn-zh` burns its captions into — at 1,381,017,600
 * bytes exactly. That last one is 659,865,600 of it on its own: ingest
 * decodes the whole 179-frame source at the drawn 720×1280 although the
 * sample's window is 101 frames, because the decode is keyed on the source
 * and not on the window (`src/cli/footage.ts`).
 *
 * Bytes rather than GiB because that is what was read; the GiB the callers
 * print is derived, so the two can never drift apart by a rounding.
 */
export const FULL_RUN_RGBA_BYTES = 1_381_017_600;

/** How many files that was, for the sentence that prints it. */
export const FULL_RUN_RGBA_FILES = 6;

/** The day the figure above was measured. */
export const FULL_RUN_RGBA_MEASURED = "2026-10-22";

/** `FULL_RUN_RGBA_BYTES` in the unit `freeGiB` reports. */
export const FULL_RUN_NEED_GIB = FULL_RUN_RGBA_BYTES / 1073741824;

/**
 * How much more than the need is "comfortable", for the warning band.
 *
 * A run needs its own bytes and then some: the paks and bundles beside them,
 * whatever the encode leg writes, and the next run's decode landing before the
 * last one is deleted. Three is a stated choice rather than a measurement, and
 * it is stated here so the sentence can name the number it came from — below
 * it `doctor` says the headroom is thin and still passes, because a thin
 * volume that fits is not a broken checkout.
 */
export const HEADROOM_MULTIPLE = 3;

/** Free space below which the tree is reported as tight but workable. */
export const FULL_RUN_COMFORTABLE_GIB = FULL_RUN_NEED_GIB * HEADROOM_MULTIPLE;

/**
 * One rendering of a size, so the banner and the check cannot disagree.
 *
 * Sub-GiB figures print in MiB: "0.7 GiB" for the need would round two
 * different trees to the same sentence, and the whole point of the constant
 * above is that it is a measurement.
 */
export function formatGiB(gib: number): string {
  return gib < 1 ? `${Math.round(gib * 1024)} MiB` : `${gib.toFixed(1)} GiB`;
}

/** Free space in GiB on the volume holding `path`, or null if `df` cannot say. */
export async function freeGiB(path: string): Promise<number | null> {
  try {
    const proc = Bun.spawn(["df", "-kP", path], { stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return null;
    const last = out.trim().split("\n").at(-1);
    const availKiB = Number(last?.trim().split(/\s+/)[3]);
    return Number.isFinite(availKiB) ? availKiB / 1048576 : null;
  } catch {
    return null;
  }
}

/**
 * Every `.rgba` under the dist root, with its size.
 *
 * ONE root: `<repo>/dist`, whatever depth a composition sits at
 * (`src/cli/resolve.ts`). It was three, keyed on the composition's depth, and
 * scanning only the first reported 5 files holding 5.7 GiB on a tree that was
 * holding 52 files and 63.4 GiB — the warning named a tenth of what it was
 * warning about. Both halves of that are fixed now, and the
 * `find dist -name '*.rgba' -delete` both callers print reaches everything
 * this counts.
 *
 * The `dist`-at-any-depth rule still holds for anything that WALKS the source
 * tree (`src/cli/discover.ts`, `src/preview/reload.ts`): a build run by hand
 * with its own `--outdir`, and every leftover of the three-root arrangement,
 * still lands inside `compositions/`.
 */
export async function strayRgba(
  root: string = ROOT,
): Promise<{ count: number; gib: number }> {
  const glob = new Bun.Glob("**/*.rgba");
  let count = 0;
  let bytes = 0;
  try {
    for await (const abs of glob.scan({ cwd: join(root, "dist"), absolute: true })) {
      const size = Bun.file(abs).size;
      if (size > 0) {
        count++;
        bytes += size;
      }
    }
  } catch {
    /* a root that does not exist yet holds nothing */
  }
  return { count, gib: bytes / 1073741824 };
}

/** The command that reclaims what `strayRgba` counted. */
export const RECLAIM_COMMAND = "find dist -name '*.rgba' -delete";
