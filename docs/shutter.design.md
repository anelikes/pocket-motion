# Motion blur as a declared shutter — design (stage 1)

**Stage 2 has landed** as `patches/0031-shutter.patch` and the host changes
listed at the end of this document. Where the build departs from the plan
below, the last section, "Stage 2 as built", says how and why.

Design, before the patch. A prototype was built in a scratch copy of the
vendored tree (`baselines/shutter/prototype.diff`, against the pin 66caf4e5
plus `patches/0001`–`0022`) and every number below is measured in
[`baselines/shutter.md`](../baselines/shutter.md), with the reproducers in
[`baselines/shutter/`](../baselines/shutter/). Nothing under `patches/` or
`vendor/` changes in this stage. The last section lists what stage 2 changes,
file by file.

## What it is for

Independent reviews of films made here flagged strobing on fast moves. The
case they named was a group rotation carrying forms about 180 px per frame:
each frame shows the forms sharp at one position and the next frame shows
them sharp 180 px further on, with nothing between. Films rendered in a
browser or in Blender carry motion blur there.

Here a frame is a pure function of the tick and is hash-verified, so blur
cannot be a filter run over finished frames (ffmpeg `tmix`, an optical-flow
pass). That would be pixels `check`, `visibility`, `layout` and the frame hash
never saw, which is the shape AGENTS.md's working rules rule out for draw ops,
and an input no sidecar declares. Blur has to be part of the picture: declared
in the sidecar, evaluated by the core, hashed like every other pixel.

The constraint is time resolution. Timelines bake to whole ticks at 60 Hz
(`framework/compiler/animation.ts:173`), and the core samples a timeline at its
integer clock and steps one tick at a time (`engine/core/src/lib.rs:1840-1845`).
Frame f of a 30 fps film reads clock `c = (f + 1) · 2 − 1`. A 180° shutter at
30 fps is open for 1/60 s, which is one tick, and the realm has no state
between two ticks.

## Decision 1 — samples come from evaluating timelines between ticks

A shutter sample at clock `c + δ`, with δ a rational fraction of a tick,
re-evaluates every playing baked timeline at that instant and writes the result
into the nodes' `anim_values`. No clock moves. `Ui::shutter_sample(num, den)`
in the prototype. For `δ = 0` it calls `sample_track` at `c`, which is the
expression `tick_timelines` uses, so a one-sample shutter is the unblurred
frame by construction. Measured: the prototype's N=1 digest equals `trace`'s
digest for the same bundle.

### Why not a higher bake rate

The alternative is to build at `--hz=240` or higher, generalise
`assertBakedTickRate`, and take samples at whole ticks of that rate. It looks
like less code. Measured against it:

1. **The unblurred film changes.** Every ms→tick conversion rounds at the
   bake rate: delays, durations and keyframe stops
   (`animation.ts:173`, `:605-607`). With no shutter, five compositions were
   built at 240 Hz and read at the same instants as the 60 Hz realm. These
   frames came out different: `transitions` 175/756, `shutter` 29/150,
   `rename-card` 48/180, `reel` 655/1071, `curves` 290/420. Turning blur on
   would move when things happen, not only how they look.
2. **The compiler caps the sample count.** `setAnimationTickRate` accepts 1
   to 240 (`animation.ts:112`). A 180° exposure at 30 fps is 4 ticks at
   240 Hz, so N ≤ 4. N=8 needs 480 Hz and N=16 needs 960 Hz.
3. **The format caps the film's length.** Segment endpoints, delays and
   periods are u16 ticks (`engine/core/src/style.rs:72`, `:92-93`). That is
   18.2 min at 60 Hz, 4.55 min at 240, 2.3 min at 480 and 68 s at 960.
4. **A whole-tick sample moves every property at once.** A sample is the whole
   core at one tick. The shutter therefore cannot keep opacity at the frame's
   instant while it integrates translate, and it cannot stop one track at a
   jump. A one-tick segment at 60 Hz becomes a four-tick ramp at 240 Hz, and
   the shutter integrates it as motion. At 360° the prototype scene's one-tick
   flick comes out as four ghost copies
   (`baselines/shutter/pictures/jumps-360-n1-subtick-hz240.png`, row 2).
