# Vector paths — `<Path>`: baked outlines, filled, stroked, trimmed and morphed

The design of two `motion`-class patches: `0042-vector-path-op.patch`, the
op, the table and the geometry in the core, and `0043-path-component.patch`,
the `<Path>` declaration the build bakes. It was written as stage 1, before
the pin moved, against a prototype on a scratch copy of the vendored tree
([`baselines/vector-paths/prototype.diff`](../baselines/vector-paths/prototype.diff),
e0b37e2 + patches 0001-0022); the patches are that prototype rebased onto
66caf4e5 + 0001-0041 and the compiler half it did not have. Every number
below is in [`baselines/vector-paths.md`](../baselines/vector-paths.md) with
the command that produced it, and the last section, "What building it
changed", records each place the landing departs from stage 1 and why.
`patches/0013-mask-op.design.md` is the template. Where a number is a choice,
the text says so.

## What it is for

The comparison against mg-styles-15 found that about half of those fifteen
styles are reachable with today's primitives and better design. Most of the
rest stop at one missing primitive: **an arbitrary vector outline**. Line
drawing (After Effects Trim Paths, SVG `stroke-dashoffset`), shape morphing,
flat-vector illustration and characters, torn-paper edges, and wireframe
mountains and globes are all one curve, filled or stroked, whose extent or
shape changes with time. The core draws rects, rounded rects, arcs, POLY (a
convex polygon of at most 8 vertices), convex masks and images. None of those
is a curve, and none of them can be drawn on.

## The declaration

One component, thirteen style props, and no new host op:

```tsx
import { Path } from "@pocketjs/framework/components";

<Path debugName="signature"
      d="M10 80 C40 10 65 10 95 80 S150 150 180 80"
      class="fill-none stroke-white stroke-[4px] stroke-cap-round animate-draw" />

<Path debugName="blob" d={[BLOB_A, BLOB_B]} class="fill-amber-400 animate-breathe" />

<Path debugName="icon" d={ICON} viewBox="0 0 24 24" class="w-[96px] h-[96px] fill-white" />
```

`Path` is a `View`: it lays out, transforms, masks, filters and hit-tests like
one. Its node also names an entry of a **PATH TABLE** that the build bakes.
`d` is a static string literal or an array of them (the morph keys). A module
const that is a literal counts the same, as it does for class literals. A `d`
the build did not bake is refused at mount, the way a dynamic class is.

| prop | id | kind | animatable | default |
|---|---:|---|---|---|
| `path` | 199 | int: table index + 1 | no | 0 (none) |
| `fillColor` | 200 | color | bit 58 | transparent |
| `fillRule` | 201 | enum `FillRule` {NonZero, EvenOdd} | no | NonZero |
| `strokeColor` | 202 | color | bit 59 | transparent |
| `strokeWidth` | 203 | f32, in the path's own units | bit 60 | 1 |
| `strokeJoin` | 204 | enum `StrokeJoin` {Miter, Round, Bevel} | no | Miter |
| `strokeCap` | 205 | enum `StrokeCap` {Butt, Round, Square} | no | Butt |
| `strokeMiter` | 206 | f32 miter limit | no | 4 |
| `trimStart` | 207 | f32 fraction of arc length | bit 61 | 0 |
| `trimEnd` | 208 | f32 fraction | bit 62 | 1 |
| `trimOffset` | 209 | f32, wraps (1 = once round) | bit 63 | 0 |
| `trimMode` | 210 | enum `TrimMode` {Each, Whole} | no | Each |
| `morph` | 211 | f32 morph key, 0..keys-1 | bit 64 | 0 |

The defaults are SVG's (width 1, miter join, limit 4, butt cap, nonzero),
except colour: both colours default to transparent, so neither the fill nor
the stroke draws until it is asked for. The ids are one block after
`shutterHold` (198) and stay under 256, which the style record's `u8` propId
requires; 187-197 were free too, but they are eleven ids and these are
thirteen. The anim bits continue after `gradVia4Pos` (57) and are
timeline-only (above 31), like every paint prop since 0017; an animated value
is stored by prop id, so bit 64 needs no wider mask. `BgClip` gains `Path`
(2). `contracts/spec/spec.ts` carries all of this and `gen-rust.ts`
regenerates `spec.rs` and the microts copies from it.

Class tokens use Tailwind's own names where Tailwind has one:

| token | sets |
|---|---|
| `fill-<color>`, `fill-[#hex]`, `fill-none` | `fillColor` |
| `fill-nonzero`, `fill-evenodd` | `fillRule` |
| `stroke-<color>`, `stroke-[#hex]`, `stroke-none` | `strokeColor` |
| `stroke-N`, `stroke-[Npx]` | `strokeWidth` |
| `stroke-join-miter\|round\|bevel`, `stroke-cap-butt\|round\|square`, `stroke-miter-[N]` | join, cap, limit |
| `trim-start-[f]`, `trim-end-[f]`, `trim-offset-[f]`, `trim-each`, `trim-whole` | trim |
| `morph-[f]` | `morph` |
| `bg-clip-path` | the node's ground (solid, or a 0019 gradient) paints the fill |

