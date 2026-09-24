# Paint effects — what each costs per frame

Apple M4, Bun 1.3.11, 2026-09-24. `bun scripts/paint-bench.ts --reps 25`, at
the tree that added gradients (`patches/0019`).
1920×1080, `supersample` 1. The number is the median wall time of
`world.render()` — the core's draw walk plus the software rasteriser — over
25 renders of one frame after a warm-up render. The guest, the frame hash and
the encoder are not in it.

Every case is the same picture: six 96 px bold lines of lyric-shaped copy,
centred on a dark ground (about 1400×780 px of text). The `baseline` case has
no effect; each other case adds one, so its delta is the effect's own cost.

| case | ms/frame (median) | over baseline | what |
|---|---:|---:|---|
| baseline | 2.40 | — | six 96 px bold lines, no effect |
| stroke-outside | 19.49 | +17.09 | + `text-stroke-[6px]` outside on every line |
| stroke-center | 30.90 | +28.49 | + `text-stroke-[4px]` centred on every line |
| glow | 12.78 | +10.38 | + `glow-[24px]` on every line (six layers) |
| shadow | 11.82 | +9.42 | + `drop-shadow-[6px_6px_8px]` on every line (six layers) |
| blur-block | 20.79 | +18.39 | + `blur-md` on the column (one layer) |
| blur-3xl | 18.39 | +15.99 | + `blur-3xl` on the column (one layer, 64 px deviation) |
| blend | 5.54 | +3.14 | + `mix-blend-screen` on the column (one layer) |
| gradient-text | 2.99 | +0.59 | + `bg-clip-text` with a three-stop gradient on every line |
| gradient-ground | 7.86 | +5.46 | + a full-frame four-stop 30deg gradient ground |

The first recorded run (v0.3.0, before gradients) is within 1–3 ms of these
rows on every shared case; the spread between runs on this machine is of
that order, so read the table to the millisecond, not below.

## Reading it

- **A stroke is paid per line of text, by area.** The outline is a distance
  field over each run's coverage, over the run's cells grown by the width —
  about 1400×110 px per line here. A centred stroke computes the field twice
  (outside and inside), which is why it costs nearly double. The first
  implementation took a square root at every propagation step: 36.3 ms and
  62.0 ms over baseline for the two stroke rows; integer dead reckoning with
  a 3×3 refinement at the edge brought them to the numbers above.
- **A layer is paid by the area it touches.** The six glow and shadow layers
  each cover one line; the blurred column is one layer over the whole block.
  The layer buffer is pooled within a render, so six siblings allocate one.
- **A wide blur is not dearer than a narrow one.** Each pass costs the same
  per pixel whatever the radius, and from 8, 16 and 32 px of deviation the
  blur runs at 1/2, 1/4 and 1/8 resolution — which is why `blur-3xl` (64 px)
  costs less than `blur-md` (12 px, computed at half resolution). The picture
  moves by at most 1 level across each of those steps (core test
  `blur_across_a_resolution_step_moves_the_picture_by_little`).
- **Blend modes cost a read per written pixel** and nothing else: +3 ms for
  a layer the size of the text block.
- **A gradient costs a table lookup per written pixel.** The stops are baked
  into a 4096-entry table once per paint; each pixel then maps to t (one
  multiply-add for linear, a square root for radial). Gradient text is paid
  only where glyphs have coverage (+0.6 ms for six lines); a full-frame
  ground is 2 M pixels (+5.5 ms).
