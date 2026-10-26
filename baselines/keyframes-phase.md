# The grid's phase: measurements, 2026-10-26

What moved when `keyframes` stopped placing the render's grid at the FIRST
tick of each frame's window, `f × 60 / fps`, and placed it at the last,
`(f + 1) × 60 / fps − 1` — `clockOfFrame` in `src/runtime/clock.ts`.
Reproducer for the tables: [`keyframes-phase/measure.ts`](keyframes-phase/measure.ts),
which reads the earlier grid out of git (`524173f`, main before the change).

## Setup

- Apple M4, 10 cores, 32 GB, macOS 26.5.1, Bun 1.3.11.
- Vendored tree: pin `66caf4e5` plus `patches/0001`–`0050`.
- The paks are the ones a full `bun scripts/digests.ts` run built (42 of 42
  matched the ledger) and `bun scripts/visibility.ts` built for the rest;
  the script builds any composition neither ledger did. No digest moved, and
  none could: the change is in what `keyframes` reads, not in a pak.

## The rule, read off pixels

`compositions/late-anim`'s `ruler` moves one pixel a tick from `left-[80px]`.
The first column of its middle row more than half lit, minus 80, in `frame`'s
PNG:

| fps | frame 0 | 1 | 2 | 3 | 10 | last (tick 59) |
|---:|---:|---:|---:|---:|---:|---:|
| 20 | 2 | 5 | 8 | 11 | 32 | 59 (frame 19) |
| 30 | 1 | 3 | 5 | 7 | 21 | 59 (frame 29) |
| 60 | 0 | 1 | 2 | 3 | 10 | 59 (frame 59) |

`3f + 2`, `2f + 1`, `f`. The first-tick placement agrees with the 60 fps row
only. The same fixture's text nodes, brightest red in each band at 30 fps
(ground 2, `text-slate-50` 248):

| frame (tick) | `sampled` (delay 1) | `shifted` (delay 2) | `gated` (ticks 2–4) |
|---|---:|---:|---:|
| 0 (1) | 2 | 2 | 2 |
| 1 (3) | 22 | 13 | **125** |
| 2 (5) | 43 | 33 | 248 |
| 29 (59) | 248 | 248 | 248 |

`sampled`'s delay is a tick frame 0 shows, so frame 0 shows its first
keyframe and frame 1 two ticks of a 24-tick fade (2 + 246 × 2/24 = 22.5).
`shifted`'s is not: frame 1 already shows one tick of it (12.25). `gated`'s
two-tick step is shown half drawn by frame 1 and nowhere else.
`tests/keyframes.test.ts` holds all three, through the frame numbers
`keyframes` reports.

## Readings before and after

Every reading that depends on the segments alone — timeline counts, baked
and unreferenced entries, delays, periods, `neverStarts`, `endsPastWindow`,
period and loop drift, contention, shutter jumps — is identical per timeline
in all 55 compositions; the script stops on the first difference. The two
that depend on the phase, per composition (rows with no timeline omitted):