`stroke-*` does not collide with 0017's `text-stroke-*`: the compiler reaches
that one only after it strips `text-` (`framework/compiler/tailwind.ts:576`).
Keyframe names are the prop names (`trimEnd`, `morph`, `strokeWidth`,
`fillColor`, `strokeColor`, …) plus the CSS spellings `stroke`, `fill` and
`stroke-width`. `stroke-dashoffset` is deliberately not a spelling: it is a
length and trim is a fraction, and treating them as one would make a draw-on
depend on a length nobody wrote. A draw-on is one keyframe:

```ts
keyframes: { draw: { from: { trimEnd: "0" }, to: { trimEnd: "1" } } },
animation: { draw: { value: "draw 1200ms cubic-bezier(0.4,0,0.2,1) both" } },
```

**Why a style prop and not a host op.** A path is static data selected by a
style prop, the way a font slot is. Keeping the selection in the style record
means it travels through the style table, `setProp`, the inspector and the
ANIM TABLE with no new plumbing; a change to `path` is a paint-only change;
and the draw list stays the complete pixel truth.

## The table

The table is appended to `styles.bin` after the ANIM TABLE and counted by the
header's `u16` at offset 10, which was `reserved (0)`. A composition with no
`<Path>` therefore writes the bytes it wrote before, and no ledger digest moved
(measured: every recorded digest reproduced with both patches applied).
`StyleTable::parse` reads the table there, and a truncated one makes
`load_styles` refuse the blob (tested). `encodeStyleTable` and
`decodeStyleTable` in `contracts/spec/spec.ts` write and read it, and the
encoder refuses what the core would.

    Path entry (little-endian, unaligned, like the style records):
      +0  u16  verbCount
      +2  u8   shapeCount (1..=8)       morph keys
      +3  u8   flags                    bit 0: viewBox present
      [viewBox] 4 x f32                 x, y, w, h
      verbCount x u8 verb               0 move, 1 line, 2 cubic, 3 close
      shapeCount x npts x (f32, f32)    npts derived from the verbs

The parser refuses an entry whose first verb is not a move, an unknown verb,
zero or more than 8 shapes, shapes of different point counts, and any
non-finite coordinate (all tested).

The compiler (`framework/compiler/path-data.ts`) normalises `d` to those four
verbs: relative to absolute, `H`/`V` to `L`, `S`/`T` to `C` by reflection, `Q`
to `C` by exact degree elevation, `A` to cubics of at most 45° each, and every
subpath after a `Z` reopened by an explicit move. A number after a `Z` is
refused, not read as a command. **The arc conversion must not use
`Math.sin`.** JavaScriptCore's `Math.sin`, `cos` and `atan2` are
implementation-defined and may call the host libm, so a pak's bytes would
depend on the machine that built it. The arc never becomes an angle at all:
from SVG's centre construction (F.6.5) it keeps the start and end as unit
vectors, cuts the sweep in halves by bisecting them — `a + b` normalised near
a full turn's ends, the difference turned back a quarter near a half turn,
where the sum cancels — until every piece is within 45°, so an arc is 1, 2, 4
or 8 cubics, and takes each piece's handle length `4/3 tan(α/4)` from its
cosine and sine by two half-angle steps. That is `+ - * /` and `Math.sqrt`,
which IEEE 754 rounds correctly on every host. The one angle left is the
x-axis rotation the author wrote, in degrees: `cosSinDeg` reduces it exactly,
is exact at multiples of 90°, and evaluates a Taylor series in f64 elsewhere.
A quarter-turn cubic sits up to 2.7e-4 r off the true ellipse, 0.27 px at
r = 1000; an eighth, under 4.3e-6 r. `tests/vector-paths.test.ts` pins two
arcs' f32 bits, and the determinism workflow re-runs it on Linux/x86-64.

Morph keys must share their verbs after normalisation. Where one key has a
line and another a cubic at the same index, the line is promoted to a cubic
with control points at 1/3 and 2/3. The promotion is exact, and the flattener
turns a straight cubic into one chord, so a square can morph into a circle.
Any other difference is refused, naming the first differing command and its
index in each key. Point counts are not equalised automatically. A morph
between keys drawn separately is refused, not resampled, because resampling
chooses a point correspondence, and the correspondence it chooses is a
picture nobody declared.

## The op

    PATH = 71   op, len, flags, color, C, then C x { n, n x (x, y) }

