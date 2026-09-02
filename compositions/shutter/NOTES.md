# shutter — what was measured, and what the measurement does not say

The motion in this composition was taken off a screen recording rather than
invented. This file records how each number was obtained, so that a number can
be re-derived or disputed instead of trusted.

## The source, and its limits

A 35s recording, downloaded at 1730x1080 / 29.616 fps. The capture it came
from was 2560x1600 at 60 fps; the copy available here is the half-rate
transcode, so **every duration below is quantised to 33.8ms and the true
motion may contain one intermediate step this file cannot see**. Where the
reference shows a single transition frame, the original had two, and which of
the two shapes is the real midpoint is not recoverable from this source.

The stretch measured is 10.30s–11.45s: a UI panel assembling itself. Only its
geometry and cadence were taken. None of its artwork, text or layout is
reproduced here.

Frames were extracted at native rate into one raw grayscale stream, frame N at
byte offset N·W·H. That indexing was verified against three independently
converted PNGs from moving (non-duplicated) frames before any measurement was
read — an earlier pass numbered the frames through ffmpeg's image2 muxer and
was silently off by 13, and a checksum taken in a static stretch agreed anyway
because consecutive frames there are identical.

## Bow: a per-row horizontal scale, not a lens

For each row of the panel, the lit runs were found by thresholding, the two
end walls dropped, and the run centres regressed against a reference row's
centres. The slope of that regression is the row's horizontal scale.

The slope varies with height and the residual is flat, which means the
horizontal displacement of a slat is **proportional to its distance from the
centre**. Barrel distortion would put it proportional to the cube of the
radius, and would bend the near-centre slats too; those measure straight to
within a pixel. What fits is a surface bulging toward the viewer, sampled row
by row:

    s(u) = 1.000195 + 0.013744u - 0.023442u²        u = -1 top … +1 bottom

peaking at u ≈ +0.29, i.e. just below mid-height — the panel is seen from
slightly above. Rendered back and measured with the same script:

Measured on frame 30, which is after the panel settles and before the title
fades in — glyph strokes read as lit runs and would corrupt the regression:

| u | reference | this composition | diff |
|---|---|---|---|
| -0.75 | 0.9769 | 0.9775 | +0.0006 |
| -0.50 | 0.9877 | 0.9879 | +0.0002 |
| -0.25 | 0.9952 | 0.9958 | +0.0006 |
| 0.00 | 1.0000 | 1.0000 | reference row |
| +0.25 | 1.0021 | 1.0021 | +0.0000 |
| +0.50 | 1.0012 | 1.0011 | -0.0001 |
| +0.75 | 0.9972 | 0.9972 | -0.0000 |

**What this does not say:** the fit is over the panel's own height only. It is
a description of where the slats are, not a camera model, and nothing here
recovers a focal length or a real radius of curvature.

## Vertical bulge

The panel is taller in the middle than at its ends. Two independent readings:
the bottom rail fits `y = 720.7 - 31.7·d²` (d = dx/halfWidth) across 27 sampled
columns, and at the comb's peak the topmost lit row carries 13 of 18 slats
while the bottom row carries 9 — the outer slats start lower and end higher.
`VSAG` is 30px against a 420px panel.

The rail fit is the noisiest number in this file: per-column brightest-row
picks scatter over ~70px because the rail is a comb of ticks of differing
heights. The quadratic's sign and rough magnitude are solid; its second digit
is not.

## Cadence

Stage boundaries, read off per-frame run counts and widths. Reference frames
are at 29.616fps, this composition's at 30fps:

| stage | reference | frames | here | frames |
|---|---|---|---|---|
| rail wipes in, comb → solid | f23–f27 | 5 | f9–f13 | 5 |
| seed bars near centre | f28–f31 | 4 | f14–f17 | 4 |
| hairlines, full height, bare | f32 | 1 | f18 | 1 |
| thickening front part-way down | f33 | 1 | f19 | 1 |
| full comb | f34–f36 | 3 | f20–f22 | 3 |
| thinning front part-way down | f37 | 1 | f23 | 1 |
| settled: hairlines + two walls | f38→ | — | f24→ | — |

The whole flash is five frames. Nothing in it eases; the source cuts between
states, and easing it reads as a different effect. Both the thickening and the
thinning propagate **top to bottom** — the thinning front is the give-away, at
f37 the top row is already back to a hairline while the rest is still thick.

The seed bars sit at their own pitch (~42px at 1730 wide) rather than on the
slat grid's (~61px): six runs inside 208px is not the slat spacing.

## Slat metrics

18 slats; pitch 61.2px, thick 35px, hairline 3–4px, panel 1040x417, centre
x=863.5 in a 1730-wide frame — held as proportions (60.1% of width, 38.6% of
height) and re-laid at 1920x1080.

