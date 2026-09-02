# Phase 1.5 — kerning in the font atlas: implementation spec

Read `baselines/phase1_5-kerning-trigger.md` first. It is the measurement this
exists to act on and it also records what is deliberately NOT in scope.

## What this builds, in one paragraph

The pak's font atlas gains a **kerning pair section**, the baker extracts pairs
from the face's GPOS table at build time, and the core applies them while
walking a run. Nothing is computed at runtime from font data — the pairs are
baked integers, exactly like the glyph cells and the advances, so the
determinism contract is untouched.

## Why (the numbers that decide it, not the argument)

`bake-font.ts` reads three things — `hhea`, `charToGlyphIndex`, `advanceWidth`.
One codepoint, one glyph, one width. Measured against Chrome on the same font
file at 64 px:

| face | classic pairs non-zero | worst |
| --- | ---: | --- |
| Inter | **0 / 14** | — |
| HarmonyOS Sans | **13 / 14** | `P.` −143 units = **−9.2 px** |
| Noto Sans SC | **13 / 14** | `P.` −125 units |

Every one of the 13 lands within **1 px** of its declared value in the browser
and at **0 px** here. In the deliverables' own copy the visible one is `Ta` in
"a Tailwind subset" at **−7.4 px in a single gap**.

**GSUB is measured and is second-order** — largest effect present in any
deliverable is `fi` at −0.70 px. Reserve room, do not build it. See §9.

## 0. What is NOT decided here

**Whether this lands upstream or as a local patch.** The atlas format belongs to
`vendor/pocketjs`, so this is a change to a shared binary format. `pocket-stack/pocketjs#301`
is the open question of whether upstream takes format work from us. Build it as
a clean upstream-shaped change either way — one commit, no motion-specific
assumptions, no reference to this repository in the code or comments.

## 1. The format: v3 → v4

### Where the section goes, and why

`text.rs::Atlas::parse` computes the coverage region's end and checks
`bytes.len() < bitmap_end` — it rejects a blob that is **too short** and does
**not** reject trailing bytes. So the kern section is **appended after the
coverage region**, and a v4 blob is **byte-identical to a v3 blob up to the end
of coverage**. Nothing moves. No offset in the header changes meaning.

### Why the version bumps anyway

Because a core that cannot apply the pairs must **refuse** the blob, not lay the
text out differently. If v4 were signalled by a flag bit that old cores ignore,
a patched and an unpatched core would produce different frames from the same
pak — silently, and the frame-hash contract is the thing this project sells.
Loud rejection is correct here; graceful degradation is not.

### Layout

Header stays **16 bytes**, cmap entry stays **8 bytes**, coverage stays where it
is. `VERSION` becomes `4`. Cores accept **2, 3 and 4** (v2 = density 1, v3 = no
kern section).

```
kern section, at  HEADER_SIZE + glyphCount*8 + glyphCount*(cellH*density)*(cellW*density)

  +0   u32  pairCount
  +4   pairCount x 5 bytes, SORTED ASCENDING by (leftGid, rightGid):
         +0  u16  leftGid    atlas-local gid (0..glyphCount-1)
         +2  u16  rightGid   atlas-local gid
         +4  i8   delta      LOGICAL px, same units and scale as cmap advance
```

- **5-byte stride, no padding.** The format is already unaligned (the cmap entry
  is `u32 + u16 + u8 + u8`) and the core reads through `rd_u16` helpers.
- **Sorted so lookups binary-search**, the same discipline as the cmap. A single
  `u32` key of `(leftGid << 16) | rightGid` is the comparison.
- `pairCount == 0` is legal and means "this face has no pairs in this subset".
  Emit the section anyway when version is 4, so presence is decided by the
  version and not by length arithmetic.
- Cap `pairCount` such that the section cannot exceed the blob; validate on
  parse the same way `bitmap_end` is validated, and return `None` on truncation.

### Units, and what the quantisation costs