- `len` is the op's total word count, so any reader can skip the op without
  decoding it.
- `flags` bit 0 is the fill rule.
- Each of the C contours is closed implicitly.
- `x` and `y` are `i32` in **1/256 logical px**.

This is the first op since TEXT_RUN exempt from the i16 guarantee: a path's
coordinates need the fraction, and a vertex may lie off screen. They are not
unbounded, though. The core clips every contour to the viewport grown by a
4 px guard band before quantising, by Sutherland-Hodgman, which preserves
winding for every point inside the band: each excursion outside is replaced by
a segment of the boundary, and the loop the excursion and the segment form
lies wholly outside. Every coordinate is therefore within `(W + 8) * 256`,
which keeps the rasteriser's integers far from overflow; that is what lets an
edge's stepping state fit `i32`. A contour wholly outside the band is dropped,
not clipped. Code 71 is the next one in the reserved range, and
`MOTION_DRAW_OPS` gains `"path"`.

Five readers walk a draw list in the core and each takes an op's length from
a table of its own: the rasteriser, the damage decoder, the tests'
`validate_drawlist`, and — added upstream after stage 1 — the compositor's
`draw_op_len` and `Ui::compositor_surface_frames`. An op none of them knows
ends the walk, so every one learns PATH's `len`, and every one refuses a
`len` shorter than the five header words, which would otherwise never
advance (`every_draw_list_walker_steps_over_a_path` holds the two compositor
walkers).

A node emits at most two PATH ops, the fill and then the stroke (SVG's paint
order), after its ground and before its children. A gradient fill is the fill
op between PAINT_PUSH and PAINT_POP, painted white, exactly as 0019 paints a
ground or a glyph run; a fill that the guard band leaves empty takes its
PAINT_PUSH with it rather than leaving an empty bracket.

## Coverage

**The sample lattice is POLY's.** There are sixteen samples per physical
pixel, at ±1/8 and ±3/8 px from its centre; a pixel blends at
`a * hits / 16`; and a run of fully covered pixels is one `fill_opaque`. What
changes is the predicate. POLY's cannot be shared: it asks every edge function
of one convex polygon for `F >= 0`, and a path is any number of contours,
concave, self-intersecting, and with holes. PATH sums winding:

- an edge counts at sample row Y when `ytop <= Y < ybot`;
- its crossing x counts for the samples with `X >= x`, tested exactly in
  integers (as `X * den >= num` in the reference);
- the fill rule reads the sum (`!= 0`, or odd).

That is the top-left convention, chosen over POLY's inclusive rule on purpose.
POLY counts a sample lying exactly on an edge for **both** polygons that share
the edge. PATH gives it to exactly one, so two shapes that abut partition the
samples of their seam: `hits_a + hits_b == hits_whole` on every pixel, over
300 polygons cut in two (tested). An illustration is made of abutting shapes,
and a seam whose samples count twice is a line nobody drew. The price is that
a convex polygon with integer vertices drawn as PATH differs from the same
polygon drawn as POLY on the pixels holding such a sample. Measured over 300
random polygons at scales 1-3: **3,429 of 960,934 covered pixels** differ.
The test asserts both that every one of those differences is a sample exactly
on a right or bottom edge, and that no sample anywhere else differs. So PATH is
POLY's lattice, POLY's levels and POLY's blend, with a different answer on the
boundary set and the same answer everywhere off it.

Two patches since stage 1 sit beside this. `0024` moved `PolyScan`, which
POLY and MASK_PUSH share, to sixteenths of a pixel with POLY byte-identical,
so the lattice and the comparison above are unchanged (the count was
re-measured equal). `0030` gave TRI and TEX_TRI the same idea for pixel
centres: a centre exactly on an edge two triangles share is drawn by one of
them. PATH's rule is that rule on the 4x4 lattice, and a PATH and a POLY that
share an edge still both count its samples — POLY is unchanged by either.

What PATH does **not** fix is conflation. Two abutting shapes are still two
blends, so a seam pixel half-covered by each shows `(1 - h_a/16)(1 - h_b/16)`
of whatever is behind it; the fan of 24 wedges in the scene set shows the
faint radial lines. Every renderer that anti-aliases shapes one at a time has
this, and designers underlap. A coverage-merging op for flat illustration is
a later design, and the partition above is what it would be built on.

**How the coverage is computed.** Each edge is set up once: it is dropped if
it spans no sample row, otherwise it gets its first crossing by one division,
and is bucketed by first row (a counting sort). From then on its crossing
steps from row to row exactly, by quotient and remainder with no division,
and the active list stays in crossing order with an insertion sort, since the
order from the row above is nearly right. Each sample row's transitions of
the fill rule become interval ends, appended without a branch. The four
sample rows of a pixel row are merged and swept once, which emits **runs**: a
solid interior is one `fill_opaque`, and the hole of a stroked ring costs
nothing.

