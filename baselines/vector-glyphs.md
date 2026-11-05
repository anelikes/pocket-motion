# Vector glyphs and colour glyphs: what was measured

`patches/0063` bakes a text size the FONT ATLAS cannot hold — or one a
literal declares `text-vector` — as a FONT VECTOR face, whose glyphs the core
fills as PATH ops, and draws a COLR face's colour glyphs as layered outlines.
Measured 2026-11-06 on an Apple M4 (10 cores, 32 GB), Bun 1.3.11, the core at
`66caf4e5` + 45 patches. Other sessions held the load average between 60 and
340 for most of the day; every timing below says what the load was when it
was taken, and the counts and pixel comparisons do not depend on it.

## Where the atlas stops

The atlas cell is `round(ascender * px / upm) + ceil(-descender * px / upm)`
and is a u8. Per face, from `hhea` (computed by the formula over the files):

| face | upm | ascender / descender | largest atlas size |
| --- | ---: | --- | ---: |
| Noto Sans SC (Regular, Bold) | 1000 | 1160 / −288 | 176 px |
| Inter (Regular, Bold) | 2048 | 1984 / −494 | 211 px |
| HarmonyOS Sans (Regular, Bold) | 1000 | 928 / −244 | 217 px |

One px past it the build now writes a vector slot: 177 px Noto Sans SC Bold
has a cell of 205 + 51 = 256 (`tests/vector-glyphs.test.ts`).

## The switch-over

At each face's ceiling a composition sets one string twice, once from the
atlas and once `text-vector`, each in a 256 px line box around its 255 px
cell, so the cell's anchor falls half a pixel off the grid and the atlas's
rounding of it is in play (`tests/vector-glyphs.test.ts`):

| | 176 px Noto Sans SC Bold, `第一名AVATAR` | 211 px Inter, `AVATAR Wo.` |
| --- | --- | --- |
| baseline, cell, line height | equal | equal |
| advances (every collected codepoint) | equal | equal |
| kern pairs (every pair either slot holds) | equal, 917 | equal |
| ink box (green > 127), atlas | 47,54 – 1213,220 | 46,51 – 1333,206 |
| ink box, vector | 47,54 – 1213,220 | 46,52 – 1333,206 |
| total ink, vector against atlas | +0.05% | −0.04% |
| pixel-for-pixel difference, share of the ink | 0.54% | 0.52% |

The atlas rasterises each glyph once at its baked size with eight chords a
curve and stores coverage; the core flattens the outline to 1/16 px and fills
it on a 4×4 lattice per pixel. The 0.5% is that difference along every edge.
The test bounds it at 1.5%; the anchor left unrounded is what that bound is
for (red check below).

## Colour glyphs: Noto Color Emoji

`Noto-COLRv1.ttf`, googlefonts/noto-emoji `v2026-09-24-unicode18_0`,
5,038,236 bytes, OFL 1.1 — COLR version 1, 1,508 mapped codepoints, 1,469 of
them with a colour paint. Its paints, read by `colr.ts`: solid fills,
linear gradients, radial gradients (concentric, and nine with a focal point),
transforms, and two composites. Colour lines carry up to 13 stops — 41
glyphs need more than the six PAINT_PUSH held, which is why its bound is 16
now (7 stops: 21 glyphs, 8: 9, 9: 7 — the flame among them — 10: 2, 11: 1,
13: 1).

**1,398 draw. 109 codepoints are left out of every slot, by name**
(`bun baselines/vector-glyphs/refused.ts` prints each):

