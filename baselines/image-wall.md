# An image wall pushed in — trilinear against nearest and bilinear, 2026-11-05

Apple M4, Bun 1.3.11, the wasm rasteriser `scripts/vendor.ts` builds
(patches 0001–0050 and this one, now `0064`). Subject: `compositions/image-wall`, sixty 300×420
synthetic covers drawn at 45×63 — 15% — in a 12×5 wall on a 1280×720 canvas,
pushed in from 1× to 1.75× over 300 frames at 30 fps, linear. A cover is
6.67 texels a pixel at the first frame and 3.81 at the last, so the push
crosses from levels 2 and 3 to levels 1 and 2 at 4. Each cover carries what
a poster carries and a wall at 15% cannot show: rings 3 to 6 px apart, rows
of 2 px bars for a title, a 1 px checker, a 2 px frame.

Reproduce with [`image-wall/shimmer.ts`](image-wall/shimmer.ts). It stages
five copies of the composition that differ only in the class on the images
and `images.json`'s `linear` flag, builds each through the CLI, and renders
all five in one process in lockstep.

## Why this is the measurement

`baselines/phase4-minification.md` measured footage on a zone plate and
found **bilinear adequate to 2× minification and failing beyond it**: a
2×2 footprint covers the source once at 2× and misses most of it past that.
It left the mip chain open, for want of a shot that needed it. A wall of
covers at 15% is that shot at 6.7×, and platform templates — a ranking video
is a page of covers — are made of it.

## Metrics

Over the 299 pairs (298 triples) of consecutive frames:

- **mean |Δ|** — mean absolute change per channel from one frame to the next,
  /255: the frame-to-frame difference on a static-content zoom.
- **flicker** — share of pixels whose largest channel moves more than 32.
- **jitter** — mean |f(t+1) − 2f(t) + f(t−1)| per channel: the part of the
  change that is not steady. A push moves detail at a rate that changes
  slowly, so a well-filtered sequence keeps it small, and a pattern that
  flips between frames makes it large. It needs no reference.
- **crawl** — how much the frame's difference from a reference moves from
  one frame to the next, mean |(f₁ − r₁) − (f₀ − r₀)|, the definition the
  footage measurement used. The reference is the same wall under
  `image-filter-trilinear` at raster scale 4, box-averaged: sixteen samples
  a pixel, which is what supersampling buys an author today. It is **not**
  the truth — see below.
- **vs ref** — mean |Δ| from the reference's same frame.

| filter | raster scale | mean \|Δ\| /255 | flicker | jitter /255 | crawl /255 | vs ref /255 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| nearest | 1 | 8.988 | 7.63% | 17.945 | 6.838 | 9.137 |
| bilinear (`linear: true`) | 1 | 8.732 | 9.38% | 16.987 | 4.920 | 6.421 |
| **trilinear** | 1 | **4.574** | **6.80%** | **8.661** | **2.443** | **3.048** |
| bilinear | 4 | 6.447 | 9.26% | 12.246 | 0.223 | 0.292 |
| trilinear — the reference | 4 | 6.302 | 9.12% | 11.966 | 0 | 0 |

These are pixel arithmetic over deterministic frames: two runs on this
branch gave the same digits in the four columns both took.

## What it says

**Trilinear halves the shimmer, and has less than sixteen samples a
pixel.** Jitter, which needs no reference, is 8.66 against 17.95 nearest and
16.99 bilinear — and against 12.25 and 11.97 for the two ×4 renders. The
frame-to-frame difference halves the same way (4.57 against 8.99 and 8.73).

**The ×4 renders keep moiré that trilinear does not, and that is why they
jitter more.** At 15% the rings are 0.45 to 0.9 px apart on screen. Frame 0
cropped and magnified ([`image-wall/crops.ts`](image-wall/crops.ts)) shows
it: nearest and bilinear draw bold false
patterns over every ring; the ×4 render draws the same patterns fainter;
trilinear draws the rings close to grey, with a faint pattern left. A 4×4 box
is a weak low-pass at 6.7 texels a pixel; a chain of box-reduced levels read
at the footprint is a wider one.

**The price is softness.** The same crops show the title bars, 2 px rows in
the cover, blurrier under trilinear than at ×4. `vs ref` (3.05 against 9.14
nearest and 6.42 bilinear) and crawl (2.44 against 6.84 and 4.92) measure
the distance from the ×4 render and how much it moves; both put trilinear
closest of the three that render at scale 1, and neither can say which of
trilinear and ×4 is nearer the truth, since the ×4 render's moiré is in
both.