5. **The blur becomes a build input.** The rate is compiled into the bundle.
   Changing N would mean a rebuild, and the bundle component of identity
   would move with it.

Cost does not decide between them. Both pay N rasters per frame, and the
extra ticks are ~0.035 ms per frame (`baselines/phase5-throughput.md`).

## What a fractional instant means

### Where the samples sit

The exposure is `span = angle/360 · 60/fps` ticks. Sample k of N sits at

    δ_k = span · (2k + 1 − N) / (2N)

so the samples are centred on the frame's tick and evenly spaced. The frame's
own tick is one of them only when N is odd. The host passes `angle · 60/fps`
over 360, and the core forms each sample's numerator and denominator in i64.
A sample time is therefore never a float that two hosts could round
differently. The samples are centred rather than trailing for two reasons:
N=1 is then the unblurred frame, and the tick that `layout` reads rects at is
then the centroid of the blur.

### Which properties are integrated

Only the transform properties are evaluated off the tick: `translateX`,
`translateY`, `translateZ`, `scale`, `scaleX`, `scaleY`, `rotate`, `rotateX`,
`rotateY` and `skewX`. Every other property keeps its value at the frame's
tick in every sample. That covers opacity, every colour, the layout properties
(width, insets, padding), radius, arcs, filter parameters and gradient stops.

- The transform properties are paint-time. None of them is layout-dirtying
  (`LAYOUT_DIRTY_BITS[2]`, which covers ids 128–191, is zero), so a sample
  costs a draw and a raster and never a relayout. A width animated per sample
  would reflow text differently in each sample, and the average would be a
  smear of two line breaks.
- Opacity is where the gates are. Every gate in this tree is an opacity
  segment one or two ticks long (`gin 17ms`, `gin 34ms`). If opacity is
  integrated, a two-tick gate at 30 fps shows faintly one frame before it
  opens. Measured on `rename-card`, with the prototype's measurement-only
  switch that integrates opacity: 23 of 180 frames change, by at most 8/255,
  and frame 13 lights 1260 px where the unblurred frame shows ground. With
  opacity held, those frames are the unblurred ones. The amplitude is small,
  and the rule is not chosen for the amplitude. It is chosen because a gate is
  a declared instant: `keyframes` already reports a gate that a frame shows
  part-way as the shape of a defect that shipped (`rename-card`'s close
  arriving late and grey).
- Holding opacity costs nothing on fades. For a linear fade, the average over
  a centred exposure equals the value at the centre. An eased fade differs
  from it only by the curve's bend over half a frame. Because opacity is held,
  `covered` and `invisible by declaration` read the same with the shutter as
  without it: the predicate in `src/render/visibility.ts` turns on whether a
  node emitted geometry, and opacity decides that.

### Inside a segment, and across a jump

Between ticks `n` and `n + 1`, a sample takes the segment's own eased curve at
`x = (n − t0 + p/q) / (t1 − t0)`, through `cubic_bezier` or the polynomial
ease and then `interp`. It does so only when the realm itself shows that
motion in progress: both ticks lie on one segment that has at least one
interior tick, and the value the realm writes at `n + 1` continues that
segment. Everything else is a **jump**:

- a zero-length keyframe interval, such as `50%` and `50.01%` rounding to one
  tick (`animation.ts:607` drops that segment and the later stop wins)
- a one-tick segment, which no tick of the realm ever shows part-way
- the first tick a fill-less timeline writes, and the tick after a fill-less
  end
- a choreography loop wrap (`animate-loop-[..]`), unless the value is the same
  on both sides of it
- an iteration wrap whose end value differs from its start value.
  Rotations are compared modulo 360, so a spin keeps its blur through every
  wrap.

A sample never reaches across a jump. It is clamped to the tick on the
canonical side, so every sample of one frame is on the same side of every
jump. A teleport therefore reads as one frame with a shorter exposure, never
as a streak or as two half-images. A sample before the timeline instance's
clock 0 clamps to clock 0.

Measured on the prototype scene, at 180° and N=8:

