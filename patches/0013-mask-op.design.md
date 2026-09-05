# 0013 — a mask op: `overflow-mask` clips children to the node's own shape

Design, before code. The first `motion`-class patch and the first op in the
reserved range (`patches/README.md`, `src/vendor/draw-ops.ts`). Everything
below names the file and line it was read from; where a number is a choice,
it says so.

## What it is for

`compositions/transitions/NOTES.md` and `compositions/captions/NOTES.md` each
list what their catalog could not express here, and both put one primitive
first: **a clip that is not an axis-aligned rectangle**. Today
`overflow-hidden` emits one SCISSOR — an integer rectangle, the AABB of the
transformed box (`draw.rs:1107-1118`) — and the rasteriser pixel-clips every
op against it (`raster.rs:20-24`). So a circle cannot reveal a scene, a
rotated window cannot wipe diagonally, and a rounded card cannot clip what it
holds. Two transitions shipped flat for want of this, and three caption styles
were left unbuilt.

The op in this design gives a node's children **the node's own outline** as
their clip: its rounded rectangle, under whatever rotation and scale its
transform carries. That is one convex polygon per node, and it reaches every
reveal in the two NOTES that a convex shape can express — iris, halftone
dots, rounded cards, diagonal wipes, comparison wipes. What it does not reach
is in the last section.

## The declaration

One new value of an existing enum, one new token, no new style property:

    Overflow: { Visible: 0, Hidden: 1, Mask: 2 }      contracts/spec/spec.ts:501
    "overflow-mask" -> [PROP.overflow, Mask]          framework/compiler/tailwind.ts:358

`overflow-mask` means what `overflow-hidden` means — same layout
(`layout.rs:165-173` maps it to taffy's `Hidden`), same hit-testing
(`draw.rs:768`) — plus the children are clipped to the node's shape rather
than to its bounding box. The shape is the one the node already declares:
`rounded-[N]` / `rounded-full` for the corners, `rotate-[N]` / `scale-[N]` /
the parent chain for the transform.

**Why a new token rather than a new meaning for `overflow-hidden`.** CSS
clips `overflow:hidden` to the border radius, and no composition in this tree
combines `overflow-hidden` with a radius or a rotation in one literal, so
changing the meaning would move no digest today. It is still the wrong
choice. A mask is drawn by this rasteriser and by no upstream target — a
PSP reading the stream stops at the first op it does not know — so the
literal that asks for it should be a literal a reader can find, `lint` can
name, and a portable composition can avoid. `overflow-hidden` keeps
upstream's meaning exactly.

**Why this is one patch, class `motion`, though it touches the compiler.** The
class is decided by what a change is for, not by which file it lands in. A
token whose only meaning is an op no upstream backend draws goes with the op.
The README's class definition is to be read that way; this patch is the case
that makes it explicit.

## The op

Two codes at the base of the reserved range:

    MASK_PUSH = 64    op, n, xy0 .. xy(n-1)     n in 3..=MASK_MAX_VERTS (256)
    MASK_POP  = 65    op

Vertices are packed as POLY's are — `xy_word`, integer logical pixels, i16
each (`draw.rs:269`) — and are, like every coordinate the core emits, already
inside the viewport and the enclosing scissor. The polygon is convex, and its
winding is whatever Sutherland-Hodgman left; the rasteriser orients it as it
does for POLY (`raster.rs`, the `ccw` test).

**Coverage is POLY's coverage.** The mask value of a pixel is the number of
its 16 samples inside the polygon, computed by the same `poly_hits` in the
same 4·F fixed point (`raster.rs:977-1004`), and an op drawn under the mask
blends at `a * hits / 16` — the expression POLY's own boundary pixels already
use (`raster.rs:1126`). So a white full-bleed rectangle under a mask of
shape S is byte-identical to a white POLY of shape S. That equality is the
first test, and it is what keeps this from being a second rasteriser with its
own edges: an edge under a mask is the edge a rotated box already has, which
the ledger already reproduces across macOS/ARM and Linux/x86-64.

**Nesting multiplies.** A mask pushed under a mask has value
`hits_outer * hits_inner / 16`, integer division. Two identical masks on top
of each other therefore give a boundary pixel less than one would — the same
thing two alpha layers do — and that is stated rather than corrected.

**MASK_PUSH inside the scissor, not instead of it.** Emission order for a
node with `overflow-mask`:

    SCISSOR (the AABB, as today)
      MASK_PUSH (the outline, clipped to that AABB)
        the node's own background and border
        the children, in paint order (or the paint_3d subtree)
      MASK_POP
    SCISSOR_POP

The scissor stays so that the guarantees built on it hold unchanged: every
coordinate in range, damage bounds conservative, the AABB pre-clip a
backend can rely on. The mask is refinement inside it. The node's own
background moves inside the mask on purpose: today a rotated rounded box
"degrades to a square fill" (`draw.rs:17-18`), and a window whose children
are round while its own ground is square would be a defect with a name. Its
shadow, which extends outside the box, is emitted before the push as now.

**When the outline is the AABB, no mask is emitted.** Radius zero and an
axis-aligned world reduce to today's SCISSOR exactly, so `overflow-mask` on a
plain box costs nothing and draws the same bytes as `overflow-hidden`. A
composition can therefore use the token uniformly and pay only where a shape
exists.

## Flattening the outline

The corner arcs become chords. The count per quarter-arc is a table on the
corner's radius in screen pixels — the logical radius scaled by the largest
of `|a| |b| |c| |d|` of the world affine — chosen so the sagitta stays under
a quarter of a pixel:

| screen radius | chords per corner |
|---:|---:|
| < 8 | 3 |
| < 32 | 6 |
| < 128 | 12 |
| < 512 | 24 |
| otherwise | 48 |

A table rather than a formula because the formula needs a square root and
the core has none; the sine it has is the Taylor `sinf` at `draw.rs:71`, the
one every rotation already goes through, so a circle's vertices come from
the same arithmetic as a rotated box's corners. The largest outline before
clipping is 4 × 48 + 4 = 196 vertices; clipping against a rectangle adds at
most four, under the 256 cap. `rounded-full` clamps to half the shorter side
as the rounded-box painter already does, so a square window is a circle and
a wide one is a stadium.

Vertex precision is one logical pixel, as it is for POLY: a growing circle's
outline advances in whole-pixel steps and the 4×4 coverage smooths each
edge. A finer packing (quarter-pixel, 14.2) is this op's own format to change
later; not in this patch, because sharing POLY's packing is what makes the
equality test possible.

## The rasteriser

Every pixel the software rasteriser writes goes through two methods of the
`RenderTarget` trait — `blend` and `fill_opaque` (`raster.rs:133-137`; the
list of call sites was checked, and the only other accesses to pixel
storage are texture *reads*). So a mask is a wrapper target:

    struct Masked<'a, T: RenderTarget> { inner: &'a mut T, stack: Vec<MaskLevel>, stride }
    struct MaskLevel { x0, y0, w, h: i32, hits: Vec<u8> }   // 0..=16, bbox-sized

