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

**42 of 42 equal at `--workers 7`**, with the code in this change: the 30
films of 30 frames or more split seven ways, the twelve of 1 or 2 frames
rendered as one segment. That covers shutter exposures (`shutter`,
`shutter-blur`), footage held and presented (`footage-tracks`,
`sound-roles`, `captions/burn-zh`), a 2100-frame camera track
(`long-track`), supersampling (`timeline`) and all seven caption
compositions. The first sweep, at `--workers 4` and before the fix below,
matched on 37 and stopped on the other five in the join's own read-back;
those five matched when re-run at `--workers 4` after it.

## What the join's read-back found

The first sweep, at `--workers 4`, failed 5 of 42 compositions — not on a
digest, since the command stopped before it reported one, but in the join's
own read-back of the joined MP4: `burn-zh`, `gradients`, `reel`, `shutter`
and `stroke`, each presenting one segment's first frame 5 or 10 ticks of
1/15360 early, and every one a split into unequal segments (101 frames as
26/25/25/25, 30 as 8/8/7/7). The concat demuxer offsets each file by the one
before's container duration, and an x264 MP4's duration passes through its
edit list, which can come out short of its frames: a 26-frame segment of
synthetic `testsrc2` frames reads 13302 ticks where its frames span 13312,
and a 25-frame one reads exactly 12800. It is the bitstream that decides,
not the length alone — `gradients`' first 8-frame segment is exact and its
second is not. Every segment's duration is now written into the concat list
from its frame count, in microseconds of the cumulative boundary; the five
re-ran equal, and `tests/segments.test.ts` holds `gradients` at
`--workers 4` to timestamps of exactly `i × 512`, a case that goes red with
the duration lines removed.

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

Two films. `reel`: 1071 frames at 1920×1080, 30 fps, with a mix.
hajibang's ranking: the port's generated `sample-full` request
(`compositions/hajibang-top-reveal/`, branch `claude/angry-carson-0abed5`,
generated into the gitignored `out/` and copied here to measure), 1665 frames
at 1080×1920, 30 fps, with 34 sound cues. Every configuration below produced
one digest per film: `adfa3b52…` and `1d02a31e…`.

### On one machine: `render --workers N`

| film | workers | wall s | CPU s | CPU / wall | load before → after |
|---|---|---:|---:|---:|---|
| reel | none (one process) | 14.1 | 31.8 | 2.25 | 12.3 → 11.8 |
| reel | 1 | 16.5 | 39.0 | 2.36 | 11.8 → 13.5 |
| reel | 2 | 13.0 | 41.4 | 3.17 | 13.5 → 14.3 |
| reel | 4 | 14.2 | 45.4 | 3.19 | 14.3 → 16.3 |
| reel | 8 | 14.9 | 53.6 | 3.60 | 16.3 → 19.5 |
| ranking | none (one process) | 43.5 | 87.7 | 2.02 | 18.7 → 14.2 |
| ranking | 1 | 43.7 | 96.3 | 2.20 | 14.2 → 11.6 |
| ranking | 2 | 44.7 | 106.0 | 2.37 | 11.6 → 18.4 |
| ranking | 4 | 38.8 | 111.4 | 2.87 | 18.4 → 25.1 |
| ranking | 8 | 47.5 | 120.2 | 2.53 | 25.1 → 25.4 |

**On this machine, as loaded, `--workers` saved at most 8 % (`reel`, 2
workers) and 11 % (the ranking, 4 workers) of wall time, was slower than one
process at 8 workers on both, and cost 21–69 % more CPU at 2 to 8 workers.** A one-process render already keeps more than two
cores busy — one raster thread and a multi-threaded libx264 — and the
other sessions on the machine held its 1-minute load between 12 and 25 on
10 cores, so N workers mostly compete for the cores libx264 was already using.
That is the plateau `baselines/phase5-throughput.md` measured for the earlier
`parallel.ts` with an encoder in the loop (1.19× at 4 workers), and it says
nothing about an idle machine, which this was not at any point. `--workers 1`
is the cost of the mechanism itself: one more process, the join and its
read-back, +2.4 s wall and +7.2 s CPU on `reel`, most of it decoding the film
twice to compare frames.

### Across machines: segments rendered one at a time

`bench.ts --segments N` renders each segment alone, one after another, so
each row is what that segment costs on a machine of its own, then runs
`concat` over all of them. The ranking is split 16 ways because hajibang's
SCF pipeline renders it in 16 chunks.

| film | segments | whole, wall / CPU | one segment alone, wall | one segment alone, CPU | sum of segment CPU | `concat` wall / CPU |
|---|---:|---|---|---|---:|---|
| ranking | 16 | 51.3 s / 92.4 s | 1.8–4.2 s | 4.5–7.2 s | 100.7 s | 8.0 s / 20.5 s |
| reel | 4 | 14.6 s / 32.4 s | 3.2–3.8 s | 8.0–9.2 s | 34.7 s | 3.7 s / 9.2 s |
| reel | 8 | 13.6 s / 32.4 s | 1.5–2.3 s | 4.3–5.0 s | 38.1 s | 3.9 s / 10.6 s |

Load 13–20 throughout. The segments together cost 7–18 % more CPU than the
whole render — each
segment boots, folds and starts an encoder of its own — and **with one
machine per segment the critical path is the slowest segment plus the join:
4.2 + 8.0 s against 51.3 s for the ranking, 3.8 + 3.7 s against 14.6 s for
`reel` in four.** Folding is not where a late segment's time goes: the
ranking's last segment folds through 1561 frames and was the fastest of the
16, at 1.8 s.

The join is the largest single step once segments run in parallel. On the
ranking, timed piece by piece in a second run whose whole `concat` took
10.5 s: the stream copy is 0.36 s, decoding the joined film for the
read-back 2.4 s, and decoding the 16 segments for comparison 3.0 s
(concurrently with it); the rest is probing each segment, hashing the
identity's inputs (the CJK face alone is 25 MB) and the sound mux.

### What these numbers do not cover

- SCF itself. Nothing here ran there. The one bridge measured so far is
  HyperFrames' capture, 62 ms a frame on this Mac and 186 ms on SCF
  (`docs/hajibang-top-reveal-port.md` on its branch); whether pocket-motion's
  raster and libx264 scale by the same factor is not known.
- An idle machine. Every row was taken beside other sessions' builds and
  tests.
- Encoder settings other than the defaults. A different preset or encoder
  changes how much of a segment's time is libx264, and `concat` refuses to
  mix encoder argvs, so it cannot change between segments of one film.
