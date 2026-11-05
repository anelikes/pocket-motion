# Colour filters — a layer, or draw time?

`patches/0055` applies CSS's colour filters on a node's filter layer
(`patches/0018`): the node and its subtree are rendered into a transparent
layer, the layer's straight colour goes through each filter's matrix, and the
layer is composited back. The question this note answers with numbers is
whether a colour-only filter needs the layer at all, or whether it is cheaper
applied at draw time — recolouring the node's ops as the draw list is built.

Apple M4, 10 cores, Bun 1.3.11, 2026-11-05, on a machine other sessions held
at a load average of 15–40, so every number below is a **minimum** over 40
renders, not a median; medians were 1.5–4× the minimums and moved between
runs.

## What draw time could save, and where it is exact

A draw-time recolour emits the same ops a plain node emits, with different
colour words: it costs what drawing the node without a filter costs. So the
saving is the whole of the layer's cost, and that cost is the first table.

It is exact — the same bytes the layer gives — only for a subtree that paints
one op that cannot overlap itself: a box, a path fill. Two ops of one subtree
that cover the same pixel are blended twice into the frame by a draw-time
recolour, and once (after being blended into the layer) by the layer, and
the two roundings differ by a level there. A text run is such a case: two
glyphs' edge coverage meets in one pixel wherever letters sit tight. And
under any filter that clamps (brightness, contrast or saturate above 1,
hue-rotate, sepia) the filter of a blend is not the blend of the filters, so
two overlapping colours differ by more than rounding. The nodes for which a
draw-time path is exact are the nodes nobody filters: a solid box is given
the colour it should have.

## What the layer costs

Native (`cargo test --release --lib colour_filter_layer_cost -- --ignored
--nocapture` in `vendor/pocketjs/engine/core`, the bench is in 0055's
`tests.rs`): N boxes on a 1920×1080 ground, each `hue-rotate-90
saturate-150` through a layer, against the colour that filter makes drawn
directly.

| scene | direct | layered | per layer | per layer, rows only |
|---|---:|---:|---:|---:|
| 1 box 160×64 | 0.22 ms | 0.33 ms | 0.106 ms | 0.340 ms |
| 40 boxes 160×64 | 0.26 ms | 2.27 ms | 0.050 ms | 0.198 ms |
| 100 boxes 160×64 | 0.34 ms | 5.32 ms | 0.050 ms | 0.242 ms |
| 1 full-frame gradient | 4.64 ms | 17.03 ms | 12.4 ms | (within noise) |

The last column is the same scene on 0018's layer as it was: it scanned
every touched ROW of the frame, all 1920 pixels of it, for alpha, and the
pool cleared those rows afterwards. A 64 px word paid for 123,000 pixels. The
layer now records the columns it touched beside the rows, and scans and
clears that rectangle only; the content bounds it finds are the same by
construction (nothing outside the touched rectangle has alpha), so the
pixels are byte-identical, which the digest ledger confirms over every
composition with a filter layer in it. On a full-frame layer the two are the
same work and measured within noise of each other (9.5–16 ms either way over
six runs).

Of the full-frame row, the colour pass itself — two matrix steps per pixel,
in i64 — was 2–4 ms native on a gradient (the pass run and skipped, two
runs each); the rest is 0018's layer: drawing into it, scanning it,
compositing it and clearing it.

In the wasm core, through `bun scripts/paint-bench.ts --reps 40` (six 96 px
bold lines of copy at 1920×1080; the bench's own table and method are in
`paint-effects.md`; `grayscale` and `grade-frame` are the two cases 0055
adds). Minimum ms a frame; "rows only" is the same wasm with the layer's
column bounds taken out, one run; "patched" is two runs, before and after
it, which is how far apart two runs of one build land at this load:

| case | rows only | patched | what |
|---|---:|---:|---|
| baseline | 3.06 | 2.41, 2.46 | six lines, no effect |
| glow | 21.70 | 15.12, 15.25 | `glow-[24px]` on every line: six layers |
| shadow | 16.40 | 13.13, 12.98 | a drop shadow on every line: six layers |
| blend | 6.96 | 5.32, 6.30 | `mix-blend-screen` on the column: one layer |
| grayscale | 7.56 | 5.49, 5.43 | `grayscale` on every line: six layers |
| gradient-ground | 11.30 | 9.83, 9.41 | a full-frame four-stop gradient ground, no layer |
| grade-frame | 43.41 | 37.91, 30.71 | that ground and the lines on it, `hue-rotate-90 saturate-150` on the root: one full-frame layer |

With the colour pass removed from the wasm, `grade-frame` measured 24.01
and 27.09.

So in the wasm core a line-sized colour layer costs about half a millisecond
at 1080p (`grayscale` over `baseline`: +3.0 ms for six), the column bounds
take a quarter to a third off every per-line layer whatever its filter, and
grading the whole frame costs 21–28 ms over the same frame ungraded, of
which the colour pass is 4–14 ms — the spread is the load, not the build —
and 0018's layer the rest.

## The decision

One path: the layer. A draw-time recolour would save about 0.05 ms native
(0.5 ms wasm) per line-sized node, would be exact only for a subtree of one
op that cannot overlap itself, and would make a node's picture depend on how
many ops its subtree happens to emit. What made the small layers expensive
was 0018's full-row scan and clear, and bounding it to the touched
rectangle took 0.20 ms off every word-sized layer — colour, blur, shadow,
glow or blend alike — without a second definition of what a filter does.

What is left is stated in `AGENTS.md` ("What does not reach them yet"): a
full-frame grade, the case footage needs, is the most expensive colour
filter and the pass is per pixel with no cache; and the layer composite
that dominates it is 0018's.