- the zero-length teleport's frames show 492 changed pixels instead of 892
  (half an exposure)
- the one-tick flick is byte-identical to N=1 at every frame
- the ring's blur stays at 106–116 k changed pixels on every frame, including
  every spin wrap.

### What the shutter does not evaluate

Tracks that `animate()` and transitions spawn (`Track::step`), springs and
physics keep their tick value. A mount-only composition cannot spawn any of
them after mount, because `check` refuses ops after mount. A `Track` spawned
during mount and still running would hold rather than blur. This is stated
here and not handled.

## Decision 2 — the core averages, in integers

`ui_render_exposure(scale, spanNum, spanDen, N)` works like this. For k
ascending, it samples at δ_k, rasterises into the framebuffer and adds the
result into an accumulator. It then samples at δ = 0, which leaves the core in
the canonical state, resolves the average and returns the exposure. With
N ≤ 1 it is `ui_render_scaled` and nothing else.

The arithmetic uses integers only and rounds half up:

- Per pixel, it keeps u32 sums of `r·a`, `g·a`, `b·a` and `a` over the N
  straight-alpha samples. These are exact up to N = 256, since
  255 · 255 · 256 < 2³².
- `α = (2Σa + N) / 2N` and `c = (2Σca + Σa) / 2Σa`. When `Σa = 0` the result is
  transparent black, which is the clear colour.
- A pixel opaque in every sample uses a table indexed by `Σc` that holds
  `(2Σc + N) / 2N`. That is the same expression without a division per
  channel.
- The accumulate step is simd128: four pixels per step, each channel byte
  multiplied by its pixel's alpha into u16, then widened and added. It
  produces the same bytes as the scalar loop, so digests did not move when
  the loop was replaced.

The average is premultiplied because the framebuffer carries straight alpha
(patch 0014). Averaging straight RGBA directly would darken every edge that
moves over transparency. It is exact in u32 so that a pixel no sample changes
resolves to itself, semi-transparent pixels included. A static region is then
byte-identical at any N. Measured: the prototype scene's static caption
region has 0 changed pixels at every frame for N = 4 and 8.

Why the average belongs in the core and not in the host:

- The core already evaluates the samples. If it also sums them,
  `ui_render_exposure` is the one call that produces a frame, and no host can
  sample without averaging or average a different way.
- It costs 2.4–3× less. A JS reference with the same arithmetic takes
  40.6 ms per frame at N=8 on the prototype scene against 17.3 ms in the core,
  and 188 ms against 66 ms at N=16 on `reel`.
- It is not a host-side pass over a finished frame. Each sample is a draw
  list the core built and rasterised, and `ui_draw_hash` can be taken per
  sample.

The result reproduces across platforms because the arithmetic is
integer-only and the sample order is fixed (integer sums do not depend on
order anyway). Measured: digests are equal on darwin/arm64 (two runs) and
linux/x86-64 (Docker, emulated) for N = 1, 4, 8 and 16. The core's bytes
equal the JS reference on 180 of 180 frames.

## Decision 3 — the declaration

```json
"shutter": { "angle": 180, "samples": 8 }
```

The key goes in `pocket-motion.json`. It changes pixels, so it is a sidecar
key, it is part of identity, `trace` prints it beside the digest, and
`CAPABILITIES.md` has a row for it. There is no CLI flag. A render flag that
changed the exposure would be an input nothing declares.

- `angle` is an integer number of degrees, 1–360. `samples` is an integer,
  2–64. These bounds are proposals. The arithmetic is exact up to 256, and
  64 caps a frame at 64 rasters, which is about 3 s per frame on the heavy
  scene.
- **When the key is absent there is no shutter, and the parser must not
  fill in a default.** `identityProjection` hashes every key the parser
  returns. A filled-in default would move the identity of every composition
  in the tree without moving one pixel, which is what
  `src/render/identity.ts:120-128` says about `sound`. `shutter` must not be
  added to `NOT_IN_IDENTITY`, because it changes frames.
- `samples: 1` is refused. It renders exactly the unblurred frame under a
  different identity, and the message says to remove the key instead.