| codepoints | why |
| ---: | --- |
| 37 | tag characters (U+E0030–U+E007F): subdivision flags are formed by shaping |
| 26 | regional indicators (U+1F1E6–U+1F1FF): a flag is a pair the core does not shape |
| 20 | a src-in composite: ⚠ 🎛 🎟 🎫 👓 💻 📜 📠 📦 📰 🕰 🖥 🗒 🗞 🚸 🛼 🦎 🩲 🪢 🪦 |
| 10 | a soft-light composite: U+FE4E5–U+FE4EE, private-use codepoints whose glyphs are flags (the font's build lays a soft-light shade over every flag) |
| 9 | a radial gradient with a focal point: ⛈ 🌁 🌄 🌏 🌩 🌫 💟 🗻 🦟 |
| 5 | skin-tone modifiers (U+1F3FB–U+1F3FF) |
| 1 | U+200D ZERO WIDTH JOINER |
| 1 | U+20E3 COMBINING ENCLOSING KEYCAP |

Country flags are not codepoints in this font — each is a ligature of two
regional indicators — so what a flag in a title meets is the regional
indicators' refusal, and a subdivision flag (England, Scotland) the tags'.
A codepoint the slot's own face maps never reaches the fallback: Noto Sans
SC maps ⚠, so a composition with it as the default face draws ⚠ in the text
colour and never meets the src-in refusal.

## Every guard watched red

`bun baselines/vector-glyphs/redcheck.ts` writes each defect into the patch
(one `+` line for another) or into this repository's file, rebuilds the
vendored tree from the patches, runs the one test that names it, and
restores. 24 defects; each test is green on the tree as it is first.

| defect | test | |
| --- | --- | --- |
| measurement reads only atlases | core `a_vector_slot_measures_with_wide_advances_and_kerning` | red |
| a vector face's kern pairs not applied | the same | red |
| a miss's codepoint not kept | the same | red |
| a vector slot taken down the atlas branch | core `a_vector_slot_draws_paths_and_no_cells` | red |
| a glyph's origin without its baseline | the same | red |
| a glyph placed by its anchor alone, upright | core `a_vector_glyph_turns_with_its_node` | red |
| an atlas slot's supplement ignored | core `an_atlas_slot_draws_its_colour_glyphs_as_layers` | red |
| a colour layer drawn without the subtree opacity | the same | red |
| a supplement evicting its slot's atlas | core `loading_order_keeps_one_owner_of_a_slots_metrics` | red (see below) |
| a gradient's coefficients not mapped to the screen | core `a_gradient_layer_is_a_paint_around_a_white_fill` | red |
| trailing bytes after the outlines accepted | core `vector_face_parse_refuses_malformed_blobs` | red |
| a vector advance rounded down | `vector-glyphs` "carries the atlas's metrics" | red |
| a vector slot's kern pairs dropped | the same | red |
| a vector baseline rounded up | the same | red |
| the ceiling no longer switches to a vector slot | `vector-glyphs` "past the ceiling" | red |
| a vector glyph's anchor not rounded where GLYPH_RUN rounds | `vector-glyphs` "land where the atlas" | red (see below) |
| the measurer reading atlases only | `vector-glyphs` "measures a size past the ceiling" | red |
| a colour face's glyph baked into an atlas cell | `colour-glyphs` "draws its colours" | red |
| regional indicators drawn on their own | `colour-glyphs` "left out by name" | red |
| a composite drawn as its source alone | the same | red |
| the paint's stop bound back at six | `colour-glyphs` "draws its colours" | red |
| check not reading the missed codepoints | `colour-glyphs` "tofu fails check" | red |
| a refusing render not checking its first frame | `colour-glyphs` "refuses tofu" | red |
| trace not saying so | `colour-glyphs` "trace and render say so" | red |

The first full run left two green, and both were the test's fault, not the
defect's. The loading test fed the supplement before the atlas, so a
supplement that evicted its slot's atlas had nothing to evict; it now loads
both orders. And the switch-over lines sat on whole pixels — layout rounds a
node's position — so rounding the glyph anchor was a no-op there and an
unrounded one changed nothing; a 256 px line under each face's 255 px cell
now puts the cell half a pixel down its line box. Measured on that layout:
0.54% of the ink apart with the anchor rounded, 2.96% without; the bound is
1.5%.

## What a vector glyph costs

`bun baselines/vector-glyphs/cost.ts --runs 30` stages six 1920×1080
compositions, builds each, boots each at frame 0, and times the draw walk
alone (`ui_draw_hash`, where a vector glyph's outline is flattened and
mapped) and the walk with the raster (`render`), 30 times each after three
warm-ups. Load average 48–83 while it ran, so the minimum is the number to
read; the medians swing with whatever else held the cores.

| scene | walk, min / median ms | walk + raster, min / median ms |
| --- | ---: | ---: |
| 4 lines × 8 glyphs, 176 px Noto Sans SC Bold, atlas | 0.00 / 0.02 | 1.96 / 11.06 |
| the same, `text-vector` | 0.10 / 0.20 | 2.22 / 7.33 |
| the same, each line turned 6° (no atlas form: cells stay upright) | 0.08 / 0.16 | 1.49 / 4.83 |
| 3 glyphs at 480 px (vector: the atlas cannot hold it) | 0.02 / 0.06 | 0.43 / 1.19 |
| 12 lines × 8 glyphs at 64 px, atlas | 0.01 / 0.03 | 0.98 / 3.99 |
| the same, `text-vector` | 0.16 / 0.31 | 1.38 / 3.93 |

At the switch-over size a vector run costs about an eighth more than the
atlas run per frame; at a title size, where the per-glyph setup of a PATH op
weighs more against its area, about two fifths more — under half a
millisecond for 96 glyphs. The flatten in the walk is 1–3 µs a glyph. A 480
px hero of three glyphs is under half a millisecond in all. None of this is
cached across frames: every frame flattens every visible glyph again.
