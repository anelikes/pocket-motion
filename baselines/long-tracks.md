# Tracks over 255 segments: measurements, 2026-10-23

The numbers behind `patches/0050-long-animation-tracks.patch` and
`compositions/long-track`. Reproducer for the chaining measurement:
[`long-tracks/chain.ts`](long-tracks/chain.ts).

## Setup

- Apple silicon, macOS, Bun 1.3.11, the rustup stable toolchain for
  `wasm32-unknown-unknown`.
- Vendored tree: pin `66caf4e5` plus `patches/0001`–`0041`, and the same
  plus `0050`.
- The machine was shared with other sessions; the load average was 45–140
  during every timing below. Digests do not depend on load. The timings are
  user CPU, which the load disturbs less than wall time; wall times are given
  where they are the point, with that caveat.

## Where the limit was

Read, then run, on the pin with 0001–0041:

| layer | what it does with a track's segment count |
|---|---|
| format (`contracts/spec/spec.ts`, ANIM TABLE) | `segCount` is the second byte of a track header, a u8 |
| encoder (`encodeStyleTable`) | throws `animation track needs 1..255 segments` above 255 |
| core (`StyleTable::parse`, `engine/core/src/style.rs`) | reads one byte, refuses 0 |
| baker (`framework/compiler/animation.ts`, `bakeEntry`) | none: a keyframe set of 1,000 stops over 20 s bakes 1,000 segments, and the build then fails at the encoder |
| kit (`src/anim/sampled.ts`) | refused more than 250 keys (`MAX_KEYS`) |

The next ceiling is the timeline: period, delay, `t0` and `t1` are u16 frame
counts, 65,535 ticks or 18 min 12 s at 60 Hz. It bounds the segment count
too, because a segment spans at least one frame — so the wide count is a u16
and goes no further.

## What a segment costs

- **Bytes.** 14 per segment per track in the pak (30 with a bezier easing),
  plus 2 bytes of header per track, 4 once it is wide. `El.entry` writes all
  six of its props at every key, so an element keyed every second tick costs
  `6 × 14 = 84` bytes per two ticks of film whether or not a prop moves.
- **`compositions/long-track`** (70 s, 21,371 segments over 34 timelines):
  `pocket.config.ts` 494,597 bytes, pak 338,272 bytes, bundle 237,761 bytes.
- **A 7.5-minute variant** — a draft of the fixture's generator (the camera
  travelling to the last station rather than cutting to it) at 13,500
  frames, so the camera's six tracks carry about 13,500 segments each:
  `pocket.config.ts` 3.2 MB, pak 2.0 MB, build 15.8 s wall.

### The lookup

`sample_track` walked from the first segment on every tick. The same
7.5-minute trace on a core with the walk and on one with 0050's search
(`partition_point` on `t1`), two runs each, interleaved:

| core | user CPU, first run | second run | digest |
|---|---|---|---|
| search | 2.36 s | 2.43 s | `586036a6232b…` |
| walk | 4.10 s | 3.95 s | `586036a6232b…` |

About 1.6 s over 27,000 ticks — 60 µs a tick for six tracks of 13,500
segments — and it grows with the film: a walk's per-tick cost is linear in
the track's length, so a film's total is quadratic in its length. The
70-second draft is the same picture under both, `69faaf4e279d…`.

In the core's debug test build, `a_track_over_255_segments_plays_every_segment`
(30,000 segments, every tick checked) took about 50 s walking and 0.3 s
searching.

## Chaining, measured and refused

The other way to carry a long track is to split it in the kit into
consecutive animations on one property in one comma list: the earlier with
fill `both`, each later one delayed to where the previous ends with fill
`forwards` only, so the last one that has started is the one writing. The
core's rule (the LAST animation currently writing a property wins) makes that
exact at every tick. `chain.ts` writes one 600-tick move, about 19 px a tick
through its centre, both ways.

