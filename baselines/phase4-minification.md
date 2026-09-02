# Phase 4 — resampled footage, 2026-08-13

Two hard defects in `engine/core/src/raster.rs` were asserted from a survey,
the first being "no mipmap — scaled footage shimmers, the most glaring artefact in
video", with the criterion "4K footage into a 1080p frame, no shimmer frame by
frame". The assertion came from a survey. It had never been run.

Phase 5 is why that matters: its premise, "93% of the time is rasterisation",
came from a synthetic scene of 400 translucent boxes and did not survive contact
with real content — the frame hash turned out to cost more than the renderer,
and the work the plan had scoped was cancelled.

Reproduce with [`scripts/shimmer-probe.ts`](../scripts/shimmer-probe.ts). The
tables were re-measured after the tile-join fix below, so the ratios are against
the 510-pixel drawn interior rather than the 512 texture; the numbers moved by
less than the change in ratio.

## Method

A **zone plate** — radial frequency rising through Nyquist and past it, the
canonical aliasing pattern. A resampler that aliases at all aliases here. The
crop window **translates one source pixel per frame**, so the content is
identical between frames and every difference is either the shift or the
resampler's error.

Everything goes through the real path: `ingestFootage` → `FootageLayer` → 512px
tiles (drawing a 510px interior each) → `<Image>`. The comparison is ffmpeg's lanczos resample to the same drawn
size.

Three numbers. **mean |Δ|** and **PSNR** are the distance from a correct
resample. **crawl** is how much the *error field* moves frame to frame: a stable
resampling bias scores near zero however large it is, while aliasing that
reorganises as content slides scores high. Crawl is the one that means shimmer,
because the artefact is temporal.

Every row is measured twice, nearest and bilinear, against the same reference.

## What the first pass found, before there was anything to compare against

**The defect is not "no mipmap" — it is no filtering at all.** `raster.rs`
samples nearest by default and bilinear is opt-in per texture
(`spec::img::FLAG_LINEAR`), while `FootageOps.uploadTexture(buf, w, h, psm)` had
no flags parameter and the wasm host exported only the flagless
`ui_upload_texture`. The core's `Ui::upload_texture_flags` has always existed;
every route to it went through a pak entry or a tileset, so a host uploading
pixels it produced itself could not reach it. Footage could not request even
bilinear.

[`patches/0004`](../patches/0004-upload-texture-flags.patch) exports
`ui_upload_texture_flags` and wires `ops.uploadTextureFlags`;
`FootageLayerOptions.linear` selects it. Asking for linear on a rasteriser that
lacks the op **throws** — the wasm export is feature-detected upstream-style, and
a silent fall back to nearest would have produced a plausible, wrong table.

## Minification

Reference: lanczos downscale of the original zone plate, through the same
`in_range=tv:out_range=pc` conversion `src/footage/ingest.ts` applies.

| minify | mean \|Δ\| /255 | | PSNR | | crawl/frame | |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| | **nearest** | **linear** | **nearest** | **linear** | **nearest** | **linear** |
| **1.00 — control** | **0.00** | **0.00** | **∞** | **∞** | **0.00** | **0.00** |
| 1.06 | 12.51 | 4.20 | 19.00 | 30.72 | 15.27 | 6.04 |
| 1.14 | 12.99 | 3.95 | 18.76 | 31.25 | 16.13 | 5.67 |
| 1.33 | 13.98 | 4.22 | 18.35 | 30.70 | 17.92 | 6.03 |
| 1.59 | 14.85 | 4.52 | 18.09 | 29.54 | 19.39 | 6.60 |
| 2.00 | 24.60 | 2.80 | 14.56 | 34.77 | 27.77 | 3.63 |
| 3.98 | 47.20 | 37.64 | 11.49 | 13.12 | 29.99 | 25.31 |
| 7.97 | 68.58 | 59.77 | 9.14 | 10.11 | 32.28 | 31.66 |

The control ingests at the drawn size, so swscale does the downscale and the
rasteriser draws tiles at native size — what the pipeline does today. It comes
back **byte-identical to the lanczos reference in both modes**, which is what
makes the rest of the table readable: ingest, tiling, upload, `TEX_QUAD`,
readback and crop are all exact, so every number below the control is the
rasteriser's resampling and nothing else.

## Magnification