The scanline is held to a brute-force reference that shares no code with it.
The reference evaluates the predicate above for every sample of every pixel
against every edge, with no sorting, no stepping and no clip. Over **480
random ops the two agree hit for hit**. The vertices sit on grids of 1, 1/2,
1/4, 1/8 and 1/256 px and on an odd step, so vertices land on sample rows and
crossings on sample columns. Repeats, horizontal runs and zero-area spikes are
inserted on purpose. The ops are drawn at scales 1-3, clipped and unclipped.
A second test holds the framebuffer a PATH op leaves equal to one built from
the reference's hits with 1×1 RECTs at `a * h / 16`.

## Geometry

Per frame, in the draw walk, the core turns an entry into ops:

1. **Morph.** The control points at `m` come from key `k = floor(m)` and key
   `k + 1`, as `a * (1 - f) + b * f`. The two-term form is exact at both ends
   in f32 (`a * 0 + b * 1 == b`); `a + (b - a) * f` is not, and a test that
   compared emitted words could not tell, because 1/256 px quantisation hides
   one ulp. The test compares the points bit for bit.
2. **Flatten, in local space.** Cubics become chords by Wang's bound,
   `n = ceil(sqrt(3/4 * M / tol))`, where M is the larger second difference of
   the control polygon. It is computed as a fourth root of squared lengths, so
   no norm needs its own root. `tol` is 1/16 logical px divided by the
   Frobenius norm of the node's world affine. That norm bounds the largest
   stretch and does not change under rotation, so **a turning path keeps its
   chord count**: one count over 360 angles, where a row norm gives 11
   different counts (457 to 537). Every chord stays within `tol` of its cubic
   over its parameter span (tested in f64). Each cubic's end point is copied,
   not evaluated, so subpaths join exactly.