| case | frames that differ, of 300 |
|---|---|
| no shutter, hand-off at 300, keys on even ticks | 0 (one digest) |
| shutter 180° × 8, hand-off at 300, keys on even ticks | 0 |
| shutter 360° × 8, the same | 0 |
| shutter 180° × 8, hand-off at 301, keys on odd ticks | **1 (frame 150)** |
| shutter 360° × 8, the same | **1 (frame 150)** |
| 60 fps, 600 frames: shutter 180° × 8, hand-off at 300, keys on even ticks | **1 of 600 (frame 300)** |

Under a shutter a later animation's start is a fill-less edge, which
`shutter.rs` treats as a jump and never samples across, so at the hand-off the
samples on the earlier side clamp to the hand-off's value where the single
track interpolates. In the core directly (a scratch test, two linear segments
0 → 100 → 300 over ticks 0–20 against the same as two animations): at clock
10 the sample half a tick earlier is 95 on the single track and 100 on the
chain. The render shows it only where a frame's exposure reaches the hand-off,
and frame f renders clock 2f + 1 at 30 fps (next section), so a hand-off on an
even tick sat between exposures and showed nothing; at 60 fps every tick is a
frame's, and the even hand-off that showed nothing at 30 fps differs at frame
300. `keyframes` would report no jump at a hand-off either, since it reads
each timeline alone. A kit that chained would have to place every hand-off
against the frame rate and the shutter; the wide count needs neither.

## Which tick a frame shows

Found while placing the fixture's readings, and not changed by 0050.

A node whose translateX runs 0 → 300 px over 300 ticks, at 30 fps:

| frame | `layout` x | `frame` pixels, first lit column |
|---|---|---|
| 0 | 1 | 1 |
| 1 | 3 | 3 |
| 2 | 5 | — |
| 10 | 21 | — |
| 30 | 61 | 61 |

The same ruler at 60 fps reads x = 0, 1 and 30 at frames 0, 1 and 30, and at
20 fps x = 2, 5 and 32 at frames 0, 1 and 10. Frame f shows the last tick of
its window, (f + 1) × 60 / fps − 1: clock 2f + 1 at 30 fps, as
`tests/shutter.test.ts` already reads ("frame 15 (clock 31)"). `keyframes`
(`src/anim/timelines.ts`) and the kit's header take frame f to show the first,
tick f × 60 / fps; the two agree at 60 fps only. `late-anim`'s `gated` — a 34 ms
step baked to ticks 3–5, which `keyframes` reports as shown half done by
frame 2 — measures 248 red at full opacity in its box at frame 2 and at
frame 3, and frame 1 does not paint it: no frame shows it part-way.

## Byte identity of every other composition

The digest ledger built every one of its 38 compositions on the tree without
0050 and again with it, and the sha256 of every `main.js` and `main.pak` under
`dist/` was taken after each run.

- Without 0050: 38/38 match the ledger; 76 artefacts hashed.
- With 0050: 39/39 match (the 38 and `compositions/long-track`), all 39 paks
  and all 39 bundles rebuilt by that run (newer than a marker written just
  before it), and **the 76 artefacts are byte for byte the ones built
  without it**. A table with no track over 255 segments encodes as it did.

## With the vector-path patches (PR #7, 0042–0043)

0050 takes no PROP, no anim bit and no draw op, so it collides with none of
0042's (PROP 199–211, anim bits 58–64, op 71). Applied in sorted order after
0042–0043 on the pin, one hunk does not apply: both add constants after
`ANIM_FILL_FORWARDS` in `contracts/spec/spec.ts`, and the resolution is to keep
both blocks. Every other hunk applies with an offset. The two formats compose:
0042's PATH TABLE is read from wherever the ANIM TABLE's parse ends, and
0050's wide track header advances that offset like any other byte. On that
combined tree (one hunk resolved by hand): `tests/contract.ts` green, the core
suite 295/295, the vendored tailwind and long-track suites 101/101, and a
table holding a 300-segment track and one path round-trips both through
`encodeStyleTable` and `decodeStyleTable` with `pathCount` 1 in the header.
Whichever of the two PRs lands second regenerates its patch onto the other.
