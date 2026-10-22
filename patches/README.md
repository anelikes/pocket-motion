# patches/

Engine and compiler changes this project needs and upstream does not carry.
`scripts/vendor.ts` clones `pocket-nexus/pocketjs` (renamed from
`pocket-stack/pocketjs`) at the pinned commit
(`UPSTREAM.commit` in `src/vendor/upstream.ts`), applies every `*.patch` here in
sorted order, and rebuilds `hosts/web/pocketjs.wasm`. **`vendor/` is never
edited**: a change to engine behaviour is a new file here.

Sorted order is load-bearing where one patch's tests call a helper another
defines — `0008` uses the `raster_fb` helper `0007` adds to
`engine/core/src/tests.rs`.

## Two classes

Upstream's constraints are its targets: the PSP GE takes i16 coordinates, the
ESP32 and Symbian hosts draw into RGB565, every backend parses the draw list
by a closed op set, and damage tracking redraws regions. This project's
constraints are determinism and declaration, and its one backend is the
software rasteriser in `engine/core/src/raster.rs` reached through wasm. So a
change to how a class literal becomes a style table, a keyframe bakes, a font
bakes or a bundle publishes its tick rate is the same change for both; a
change to what the rasteriser can paint is not, because a mask or a blur is
cheap here and impossible or a redesign there. Each patch is therefore one of
two classes, in the `class` column below and checked by
`tests/patches.test.ts`:

- **`upstream`** — belongs in pocket-nexus/pocketjs. Submitted when there is a
  reason to, and **rebased onto upstream main before it is**; the last column
  measures how far it is from that. The judgement is one line: the change is
  in the declaration layer and does not depend on a target.
- **`motion`** — a change this rasteriser needs and no upstream target will
  draw. Never submitted. The patch's own header carries a line
  `pocket-motion-only: <why>` naming the target-side reason, so the class is
  readable from the file and the test refuses a `motion` patch without one.
  `0013`, the mask op, was the first; `0014`, the transparent clear, is the
  second.

Whichever the class, an op is declared in the class literal and emitted by
`draw.rs`. A host-side pass over the finished frame is not a substitute:
`check`, `visibility` and `ui_draw_hash` read the draw list, and an effect
applied after it is an input none of them sees.

## Reserved op codes

A `motion` draw-list op takes a code at or above **`MOTION_DRAW_OP_BASE`
(64)** in `src/vendor/draw-ops.ts`, and `MOTION_DRAW_OPS` there names the
`DRAW_OP` keys that are this project's. Upstream allocates densely from 1, and
the reason for the gap is a collision that already happened: `0008` gave POLY
the code 10, the next free number at the pin, and upstream gave 10 to
`surfaceQuad` on 2026-08-22 (`add3270`). The 2026-09-02 measurement below
recorded `0008` as not applying and did not say why; this is why. The test
holds three things: every named op at or above the base, every other op below
it, and no two keys on one number — the last is what goes red when the pin
moves onto a collision, and the `motion` class is what keeps this project's
own ops out of the way of the next one.

`0008` is class `upstream`, and since the pin moved to `66caf4e5` POLY is
**11**: `surfaceQuad` holds 10 on main, and 11 is what #301's head
(`20b663c`) gives POLY. The two other resolutions were measured against that
one and refused. Moving POLY into the `motion` range would put an op this
project means to submit where upstream is told it will never allocate, and
the day #301 merges at 11 every POLY in a stream would change number. Keeping
10 is the collision the test exists to catch. #301 was still open and
unchanged on 2026-10-22 (last activity 2026-09-28); if upstream gives 11 to
something else first, the no-shared-number test goes red on that bump and
POLY takes whatever #301 then says. `0013`'s MASK_PUSH and MASK_POP are 64
and 65, and move with nothing.

## What each one does, and where it stands upstream

The pin is upstream main as of 2026-10-22, `66caf4e5`, so every patch applies
to main by construction. The last column says what moving onto it took; the
patch's own header carries the full note.