| composition | fps | timeline uses | with an unsampled instant | unsampled instants | with a part-way step | part-way steps | contended | jumps |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| compositions/captions/alpha-en | 30 | 45 | 32 → 42 | 34 → 55 | 0 | 0 | 0 | 0 |
| compositions/captions/burn-zh | 30 | 39 | 19 → 39 | 19 → 57 | 0 | 0 | 0 | 0 |
| compositions/captions/clip-wipe | 30 | 137 | 107 → 105 | 135 → 133 | 0 | 0 | 7 | 0 |
| compositions/captions/highlight | 30 | 102 | 82 → 85 | 99 → 105 | 0 | 0 | 3 | 0 |
| compositions/captions/kinetic-slam | 30 | 56 | 32 → 31 | 57 → 55 | 0 | 0 | 10 | 0 |
| compositions/captions/matrix-decode | 30 | 158 | 155 → 152 | 161 → 155 | 0 | 0 | 0 | 0 |
| compositions/captions/pill-karaoke | 30 | 37 | 27 → 26 | 37 → 35 | 0 | 0 | 0 | 0 |
| compositions/curves | 30 | 56 | 24 → 32 | 48 → 64 | 0 | 0 | 0 | 0 |
| compositions/curves-race | 30 | 11 | 6 → 11 | 6 → 16 | 0 | 0 | 0 | 0 |
| compositions/filters | 30 | 2 | 0 → 2 | 0 → 4 | 0 | 0 | 0 | 0 |
| compositions/gradients | 30 | 2 | 0 → 2 | 0 → 2 | 0 | 0 | 0 | 0 |
| compositions/kenburns | 30 | 1 | 0 → 1 | 0 → 1 | 0 | 0 | 0 | 0 |
| compositions/late-anim | 30 | 7 | 1 → 5 | 2 → 9 | 0 → 1 | 0 → 1 | 1 | 0 |
| compositions/long-track | 30 | 34 | 34 | 4661 → 6695 | 0 → 3 | 0 → 2002 | 0 | 2 |
| compositions/masked | 30 | 3 | 0 → 3 | 0 → 6 | 0 | 0 | 0 | 0 |
| compositions/mg-bauhaus | 30 | 297 | 202 → 297 | 542 → 1064 | 2 → 10 | 5 → 121 | 0 | 28 |
| compositions/mg-hud | 30 | 1024 | 776 → 1024 | 1845 → 12054 | 2 → 86 | 21 → 2636 | 0 | 190 |
| compositions/reel | 30 | 1160 | 958 → 955 | 1158 → 1157 | 0 | 0 | 63 | 6 |
| compositions/rename-card | 30 | 1137 | 616 → 919 | 1102 → 1686 | 217 → 456 | 351 → 578 | 18 | 0 |
| compositions/same-frame | 60 | 2124 | 0 | 0 | 0 | 0 | 1 | 0 |
| compositions/shutter | 30 | 963 | 442 → 587 | 1086 → 1352 | 376 → 456 | 510 → 578 | 18 | 0 |
| compositions/shutter-blur | 30 | 12 | 2 → 12 | 2 → 29 | 0 → 3 | 0 → 3 | 0 | 2 |
| compositions/smoke | 30 | 3 | 1 → 3 | 1 → 7 | 0 | 0 | 0 | 0 |
| compositions/spanned | 30 | 5 | 0 → 5 | 0 → 11 | 0 | 0 | 0 | 0 |
| compositions/stroke | 30 | 1 | 0 → 1 | 0 → 2 | 0 | 0 | 0 | 0 |
| compositions/timeline | 30 | 209 | 131 → 122 | 302 → 280 | 0 | 0 | 0 | 0 |
| compositions/transitions | 30 | 724 | 714 → 719 | 722 → 731 | 0 | 0 | 0 | 0 |
| compositions/vector-paths | 30 | 5 | 0 → 5 | 0 → 9 | 0 | 0 | 0 | 0 |

`late-anim`'s "before" is the earlier grid read over the retimed fixture,
not the fixture as it was. The earlier column reproduces every figure
AGENTS.md quoted for the earlier grid: 958 of `reel`'s 1160 uses, part-way
steps in 376 of `shutter`'s uses and 217 of `rename-card`'s, contention 63,
18, 18 and 20 over the `captions/*`.

Most of the unsampled growth is one fact: at 30 fps no frame shows tick 0,
so every timeline that starts at mount now reports its delay — frame 0 shows
it a tick under way. A delay written as whole frames (33.3 ms, two ticks)
is an even tick and reports the same way; 16.7, 50 and 83.3 ms do not.

## What the part-way steps are

Each step classified by what the frame inside it shows: a change between
holds (a gate), a segment of a move whose neighbour on the same track also
moves and touches it (a keyed move), or a segment over which no track
changes at all (a hold):

| composition | gate | keyed move | hold |
|---|---:|---:|---:|
| compositions/shutter | 578 | 0 | 0 |
| compositions/rename-card | 578 | 0 | 0 |
| compositions/shutter-blur | 3 | 0 | 0 |
| compositions/late-anim | 1 | 0 | 0 |
| compositions/mg-hud | 0 | 2224 | 412 |
| compositions/mg-bauhaus | 0 | 119 | 2 |
| compositions/long-track | 0 | 2000 | 2 |

`shutter` and `rename-card` carry the same 578 — 34 ms gates from even
ticks, all inside the first 48 ticks, which is the opening `rename-card`
keeps. The three kit-built films carry no gate at all: `src/anim/sampled.ts`
keys a move every `MOVE_STEP` (two) ticks, one rendered frame at 30 fps, and
a move keyed from an even tick has a frame inside every segment. The reading
takes a segment's length for the author's intent and asks neither whether
the segment changes anything nor whether it continues a move; it did so on
the earlier grid as well (mg-hud's 21, mg-bauhaus's 5), where moves keyed
from odd ticks were the ones it counted.