- The per-node opt-out is a class (Decision 4). It is declared in the class
  literal, reaches the pak, and enters identity through it.

## Decision 4 — opt-outs

The rule settles most cases without any extra declaration:

- Gates and cuts are opacity, which is held.
- Jumps are clamped.
- Text that does not move has no integrated timeline, so it does not blur.

What the rule cannot know is that a node's transform motion has to stay
sharp. The usual case is a caption that slides in fast and has to be readable
in every frame. For that there is a class, `shutter-hold`, compiled to a style
flag. A node carrying it keeps its own timelines at their tick value in every
sample.

The flag is not inherited. A node's picture moves with its ancestors'
transforms, so text inside a moving group stays sharp only if the group
holds. A hold on a child whose ancestor blurs changes nothing visible, so
`lint` should warn about it rather than let it pass.

The prototype tested this with a host-side stand-in, `ui_shutter_exempt`,
resolved by `debugName`. The held label is byte-identical to N=1 at every
frame, while an identical label without the hold blurs
(`baselines/shutter/pictures/labels-f007-n1-n8.png`). Stage 2 replaces the
stand-in with the class, because a node list supplied by the host is exactly
the undeclared input this design exists to avoid.

## Interactions

- **Frame hash, `trace`, `render`, `frame --at`, `snapshot`, preview
  `/frame`.** Each of these produces the exposure. They all read frames
  through `WasmFrameSource.read()` (`src/runtime/frame-source.ts:188`), which
  is the one place that changes. The bytes `frame --at N` writes therefore
  stay the bytes `/frame` serves. `trace` prints the shutter beside the digest
  so a digest says which exposure it is a digest of.
- **`check`.** Unaffected, and it says so. The samples run no guest code:
  they happen inside one core call, after the frame's guest turn and ticks.
  Op counts, realm cleanliness and pending work describe the same guest turns
  as before.
- **`layout`, `visibility`, `assert`.** `inPicture` is a pixel question:
  hide the node, re-render, compare. It is asked of the exposure, so the node
  is hidden and all N samples are re-rendered. A node blurred into a region
  where the canonical tick shows nothing counts as in the picture, because
  the verdict is about the delivered pixels. `paints` is asked per sample: the
  node emitted geometry in at least one sample. Opacity is held, so
  `covered` and `invisible by declaration` do not change under the shutter.
  Rects are taken at the canonical tick (the centre of the exposure), and the
  JSON names the shutter and says so. Every probe costs N times as much.
  `visibility` on `reel` sweeps 631 nodes over 24 frames, so stage 2 should
  measure that before it decides whether any default grid changes.
- **`keyframes`.** It reads the pak and claims nothing different. One
  addition is worth having: report the transform segments the shutter treats
  as jumps (one-tick segments and zero-length intervals), so an author can see
  where blur stops. Reported, not failed.
- **Footage.** The layer presents one decoded frame per output frame, before
  the guest turn, so every sample of that frame draws the same texture.
  Footage content carries its camera's own exposure and is not resampled in
  time. A footage track's placement (tiles moved by a timeline) blurs like
  any other node.
- **Checkpoints and preview.** The accumulator lives in linear memory. After
  one exposure, memory grows from 10.2 to 49.8 MiB at 1080p, and from 33.9 to
  192.3 MiB at supersample 2. `captureSnapshot`
  (`src/runtime/checkpoint.ts:40`) copies all of linear memory. Preview
  rebuilds a session once memory passes 4× its boot reading
  (`src/preview/session.ts:64`, `:226`). The boot reading is taken before the
  first exposure, so every seek would rebuild. Stage 2 takes that reading after
  one exposure (or sizes the scratch at init), and lets a snapshot skip the
  scratch range the core reports. A restore never needs that range back,
  because every exposure overwrites it before reading it.
- **Supersample.** The exposure is rendered at physical size, and the
  encoder's downscale follows as before. At supersample 2 each sample costs
  4×.
- **Alpha delivery.** The average is premultiplied, so edges over
  transparency are correct. `render --alpha` measures its alpha floor on the
  exposure.
- **Parallel render.** Each worker folds forward and renders exposures for
  its own range. Nothing is shared.