| # | class | what it changes | upstream | rebased onto 66caf4e5 |
|---|---|---|---|---|
| 0001 | upstream | `MAX_FONT_SLOTS` 24 → 64, and the build assigns slots from the sizes a composition actually uses instead of a fixed seven-size table (`compositions/typography` is the fixture) | unsubmitted | upstream's `text-2xs` (04a32ce8) pins 19/20, so the first dynamic slot is 21 |
| 0002 | upstream | refuses a font size whose baked cell would exceed the atlas header's u8 `cellH` and names the largest px that fits, instead of clamping and truncating the glyph | unsubmitted | applied unchanged |
| 0003 | upstream | read-only counts of every queue the frame pump drains — timers, both frame registries, effects, service pumps, model tasks, deliveries, commands and animations, dirty model regions, unflushed lifecycle hooks — so a host can ask what the framework is still holding; the structural half of `check` | unsubmitted | main's pump drains eleven registries where it drained five; the six new ones are counted, each with a case in upstream-style `tests/pending-work.test.ts` that is red without it |
| 0004 | upstream | a wasm entry point that carries `spec::img` flags into `upload_texture` (`FLAG_LINEAR` bilinear sampling, `FLAG_RLE`); `Ui::upload_texture_flags` could always do it, nothing exposed it | unsubmitted | applied unchanged |
| 0005 | upstream | `set_image_uv`: a plain Image samples a sub-rect of its texture rather than the whole of it — the tile grid every footage track draws through | unsubmitted | fields beside main's compositor-surface ones |
| 0007 | upstream | `debug_hide(slot)`: a draw-time skip of one node and its subtree, which is how `layout` answers "is this in the picture" in pixels and how `visibility` classifies covered against invisible-by-declaration | unsubmitted | the skip sits ahead of main's text capture and opacity-0 cull; threaded through main's `build_root` and auxiliary-surface draw |
| 0008 | upstream | a POLY op, so rotated solid geometry carries coverage instead of being drawn as an axis-aligned box | **#301 open**, unchanged since 2026-09-28. Its head (`20b663c`) is the reviewer's redesign: coverage computed once in core, PSP eating the same spans, POLY numbered 11. The patch here is #301's first commit `759ffff` **plus the one line from `1c7c914`** (2026-09-05): the interior-span bound for a negative step. `baselines/poly-301.md` is the measurement — 250 of 333 rotated-box scenes differed from #301's head before the line and 356 of 356 match after it | POLY is 11 (see "Reserved op codes"); the clipped polygon comes from `clip_poly`, split out of main's `clip_fan` with the same passes; main's two new draw-list walkers know its length |
| 0009 | upstream | font atlas v3 → v4: a GPOS kerning-pair section the baker writes and the core applies in `measure_run` / `layout_run`; v2 and v3 still load | unsubmitted | main's v3-only readers and writers (`font-coverage.ts`, `runtime-glyphs.js`, the companion's atlas) handle v4 or write v3 by name; a glyph from main's fallback faces is not kerned by the slot face's pairs (a measured `7`+`二` pair at 24 px before the fix) |
| 0010 | upstream | publishes the baked tick rate out of the bundle as `__pocketTickHz`, so `assertBakedTickRate` can refuse a bundle baked at a rate this realm does not step | unsubmitted | applied unchanged on top of 0003 |
| 0011 | upstream | an `animate-<name>` naming nothing is a build error listing the declared names, instead of dropping the whole class literal silently | unsubmitted | main's `unknownUtilities` (#557) swallowed the deferred name; it now reports it |
| 0012 | upstream | records which string literals are, on some execution, the WHOLE value of a `class=` attribute, so 0011 can refuse a bad animation name in one of them whatever else the literal holds — and prose stays safe by where it was written rather than by token count | unsubmitted | rebuilt on main's `markClass` (#557) with one stricter edge, the left operand of `&&`; G7 unchanged and green |
| 0013 | motion | `overflow-mask`: a node's children and its own ground clipped to its outline — the rounded rectangle under its transform — through two draw-list ops at 64 and 65 whose coverage is POLY's own; design in `0013-mask-op.design.md` | never; the header says why | generic over main's `RenderResources`; outline clipped by `clip_poly` |
| 0015 | upstream | `--metrics-only`: the baker writes advances, kerning, baseline and line height with 1x1 empty coverage cells and sets `FONT_FLAG_METRICS_ONLY`, so a measurement pass over a whole charset at every size is kilobytes per slot instead of tens of megabytes; `tests/font-bake.test.ts` holds the cmap and kern sections byte-equal to the full bake | unsubmitted | the flag is `bakeSlot`'s eighth argument, after main's `fallbacks` |
| 0014 | motion | the framebuffer carries alpha: a frame clears to transparent black and a partial source over a partly covered destination composites straight-alpha src-over; over an opaque destination the arithmetic is the old expression verbatim, so only `compositions/alpha` moves in the ledger | never; the header says why | kept beside main's separate `PremultipliedTarget` (f26191a8), whose tests now compare against the default render over an opaque black root |
| 0016 | upstream | named font faces: `font-[name]` selects a face declared to the build with `--font-face-regular=<name>=<path>` / `--font-face-bold=<name>=<path>`; a face's (px, weight) pairs are dynamic slots keyed by the face, an undeclared face is refused by the baker, and `MAX_FONT_SLOTS` goes 64 → 128 so several faces fit. No engine code changes: the core indexes slots and never knew which file one came from | unsubmitted | a face slot takes main's fallback faces, and its files are reported as build inputs |
| 0017 | motion | text stroke: `text-stroke-[Npx]`, `text-stroke-<color>`, `text-stroke-outside\|center`, width and colour keyframe-animatable; one GLYPH_STROKE op at 66 whose coverage is a nearest-seed distance field over the run's own rasterised coverage | never; the header says why | bits 39/40 behind main's `skewX`; a stroked run keeps unscaled cells under a scale (the gap below) |
| 0018 | motion | filter layers: `blur-*`, `drop-shadow-*`/`text-shadow-*`/`glow-*` and `mix-blend-*` render a node and its subtree into an offscreen layer that is blurred (three extended-box passes, continuous in the deviation), shadowed and blended (W3C separable) at LAYER_POP; ops at 67 and 68, at most 4 deep | never; the header says why | bits 41-46 |
| 0019 | motion | gradient paint: stop positions, `bg-linear-*`, `bg-radial`, arbitrary `linear-gradient()`/`radial-gradient()` up to six stops, and `bg-clip-text`; one PAINT_PUSH/PAINT_POP pair at 69 and 70 recolours the ops between them per pixel from a premultiplied stop table. A literal upstream draws itself — two stops, or main's one `via` under a `bg-gradient-to-*` direction — is compiled as upstream compiles it | never; the header says why | one representation per literal (main's `gradVia` or the paint's `gradVia1`, never both); bits 47-57; `bg-clip-text` reaches main's scaled glyph pages |
| 0020 | motion | images of any size: an IMG entry or uploaded texture is 1..`IMG_MAX_DIM` (2048) px per side, power of two or not; sprites, tilesets, stream planes and footage tiles keep 512 and powers of two | never; the header says why | `tests/image-dims.test.ts` listed in main's `tools/test.ts` |
| 0021 | upstream | TEX_QUAD takes its sampling taps once per column and once per row instead of per pixel: a tap on a texel centre reads one texel instead of four, and an RGBA8888 texel of alpha 0 there is skipped. Byte-identical by construction; a core test holds `tex_quad` equal to the per-pixel sampler it replaced. No target-side change, so it belongs to upstream's software rasteriser as much as to this one | unsubmitted | applied unchanged |
| 0022 | motion | the wasm core builds at `opt-level = 3` with `+simd128` (was `"s"`): the same pixels; the module grows from 312 to 513 KB | never; the header says why | applied unchanged |
| 0023 | upstream | the build's style table, which upstream #591 serves from memory, stays in the file namespace, so a bundle names it `vendor/pocketjs/framework/src/styles.generated.ts` rather than `pocketjs-generated-styles:/<the checkout>/…`; and a `styles.generated.ts` reaching the loader at any other path fails the build naming both paths, where main bundles it from disk (a red class drawn blue, exit 0) | unsubmitted; #591 itself merged 2026-10-19 (`586428b2`) | new at this pin: the two departures the old pin's #591 backport made, against main's form; `tests/style-table.test.ts` was red on main's form in both |
| 0024 | motion | `overflow-mask` outlines at sub-pixel precision: MASK_PUSH carries `(x, y)` f32 pairs and the rasteriser takes them to a sixteenth of a pixel, where `0013` rounded each vertex to a whole pixel — a band of content up to a pixel wide outside a turned window along any long edge; a square-cornered axis-aligned window is its AABB only on whole pixels. `PolyScan` works in sixteenths, which leaves every POLY byte-identical | never; the header says why | new at this pin |
| 0025 | upstream | an arc with no sweep draws nothing: any `arc-width` makes the node an arc, where a sweep of 0 fell through to the box painter — a full disc on a `rounded-full` node for the frame a drawn-on stroke starts from | unsubmitted | new at this pin |
| 0026 | upstream | an arc follows its world transform: under a rotation, mirror, skew or per-axis scale every sample is tested in the node's own frame, where the arc returned unpainted under any world that was not axis-aligned; a per-axis scale stretches the ring into an elliptical band. Axis-aligned uniform scale keeps the screen-space path | unsubmitted | new at this pin |
| 0027 | upstream | `arc-cap-butt` (PROP `arcCap` 183, `arc-cap-round` the default): an arc's ends stop on the radius instead of a half-disc each, so an arc as wide as its radius is a pie sector | unsubmitted | new at this pin |
| 0028 | motion | a turned rounded box keeps its corners: under a world that is not axis-aligned it is its fill under a MASK_PUSH of its rounded outline (`mask_outline`, 0024's precision) inside its AABB's SCISSOR, where it was the plain box — a turning `rounded-full` circle was a turning square. Unturned boxes are byte-identical | never; the header says why | new at this pin |
| 0029 | motion | a radial gradient takes the ending shape it names (PROP `gradShape` 184): `bg-radial-circle`, `bg-radial-[<shape>_<size>]`, `radial-gradient(<shape> <size>, …)` — the circle or ellipse to the farthest corner or the sides — where 0019 drew the farthest-corner ellipse only. The radii are chosen in `emit_paint_push`; PAINT_PUSH and the rasteriser are unchanged | never; the header says why | new at this pin |
| 0030 | upstream | TRI and TEX_TRI draw a pixel centre lying exactly on an edge two triangles share once, by an edge-ownership rule, where both drew it: under a translucent texture every perspective image's cell diagonal was a line blended twice | unsubmitted | new at this pin |
| 0032 | motion | straight-alpha src-over onto a partly transparent destination (0014) and a filter layer's content over its shadow (0018) divide by the exact new alpha, where they divided by the stored, rounded one: the colour was inflated, and white over white wrapped to black — speckle where translucent whites overlap in a glow layer | never; the header says why | new at this pin |
| 0033 | motion | `glow-mode-luma` (PROP `glowMode` 185, `glowThreshold` 186): a glow made from the layer's bright pixels' own colour above a brightness threshold and added over the content — a bloom — where `glow-*` is CSS's drop shadow, made from alpha and drawn under, which lightens a dark translucent plate. Carried in LAYER_PUSH's blend word; an alpha glow's words are unchanged | never; the header says why | new at this pin |
| 0034 | motion | a shutter: `ui_render_exposure` renders a frame as the integer average of N renders whose transform timelines are evaluated between ticks (`engine/core/src/shutter.rs`), never across a keyframe jump, centred on the frame's tick; `shutter-hold` (prop 198) keeps one node's own timelines at the tick. The sidecar's `shutter` key is what asks for it; design in `docs/shutter.design.md` | never; the header says why | new at this pin, after `0024`–`0033`; prop 198, past `glowThreshold` 186 |
| 0040 | upstream | the build's SVG baker covers by scanline instead of testing every subsample against every edge — the same 4x4 samples, the same crossing arithmetic, so every pixel's count is the integer it was (`tests/fixtures/bake-svg-reference.ts` is the old baker, kept as the oracle) and a 952-cell hex grid takes 63 ms instead of 23 minutes of CPU — and draws strokes (width, miter/round/bevel joins, butt/round/square caps, miter limit, stroke-opacity), `<g>` with transform, inherited paint and group opacity, `A` arcs, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>` and `rect` `rx`; what would paint and is not drawn is refused instead of dropped | unsubmitted | written on 66caf4e5 |

**The `0023` that backported #591 onto the old pin is gone.** Main carries
#591 since 586428b2, so the pin needs no backport. The two places the
backport departed from upstream — the style module kept in the file
namespace, and a second copy of it refused — are not in main, and the
`0023` above carries them against main's form.

**`0006` is gone.** It filled glyph outlines by non-zero winding; upstream
8188d16a (#302) fills them by non-zero winding too, with spans merged where
the winding leaves zero rather than one span per crossing pair. Dropped on
the measurement, not on the argument that the two rules agree: the same
`bakeSlot` from main with either `rasterize` over Noto Sans SC Regular and
Bold, HarmonyOS Sans Regular and Bold, Inter Regular and Bold, Inter Display
Bold, JetBrains Mono and W95FA — ASCII, Latin-1 and the 3,755 GB2312 level-1
characters each face maps, 14 sizes from 10 to 176 px, density 1 and 2 —
gives **252 atlases, 2,104,795,468 bytes, 0 differing**.

`test/poly-span-oracle` (**#333, open**, draft) locks POLY spans against a 4×4
sample oracle. It is a test branch upstream, not a patch here.

Twenty patches are class `upstream` and thirteen `motion`. Of the twenty,
seventeen are unsubmitted declaration- or build-layer changes, `0040`, the
build-time SVG baker every target's pak goes through, among them; `0008` is
#301, and `0021` and `0030` are rasteriser changes with no target-side cost.

## Known gaps the rebase left

- **A stroked text run does not scale its glyphs.** Main draws an
  axis-aligned scaled run as glyph-page TEX_QUADs; GLYPH_STROKE (`0017`)
  places unscaled cells, so a run with a stroke keeps main's unscaled
  GLYPH_RUN path and its outline and fill stay one size. That is how every
  run drew before main; making the stroke scale is a change to the op.

## How the pin was moved

On 2026-10-22, from `e0b37e2` (2026-08-18) to `66caf4e5`, 207 commits. A
clone of `pocket-nexus/pocketjs` at the old pin carried one commit per
patch, rebased onto main with conflicts resolved commit by commit; each
patch file here is that commit's header and diff. The exported files,
applied in sorted order to a fresh checkout of `66caf4e5`, reproduce the
rebased tree with no difference. Measured at the time on main before the
rebase: 4 of 22 applied alone (`0002`, `0004`, `0021`, `0022`).

What was run on the patched tree, and on pristine `66caf4e5` beside it:
`cargo test` in `engine/core` (247 pass) and in `engine/backends/rgb565`;
upstream's contracts drift guard (green); and five stages of
`tools/test.ts` run as `bun test` over their listed files. `unit`: 1137
pass, 1 fail, the same failure as main (the ESP-IDF incremental build needs
`cmake`). `unit (wasm host)` and `handheld models and dual output`: no
failures. `Model AOT semantics and resources`: the same nine failures as
main. `AOT frontends and execution parity`: main's one failure (it builds
wasm through upstream's `tools/wasm.ts`, whose cargo lacks the wasm32 std
here), plus one 5 s timeout with both trees' suites running at once, which
passed twice run alone. The `sim` stages, which need prep builds, and the
gpui, wgpu, PSP, Vita and GLES backends, which need their toolchains, were
not run; their POLY and op-length edits are textual merges.