`delta` is **i8 logical px**, matching `advance` (`u8` logical px) and using the
baker's existing `scale = px / unitsPerEm`, so a pair is
`round(units * scale)` clamped to −128..127.

**This quantises, and the quantisation must be stated rather than discovered.**
A pair needs `|units| * scale >= 0.5` to survive. At a 16 px slot that is
**|units| >= 31**; HarmonyOS's `Av` (−37) survives and `av` (−9) does not. At
64 px the threshold is `|units| >= 8` and all 13 classic pairs survive.

Do **not** introduce a fractional unit for kerning while advances stay integer.
The pen is already integer-quantised by the advance; a sub-pixel kern would add
precision on one term of a sum whose other term does not have it.

## 2. Extraction (`framework/compiler/bake-font.ts`)

`opentype.js`'s `getKerningValue()` **returns 0 for GPOS-only faces** — Inter is
one. Walk the subtables directly.

**`scripts/kern-audit.ts` in this repository is a working, cross-checked
implementation of exactly this walk.** It reproduces appendix D's Inter result
(0/14 non-zero, 43 vs 46 format-1 ASCII pairs). Port its logic; do not re-derive
it. It handles:

- `lookupType === 2`, **format 1**: coverage → `pairSets[i][j].value1.xAdvance`
- `lookupType === 2`, **format 2**: class-based, expanded through `classDef1` /
  `classDef2`, with **class 0 reconstructed from coverage** (it means "in
  coverage but in no other class" and cannot be read out of the ClassDef)

### Subsetting is what keeps it small

The atlas is a **subset** — only the codepoints the build actually uses, with
atlas-local gids the baker assigns. So:

1. extract font-gid pairs from GPOS
2. **drop every pair whose left or right font-gid is not in the subset**
3. map both sides to atlas-local gids
4. `round(units * scale)`, **drop pairs that round to 0**
5. sort by `(leftGid, rightGid)`, serialise

Most of the face's pairs disappear at step 2. Expect **well under 1 KB per
slot**; log the pair count per slot next to the existing `font: slot N …` line
so the size is visible on every build rather than assumed.

## 3. Core (`engine/core/src/text.rs`)

### Parse

Add `kern: Vec<KernPair>` (or a sorted `Vec<(u32, i8)>` keyed on the packed gid
pair — pick one and keep it) to `Atlas`. Parse it only when `version == 4`.
Validate length before slicing, matching how `bitmap_end` is handled.

Add one method beside `lookup_entry`:

```rust
/// Logical-px pair adjustment, 0 when absent. Binary search, same
/// discipline as the cmap.
pub fn kern(&self, left: u16, right: u16) -> i32
```

### Apply

Two loops, both currently `for ch in …` accumulating `adv + tracking`:

- `Fonts::measure_run_provider` (`text.rs:308`)
- `Fonts::layout_run` (`text.rs:350`)

Each carries a `prev_gid: Option<u16>` reset at every `'\n'` (both already treat
`'\n'` as a line break — `measure_run_provider` in its `if ch == '\n'` branch,
`layout_run` via `text.split('\n')`). The pen advance becomes

```
pen += kern(prev_gid, gid) + adv + tracking
```

with the kern term applied **before** the glyph is placed, so `layout_run`'s
`out.push(GlyphPos { x: pen - xoff, .. })` sees the adjusted pen.

**These two must not diverge.** `measure_run` sizes the box and `layout_run`
places the glyphs inside it; a pair applied in one and not the other puts text
outside its own box. Add a test that asserts the two agree on a kerned string.

### The native-measurement path is untouched

`measure_run_provider` returns early when `native` is set and a measurer is
installed (`docs/BACKENDS.md`). That path is the host's own shaper and already
kerns. Do not add anything to it.

## 4. The affected set — the surveyed list is wrong

The survey that scoped this work names `pocket-ui-wgpu/src/render.rs` and
`symbian/src/gl/mod.rs`. **Both were checked and neither needs a change**: they
reach glyphs through the core's `Atlas` API (`atlas.glyph_rows`,
`atlas.glyph_count`) and consume `GLYPH_RUN` ops whose positions the core has
already computed. Kerning moves the pen inside the core; the backends draw cells
at given positions. The same is true of `backends/gpui/src/render.rs`.