## Cost

Median ms per frame at 1920×1080, 180°, with the load average at 9–12
(minimums are in `baselines/shutter.md`):

| scene | one raster | N=4 | N=8 | N=16 |
| --- | ---: | ---: | ---: | ---: |
| prototype scene (sparse) | 0.64 | 10.5 | 17.7 | 30.7 |
| `reel` frames 400–411 | 1.19 | 14.3 | 26.3 | 52.4 |
| `transitions` frames 100–111 | 7.84 | 40.3 | 77.2 | 209 |
| heavy: 400 translucent rotating boxes | 54.8 | 238 | 457 | 971 |

An exposure costs about N rasters, plus ~1 ms per sample to accumulate, plus
~3.5 ms per frame to resolve at 1080p. On a sparse scene the averaging is
most of the cost. On a heavy scene the rasters are.

The number of samples a film needs depends on speed. Sample spacing is
`speed · angle/360 / N`. The prototype's ring moves at 167 px per frame, so
the spacing is 10.5 px at N=8 and 5.2 px at N=16. At N=16 the steps are still
visible at the edge of a white form on a dark ground
(`baselines/shutter/pictures/ring-f015-n1-n4-n8-n16.png`).

## What it does not do

- Blur opacity, colour, layout, arcs, gradient stops or filter parameters.
  The rule holds them.
- Choose N per frame or per node. N is set once per composition.
- Resample footage in time.
- Jitter its samples. Every sample time is a fixed rational, so N trades
  against banding, not against noise.
- Reach `Track`s, springs or physics.

## Stage 2, file by file

The engine change is one patch, class `motion`. The shutter has no meaning on
the display targets upstream presents to. It takes the next free number at
the time it lands; `0023` is taken by the #591 backport branch.

- `engine/core/src/shutter.rs` (new): `integrates`, `value_at`, the
  interval and jump rule, and `sampled`. This is the prototype's file without
  the measurement-only opacity switch.
- `engine/core/src/anim.rs`: make `ease` reachable from the crate. The
  prototype adds `ease_ordinal` for this.
- `engine/core/src/lib.rs`: `Ui::shutter_sample(num, den)` beside
  `tick_timelines`. It reads the hold flag from the node's resolved style
  instead of the prototype's `shutter_exempt` list.
- `engine/core/src/tests.rs`: each jump case (zero-length interval, one-tick
  segment, fill-less start and end, loop wrap, spin wrap), offset 0 against
  `tick_timelines`, and the hold flag.
- `contracts/spec/spec.ts` and the generated `spec.rs`: a non-animatable
  style prop for the hold flag, at the next free id (the vector-paths design
  reserves 183–195).
- `framework/compiler/tailwind.ts`: the `shutter-hold` utility.
- `engine/wasm/src/lib.rs`: `ui_render_exposure`, plus
  `ui_exposure_scratch()` returning the pointer and length that checkpoints
  skip. Drop `ui_shutter_exempt` and `ui_shutter_integrate_opacity`. Keep
  `ui_shutter_sample` only if the host reference test uses it.
- `hosts/web/wasm-ops.js`: `renderExposure(scale, spanNum, spanDen,
  samples)`, feature-detected, and throwing when absent. A stale wasm would
  otherwise render unblurred with nothing reporting it, which is the lesson
  of patch 0004.

In this repository:

- `src/manifest/sidecar.ts`: `shutter` in `ROOT_KEYS` (line 226), its parser
  and its `sidecar.shutter.*` diagnostics, with no default filled in.
- `src/render/identity.ts` and `tests/identity.test.ts`: two sidecars that
  differ only in `shutter` have two identities, and a sidecar without the key
  has the identity it had before.
- `src/runtime/boot.ts`: `BootedWorld.render` takes the declared exposure, and
  a declared shutter on a wasm without `ui_render_exposure` is refused.
- `src/runtime/frame-source.ts` and `src/runtime/checkpoint.ts`: `read()`
  renders the exposure, and snapshots skip the scratch range.
- `src/cli/resolve.ts`: `ResolvedComposition.shutter`.
  `src/cli/commands/{trace,render,frame,snapshot}.ts` pass it through and
  print it.
