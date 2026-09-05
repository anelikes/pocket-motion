# patches/

Engine and compiler changes this project needs and upstream does not carry.
`scripts/vendor.ts` clones `pocket-stack/pocketjs` at the pinned commit
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

- **`upstream`** — belongs in pocket-stack/pocketjs. Submitted when there is a
  reason to, and **rebased onto upstream main before it is**; the last column
  measures how far it is from that. The judgement is one line: the change is
  in the declaration layer and does not depend on a target.
- **`motion`** — a change this rasteriser needs and no upstream target will
  draw. Never submitted. The patch's own header carries a line
  `pocket-motion-only: <why>` naming the target-side reason, so the class is
  readable from the file and the test refuses a `motion` patch without one.
  **There is no patch of this class yet**; the first will be a mask op.

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

`0008` is class `upstream` and numbered 10 here; #301's head (`20b663c`)
numbers it 11 to clear `surfaceQuad`. Moving the pin means taking that number
with it.

## What each one does, and where it stands upstream

| # | class | what it changes | upstream | applies to main |
|---|---|---|---|---|
| 0001 | upstream | `MAX_FONT_SLOTS` 24 → 64, and the build assigns slots from the sizes a composition actually uses instead of a fixed seven-size table (`compositions/typography` is the fixture) | unsubmitted | **no** — `engine/core/src/text.rs` |
| 0002 | upstream | refuses a font size whose baked cell would exceed the atlas header's u8 `cellH` and names the largest px that fits, instead of clamping and truncating the glyph | unsubmitted | yes |
| 0003 | upstream | read-only counts of pending timers, frame hooks, queued effects and service pumps, so a host can ask what the framework is still holding; the structural half of `check` | unsubmitted | **no** — `framework/src/index.ts` |
| 0004 | upstream | a wasm entry point that carries `spec::img` flags into `upload_texture` (`FLAG_LINEAR` bilinear sampling, `FLAG_RLE`); `Ui::upload_texture_flags` could always do it, nothing exposed it | unsubmitted | yes |
| 0005 | upstream | `set_image_uv`: a plain Image samples a sub-rect of its texture rather than the whole of it — the tile grid every footage track draws through | unsubmitted | **no** — `engine/core/src/tree.rs`, `engine/wasm/src/lib.rs`, `framework/src/host.ts`, `hosts/web/wasm-ops.js` |
| 0006 | upstream | glyph outlines fill by non-zero winding rather than even-odd | **#271 merged 2026-08-15, the contour-closing half**; the winding rule itself was not submitted | **no** — `framework/compiler/bake-font.ts` |
| 0007 | upstream | `debug_hide(slot)`: a draw-time skip of one node and its subtree, which is how `layout` answers "is this in the picture" in pixels and how `visibility` classifies covered against invisible-by-declaration | unsubmitted | yes |
| 0008 | upstream | a POLY op, so rotated solid geometry carries coverage instead of being drawn as an axis-aligned box | **#301 open**, last moved 2026-08-25. Its head (`20b663c`) is the reviewer's redesign: coverage computed once in core, PSP eating the same spans, POLY numbered 11. The patch here is #301's first commit `759ffff`, numbered 10, **plus the one line from `1c7c914` since 2026-09-05**: the interior-span bound for a negative step, which the first design rounded toward positive infinity and so filled one boundary column per affected row at full coverage. `baselines/poly-301.md` is the measurement — 250 of 333 rotated-box scenes differed from #301's head before the line and 356 of 356 match after it — and the same commit re-records the ledger digests it moved | **no** — `contracts/spec/gen-rust.ts`, `contracts/spec/spec.ts`, `engine/core/src/spec.rs`, `engine/core/src/tests.rs` |
| 0009 | upstream | font atlas v3 → v4: a GPOS kerning-pair section the baker writes and the core applies in `measure_run` / `layout_run`; v2 and v3 still load | unsubmitted | **no** — `framework/compiler/bake-font.ts` |
| 0010 | upstream | publishes the baked tick rate out of the bundle as `__pocketTickHz`, so `assertBakedTickRate` can refuse a bundle baked at a rate this realm does not step | unsubmitted | **no** — `framework/src/index.ts` |
| 0011 | upstream | an `animate-<name>` naming nothing is a build error listing the declared names, instead of dropping the whole class literal silently | unsubmitted | yes |
| 0012 | upstream | records which string literals are, on some execution, the WHOLE value of a `class=` attribute, so 0011 can refuse a bad animation name in one of them whatever else the literal holds — and prose stays safe by where it was written rather than by token count | unsubmitted | **no** — `framework/compiler/tailwind.ts` |

`test/poly-span-oracle` (**#333, open**, draft) locks POLY spans against a 4×4
sample oracle. It is a test branch upstream, not a patch here.

Every patch today is class `upstream`, which says what the table has been
saying since it was first measured: nothing here has yet needed the paint
layer to diverge, and eight of the twelve are unsubmitted declaration-layer
changes that have drifted from main. That is the real cost of the pin, and it
is the `upstream` class's cost, not the `motion` class's.

## How the last column was measured

Not from memory. A detached worktree of the sibling `pocket-stack/pocketjs`
checkout at **`origin/main` = `64fc0c0`** (2026-09-05), then, per patch,
`git apply --check`, and then a second pass applying them in sorted order into
the same tree. **Both passes give the same verdict: 4 apply, 8 refuse** — the
same four (`0002`, `0004`, `0007`, `0011`) as at `7842d09` on 2026-09-02, when
the files named above were taken from `git apply`'s report. At that pass only
`0012` moved between the two runs — alone it failed at `tailwind.ts:715`, after
`0011` at `:811` — and it refused either way, so no refusal here is a sibling
dependency standing in for upstream drift; the 2026-09-05 pass re-took the
verdicts only, not the line numbers.

The column says whether the diff still lands, and nothing more. It is not a
claim that upstream still lacks the behaviour: `0006` applies to no line of
today's `bake-font.ts` and half of what it was written for is merged. Re-measure
before reading it as a rebase estimate; the number was 7 of 12 in mid-August.

The pin is a different question. Every patch applies at `UPSTREAM.commit` by
construction — `bun run vendor` fails loudly otherwise — so this table is about
the cost of moving the pin, which is deliberately not a release blocker. The
pin moves when the declaration layer upstream has something this project
wants; `motion` patches are rebased then, and their op codes do not move.