## How the curve is drawn, and one wrong turn on the way

There is no warp primitive and no mask here, so the curve has to be geometry.
The first construction stacked axis-aligned rectangles, each at its own row's
horizontal scale, and it looked like a staircase. The measurements that
diagnosed it, in order:

1. A raw pixel dump across a settled hairline: values went `0 0 95 95 95 95 0`
   — a hard edge, no intermediate greys anywhere in the frame. **The core does
   not anti-alias.** Sub-pixel coverage exists in `engine/core/src/draw.rs`
   only for rounded corners and shadows; a plain rect snaps to whole pixels,
   and a rotated one is emitted as untouched triangles.
2. The same dump down the line's own length: it alternated between 4 and 5
   pixels wide, and jumped a whole pixel sideways every few rows.
3. Raising the subdivision from 42 rows to 100 took the geometric step from
   1.23px to 0.53px and changed the picture very little.
4. Supersampling to 2x, then 4x, put real intermediate greys at the edges and
   changed the picture very little either. **That reading was taken through a
   defect and does not survive it** — see the section below.

The reason all of that failed is that the staircase is not an aliasing
artefact. Stacking axis-aligned rectangles to approximate a leaning line
leaves a horizontal discontinuity at every joint, and what the eye reads is
the discontinuity, not how soft the edge across it is. Anti-aliasing a step
gives a soft step.

Rotating each segment onto the curve's local tangent removes the joint
instead of softening it. The residual is then chord-vs-curve sagitta,
`(1/8)·|x''|·Δ²`, and `x''` here is 6.2e-4 px/px²: over 16 segments of a 420px
panel that is **0.039px**, which `gen.ts` prints on every run. It also made the composition
smaller: 448 nodes against 2464.

It did **not** measurably improve the bow fit, and saying so would overstate
it — the stacked build's worst error against the reference was 0.0008 and the
rotated build's is 0.0006. Both constructions put the slats in the right
places. Only one of them puts them there without a staircase.

## Supersampling was the only anti-aliasing here, and it had a floor

> Everything in this section was measured while rotated solid boxes had no
> coverage. It is kept because the floor it describes is what motivated the
> `POLY` op, and because the lanczos and codec findings inside it still hold.
> For what supersampling decides now, see the section after it.

Step 4 concluded supersampling barely changed the picture. It was measured
before `518b9fb`, which found `src/render/encode.ts` downsampling supersampled
frames with **lanczos** — whose negative lobes re-sharpen and halo exactly the
hard synthetic edges supersampling had just softened. That reading was of
supersampling and something undoing it.

It was also measured through h264, which adds its own intermediate values. The
honest measurement is taken **pre-encode**: render `frame --at 30` (which
emits the supersampled buffer), area-downscale it to the viewport by hand, and
read the edges. On 350 rows of one interior hairline:

| | distinct partial levels | partial-coverage px (of 3850) |
|---|---|---|
| supersample 2 | 3 — exactly 64, 127, 191 | 105 |
| supersample 4 | 11 | 164 |

Three levels is not a measurement artefact, it is the whole story: **the core
snaps geometry to whole device pixels**, so the only anti-aliasing available
is "how many subpixels did the downscale average", and coverage is quantised
to N²+1 levels. At supersample 2 that is 5 possible values, and 97% of the
edge pixels still land on 0 or 255.

That is the floor. There is no coverage-based rasteriser to switch on, no blur
and no mask in this vocabulary, so edge quality here is bounded by the
supersample factor and nothing else.

**There is one now.** That sentence was true when written and is the reason
the op exists: `emit_box` emits `POLY` for a flat fill and `raster.rs` samples
coverage 4x4 over the whole clipped polygon. The floor moved from N²+1 levels
of downscale averaging to 17 levels of coverage before any downscale, and this
composition now measures 68 at supersample 2 and 22 at supersample 1.

**This composition delivers at 3840x2160 with supersample 2**, which renders
the same 7680x4320 buffer that 1920x1080 at supersample 4 did — identical
cost, four times the delivered pixels. The extra pixels are worth more than
the extra coverage levels were, because a player showing it at 1080p performs
one more downscale, and that one is a real box filter over four samples
rather than the core's whole-pixel snapping. Measured on the same hairline,
both reduced to 1920x1080 for comparison:

| | partial-coverage px (of 3850) |
|---|---|
| 1920x1080 render, supersample 4 | 285 |
| 3840x2160 render, shown at 1080p | 422 |

On a 4K display the file simply has the pixels. The geometry is authored in
1920-space and multiplied by `K` exactly once per constant, so every number
above stays comparable to the reference measurements.

The supersample factor itself is 2 here rather than 4. It costs 4.6x the render time (90ms/frame
against 21ms) and a 17MB pak against 4MB, which for a 5s card is worth paying
and for a long piece may not be. An earlier version of this file dismissed 4
as indistinguishable from 2; that comparison was made through both the lanczos
downscale and the codec, and does not survive either.