`blend(offset, r,g,b,a)` looks the offset up in the top level (offset →
x, y by `stride`; outside the bbox is 0), and forwards with `a * hits / 16`,
skipping the write at 0. `fill_opaque(start, len, ...)` walks the run and
forwards whole sub-runs at 16, blends the rest. A push under an existing
`Masked` multiplies the new level into the product and pushes it; a pop
pops. The dispatch loop (`raster.rs:681`, `render_scaled_clipped`) reaches
this with one new branch and no change to any op function: on MASK_PUSH it
builds the level from the polygon with `poly_rows` (the same row walker
POLY uses, emitting hits per column into the buffer instead of pixels) and,
if the target is not already a `Masked`, wraps it and re-enters itself for
the words up to the matching MASK_POP; if it is, pushes a level. The
trait gets a default `push_mask` / `pop_mask` returning false so the plain
targets need no code. Every `render_scaled_*` entry (`raster.rs:342-531`,
including the incremental and region variants) goes through the one
dispatch loop, so the mask reaches all of them.

Memory is one `u8` per pixel of the mask's bbox per level, at physical
resolution: a full-frame mask at 1920×1080 under supersample 2 is 8 MiB,
freed at the pop. Cost is the coverage sampling of the boundary pixels once
per push plus one lookup per masked pixel write.

`damage.rs` learns the two word counts and takes `polygon_bounds` for the
push, as it does for POLY (`damage.rs:427-433, 470`); a mask draws nothing,
so a conservative bound is all it needs.

## What the gates see

- `ui_draw_hash` hashes the words, so a mask is in the frame hash; a change
  of radius or angle moves it.
- `check` sees no guest op: the mask is baked geometry, the same as a
  scissor.
- `visibility` classifies a node whose geometry survives no mask pixel as
  **covered** (it emitted geometry and none reached the picture — the same
  reading as being painted over), not as invisible by declaration. That is
  a third cause under an existing name; stated in `src/render/visibility.ts`
  when the patch lands, not renamed.
- `layout` findings are measured in pixels through `debug_hide`, so
  `clipped_text` fires on text a mask cuts, as it does under a scissor.
- The ledger: the fixture below carries the op in both ledgers, and the
  cross-platform workflow reproduces it on Linux/x86-64.