3. **Trim**, for the stroke only, by arc length on the local polyline. Start
   and end are ordered and clamped and the offset wraps; `e - s >= 1` means no
   trim at all, byte for byte. `Each` trims every subpath by the same
   fractions (After Effects' "Simultaneously"); `Whole` treats the subpaths as
   one sequence ("Individually"). A window that wraps past the end of a closed
   subpath is one piece through its start point; on an open subpath it is two
   pieces. The pieces' lengths sum to `(e - s)` of the whole to within 1e-3.
4. **Stroke**, in local space, so a non-uniform scale strokes the way an SVG
   transform does. Each side of a polyline is walked forward with its offset
   points. Open polylines become one cycle (side A, end cap, side B reversed,
   start cap); closed ones become two. **The cycle's winding is the sum of the
   windings of its pieces**: one quad per segment and one wedge per join or
   cap, all wound the same way. The cross edges that each quad and wedge add
   at a join cancel in pairs, leaving exactly the cycle. So the cycle's
   nonzero fill is the union of the pieces, with no boolean geometry and no
   special case for curvature tighter than the half-width, where the inner
   offsets fold back on themselves (the 30 px hairpin in the scene set fills
   as one solid shape). At each join:
   - the outer side gets the join: the miter point within the limit, a bevel
     beyond it, or a round arc;
   - the inner side gets the vertex itself, the pivot. Where both
     neighbouring segments are longer than `1.125 * hw * |sin|`, the inner
     wedge lies inside both quads, and the side takes the point where its two
     offset lines meet, which is exactly the union's boundary there;
   - the outer side likewise takes the meeting point for a miter within its
     limit (the dropped ends are collinear with it, so the region is
     unchanged) and for a round or bevel join that the miter point overshoots
     by under 1/256 px.

   On the stress frame below that takes the stroke outlines from 1.15 M
   vertices to 0.76 M. Round joins on a curve mostly keep both offset ends:
   the 1/256 px overshoot allowance is strict, and it is the knob if strokes
   ever need fewer vertices.
5. **Round joins and caps use no trigonometry.** An arc of cosine `c` is
   bisected until each chord's sagitta is under the tolerance. The half-angle
   cosine is `sqrt((1 + c) / 2)`, and each bisector is `u + v` normalised, or
   past 90° the perpendicular of `v - u`, which does not cancel.
6. **Map, clip, quantise.** The points go through the node's world affine
   (with the viewBox, if any, composed in front of it as xMidYMid meet), are
   clipped to the guard band, and are rounded to 1/256 px.

**Determinism** is the argument the rest of the core already makes, applied
to more code. Every step is f32 `+ - * /`, comparisons, and a Newton square
root: `fmath::sqrtf`, which the pin carries (a bit-trick seed and three
steps), behind a guard that reads a NaN as 0 — fmath's own guard is
`x <= 0`, which a NaN passes. Rust never contracts `a * b + c` into an FMA; wasm has no
FMA outside relaxed-simd, which is not enabled; nothing calls libm. The one
f32 result that differs between x86, ARM and wasm is the bit pattern of a NaN,
so no NaN reaches an output:

- the table refuses non-finite coordinates;
- every divisor is checked or bounded away from zero first;
- a transform that produces a non-finite point drops the op (tested with NaN,
  infinite, zero, singular, 1e4 and 1e-6 transforms);
- quantisation goes through a saturating `as i32`.

From the quantised words on, the coverage is integer. This is checked, not
argued: the scene digests below are equal on every target tried.

## Paint, transforms, masks, filters

- Opacity multiplies both colours' alpha, as it does for every op.
- `bg-clip-path` paints the node's ground into the fill. A solid `bg-*`
  becomes the fill colour. A 0019 gradient wraps the fill op in
  PAINT_PUSH/PAINT_POP, with its line spanning the node's box, and the box
  itself is not painted (tested). The stroke is not painted by it: a gradient
  stroke needs a second stop set and is left for later. As with
  `bg-clip-text`, the compiler takes the paint path for a legacy two-stop
  gradient under `bg-clip-path`.
- The world affine applies to the control points before flattening, which is
  exact for Béziers, so rotate, scale, skew and the parent chain all apply. A
  path inside a perspective subtree is not projected; that is the same
  contract text has.
- Masks, paints and filter layers wrap the render target, and PATH writes
  only through `blend` and `fill_opaque`, so it is masked, painted and
  filtered with no code of its own. A frame-covering path under a mask is
  byte-identical to a RECT under the same mask (tested), and the pinned scenes
  include a path under a mask, one under a gradient paint, and one in a
  blurred, shadowed layer.
- A shutter (`0034`) re-evaluates transform timelines between ticks, and a
  path's geometry is rebuilt from its node's world affine in every sample, so
  a moving or turning path blurs. Its trim, morph, width and colours keep the
  frame's tick in every sample — the shutter integrates transform tracks
  only — so a draw-on's tip is not smeared and a morph is not ghosted. A path
  under a shutter costs its geometry once per sample.

## What the gates see

- `ui_draw_hash` hashes the words, so every vertex, the morph, the trim and
  the width are in the frame hash, and a change to any of them moves it.
  (Tested through `animate`: every frame of a trim draw-on emits a new stroke
  op while the fill op stays the same.)
- `check` sees no guest op: the path is baked data selected by a style prop.
- `visibility` and `layout` read a `<Path>` like any other node. `debug_hide`
  removes both of its ops (tested), and its pixels decide `inPicture`. A path
  trimmed to nothing emits no geometry and reads as invisible by declaration;
  a path entirely under another reads as covered.
- `keyframes` reads the new tracks like any other and needed no change: it
  takes prop names from the vendored spec.
- `layout` calls a named node that emits nothing `text_not_painted`, whatever
  its kind, so a signature before its draw-on is reported, by that name, as
  invisible by declaration; `compositions/vector-paths` excuses it with a
  `layoutAllow` entry saying so.
- `damage.rs` takes the op's length from word 1 and its bounds from its
  vertices. An incremental render of a moving path equals the full render
  (tested, and red with the bound one pixel short).

## Measurements

The prototype, the harness and the outputs are in
[`baselines/vector-paths/`](../baselines/vector-paths/). Times are medians on
an Apple M4. "wasm" is the shipping configuration: opt-level 3, lto and
`+simd128` (patch 0022), run in Bun 1.3.11 / JavaScriptCore.

**Determinism.** Sixteen scenes are pinned by an FNV-1a 64 digest of the draw
list's words and one of the framebuffer, both recorded on darwin/arm64: fill
rules, joins×caps, closed and tight-curvature strokes, trim windows and
wraps, a morph sweep, transforms with a viewBox, the mask/paint/layer
wrappers, abutting tiles, and the three dense illustrations below at 1× and
2×. All 32 digests are equal on:

| target | how |
|---|---|
| darwin/arm64, native | `cargo test --release` (rustc 1.97.1) |
| darwin/arm64, wasm32 | Bun 1.3.11 / JSC |
| linux/x86-64, native | `rust:1.97.1-slim-bookworm`, linux/amd64 |
| linux/x86-64, wasm32 | `oven/bun:1.3.11`, linux/amd64 |

At the landing scene 10 was re-pinned (see "What building it changed"), and
the two darwin/arm64 rows were measured again on the landed core: 16 of 16
scenes equal. The two x86-64 rows are stage 1's and were not re-run.

The two x86-64 rows ran under Docker Desktop on Apple silicon, so their
instructions were x86-64 translated, not run on x86 hardware. The x86-64
hardware run is the repository's existing workflow, and the patch puts the
path fixture in its ledger (below).

**Cost per frame at 1920×1080.** Each illustration has 300 paths of 67 cubics
each (20,100 segments), with a two-key morph on every path. The machine was
shared while these ran (load average 12-14 from other work), so the table
gives each stage's **minimum** over 15-25 runs; the medians, up to 50% higher,
are in the raw outputs.

| illustration | geometry | raster ×1 | raster ×2 | `ui_draw_hash` | words |
|---|---:|---:|---:|---:|---:|
| flat vector: smooth fills + 1.5-6 px strokes, ~1.4× coverage | 4.4 ms | 21.5 ms | 41.5 ms | 2.8 ms | 687 k |
| line art: open curves, stroked only | 5.3 ms | 26.6 ms | 53.8 ms | 2.0 ms | 494 k |
| line art, mid draw-on (trim animating) | 3.4 ms | 12.8 ms | 26.8 ms | 1.1 ms | 264 k |
| stress: spiky blobs, ~4.4× overdraw | 12.0 ms | 70.9 ms | 127.3 ms | 8.2 ms | 1.95 M |

Those are wasm. Native aarch64 is within the run-to-run noise of wasm: its
×1 minima are 23.2, 26.6 and 61.6 ms for the first, second and fourth rows.
The geometry is rebuilt every frame, with nothing cached. For scale: the reel
rasterises a 1080p frame in 1.19 ms (`baselines/phase5-throughput.md`), and
HyperFrames measured 32-38 ms per 1080p frame of a GSAP data-viz
(`baselines/phase0-acceptance.md`). So a dense illustration costs 20-60× a
frame of text and rules, single-threaded, and its frames parallelise across
processes as frames already do.

The cost is set by edge-rows (each edge times the sample rows it spans) and
by covered pixels. The first prototype took 117 ms to rasterise the stress
frame natively. The scanline changes listed under "How the coverage is
computed" brought it down while leaving every pinned digest unchanged:
bucketing and exact stepping instead of a sort and a division per row,
emitting runs, and merging the four sample rows' interval ends in linear time
instead of insertion-sorting them, which alone was 28 ms. Merging the
outline's offset points at gentle joins then took out a third of the stroke
vertices; that step changes stroke geometry by design (not at all in the
picture for miters, under 1/256 px elsewhere), and the digests were re-pinned
after it. `baselines/vector-paths.md` has each step's number.

**Correctness**, as measured by the suite (24 tests):

| claim | measured |
|---|---|
| scanline = brute-force reference | 480 random ops, every hit equal |
| PATH vs POLY on convex integer polygons | 3,429 of 960,934 pixels differ, all by on-edge samples |
| abutting paths partition their seam | 300 cut polygons, every pixel `a + b == whole` |
| stroke outline = union of quads, wedges, caps | 24,473,600 samples, 119 differ, all within 0.74/256 px of a piece edge |
| round stroke = true offset | within 1/16 + 2/256 px at every sample of 120 polylines |
| chords independent of rotation | 1 count over 360 angles |
| trim end only adds coverage | 1 pixel loses a sample over a 40-step draw-on (cut points re-quantised); the test allows 4 |

**Guards.** Each test was made to fail before it was trusted.
`baselines/vector-paths/redcheck.py` introduces a defect, runs the test that
should catch it, and reverts. Over **33 defects, every one turns its test
red**. They include: a crossing rounded the wrong way; a remainder carry on
zero; a closed y range (red in both the reference and the partition test); a
sweep run one pixel short; a merge that drops a tail; the sample lattice
moved by 1/16 px; the render scale ignored; an outer join on the inner side;
the inner meeting point taken without the length margin; round joins merged
too eagerly; a round cap facing backward; the miter limit inverted; the
trim's full window, wrap and interpolation each broken; the morph lerp made
inexact; a row-norm scale bound; Wang's bound quartered; no guard clip; the
damage bound a pixel short; the table's checks removed; and the walk ignoring
trim, painting the box under `bg-clip-path`, or drawing a hidden node. One
guard did not guard on its first run: morph exactness was compared through
quantised words, which hide one ulp. It now compares the points bit for bit.

## The declaration, as built (0043)

- **`framework/compiler/path-data.ts`** (new): the grammar, the four-verb
  normalisation, the arc conversion above, morph-key alignment and its
  refusals, and `parseViewBox`. A refusal is a `PathDataError` naming the
  character offset, or the first normalised command at which two keys part
  and the source command each came from.
- **`framework/compiler/jsx-plugin.ts`**: the collector records, as
  `pathDecls`, every `d` attribute whose value it can read — a string, a
  backtick with nothing interpolated, a `+` of two (a long `d` written across
  lines), an array of those, a `const` of any of them, an element of a
  `const` array by literal index, the parameter of a `.map` callback over one
  (each element, so `{ICONS.map((d) => <Path d={d} />)}` bakes every icon,
  and an array of key arrays bakes a set of morphs), and the arms of a
  ternary, `||` and `??` (of `&&` the right only) — paired with the
  `viewBox` written on the same element, on ANY element, so a component that
  forwards `d` to a `<Path>` is baked from its call site. A `d` it cannot
  read — an import from another module, a string computed at run time, a
  destructured `.map` parameter — records nothing and is left to mount. The literals stay ordinary
  literals: a `const` used as path data and as text keeps its glyphs. The
  field rides in the transform cache entry, whose file is in the cache key,
  so no shape marker was needed.
- **`tools/build.ts`**: one PATH TABLE entry per distinct `d` and `viewBox`,
  in walk order, baked before the styles so a refusal is printed as
  `file:line:column: <Path> d does not bake: …` and the build exits 1.
- **`framework/compiler/tailwind.ts`**: `compileClasses` takes the entries and
  writes them into `styles.bin`; `generateStylesModule` writes `PATH_IDS`,
  key to index + 1, beside `STYLE_IDS`. The tokens are the table above, and
  `bg-clip-path`; a negative width, a miter limit under 1, a negative morph
  and a fraction that is not a number do not parse, which a class= attribute
  refuses (`0041`).
- **`framework/compiler/animation.ts`**: the seven prop names and `fill`,
  `stroke`, `stroke-width`. `stroke-dashoffset` stays unsupported.
- **`framework/src`**: `path-key.ts` (new) is the one function the build and
  the runtime both key an outline by; `Path` (in `primitives.ts`, exported by
  `components.ts`) is a View that hands the host ONE attribute, that key, so
  the order `d` and `viewBox` arrive in cannot matter; `native-tree.ts`
  resolves it through `styles.ts`'s `resolvePath` and sets `PROP.path`, and
  on a strict host refuses a key the build did not bake; each `index*.ts`
  registers `PATH_IDS` at mount as it registers `STYLE_IDS`.

In this repository:

- `src/vendor/draw-ops.ts`: `"path"` in `MOTION_DRAW_OPS`, which
  `tests/patches.test.ts` holds to the range.
- `src/catalog/surface.ts`, and `CAPABILITIES.md` from it: six probed rows —
  `paint.path`, `paint.fill`, `paint.stroke`, `paint.bg-clip-path`,
  `animation.trim`, `animation.morph`. Tokens and keyframes are G6 bake
  probes; the collector and the baker are a new probe kind, `pathProbes`, run
  by gate G9 (`tests/catalog.test.ts`), which runs the real `transformFile`
  and `compilePathEntry`.
- `tests/vector-paths.test.ts`: the build's located refusals, mount's
  refusal of an outline the build did not bake (and its control, a `d`
  forwarded by a component), the two arcs' bits, and `cosSinDeg`.
- `compositions/vector-paths`, in both ledgers: a signature drawn on by
  `trimEnd`, a blob morphing between a circle and a star under a gradient
  fill, a hexagon of six abutting wedges, a wireframe globe in a viewBox
  turning with a trimmed ring orbiting it, and a wave morphing under an
  `overflow-mask` window. Its sidecar's `assertions[]` state what each is
  for, including that the caption is shown before the signature, which a
  draw-on that ignored its trim would fail.
- `src/render/visibility.ts` needed no code.

## SVG import

**Not in the first patch.** The first patch's `d` grammar is the whole SVG
path grammar, arcs included, so a `d` pasted from any editor's export is
already a `<Path>`; that covers a signature, an icon, or a single drawn line.
Importing a whole SVG document is something else:

- An XML subset: `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`,
  `polygon` and `g`; presentation attributes and `style=""` declarations;
  `transform` lists; `viewBox` and `preserveAspectRatio`.
- An expansion of one file into N `<Path>` nodes.
- A way for the author to address the parts they want to animate, for
  example by `id` into `debugName` plus a class map. That is its own design
  question, with its own class-literal provenance (0012's rule applies to
  the map's values).
- A lint that refuses a missing file, as `src/lint/images.ts` does for
  pictures.

None of it touches the engine, the op or the table format, so it can land
later as a compiler-only change without moving anything this patch pins.
Upstream's `framework/compiler/bake-svg.ts` already tokenises `d`, but an
importer cannot reuse its transform handling as it stands. Stage 1 found two
reasons; `0040` fixed one:

- it calls `Math.cos`/`Math.sin` for `rotate()`, and for an arc's x-axis
  rotation, and still does after `0040` (kept for byte identity, and
  recorded in `AGENTS.md` as unmeasured across hosts);
- it applied a transform list leftmost-first, the reverse of SVG's order
  (`bake-svg-transform-order.ts` in the baselines reproduces it on the old
  pin). `0040` applies SVG's order.

Gradients, clip paths, `<use>`, CSS `<style>` sheets, text and filters stay
out of any import until there is a composition that needs them.

## What it does not do, stated

- **Dashes.** A dash pattern is trim applied periodically; it is a loop over
  the same cut-point code, and it is not in the first patch.
- **Zero-length subpaths with round or square caps** (SVG's dots) draw
  nothing.
- **Gradient strokes, variable-width strokes, compound shapes with shared
  coverage** (the conflation fix), **boolean operations, text on a path.**
- **Point-count equalisation for morphs.** Mismatched keys are refused, not
  resampled (above).
- **A `d` from another module.** The collector reads a module's own
  literals; an imported `const` is looked up at mount and refused. A
  generator writes the literals into the composition, which is how this
  repository's compositions are written anyway.
- **Trim and morph under a shutter.** They hold the frame's tick in every
  sample (above); only the path's transform blurs.
- **`<Path>` for Octane and Vue Vapor.** The component is Solid's, like every
  composition here; the other frameworks' component modules do not export it.
- **Caching.** Geometry is rebuilt every frame. A cache keyed by entry,
  morph and affine would make a static path's geometry free; it is an
  optimisation with its own invalidation questions, measured above as 4-11 ms
  of the frame.
- **Other backends.** PSP, ESP32, Symbian, Vita, gpui and wgpu are not taught
  PATH, and a stream carrying it stops there. That is the `motion` class.

## Footprint

`0042`: about 1,950 lines of engine code (`path.rs` is 1,300 of them, a
seventh of that comments; the rest is the op in `raster.rs`, the walk in
`draw.rs`, the fields in `style.rs`, the five walkers' lengths, and the
generated spec files) and about 1,900 lines of engine tests and scenes.
`0043`: about 450 lines of `path-data.ts` and 250 across the collector, the
build, the tokens, the keyframe names and the component. In this
repository, the fixture, `tests/vector-paths.test.ts`, the catalogue rows
and gate, and the documents.

Separately, in this order of use: dashes (a periodic trim), gradient
strokes, a coverage-merging op for flat illustration, SVG import.

## What building it changed

Stage 1 was measured against e0b37e2 + 0001-0022. Between it and the landing
the pin moved to 66caf4e5 and `0023`-`0041` landed. What that moved, and what
building the compiler half decided:

- **Ids.** PROP 183-186 went to `arcCap` (`0027`), `gradShape` (`0029`) and
  `glowMode`/`glowThreshold` (`0033`), and 198 to `shutterHold` (`0034`),
  which skipped 187-197 for this patch; that gap is eleven ids. The props are
  199-211 in one block. Main's `skewX` (bit 38) shifted the paint bits by
  one, so the anim bits are 58-64, not 57-63; bit 64 needs nothing wider,
  because an animated value is stored by prop id. The op is still 71 and
  `styles.bin`'s offset 10 was still reserved.
- **Square root.** The pin carries `fmath.rs`; `path.rs` calls its `sqrtf`
  behind its own NaN guard instead of keeping a copy.
- **MASK_PUSH's format.** `0024` made it `2 + 2N` words of f32 pairs. Scene
  10 and the masked-path test wrote the old `N` packed words, so after the
  rebase both streams stopped at the mask and the test compared two grounds
  — it passed with nothing under test. Both now write the mask through
  `mask_push`, and the test asserts the mask let paint through (red with the
  old format: `redcheck.py`).
- **Scene 10's pixels.** With the mask written correctly, scene 10's
  framebuffer moved from stage 1's `0xbb5836a02e7cc858`; with `0032`'s exact
  divisor reverted it is that value byte for byte, so the move is `0032`'s,
  in the layer's content-over-shadow composite. It is re-pinned; the other
  fifteen scenes' thirty digests are stage 1's.
- **Walkers.** Upstream added `compositor::draw_op_len` and
  `Ui::compositor_surface_frames`, each with its own op-length table; both
  learn PATH, and a test holds them (above).
- **Arcs.** Stage 1 planned cubics of up to 90° from the core's 5-term sine
  and an octant `atan2` through `Math.fround`. Built, the arc never becomes
  an angle (unit-vector bisection and square roots), and the pieces are 45°:
  a 90° cubic is 0.27 px off a circle of radius 1000.
- **The collector.** Stage 1 named literals, arrays and module consts. A long
  `d` is naturally written as `"…" + "…"`, and a set of shapes as a `.map`
  over a const array; both are read now. The `d` is read on any element, so a
  component that forwards it is baked from its call site, and its literals
  stay class candidates and charset like any other.
- **The component.** `d` and `viewBox` reach the host as one attribute, the
  key, because two attributes would be resolved in whatever order the
  renderer set them, and the first lookup would miss.
- **`keyframes`** needed no change: it reads prop names from the vendored spec.