- `src/render/visibility.ts` (`baseline`, `probe`, `rect`),
  `src/render/findings.ts` and
  `src/cli/commands/{layout,visibility,assert,verify}.ts`: probe the
  exposure, and put `shutter` in the JSON.
- `src/preview/session.ts`: take the boot memory reading after the first
  exposure.
- `src/catalog/surface.ts`, regenerating `CAPABILITIES.md`: rows for
  `shutter.angle`, `shutter.samples` and `shutter-hold` (G5, and a G6
  `BakeProbe` for the class).
- `src/anim/timelines.ts` and `src/cli/commands/keyframes.ts`: report
  transform jumps.
- `src/lint/`: warn on `shutter-hold` under an ancestor whose timelines are
  integrated.
- `compositions/shutter-blur/`, the fixture, from
  `baselines/shutter/scene-blur/`: a sidecar declaring the shutter, the hold
  class on the sharp label, and `assertions[]`. It goes in both ledgers and
  in `baselines/visibility.json`.
- `tests/shutter.test.ts`:
  - N=1 renders the unblurred frame
  - a static region is invariant under the shutter
  - each jump clamp goes red with the clamp removed
  - the hold goes red with the class ignored
  - the core's bytes equal a host reference
  - the canonical state is restored after an exposure.
- `AUTHORING.md` and `skills/pocket-motion/SKILL.md` (both executed by
  `tests/authoring.test.ts`), and `AGENTS.md`.
- `baselines/digests.json`: one new entry. No existing digest moves. Measured
  here: 11 compositions trace to the same digest with the prototype's wasm as
  with the pin's.

## Stage 2 as built

What differs from the file-by-file plan above, each for a reason found while
building it:

- **The patch is `0031`, the prop is 198.** `0024`–`0030` and props 183/184
  are another branch's (the rasteriser-defect fixes), and the vector-paths
  design has pencilled the thirteen props after them.
- **An exposure ends with a draw walk at the tick.** Writing the tick's values
  back restores the tree, but the DrawList and the inspector latch would still
  be the last sample's. One walk without a raster makes the state after an
  exposure the state after a plain render, so `layout`'s rect, read off that
  latch, is the frame's own box whichever render filled it.
- **The scratch is reserved at boot** (`ui_exposure_reserve`) rather than
  preview taking its boot reading after the first exposure. Reserved before
  the first snapshot, the allocation is in every snapshot's heap, so a restore
  never allocates it again past the restored watermark, and preview's 4×
  threshold multiplies a reading that already holds it. Its range comes back
  as two exports, `ui_exposure_scratch_ptr` and `_len`.
- **`paints` folds every sample's draw-list hash** (`ui_draw_hash_exposure`),
  which is "emitted geometry in at least one sample" without N extra walks per
  question on the host side.
- **Ink boxes are read at the tick**, with rects. `text_box_overflow` and
  `clipped_text` compare a glyph run's pixels with its box; a smear along the
  run's motion is not a run that overflows, and reading it from the exposure
  would report one on every fast caption.
- **`keyframes` reports `step` and `cut`**: one-tick segments and a change of
  value with no segment across it, in the first iteration of each transform
  track. Iteration and loop wraps are jumps too when their two sides differ;
  they are the timeline's period and are not listed.
- **The `lint` warnings read the source text**: `shutter.holdUnderAnimatedAncestor`
  for a held element inside an element whose class starts an animation and
  does not hold, and `shutter.holdsNothing` for a hold on a literal that starts
  no animation, or in a composition that declares no shutter. Ancestry is
  lexical within one file, and the keyframes are not read, so the message says
  "if that animation moves it".
- **The fixture gained `known`**, a white square at 4 px a tick over a 64-tick
  period, so a sample a quarter tick off the frame sits on a whole pixel and
  a 2-sample exposure can be written down in advance. Before it was added the
  fixture was the prototype scene with the hold class, and it traced to the
  prototype's recorded digests: `015b2653…` with no shutter, `94b940d8…` at
  180° × 4 and `1c985200…` at 180° × 8.
