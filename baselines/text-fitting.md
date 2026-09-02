# Build-time text fitting, 2026-08-13

`engine/core/src/text.rs` states the constraint in its own header: *"v1 line
model (documented limitation): NO automatic word wrap — a run breaks only on
explicit `'\n'`"*. A `Text` wider than its box does not wrap and does not shrink.
It draws past the box, and `overflow-hidden` turns that into silently missing
words.

That is a bigger hole than the one Phase 1.5 addresses. Kerning is a *fidelity*
question — measurement and rasterisation already agree with each other, and the
worst line in the reel accumulates 0.197 em, under 1% of its width
([`phase1_5-kerning-trigger.md`](phase1_5-kerning-trigger.md)). No amount of
kerning stops a line running 2819 px past an 800 px box.

The claim tested here is that the fix needs **no core change**, because
compositions are generated and the host can measure text with the renderer's own
advance table. Reproduce with [`scripts/fit-probe.ts`](../scripts/fit-probe.ts);
the module under test is [`src/text/fit.ts`](../src/text/fit.ts).

## Method

Every claim is checked against rendered pixels rather than the API's word.
Ground is pure black and text pure white, boxes are fixed and stacked from the
top-left with no padding or gap, so a block's band in the frame is arithmetic
(`compositions/fit/gen.ts`) and ink outside a box is overflow you can count.

Stage 0 renders a box as a white rectangle first: **an 800x60 box renders x
0..799, y 0..59**. If that had disagreed with the band arithmetic, nothing after
it would mean anything.

## `ops.measureText` is the pen, exactly

Ink extents are not the pen — a glyph's outline sits inside its advance — so
comparing a measurement against the ink of a string proves nothing. Appending a
probe glyph does: the probe's ink starts at `pen(S)` plus its own left side
bearing, and rendering the probe alone gives that bearing directly, so the
difference of the two ink right edges is the pen.

| string | 64 px | 38 px | 26 px |
| --- | ---: | ---: | ---: |
| `Hamburgefonstiv` | 510 | 301 | 206 |
| `Deterministic video rendering.` | 880 | 521 | 357 |
| `a Tailwind subset, not all of CSS` | 927 | 550 | 376 |
| `no screenshot loop — a rasteriser` | 983 | 580 | 399 |
| `PocketJS Motion · 1 thread` | 803 | 476 | 326 |

Measured and rendered agree on all fifteen rows. **Worst |error| 0 px.** So a
break decided at build time is not an approximation of layout; it is layout.

Two things the measurement does **not** cover:

- **Tracking.** `Ui::measure_text` is `measure_run(text, slot, 0.0, f32::NAN)` —
  tracking is pinned to 0. It is recoverable in arithmetic, because that is all
  `measure_run` does with it: `tracking-wide` at 38 px measured 301 px plain and
  rendered 315 px, against a prediction of 315.25. The residual is the pixel
  grid, not a modelling error.
- **Line height.** `measure_text` returns `measure_run(...).0` — width only — so
  the line advance a wrapped block's height depends on is not reachable through
  the ops table at all. It is in the pak: sixteen bytes per atlas, `off 11`,
  documented under "FONT ATLAS binary format" in `contracts/spec/spec.ts`. Two
  builds' worth of sizes read out at **1.154 to 1.184 x the font size**, varying
  because it is rounded to whole px per bake.

## Why summing cached segment widths is exact

Wrapping is O(segments) measurements only if per-segment widths can be cached and
added — the split `chenglou/pretext` uses in the browser, where the ground truth
is canvas `measureText` and the win is dodging reflow.

For us the arithmetic is not merely close, it is **the same number**:
`measure_run` sums per-glyph advances with no pair adjustment, because the core
has no kerning. Width is therefore additive over any split. Checked at every
split point of every string above: **worst |error| 0 px.** A core that gained
kerning would break this, and the wrapper would have to measure whole candidate
lines instead — one more thing Phase 1.5 would cost.

