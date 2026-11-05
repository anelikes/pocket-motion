# Segments: a film split across processes and joined

Apple M4 (4 P-cores + 6 E-cores, 32 GB), Bun 1.3.11, ffmpeg 8.0, 2026-11-05.
The machine was shared with other sessions throughout; every row carries the
1-minute load average read before and after it.

`render --range <first>..<last>` renders one segment and writes its manifest;
`concat` joins segments; `render --workers N` is N of the first and the join,
on one machine (`src/render/segment.ts`, `src/render/parallel.ts`).

## Equality with the ledger

`baselines/segments/ledger.ts` renders every composition in
`baselines/digests.json` with `render --workers N` to an mp4 and holds its
digest to the recorded one.

LEDGER_RESULTS

## What the join's read-back found

The first sweep, at `--workers 4`, failed 5 of 42 compositions — not on a
digest, which was right in all five, but in the join's own read-back of the
joined MP4: `burn-zh`, `gradients`, `reel`, `shutter` and `stroke`, each
presenting one segment's first frame 5 or 10 ticks of 1/15360 early, and
every one a split into unequal segments (101 frames as 26/25/25/25, 30 as
8/8/7/7). The concat demuxer offsets each file by the one before's
container duration, and an x264 MP4's duration passes through its edit list,
which quantises it: a 26-frame segment at 30 fps reads 13302 ticks where its
frames span 13312. Every segment's duration is now written into the concat
list from its frame count, in microseconds of the cumulative boundary; the
five re-ran equal, and `tests/segments.test.ts` holds a 16/15/15/15 split's
timestamps to exactly `i × 512`.

Two other facts the join rests on, measured on ffmpeg 8.0 before it was
written (synthetic `testsrc2` frames through the encode leg's exact argv):

- libx264 `medium` writes a two-frame reorder delay (first dts at pts − 1024
  of 1/15360 at 30 fps) for a segment of 3 or more frames and none for 1 or
  2. A 1-frame segment between two long ones made the concat demuxer print
  `Non-monotonic DTS … changing to …`. `concat` measures each segment's delay
  and refuses a set that differs at a boundary; `--workers` never cuts a
  segment shorter than 3 frames.
- WebM's millisecond time base cannot hold 1/30 s, and the demuxer's offset
  is the rounded duration: 39 of 90 joined timestamps came out 1 ms early
  against a one-shot encode (31/1/58 split). Rewriting them from the packet
  index (`setts=ts=round(N/(30*TB))`) made all 90 equal to the one-shot's,
  and the AlphaMode element and libvpx's `yuva420p` decode survived it.

## Wall time and CPU

`baselines/segments/bench.ts`: each configuration is the CLI as a child
process; CPU is user + system from `wait4`, which on macOS includes every
reaped descendant — workers and their ffmpeg. Encode settings are the
defaults (libx264 `medium`, CRF 16).

BENCH_RESULTS