What actually has to change:

| file | change |
| --- | --- |
| `contracts/spec/spec.ts` | format doc, `FONT_VERSION` 3 → 4, section constants |
| `contracts/spec/gen-rust.ts` | emits `pub mod font_atlas` |
| `engine/core/src/spec.rs` | **generated** — `bun run gen`, never hand-edit |
| `engine/core/src/text.rs` | parse + `kern()` + `prev_gid` in the two loops |
| `framework/compiler/bake-font.ts` | GPOS extraction + serialisation |
| `engine/pocket3d/examples/note-widget/src/cjk.rs` | its own parser, gate is `if version != 2 && version != 3` (`cjk.rs:110`) — must accept 4, and its runtime appender must keep the section consistent when it adds glyphs |

`bun run gen` must leave `engine/core/src/spec.rs` byte-identical to what is
committed; that is checked, so regenerate rather than edit.

## 5. What breaks on the motion side

`src/text/fit.ts` documents its own dependency, at the top of the file:

> `measure_run` is a sum of per-glyph advances with no pair adjustment, because
> the core has no kerning. Width is therefore additive over any split, and a
> cached per-segment sum is not an approximation of the measurement — it is the
> same number. **A core that gained kerning would break that**, and this module
> would have to measure whole candidate lines instead.

So this change makes that comment false and that optimisation unsound. **In the
same change**: make the fitter measure whole candidate lines, and update the
prose. The exposure is smaller than the file implies — `pretty` was deleted on
2026-08-14, leaving `greedy` (default) and `balanced` (explicit, headlines).

## 6. Ledger churn is expected

Every composition with Latin text in a kerned face moves its digest. That is the
intended effect, not a regression. Re-record with
`bun scripts/digests.ts --write` **in the same commit as the change**, so the
diff shows both, and say in the message how many entries moved and why.

## 7. Acceptance

**The before-numbers already exist**, so the criterion is a delta rather than a
new measurement. `baselines/glyph-fidelity.md` records, for
`compositions/textcmp-kern` at 64 px against Chrome on the same file:

| pair | declared | predicted px | measured gap today |
| --- | ---: | ---: | ---: |
| `P.` | −143 | −9.2 | **9** |
| `LT` | −128 | −8.2 | **8** |
| `Ta` | −115 | −7.4 | **7** |
| `Yo` | −100 | −6.4 | **6** |
| `AV` / `VA` | −85 | −5.4 | **5** |
| `Av` | −37 | −2.4 | **2** |
| `av` | −9 | −0.6 | **0** |

**Pass = re-running that comparison puts every one of the 13 within 1 px of the
browser**, i.e. the gap column goes to 0. Anything else is a partial result and
should be reported as one.

Also required:

- `bun run test` 11/11 stages green; `engine/core` tests pass
- a core test asserting `measure_run` and `layout_run` agree on a kerned string
- a core test asserting a **v3** blob still parses and kerns to zero
- a core test asserting a **truncated v4** kern section is rejected, not read
- the per-slot pair count printed at build time

## 7b. How to produce it in this repository

**Never edit `vendor/` and leave it edited** — it is rebuilt from `patches/`.
The workflow is: edit the vendored tree to get it working, then capture the
result as a patch, then prove the patch is the thing that works.

```bash
# 1. work in the vendored tree until the change is right
#    (vendor/pocketjs is a clone pinned by scripts/vendor.ts)

# 2. capture, one patch, the affected files only
git -C vendor/pocketjs diff -- \
  contracts/spec/spec.ts contracts/spec/gen-rust.ts \
  engine/core/src/spec.rs engine/core/src/text.rs \
  framework/compiler/bake-font.ts \
  engine/pocket3d/examples/note-widget/src/cjk.rs \
  > patches/0009-font-atlas-kerning.patch

# 3. prove it: rebuild from scratch and re-run everything
bun scripts/vendor.ts          # re-clones, applies 0001..0009 in order, builds wasm
bun run test && bun run typecheck && bun scripts/digests.ts
```