## Sizes have to be baked, not extrapolated

Advances are `u8` **logical px per glyph**, so a 38 px bake is not a 64 px bake
scaled by 38/64; the rounding is per glyph and accumulates along the line.
Predicting the ladder from the 64 px bake, against the same paragraph:

| px | measured | from 64 px | err % |
| ---: | ---: | ---: | ---: |
| 56 | 5351 | 5350.6 | −0.01 |
| 48 | 4591 | 4586.3 | −0.10 |
| 42 | 3994 | 4013.0 | +0.47 |
| 38 | 3619 | 3630.8 | +0.33 |
| 34 | 3272 | 3248.6 | **−0.72** |
| 30 | 2845 | 2866.4 | +0.75 |
| 26 | 2484 | 2484.2 | +0.01 |

**Worst deviation 0.75%** — 6 px on an 800 px line, enough to flip a fit decision
at the boundary. Every candidate size gets measured.

## What the wrap does

The paragraph is the reel's own register, 173 characters, into an 800 px box at
38 px.

| case | lines | widest line | past the box |
| --- | ---: | ---: | ---: |
| no wrap — what ships today | 1 | 3619 | **2819** |
| no wrap + `overflow-hidden` | 1 | 3619 | 2819 |
| wrapped | 5 | 795 | 0 |

`overflow-hidden` keeps **22%** of the ink the wrapped block draws. The rest of
the sentence is not on screen and nothing reports it.

Predicted block 795x225 px; rendered ink spans 794x219 in **5 row runs for 5
lines**, and `ink right edge 794 <= predicted pen 795 <= box 800`. Nothing is
lost: 173 characters in, 173 out.

**Shrink-to-fit**, same paragraph into 800x135 (three lines at 38 px) against the
nine-size ladder: chose **26 px**, 4 lines, 798x120, rendered ink right edge 798.

Cost is not a consideration: `Intl.Segmenter` over 80 CJK characters takes
**0.02 ms**, and a full wrap of the 207-character paragraph including every
measurement takes **0.04 ms**.

## The sweep, and the bug it found

A wrapper that overshoots by one segment renders fine at the width it was
authored for and pushes a word past the box at some other width. So the check is
a sweep: both paragraphs x 9 sizes x 121 box widths from 200 to 1400 px = **2178
wraps**, asserting no line is wider than its box and no character is dropped.

The first version failed **32** of them. The guard for a word too wide to break
at a space was written as "line is empty **and** the word overflows", so an
over-long word that was not first on its line got flushed onto a line of its own
and never broken by grapheme — `screenshot` is 320 px at 38 px and sat in a
200 px box. Checking the word first, independent of what is already on the line,
fixes it: **0 of 2178** after.

## Chinese: the wrap works, the faces do not

`Intl.Segmenter` is the whole reason Chinese works at all — there are no spaces
to split on. Splitting on spaces leaves the paragraph in 3 lines whose widest
runs **492 px past the box**; segmenting gives 4 lines, widest 798, past the box
by 0.

The 行頭禁則 rule (no line begins with `、。，）`) is enforced by sending the
previous segment down with the offender. Swept over 91 box widths: a naive
breaker offends at **22** of them, 26 lines in total; with the rule, **0** — and
it never pushed a line past the box or dropped a character. It has one corner it
cannot serve: a line holding a single segment has nothing to send down, so the
box wins and the offender starts the line. It takes a box barely wider than one
word to reach.

**Neither Latin face has any Chinese in it.**

| face | ZH characters mapped |
| --- | ---: |
| HarmonyOS Sans Regular (checked in) | 14 / 63 |
| Inter Display Regular (upstream) | 14 / 63 |
| **Noto Sans SC Regular** (fetched) | **63 / 63** |

HarmonyOS Sans here is the Latin-only cut; the 14 are the Latin and ASCII
characters inside the Chinese sentence. Everything else bakes as tofu, so before
a CJK face was chosen the repository could not put Chinese on screen at all.

