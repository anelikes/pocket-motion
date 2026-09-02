# Phase 1 & 2 acceptance — 2026-08-12

Apple M4, Bun 1.3.11, vendored upstream at `272b1a9` + `patches/0001-dynamic-font-slots.patch`.

## Phase 1 — typography

### Work item 1: arbitrary font sizes

Upstream binds sizes to a seven-entry table that both the class parser and the atlas
baker import, so a composition could only use 12/14/16/18/20/24/36 px.

Slots are now assigned from what a composition uses. 0..13 stay pinned to the named
sizes; anything else is allocated from 14 upward on first sight.

```
font: slot  2 (16px)        ← pinned, unmoved
font: slot 14 (112px bold)  ← allocated
font: slot 15 (47px)
font: slot 16 (29px)
font: slot 17 (17px)
```

- Upstream's own `tests/tailwind.test.ts`: **64 pass** — backward compatible.
- Contract drift guard after raising `MAX_FONT_SLOTS` 16 → 64: **all green**.
- Rendered at 1920×1080: each size crisp at its own size.

A Rust fix rode along: `Default` for arrays stops at 32 elements, so the atlas table
is now built with an explicit const initializer.

### Work item 2: sub-pixel glyph positioning

Glyph positions are rounded to integers in **logical** pixels before the DrawList packs
them (`engine/core/src/draw.rs`), so slow motion stair-steps. The plan offered three
fixes; the cheapest turns out to be sufficient, which avoids changing the DrawList
format — a change that would propagate to every upstream backend.

**Mechanism, offset as the only variable** (4× logical, lanczos to 1080p):

| offset | differing pixels | max channel Δ | mean Δ |
| --- | ---: | ---: | ---: |
| +0.25 px | 2112 | 76 | 20.1 |
| +0.50 px | 2315 | 149 | 36.1 |

Monotonic with the offset — genuine sub-pixel placement, not sampling noise.

**Dynamic criterion — a caption easing at ~0.3 px/frame**, glyph centroid measured per
frame and normalised to output pixels:

| | per-frame displacement | quantum | **stationary frames** |
| --- | --- | ---: | ---: |
| 1× | `0.00 1.00 0.00 0.00 1.00 …` | 1.000 px | **70%** |
| 4× | `0.25 0.25 0.25 0.25 0.50 …` | 0.250 px | **0%** |

Mean speed matches (0.304 vs 0.293 px/frame), so this is the same motion sampled
differently. At 1× the text is **still for 70% of frames** and then jumps a whole
pixel. At 4× every frame moves. ✅

**The two work items are coupled**: authoring at 4× means font sizes at 4× too, and
448px is not expressible on a seven-rung ladder. Neither is useful alone.

### Work item 3: font hash in the input identity

`src/render/identity.ts` — bundle, pak, canonical sidecar, font files, frozen footage
artifacts, and the render parameters. Verified: changing the viewport changes the
digest, adding footage changes it, recomputation is stable.

## Phase 2 — checkpoint-forward seeking

A mount-only composition keeps its whole frame state in the core's linear memory, and
nothing in the JS heap moves after mount — which is exactly what the mount-only oracle
verifies. So a memory copy captures the world.

**Criterion: rewinds must reproduce the sequential fold.** Eight scattered frames,
three intervals, against a 450-frame baseline:

| interval | rewinds matching | snapshots | memory |
| ---: | --- | ---: | ---: |
| K=30 | 8/8 ✅ | 15 | 358 MiB |
| K=60 | 8/8 ✅ | 8 | 235 MiB |
| K=150 | 8/8 ✅ | 3 | 68 MiB |

**Criterion: texture accounting with footage.** Rewinds reproduce the fold, the handle
count returns to **12 for 12 tiles** with no leak, and the composition stays mount-only
(mount 77 ops, then 0 across 60 frames). ✅

Host footage is **rebuilt** after a restore rather than checkpointed: texture handles
carry a generation a restore invalidates, so a handle captured beforehand could alias a
live texture and free someone else's pixels. Footage is a pure function of the frame
index, so rebuilding is simpler and self-evidently correct.

Memory is the real cost — a snapshot is the core's whole linear memory, ~24 MiB at
1080p. The interval is the dial.

## Carried forward

- Static typography comparison against HyperFrames side by side is **not done** —
  the mechanism is proven, the aesthetic judgement is not made.
- `seek: "random"` is still unclaimed. `checkpoint-forward` covers rewinds within the
  ladder; true arbitrary order for distribution needs the ladder to cover the whole
  range, which is a memory decision rather than a mechanism one.
- Kerning remains unimplemented (Phase 1.5, triggered by a non-Inter font).