Step 3 is the only evidence that counts. A patch that works in a hand-edited
tree and not in a freshly vendored one is not done.

**Overlap with `patches/0008`.** Both touch `contracts/spec/spec.ts`,
`contracts/spec/gen-rust.ts` and `engine/core/src/spec.rs` — 0008 in the
`DRAW_OP` region, this one in `font_atlas`. Different regions of the same files,
so conflicts should be trivial, but 0008 is an **open upstream PR** and may
change under review. If `bun scripts/vendor.ts` fails applying 0009, rebase 0009
— never reorder or edit 0008 to make room.

## 7c. The acceptance measurement, without a browser

§7's table came from comparing against Chrome. **Grok does not need to repeat
that**, because the browser side was already measured and recorded. The
criterion is therefore a claim about this renderer alone: its ink widths must
move to the browser column that is already written down.

Render `compositions/textcmp-kern` (one frame, 64 px, HarmonyOS Sans Regular),
find the text bands by row, take each band's ink column extent. From
`baselines/glyph-fidelity.md`:

| pair | declared | motion today | **required** | measured gap |
| --- | ---: | ---: | ---: | ---: |
| `P.` | −143 | 44 | **35** | 9 |
| `F,` | −131 | 44 | **35** | 9 |
| `LT` | −128 | 67 | **59** | 8 |
| `Ta` | −115 | 67 | **60** | 7 |
| `To` | −110 | 71 | **65** | 6 |
| `r.` | −103 | 31 | **25** | 6 |
| `Yo` | −100 | 74 | **68** | 6 |
| `AV` | −85 | 84 | **79** | 5 |
| `VA` | −85 | 84 | **79** | 5 |
| `W.` | −74 | 73 | **68** | 5 |
| `Wa` | −74 | 93 | **88** | 5 |
| `Av` | −37 | 75 | **73** | 2 |
| `av` | −9 | 64 | **64** | 0 |

**Pass = every row within 1 px of the required column.**

**Do not derive the required column from the units instead.** Rounding
`|units| * 64 / 1000` disagrees with what the browser actually draws on four of
the thirteen: `F,` predicts 8 and measures 9, `W.` and `Wa` predict 5 from 4.7,
and **`av` predicts 1 and measures 0** — at −0.58 px the shift does not survive
ink-extent quantisation. `av` is therefore the row that tests whether the
implementation invented a shift the renderer cannot express; it must stay at 64.

The fourteenth row, `ry`, is clipped off the bottom of the frame (motion's line
spacing is wider than the browser's) and its declared value is 0. Nothing rests
on it; do not "fix" the fixture to bring it into view as part of this change.

Report the measured width per pair as a table. **A pair that does not move is a
result, not a rounding error** — say so rather than averaging it away.

## 8. Do not

- do not add a runtime shaping engine, a GPOS parser in the core, or any font
  parsing outside the baker
- do not change the header size, the cmap entry size, or the coverage offset
- do not make kerning conditional on a runtime flag — it is baked or absent
- do not touch the `native` measurement path
- do not hand-edit `engine/core/src/spec.rs`

## 9. GSUB: reserve, do not build

Ligatures ride the same section design if they are ever built — extraction is a
different table walk (`lookupType === 4`, ligatureSets) and the runtime lookup
is the same binary search. Measured 2026-08-19: the deliverables hit 4 ASCII
ligatures 43 times and **the sequences with the largest effect never occur**;
the largest that does is `fi` at **−0.70 px at 64 px** against kerning's
**−7.4 px** in the same copy. `scripts/liga-audit.ts` is the working extractor
when the time comes.

**Leave the version at 4 and do not add a second section now.** If GSUB is built
later it is another section appended after this one, by the same argument that
put this one after coverage.