Reference: lanczos enlargement of **the same ingested pixels**, not of the
original source. Upscaling cannot recover what the ingest discarded, so scoring
a magnified draw against the full-resolution zone plate would charge the rasteriser
for the ingest's downscale. The question here is only whether the enlargement
itself is right.

| magnify | mean \|Δ\| /255 | | PSNR | | crawl/frame | |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| | **nearest** | **linear** | **nearest** | **linear** | **nearest** | **linear** |
| 1.25 | 23.28 | 13.59 | 15.86 | 21.54 | 16.60 | 10.09 |
| 1.51 | 23.32 | 13.57 | 15.84 | 21.55 | 16.63 | 10.09 |
| 1.88 | 23.28 | 13.56 | 15.86 | 21.56 | 16.60 | 10.07 |

## What it says

**Bilinear closes the gap up to 2x and stops.** Below 2x it is a 3–8x reduction
in crawl and a 12–20 dB improvement, with no trend against scale — 1.06x and
1.59x score the same, which is the signature of a filter that is adequate rather
than marginal. At 4x it buys 1.3x on crawl; at 8x, nothing. That boundary is not
a surprise and it is not tuning: a 2x2 footprint covers the source area exactly
once at 2x minification and misses most of it beyond. **This is the measurement
that would justify a mip chain, and it also says a mip chain is not needed
below 2x.**

**2.00x is the best linear row, not the worst.** At exactly 2x the bilinear
footprint lands on a 2x2 source block and averages it — a correct box downsample.
The rows either side are worse because the ratio is not integral, which is a
kernel-phase effect, not aliasing.

**Enabling linear costs nothing at 1:1.** The control is 0.00 / ∞ dB in both
modes. Bilinear at unit scale samples exactly at texel centres and reproduces the
texture byte for byte, so footage drawn at its ingested size is unaffected by the
flag. There is no trade to weigh for the case that already works.

**Magnification fails differently and bilinear fixes it more cheaply.** Nothing
aliases when enlarging; the picture goes blocky, and the blocks jump in
whole-texel steps as the source slides — that is the crawl dropping from ~17 to
~10. The stills show it plainly: nearest gives visibly stair-stepped ring edges,
bilinear gives smooth arcs. The residual ~21 dB is mostly kernel disagreement,
lanczos being sharper than bilinear by construction, and is not a defect in the
sense the minification numbers are.

**The cheap zero-core-change route was already dead and stays dead.** "Ingest at
the largest on-screen scale and let lanczos do the work" holds only while the
on-screen scale never changes — which is the case that already works. A push of
any amplitude lands in the table.

## Caveat on magnitude

A zone plate is a deliberate worst case: nearly all its energy sits at
frequencies real footage does not carry. The **magnitudes** here are an upper
bound, not a prediction. What generalises is the **shape** — exact at 1:1,
bilinear adequate to 2x, bilinear failing beyond it — because that shape is a
property of the sampling footprint, not of the test pattern.

## The push itself: curve, geometry, and one seam

Everything above measures a *static* scale. A push is an animated one, and it
raises three further questions that fail independently. Reproduce with
[`scripts/push-probe.ts`](../scripts/push-probe.ts) against
[`compositions/kenburns`](../compositions/kenburns/); footage is synthesised as
raw RGBA so no codec or swscale step can be blamed for a result.

**The curve is exact.** One `scale` animation on the container — transforms
compose down the walk as 2D affines, so the whole tile grid moves as a unit —
under `cubic-bezier(0.7,0,0.3,1)`. Measured on the drawn extent, not on the
declared animation:

| frame | measured | curve | linear would be |
| ---: | ---: | ---: | ---: |
| 0 | 1.000 | 1.001 | 1.000 |
| 12 | 1.043 | 1.043 | 1.150 |
| 24 | 1.242 | 1.242 | 1.300 |
| 30 | 1.475 | 1.474 | 1.375 |
| 42 | 1.699 | 1.700 | 1.525 |
| 54 | 1.748 | 1.748 | 1.675 |

**Shape matches to 0.0010 — the extent quantises to one pixel in 1024, so that
is the floor, not a residual.** The whole discrepancy is a constant **2.50-frame
lead**: the harness burns a frame before capture and the animation clock starts
when the style is applied. Charging that to the curve would report a distortion
that is not there, so the probe fits the phase first and then scores the shape.
The number matters on its own — an animation that must land on a named frame is
2.5 frames off from the naive mapping.

