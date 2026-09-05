# POLY: patch 0008 against #301's head — not byte-identical, one line apart, 2026-09-05

`patches/README.md` had said, since 2026-09-02, that whether the two designs
of the POLY op agree on the software rasteriser had not been measured. This
measures it. Reproducers in [`poly-301/`](poly-301/): `poly_sweep.rs`, the
harness, and the three sweep outputs it wrote.

## The two designs

- **A** — `patches/0008-poly-op-coverage.patch` as applied to the pin. Its
  `raster.rs` POLY section is `759ffff` — #301's first commit — verbatim
  (checked with `diff` over the section between the `// ---- POLY` and
  `// ---- GLYPH_RUN` markers).
- **B** — pocket-stack/pocketjs#301 at its head `20b663c`, the reviewer's
  redesign: coverage computed once in core as `poly_spans`, the PSP eating the
  same spans, POLY numbered 11 to clear `surfaceQuad` at 10.

## Method

`poly_sweep.rs` is appended, identical, to the end of `engine/core/src/tests.rs`
in a scratch copy of each crate (A: `vendor/pocketjs/engine/core` copied out,
with a symlink so its `include_bytes!` fixtures resolve; B: a detached
worktree of the sibling checkout at `20b663c`). Both crates expose the same
test helpers — `place_box`, `raster_fb`, `abgr`, `set_prop` — so one source
compiles against both. For each of 356 scenes it builds the tree, ticks,
hashes the draw-list words and the 480×272 RGBA framebuffer `raster::render`
wrote, and appends one line to `$POLY_SWEEP_OUT`:

    id  POLY|----  words-hash  fb-hash  description

The scenes: 11 box sizes from 1×1 to 400×260 across 23 angles from 0 to 359.5;
five colours including alpha 1, 77, 128 and 200; sub-pixel placement; scale
0.01 to 3 and `scale_x`; radius 4/12/28 under rotation; node opacity; boxes
partly off each screen edge; a rotated child under an `overflow-hidden`
parent; two overlapping rotated boxes with alpha; a `perspective` root with
`rotate_y` 20 to 85; border and shadow under rotation; and two controls that
never emit POLY — a rotated gradient (TRI) and an axis-aligned box (RECT).
333 of the 356 emit POLY on both sides.

Run as `POLY_SWEEP_OUT=<file> cargo test poly_sweep -- --nocapture`;
`POLY_SWEEP_DUMP=<id>` also writes that scene's raw framebuffer and words.

## Result

| | scenes | framebuffer identical | differs |
|---|---:|---:|---:|
| all | 356 | 106 | 250 |
| POLY on both sides | 333 | 83 | 250 |
| controls (TRI, RECT) | 2 | 2 | 0 |

`sweepA.tsv` against `sweepB.tsv`. The words differ in every POLY scene and
that column says nothing: B's op number is 11 and A's is 10. The payload
behind the number — vertex count, colour, vertices — was compared on eight
dumped scenes and is identical in all eight, so the core emits the same
polygon and the rasteriser is where the pixels part.

The 83 POLY scenes that agree are the 1×1 boxes, the axis-aligned angles
(0, 90, 180, 270) and the smallest boxes at shallow angles. Everywhere else
the difference is on edge pixels only — in the eight dumps no interior pixel
(all four neighbours fully covered on both sides) differs except inside the
overlap of the two alpha boxes — in steps of 1/16 of the colour, and **always
in A's favour**: A's red-channel sum exceeds B's in every dumped scene, by
8,432 over a 120×56 box at 20° (93 pixels, up to 240 levels apart) and by
24,752 over a 400×260 box at 45° (272 pixels).

## The mechanism, and the proof

One line. Each row's interior run — the columns every one of the 16 samples
falls inside, filled without sampling — is bounded per edge by `solve`, and
for an edge whose step across the row is negative A wrote

    (0, ((k.div_euclid(s)) + 1).clamp(0, span as i64) as i32)

where B has

    (0, (((-k).div_euclid(-s)) + 1).clamp(0, span as i64) as i32)

`k.div_euclid(s)` with `s < 0` keeps the remainder non-negative, which rounds
the quotient toward positive infinity: 5 div_euclid −2 is −2, where the bound
wanted floor(−2.5) = −3. So on every row where that edge does not cross a
column boundary exactly, A's interior run is one column too long, and that
column is filled at full coverage instead of the coverage its samples would
have given it. Nothing else in the section differs.

Applying that one line to A's scratch copy and re-running the sweep
(`sweepA-fixed.tsv`): **356 of 356 framebuffers identical to B.**

Upstream made the change in `1c7c914` (2026-08-25, "test(raster): lock POLY
spans against a 4×4 sample oracle"), the commit that is also #333's head —
the oracle is what found it. `0008` is `759ffff`, four commits earlier.

## What it means here

Every digest in `baselines/digests.json` for a composition that rotates a
solid box embeds A's extra column. The pictures are not wrong in a way a
viewer would see — one boundary pixel per affected row, brighter by up to
15/16 of the edge's coverage — but they are the pictures of a rasteriser with
a rounding defect that upstream has already fixed, and the fix moves those
digests. Taking it is an update to `0008`, an `upstream`-class patch, to match
upstream's own head; what it costs is one ledger run, and the run's diff will
name exactly which compositions rotate a solid box. A proxy from the sources,
counting `rotate-[N]` utilities in `main.tsx`/`gen.ts` (no ledger composition
rotates through a keyframe): `rename-card` 384, `shutter` 288, `timeline` 84,
`glow-column` 3. A rotated gradient box takes the TRI path and is not
affected; nor is anything at 0, 90, 180 or 270 degrees.

Deciding that is not this measurement's job. What it settles is the README's
open sentence: the two designs are not byte-identical, the whole difference is
that line, and the difference is a defect on this side.

## Taken, 2026-09-05

The line is in `patches/0008-poly-op-coverage.patch` now, with upstream's
four-line comment above it and a paragraph in the patch header saying when and
why. `bun scripts/vendor.ts` re-applied the set and rebuilt the wasm; the core
crate's 132 tests pass under it.

A full verify run of the digest ledger before re-recording moved exactly five
of 38 and left 33 in place:

| composition | frames | what rotates a solid box |
|---|---:|---|
| `shutter` | 150 | slats and rails, `rotate-[N]` on 2D boxes |
| `rename-card` | 180 | the same opening, plus two rails of 48 segments each |
| `timeline` | 854 | `rotate-[N]` on card decoration |
| `reel` | 1071 | `perspective-[N]` roots with `rotate-y-[N]` children — a projected 3D face is emitted as POLY too |
| `probe` | 2 | the same, `perspective-[1400]` and `rotate-y-[40]` |

The source proxy above counted only 2D `rotate-[N]` and so named
`glow-column` and missed `reel` and `probe`. `glow-column` did not move: its
three rotations are `rotate-180`, which is axis-aligned and takes RECT. The
33 that stayed are the check that nothing else in the toolchain moved with the
re-vendor — every one of them reproduced its recorded digest through a fresh
clone, patch application and wasm build.

The five were re-recorded with `--write --only <name>`, one at a time, into
`baselines/digests.json` in the same commit as the patch, so the diff carries
both halves.