**Flicker barely separates anything**, 6.8% to 9.4% everywhere: at more than
32 levels it counts the edges of high-contrast detail travelling under a
push, which is motion as much as aliasing.

**What no filter here changes: the covers move in whole pixels.** TEX_QUAD
places a quad on whole logical pixels, at any raster scale, so under a push
each cover's edges step one pixel at a time — in every row, the ×4 ones
included.

## Cost

Same run, rows interleaved frame by frame, so the machine's load — a
1-minute average between 25 and 75 while this ran, from other work — lands
on all of them alike; read the times as ratios. A time is the core's seek and
read of one frame, in process; memory is wasm linear memory grown from boot
to the last frame.

| filter | raster scale | frame 0 ms | ms/frame after | memory grown MiB |
| --- | ---: | ---: | ---: | ---: |
| nearest | 1 | 38.4 | 10.9 | 3.6 |
| bilinear | 1 | 31.1 | 18.5 | 3.6 |
| **trilinear** | 1 | **82.3** | **34.8** | **13.0** |
| bilinear | 4 | 79.3 | 246.6 | 56.3 |
| trilinear | 4 | 232.7 | 476.5 | 65.8 |

**Per pixel trilinear is two bilinear reads and a blend**, 8 texels where
bilinear reads 4, and the frame costs 1.9× bilinear's. Supersampling ×4
costs 13× bilinear's and leaves more jitter.

**The levels are reduced once, on the first frame that needs them**: frame 0
costs 51 ms more than bilinear's for sixty 300×420 covers.

**Memory is the levels**, 9.4 MiB more than bilinear's here. Levels are
stored RGBA8888 whatever the texture's format, so they are a third of an
RGBA texture's bytes and two thirds of these RGB565 covers': 167,660 bytes a
cover over 252,000 of texture, 10,059,600 bytes for the sixty — 9.6 MiB. A
texture drawn at or above its size reads the texture alone and is never
reduced.

## Should it be the default?

**No, and the probe that says so is below.** Two defaults were built as
throwaway cores, never committed — an edit to `draw.rs` that sends an image
through the trilinear op whenever its footprint is above one texel a
logical pixel and its style does not say otherwise:

- **d1**, every texture;
- **d2**, only textures already flagged linear (`images.json`'s `linear`,
  and every footage tile, which `src/footage/layer.ts` uploads linear).

A default reaches image nodes and nothing else, so every composition in the
tree that draws an `<Image>` was run under the shipped core and both probes:
the ten the ledger can trace whole by their `trace --hash fast` digest, and
the two showcase films, at one to three seconds a frame here, by
`snapshot --samples 24`'s 24 PNGs. 2026-11-05, this branch.

| composition | d1: every texture | d2: linear textures |
| --- | --- | --- |
| `captions/burn-zh` | same | same |
| `footage-tracks` | same | same |
| `glow` | same | same |
| `glow-column` | same | same |
| `images` | **moves** | **moves** |
| `probe` | **moves** | same |
| `sound-roles` | same | same |
| `missing-image` | same | same |
| `kenburns`, `shimmer` | same | same |
| `mg-bauhaus` (24 frames) | **moves**: 23 frames, 4.87% of pixels, up to 219 levels | the same |
| `mg-hud` (24 frames) | **moves**: 21 frames, 3.83%, up to 189 | **moves**: 21 frames, 3.28%, up to 189 |

What stays: every footage tile, because a track is ingested at its drawn
size; the glow plates, drawn at their own size; the missing image's
placeholder. What moves: `images`' 0.8× horizon (linear, a footprint of
1.25), `probe`'s mark under d1, and both films, whose cuts were judged on the
pixels they have.

So a default would move two of the ledger's recorded digests (one under d2)
and re-cut two films that were reviewed frame by frame, in order to change
pictures nobody asked to change. The ledger exists so that a picture moves
when its composition says so. The class is one word in a literal a template
writes once, and it is the one place the cost is chosen: the levels' memory
and twice the texel reads, on the pixels of images drawn small. d2 has a
second cost the ledger does not show: a footage tile is uploaded every frame,
so a track drawn below its ingested size — a push — would reduce a chain for
every tile on every frame. Nothing in the tree does that today, which is why
nothing above moved on it.

What would make forgetting the class loud is a reading, not a default: an
image drawn below half its size without it is a finding `layout` could
report by taking the same footprint for every image. That is not built
here.