`pendingWork` is 0 throughout. A baked keyframe timeline is a table the core
walks by frame index, so an animated push costs the mount-only contract nothing.

**The tiles stay welded.** `TEX_QUAD` encodes integer x/y/w/h, so each tile
rounds its own destination rect and adjacent tiles could round apart. Solid white
footage on black, every frame of the push: **0/60 frames show a gap**. The
concern was reasonable and it is not what happens.

**But bilinear does not cross a tile boundary.** Each tile is its own texture, so
sampling at tile 0's right edge blends the last column with itself rather than
with tile 1's first column. A hard black→white edge placed inside tile 0 and an
identical one placed exactly on the join, mid-push:

```
nearest   edge inside tile 0:    0   0   0   0 255 255 255 255
nearest   edge ON the join:      0   0   0   0 255 255 255 255
linear    edge inside tile 0:    0   0   0 127 255 255 255 255   <- interpolates
linear    edge ON the join:      0   0   0   0 255 255 255 255   <- clamps
```

**The join is always sampled as if nearest, even with the flag on.** The error is
bounded by roughly half the pixel-to-pixel contrast across the join, so it is
sub-LSB on gentle content and up to ~128/255 where a hard edge lands on a tile
boundary. It is not a gap and it does not crawl with the content — the join sits
at a fixed place in the picture, so detail slides across a line that stays put.

A 4K source tiled at 512 has 7 vertical and 3 horizontal such lines. The standard
fix is a one-texel overlap: pad each tile with its neighbour's edge column at
ingest, then inset the UVs so the clamped edge is never the one on screen.

**Correction — that is not host-side, as first recorded here.** Insetting the UVs
requires addressing them, and a plain `<Image>` cannot: `emit_tex_quad` remaps
into a sub-rect `[fu0,fu1] x [fv0,fv1]`, but the only caller that passes anything
other than the whole texture is the animated-sprite path, whose frame index the
core derives from its own frame counter. A degenerate one-frame sprite can only
ever select cell 0, so it cannot express an inset. Drawing a 512-texel tile into
a narrower rect does not help either — UV still spans 0..1 across whatever rect
it is given, so the edge cannot be hidden, only minified.

So the fix needs a static UV rect on an image node, which is a core change. It is
a **cheap** one: `TEX_QUAD` already carries `u0,v0,u1,v1` in the DrawList and
every backend already honours them — `hosts/psp/src/ge.rs` converts them to raw
texels on the way to `sceGu`. Nothing downstream changes; what is missing is only
a way for an app to set them. That makes it more upstream-shaped than most of
this project's patches, not less.

### Fixed

[`patches/0005`](../patches/0005-image-uv-rect.patch) adds `Ui::set_image_uv` —
a node field, the `emit_tex_quad` call it feeds, a wasm export and the ops
wiring, plus a core test. A plain image defaults to the whole texture, so every
image that existed before draws exactly as it did. The rect is **sticky across
`set_image`**, because it describes the node's geometry rather than the binding;
that is what lets the footage layer state it once at mount while swapping a
texture into the node every frame.

[`src/footage/tiling.ts`](../src/footage/tiling.ts) is then the whole geometry in
one place: a 512 texture **draws 510**, carrying one texel of the neighbour on
each side, and the grid is `ceil(size / 510)`. At the picture's outer edge there
is no neighbour, so the bleed texel replicates the edge pixel — which is what the
sampler's own clamp would do there anyway, so the edges need no special case.

The result, mid-push, on a hard black→white edge:

```
                          before                     after
edge inside tile 0:  0 0 0 127 255 …      0  0  0  23 175 255 …
edge ON the join:    0 0 0   0 255 …      0  0  0  50 203 255 …
                             ^ clamped              ^ interpolates
```

The two profiles still differ, and that is expected — the edges sit at different
sub-pixel phases, so their weights differ even when both are right. **A hard edge
can show the clamp is gone but cannot show the join is correct.** A triangle ramp
can: bilinear of a linear function is exactly linear, so a correct render has
zero second difference everywhere except the ramp's own turning points, whatever
the phase. Measured across the drawn row, max |2nd difference| is **2 at the
join and 2 elsewhere** — the join is not distinguishable from the rest of the
picture.

Honest bound on that: the ramp steps 5/255 per screen pixel there, so a flattened
column would have scored about 5 against a floor of 2. A 2.5x margin is enough to
fail, not enough to call the join exact to the last bit. The primary evidence
remains the before/after on the edge itself.