Noto Sans SC is now pinned by digest in `assets/fonts/manifest.json` and fetched
by `bun scripts/assets.ts` — 17 MB against 1.6 MB of tracked source, which is
why it is fetched rather than checked in. Pen exactness holds against it exactly
as it does for Latin: 304/304, 530/530, 740/740, **error 0**.

Baking Chinese is affordable, because the atlas holds the characters the
composition uses rather than the face: 64 CJK codepoints took the pak from
**266 KB to 350 KB**, out of a 31,036-glyph font.

### The face found a bug in the baker

The first Noto bake came out as fragments — hollowed strokes, `h` and `r`
reduced to solid blocks, characters missing pieces. The pak was already wrong,
so it was not a rendering fault.

`framework/compiler/bake-font.ts` never closed a contour. opentype.js emits no
`Z` for either outline format; TrueType paths simply happen to **end on their
own start point**, so the closing edge is degenerate and nothing was ever wrong.
CFF closepath is implicit and leaves the path open, so the scanline fill saw an
unpaired edge on every contour. Fixed in
`patches/0006-bake-font-close-contours.patch`.

The check that matters is that nothing else moved. Baking the same compositions
before and after:

| composition | pak | |
| --- | ---: | --- |
| fit probe, HarmonyOS Sans | 195,168 | identical |
| fit probe, Inter Display | 208,592 | identical |
| typography | 1,861,360 | identical |
| **the reel** | 3,812,336 | **identical** |
| fit probe, Noto Sans SC | 358,592 | changed |

So the reel's frame digest cannot move.

The patch also switches the fill from even-odd to **non-zero winding**, which is
the rule outlines are actually defined with; even-odd only agrees while contours
do not overlap. That half is **not exercised by any face available here** —
proven identical over ~100 CJK glyphs including 龘, 鬱 and 醫 — and is in the
patch because a face whose strokes overlap would otherwise bake with every
overlap cancelled, silently.

### A trap this probe walked into

A codepoint the atlas does not carry resolves to tofu and **measures as
`cell_w`** (`text.rs` `glyph()`), so a build that was never asked to bake a
character still returns a plausible width for it — and pen exactness *passes*,
because measurement and rasterisation agree on the tofu cell just as exactly as
on a real glyph. Two CJK runs disagreed by 36 px with nothing on screen to show
why.

Every measurement is now guarded against its own build by reading the atlas cmap
out of the pak and refusing to report a width for a string the build cannot draw.
It caught two more instances immediately, and it is the reason the em dash in the
English paragraph is measured correctly: ASCII 32..126 is always baked, `—` is
not, and the build that measured it did not contain it.

## What this decides

- The capability is reachable **without touching `engine/core`, the pak format,
  the spec, or any backend**. The guest stays mount-only; what reaches the
  composition is a string that already carries its `\n`, as deterministic as the
  glyph atlas. Two runs of the probe are byte-identical.
- It is worth **more** than Phase 1.5 and costs far less. Kerning is a format
  change across six files for under 1% of line width; this is one module and a
  generator step for the difference between a title that fits and one that does
  not.
- It is wired, not just available. `src/text/measure.ts` is the build-time
  measurement pass — it builds a throwaway composition holding exactly the
  strings and sizes asked about, boots it, and hands back the measurement
  functions with the cmap guard already attached.
  `compositions/copy/gen.ts` is the worked example: Chinese copy, a headline
  sized from a ladder and a body wrapped to the column, both decided by
  measurement before `app.tsx` is written.
- What it does not do: the wrap is **greedy**, so it fills each line and takes
  what is left. It never overflows and never drops a character, but it will
  leave a short last line where a balanced break would read better, and it has
  no view on where a Chinese clause wants to break beyond the 行頭禁則 set.
  Minimum-raggedness breaking is the next thing worth measuring, not the next
  thing worth assuming.