## Fixture and tests

`compositions/masked`, four windows on one clock, every node named and
every window asserted in the sidecar:

1. **iris** — a `rounded-full overflow-mask` window whose width, height and
   offsets animate together so the circle grows about a fixed centre while
   the scene inside it stays put; scene B (a gradient with text) over A.
   `assertions`: B's title `entersBy` the frame the circle reaches it.
2. **wipe** — a `rotate-[20] overflow-mask` window translating across, its
   child counter-translating; the diagonal edge the timeline's light sweep
   wanted.
3. **card** — `rounded-[40px] overflow-mask` with text that overflows;
   `layout` reports `clipped_text` on it, on purpose.
4. **nested** — a circle window inside a rotated window, the product rule
   visible at the intersection.

Tests, each with the defect that turns it red named beside it:

- **core, in the patch** (`engine/core/src/tests.rs`): a white full-bleed
  RECT under a mask equals a white POLY of the same vertices, over the
  rotated-box sweep from `baselines/poly-301/poly_sweep.rs` — red if the
  mask samples anywhere POLY does not; nested equals the product — red on a
  min or a saturate; mask on the RGB565 target through the same wrapper;
  `damage.rs` decodes both ops; radius 0 and axis-aligned emit no mask.
- **`tests/mask.test.ts`**: the fixture builds; a `rotate-[20] overflow-mask`
  window over a white child renders byte-identical to a `bg-white rotate-[20]`
  box of the same geometry (`frame --at`) — the equality above, end to end;
  pixel probes at the iris centre, a far corner and one boundary pixel at
  three frames; the frame hash moves with the radius; `check` passes; the
  transitions' flat iris re-expressed through the op matches its own flat
  version outside the circle and differs inside.
- **`tests/patches.test.ts`**: `MOTION_DRAW_OPS = ["maskPush", "maskPop"]`
  at 64 and 65; the README row is class `motion`; the patch header carries
  its `pocket-motion-only:` line.
- **`tests/catalog.test.ts`**: an `overflow-mask` row in `surface.ts`,
  `probed` — the compiler is handed the literal and `PROP.overflow` comes
  back 2.

Documents: AUTHORING.md gets a section under the animation vocabulary
("a reveal is a window" becomes "a reveal is a window, and a window has a
shape"), CAPABILITIES.md through the catalog, `skills/pocket-motion/SKILL.md`
one line, AGENTS.md one bullet under what enforces the invariants, and the
README row. The two NOTES that asked for this are updated when their ports
are rebuilt, which is separate work.

## Footprint and order

In the patch: `contracts/spec/spec.ts` (~30 lines: enum value, two op codes,
the format comment), `gen-rust.ts` and the regenerated `spec.rs`,
`tailwind.ts` (~3), `layout.rs` (~4), `draw.rs` (~170: the outline, the
emission), `raster.rs` (~260: the level builder, the wrapper, the dispatch
branch), `damage.rs` (~15), `tests.rs` (~250). About 750 lines, against
patch 0008's 1272 — the difference being the backends this one does not
touch. In the repository: the fixture (~300), `tests/mask.test.ts` (~250),
the catalog row, the documents.

Order, each step green before the next:

1. spec, compiler token, core emission, and the outline flattener, with the
   `radius 0 + axis-aligned = SCISSOR only` test.
2. the rasteriser wrapper and level builder, with the POLY-equality and
   nesting tests over the sweep.
3. the fixture, both ledgers, `tests/mask.test.ts`.
4. catalog row, documents, README row, `MOTION_DRAW_OPS`.
5. separately: re-port the transitions' iris and halftone through the op,
   and the captions that need only a shaped clip.

## What it does not do, stated

- **Glyph-shaped masks** — text as a window onto a gradient or an image
  (captions' Gradient Fill, Texture). The mask here is a polygon; a glyph
  mask is atlas coverage and a different level, though the same wrapper
  could carry it as a second kind of level later.
- **Image masks** — a texture's alpha or luma as coverage. Same shape of
  extension, not in this patch.
- **Soft edges** — a feathered mask is a blur, which is its own op.
- **Concave outlines** — one convex polygon per node. Two windows are two
  nodes.
- **The 3D contract is unchanged** — a mask on a node *inside* a perspective
  subtree is not honoured (the subtree's paint order is its own walk); a
  mask on the perspective root is, since the whole projected subtree sits
  between its push and pop.
- **Other backends** — gpui, wgpu, esp32, symbian, PSP and Vita are not
  taught the op. A stream carrying it stops at the first MASK_PUSH on any of
  them. That is the `motion` class, and it is why the token is a token.