Two smaller confirmations: `tests/tiling.test.ts` pins the layer's fast run math
against the reference `sourceTexel` texel by texel across six geometries,
including ones where the picture divides evenly by the *texture* but not by the
interior — that pair drifting apart would shift the picture by a pixel rather
than fail. And the magnification rows, which vary layout between runs, went from
13.56–14.40 to 13.56–13.59 dB-equivalent spread: the join contamination that had
been moving those numbers is gone.

## What 2x actually constrains — the shot's zoom RANGE, not its scale

The ratio the rasteriser sees is `ingest size / on-screen size`, and **the ingest
size is ours to choose**. That makes the 2x boundary far more permissive than it
first reads, and it makes one particular choice worth measuring.

Ingest at the shot's *largest* on-screen size and the ratio runs 1.0 at the
widest framing to `range` at the tightest — so the constraint is the **zoom range
within a single shot**, not the absolute scale. A static inset, however small,
ingests at its own size and is 1:1 forever.

Ingest at the range's **mid-point** instead and the shot straddles: magnified at
the wide end, minified at the tight end. That is only worth doing if
magnification holds up at 2x, which the earlier table did not reach — a 2x1 grid
of 512 tiles cannot be drawn wider than 1920. A 1x1 grid can:

| magnify | mean \|Δ\| /255 | | PSNR | | crawl/frame | |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| | **nearest** | **linear** | **nearest** | **linear** | **nearest** | **linear** |
| 1.00 | 0.00 | 0.00 | ∞ | ∞ | 0.00 | 0.00 |
| 1.50 | 13.09 | 4.99 | 18.34 | 28.46 | 15.23 | 7.19 |
| 2.00 | 10.58 | 5.40 | 20.88 | 28.35 | 12.13 | 7.63 |

**Magnification is flat from 1.5x to 2x** — 28.46 → 28.35 dB, crawl 7.19 → 7.63.
It does not degrade with ratio the way minification does, because enlarging
invents no frequencies it has to alias. (These are a single tile with no join,
against a different crop of the pattern than the 2x1 table above, so read the
shape within this table rather than across the two.)

So a mid-point ingest covers a **4x zoom range with no core change**: 2x
magnification at the wide end, where linear holds at 28 dB, and 2x minification
at the tight end, which is the *best* linear row in the whole minification table
(34.76 dB, crawl 3.64). The cost is that the widest framing is now slightly soft
rather than exact — acceptable for footage, worth checking if the shot carries
legible text.

**That is what narrows the mip chain's remaining case to: a single shot whose
zoom range exceeds 4x and which cannot be split into two ingests.**

## Where Phase 4 stands

- Footage at fixed scale: **nothing needed**. Ingest already does it correctly.
- Footage at animated scale within 2x of its ingested size: **done** —
  `linear: true` on the footage layer. Curves work, the grid stays welded, and
  the composition stays mount-only.
- Tile-join sampling: **done** — `patches/0005` plus `src/footage/tiling.ts`.
  The join is no longer distinguishable from the rest of the picture.
- Zoom ranges up to 4x in one shot: **covered**, by ingesting at the range's
  mid-point. No core change, and the wide end goes soft rather than aliasing.
- A single shot ranging beyond 4x and not splittable into two ingests: **open**.
  A mip chain is the mechanism, and it is the one item here that would actually
  cost the PSP leg something — `engine/core` is `no_std` and has to fit in an
  EBOOT, so +33% per texture and a level-selection branch is a budget
  conversation, not an API one. Nothing shipped needs it yet.
- The second Phase 4 defect — alpha-only blending, no screen/multiply/overlay —
  is untouched here and unmeasured.

## Build note

`hosts/web/pocketjs.wasm` is upstream-gitignored and built from `engine/wasm/`,
so patch 0004 does not reach the running rasteriser until it is recompiled.
`scripts/vendor.ts` now does that build, resolving cargo through
`rustup which cargo` rather than PATH: on this machine `/opt/homebrew/bin/cargo`
is a different rustc than the rustup toolchain and only the latter carries the
wasm32 std, so the obvious invocation fails with "can't find crate for `core`".

The build is reproducible — a full re-vendor from the pinned commit rebuilt the
rasteriser to the same SHA-256, and **the reel still renders to digest
`9afd9bf701ca97d8…`**, byte-identical to the cut frozen before any of this.