What the codec still costs, measured against the pre-encode truth: 7003 pixels
moved by more than 2 levels, worst delta 22 — mosquito noise around thin
bright lines. `encode.ts` fixes CRF at 16 and the CLI exposes no flag for it,
so that one is not reachable from a composition.

## The edges were hand-painted, until the core learned to compute them

This section is kept as history because the thing it describes was removed,
and the removal is only legible against it.

`draw.rs` computed fractional coverage for axis-aligned content only. A
rotated solid box went `emit_box` -> Sutherland-Hodgman -> `emit_tri`, which
rounds every vertex to an integer pixel and emits an op with **no coverage
field**. Probed directly, one frame, three shapes at 1x:

    plain rect      0   0   0 255 255 255 255 255   0
    rotated rect    0   0   0   0   0   0 255 255 255
    gradient        16  48  80 112 143 175 207 239

The first two were the whole anti-aliasing story of this renderer: there was
none, and supersampling only ever bought N²+1 quantised levels on top of it.
The third was the way out. A linear gradient's **interior** is interpolated
per pixel, so flanking a solid core with a ramp from the background to the
line colour painted the coverage the rasteriser would not compute:

    ramp|core|ramp  0  43 128 213 255 255 255 213 128  42   0

Every slat was built that way, `RAMP` wide on each side. It worked, and it was
wrong in two ways the composition could not fix from inside:

**It only worked against a known background.** The ramps ran from `#000000`
because the stage is `#000000`; over anything else they would have drawn a
dark halo. It was painting, not anti-aliasing, and correct only where the
painter knew what was behind.

**It made the line fatter than the line that was measured.** A fixed-width
ramp adds ink rather than redistributing it. Measured on the delivery, per
hairline, median over four rows in the settled band:

| | ink per line | design width |
| --- | ---: | ---: |
| ramp \| core \| ramp | **12.00 px**, identical on every row | 8.80 |
| coverage (`POLY`) | **9.0-9.2 px**, varying by row | 8.80 |

**The 12.00 is the tell.** Coverage varies with a line's sub-pixel position;
a number that is the same on every row is being painted, not computed. The
ramps were adding a third of the line's width to a hairline whose width was
measured off the reference at 3-4px at 1730 wide.

So removing them removed 26% of the frame's lit pixels, and that is the
overshoot leaving, not detail. `engine/core` emits `POLY` for rotated solid
boxes and samples coverage 4x4 over the whole clipped polygon; the ramps,
their keyframes and two of every three slat nodes went with them — 1024 nodes
to 448, and `pocket.config.ts` from 3827 lines to 1543.

It did not get much faster: 42.8 ms/frame to 40.8. At 7680x4320 the raster is
pixel-bound, not node-bound, and 576 fewer nodes buy 5%.

## Three engine degradations, and which of them bite here

`engine/core/src/draw.rs` lists what its rotated path gives up. Checked
against this composition's own emitted `main.tsx` rather than assumed:

- **Rotated solid boxes went through `TRI` — corner-transformed, clipped, no
  coverage.** 288 nodes here are rotated, so every segment's long edge was a
  hard edge, and supersampling was the only anti-aliasing this composition
  had. **No longer applies**: the core emits `POLY` and computes coverage over
  the whole clipped polygon. This is the degradation that drove the fix, and
  the section above records what the composition did while it stood.
- **Rotated rounded boxes silently degrade to square fills.** `rounded` does
  not appear anywhere in `main.tsx` (0 occurrences), so nothing is lost — but
  a future edit that rounds a slat cap would lose it without an error.
  **Does not apply today.** The degradation is still there: `draw.rs:1999`
  sends any non-axis-aligned rounded box to `emit_box`, dropping the radius.
  It now reaches `POLY` on the way, so such a box is at least anti-aliased
  while being the wrong shape.
- **Rotated IMAGE quads are culled outright.** There are no `Image` nodes
  here (0 occurrences). **Does not apply.**

## What is approximated, not measured

- **Brightness.** The reference dims the thickening front (~200) below the
  hairlines it grows from (255) for the one frame it is partway down. That is
  not reproduced: the slats here are one white. The settled hairlines *are*
  dimmed under the content, which the reference also does.
- **The rail** is a comb of 64 ticks merging left-to-right into a solid bar.
  The reference's rail carries labels and tick scales; only its shape, its
  sweep direction and its duration were taken.

## Verification

`lint` and `check` exit 0; two `trace` runs agree. That is the composition's
own contract — determinism and mount-only — and it says nothing about whether
this looks like the reference. The claim that it does rests on the two tables
above, both produced by measuring the render with the same script that
measured the source.
