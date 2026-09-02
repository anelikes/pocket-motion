# Phase 1.5 — the trigger fired, 2026-08-13

Phase 1.5 (kerning + a bring-your-own face) is conditional. Its trigger is *"the
deliverable needs a face other than Inter"*, and appendix D justified leaving it
asleep by measuring Inter rather than trusting its reputation: **every classic
problem pair is zero**, because Inter is a UI face drawn for environments with no
shaping engine. Sidebearings do the work. Ship Inter, skip kerning.

`scripts/build-reel.ts` defaults to `--font harmony`. The reel has been baking
**HarmonyOS Sans**, not Inter, since the faces were vendored. The condition has
been true for a while and the measurement behind the decision was never re-run.

This is that measurement. Reproduce with
[`scripts/kern-audit.ts`](../scripts/kern-audit.ts).

## Method, and its control

`opentype.js`'s `getKerningValue()` returns 0 for fonts whose kerning lives in
GPOS rather than a legacy `kern` table, which is why appendix D walked the
`lookupType === 2` subtables directly. This does the same: format 1 pair sets,
and format 2 class-based pairs expanded through their class definitions, with
class 0 reconstructed from coverage (it means "in coverage but in no other
class", so it cannot be read from the ClassDef).

**The control is Inter**, whose answer appendix D already recorded. A new parser
producing a dramatic result is a claim about the parser until it reproduces a
known one:

| | appendix D (2026-08-11) | this script |
| --- | --- | --- |
| classic pairs non-zero | **0 / 14** | **0 / 14** |
| format 1 ASCII-ASCII | 43 | 46 |
| format 2 ASCII-ASCII | 100 | 105 |

The verdict matches exactly and the ASCII counts are within a few. The format-2
*total* differs by an order of magnitude (249 there, 4160 here) because the two
count class expansion differently; no conclusion rests on that column, and the
disagreement is recorded rather than smoothed over.

## HarmonyOS Sans

| | Regular | Bold |
| --- | ---: | ---: |
| unitsPerEm | 1000 | 1000 |
| legacy `kern` table | no | no |
| format 1 ASCII-ASCII | 4 | 4 |
| format 2 ASCII-ASCII | **1344** | **1392** |
| classic pairs non-zero | **13 / 14** | **13 / 14** |

Regular, the pairs appendix D checked:

| pair | units | % em | | pair | units | % em |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| `P.` | −143 | −14.3% | | `Yo` | −100 | −10.0% |
| `F,` | −131 | −13.1% | | `AV` | −85 | −8.5% |
| `LT` | −128 | −12.8% | | `VA` | −85 | −8.5% |
| `Ta` | −115 | −11.5% | | `W.` | −74 | −7.4% |
| `To` | −110 | −11.0% | | `Wa` | −74 | −7.4% |
| `r.` | −103 | −10.3% | | `Av` | −37 | −3.7% |
| | | | | `av` | −9 | −0.9% |
| | | | | `ry` | 0 | — |

**This is the opposite of Inter, and not marginally.** HarmonyOS Sans is drawn
expecting a shaping engine to apply these.

## Does the reel actually hit them?

A font *having* kerning and a deliverable *needing* it are different claims. The
second one is what decides whether this is urgent, so the audit takes the reel's
own copy:

| line | pairs | shift |
| --- | ---: | ---: |
| `"Deterministic video rendering. No browser."` | 6 | **−0.197 em** |
| `"a Tailwind subset, not all of CSS"` | 6 | −0.109 em |
| `"HyperFrames · 1 worker"` | 5 | −0.091 em |
| `"PocketJS Motion · 1 thread"` | 4 | −0.091 em |
| `"PocketJS Motion"` | 3 | −0.059 em |
| `"DETERMINISM"` / `"SPEED"` | 0 | 0 |

At the reel's 64 px headline that worst line is **12.6 px** of accumulated width.

**But read that number correctly.** A cumulative shift spread over 42 characters
is mostly a change in total line width, which nobody notices in isolation. What
is actually visible is a *single* large pair, and the reel has one: `Ta` in "a
Tailwind subset" at −115 units, **−7.4 px at 64 px, in one gap**. The all-caps
lines score exactly zero, which is the expected shape — caps pairs like `AV` are
kerned but "DETERMINISM" and "SPEED" happen not to contain any.

## Noto Sans SC, added 2026-08-13

The audit had two faces in it and the deliverable now has three: Noto Sans SC is
what Chinese copy bakes with (`assets/fonts/README.md`), and the Latin inside a
Chinese sentence is set in *its* glyphs, not HarmonyOS's. So it belongs in the
table before the decision is closed.

| | Regular | Bold |
| --- | ---: | ---: |
| unitsPerEm | 1000 | 1000 |
| legacy `kern` table | no | no |
| format 2 ASCII-ASCII | 870 | 880 |
| classic pairs non-zero | **13 / 14** | **13 / 14** |

`P.` −12.5% em, `LT` −13.4%, `F,` −8.1%, `Ta` −8.1%, `To` −7.4%. **The same shape
as HarmonyOS Sans**, so the third face does not change the verdict — it widens
it. Only Inter is drawn to need no shaping engine, and Inter has no Chinese.

Two things temper it for Chinese copy specifically: CJK glyphs are not kerned at
all (fixed advances), and the Latin runs inside Chinese prose are short — the
`copy` composition's longest are `Chrome` and `Tailwind`, which contain no
non-zero classic pair. The exposure is display Latin, which is the reel's case
rather than this one's.

## GSUB: the other half of "bring your own face", measured 2026-08-19

Kerning is GPOS. The other thing a font does that this pipeline ignores is
GSUB — substituting a *run* of glyphs with a different one, so `fi` is drawn as
a single glyph rather than an f beside an i. `bake-font.ts` reads exactly three
things: `hhea` for line metrics, `charToGlyphIndex` for the cmap, and
`advanceWidth`. **One codepoint, one glyph, one width**, so no substitution of
any kind can happen, and a browser showing the same file applies `liga` and
`calt` without being asked.

Audited with [`scripts/liga-audit.ts`](../scripts/liga-audit.ts), counting only
features a browser turns on with no author opt-in (`liga`, `rlig`, `clig`,
`calt`); `dlig`, `hist` and `ss0N` are opt-in and cost nothing.

| | ASCII ligatures under browser-default features |
| --- | ---: |
| HarmonyOS Sans Regular / Bold | **16** each |
| Noto Sans SC Regular / Bold | **5** each |

### Does the deliverable hit them

Same question as for kerning, and the same discipline. Scanning the 1389 text
literals across all 20 compositions:

| sequence | occurrences | declared Δ | at 64 px |
| --- | ---: | ---: | ---: |
| `ry` | 18 | −7 units | −0.45 px |
| `rt` | 13 | −8 | −0.51 px |
| `fi` | 7 | −11 | −0.70 px |
| `rv` | 5 | −8 | −0.52 px |
| `ff` `ffi` `ffl` `fl` `rf` | **0** | −23 … −34 | −1.47 … −2.18 px |

**The sequences with the largest effect do not occur.** The largest that does is
`fi` at **−0.70 px at 64 px**, against kerning's `Ta` at **−7.4 px** in the same
copy — an order of magnitude apart.

### Measured, in one apparatus

Cross-apparatus first, and it was wrong: comparing the motion render against a
browser canvas showed the browser carrying **3.2–5.1% more ink on every row**,
including rows whose shape barely changes. A difference that uniform is the
apparatus, not the effect, so that column was discarded rather than reported.

The isolated measurement puts both sides in the browser and separates them with
a zero-width non-joiner, which suppresses ligature formation and nothing else:

| sequence | Δ advance @64 px | Δ ink | Δ ink width |
| --- | ---: | ---: | ---: |
| `ffi` `ffl` | −2.18 | −0.5% | −2.00 px |
| `ff` | −1.47 | +0.3% | −1.50 px |
| `rf` | −1.21 | −1.1% | −1.25 px |
| `fi` `fl` | −0.70 | −1.6% | −0.75 px |
| `rt` `rv` | −0.51 | −1.5% | −0.50 px |
| `ry` | −0.45 | −0.7% | −0.50 px |
| **`xz` `no` `ka` (control)** | **0** | **0** | **0** |

Every Δ advance reproduces the declared table exactly, and **ink changes by at
most 1.6%** — HarmonyOS's ligatures tuck the f's hook rather than merging
strokes. Motion's own advances equal the un-ligated column exactly, which is
the expected shape for a pipeline that cannot substitute.

**The control caught an instrument error.** `ka` first measured non-zero, and
`rt` measured −2.30 px against a declared −0.51. Canvas 2D carries its own
`fontKerning`, defaulting to `auto`, and **ignores the CSS `font-kerning` rule**
— so the first run was measuring ligature *and* kerning. With
`ctx.fontKerning = 'none'` the control returns exactly zero on all three and
every row matches its declared value.

### What it means for the scope

GSUB is second-order. It belongs in the same v4 section if Phase 1.5 is built —
the extraction is a different table walk and the runtime lookup is the same
shape — but **it does not independently justify the format change**, and no
deliverable today is visibly wrong because of it. Kerning is the item that
carries the decision.

Fixture: `compositions/textcmp-liga`, one frame, the nine ASCII `liga`
sequences at 64 px.

## Built, 2026-08-19 — and what integer pixels cost

Atlas v4 (`patches/0009-font-atlas-kerning.patch`). All 13 non-zero pairs land
within 1 px of the browser column recorded in `glyph-fidelity.md`, measured
independently of the implementer's own report.

`delta` is `i8` **logical px**, matching `advance`, so every pair is rounded at
bake time. Nobody had measured what that rounding costs over a whole line, and
per-pair tolerance hides it. Across all 141 text literals in the tree that
contain at least one kerned pair, comparing the baked sum against the exact
fractional sum:

| slot | mean error, baked | mean error, no kerning | worst line | lines where baked is worse |
| ---: | ---: | ---: | ---: | ---: |
| 64 px | **0.42 px** | 4.39 px | 1.43 px | **2 / 141** |
| 32 px | **0.52 px** | 2.20 px | 1.95 px | **10 / 141** |
| 16 px | **0.37 px** | 1.10 px | 1.82 px | **6 / 141** |

**Ten times better at 64 px, and it can be worse.** Rounding is per pair, so a
pair whose true shift is −0.58 px becomes a whole −1 px, and a line of such
pairs over-applies. On 1–7% of lines the baked result is further from the truth
than not kerning at all, by at most 1.9 px. The trade is clearly favourable and
the failure mode is bounded, but it exists and is a property of the format
choice rather than of the implementation.

**A correction to the acceptance criterion.** The spec required `av` to stay at
64 px of ink, because the browser measures 64. That was wrong. The browser does
apply `av`'s −9 units; at 64 px that is −0.58 px, which **ink extent is too
coarse to show**. The baked path rounds it to a whole −1 px, which ink extent
does show, so `av` measures 63. Both are correct within a pixel and the
criterion mistook a metric artefact for ground truth.

## What this decides

The trigger is real and the measurement is no longer an assumption. What it does
**not** decide is whether to build Phase 1.5, because there are two ways out and
only one of them is engineering:

- **Do Phase 1.5.** The scope is known and not small: the pak's font format goes v3 →
  v4 (the cmap entry is full at 8 bytes, so kerning has to be a new section) and
  it touches six files across `contracts/spec`, the core's `spec.rs`/`text.rs`,
  two backends and the CJK appender. That is a change to a *shared upstream
  format*, which is a different weight class from patches 0004 and 0005.
- **Ship Inter.** `--font inter` already exists and is already documented as the
  exit in `assets/fonts/README.md`. Zero engineering, and **nothing but the reel
  uses HarmonyOS Sans** — no fixture, no test, no golden depends on that face.

So the cost of choosing Inter is entirely aesthetic, and the cost of choosing
HarmonyOS Sans is a format change. That is a product decision, and it is now an
informed one.

**A cost that did not exist when this was written.** Kerning would end the
additivity of width, and the build-time wrapper is built on it: cached segment
sums are exact only because `measure_run` adds advances with no pair adjustment
(`baselines/text-fitting.md`). With kerning, every candidate line has to be
measured whole. Phase 1.5 would therefore slow down and complicate a subsystem
that did not exist when its ledger was drawn up. The typography work is a
weight on the *don't* side.

**Narrowed, 2026-08-19.** This named `pretty` alongside `balanced` as the
strategies that consider an order of magnitude more candidate lines. `pretty`
was deleted on 2026-08-14 — measured identical to greedy in 391 of 404 breaks
and identical in every two-line case — so `greedy` (default) and `balanced`
(explicit, for headlines) are what remain. That shrinks the exposure and
sharpens where it lands: `balanced` is opt-in for titles, and display titles
are exactly where a single large pair is visible. **The cost and the benefit
fall on the same content.**

Determinism is unaffected either way: kerning would be extracted at build time
from a vendored face and baked into the pak, exactly like the glyph atlas, so it
carries no runtime risk — the same route the glyph atlas already takes.

## Looked at, 2026-08-19 — the reel rendered both ways

Everything above measures the *face* or the *atlas*. Nothing above had rendered
the deliverable. The A/B is `compositions/reel` built twice from the same
sources — once with `patches/0009` applied (atlas v4, 646–1464 pairs per slot)
and once with it held out (atlas v3, no kern section) — with the wasm rebuilt
each time so the core matches the format it is parsing.

**812 of 1071 frames changed.** The five contiguous ranges that moved are
113–393, 418–620, 679–734, 778–846 and 868–1070.

Per-string, read out of the baked pak by summing its kern section
(`scripts/kern-baked.ts` — a second apparatus, reading the artifact rather than
the face the way `scripts/kern-audit.ts` does, and agreeing with `layout --at`
on all fourteen lines checked that way):

| shift | size | string |
| ---: | ---: | --- |
| **−13 px** | 76 bold | `remove the browser` |
| −8 px | 38 | `no blur, no glow, no blend modes` |
| −7 px | 38 | `Deterministic video rendering. No browser.` |
| −5 px | 38 | `HyperFrames · 1 worker` |
| −4 px | 76 bold | `PocketJS Motion` |
| −4 px | 34 | `moves on every frame` |
| −3 px | 38 | `a Tailwind subset, not all of CSS` |
| **+1 px** | 38 | `that is why it is fast, and why it is portable` |

25 of the 37 distinct multi-character strings shift; the widest is −13 px on a
76 px headline. Two shift *positive* — a pair that opens the gap rather than
closing it, which the audits above never showed because they scored only the
fourteen classic closing pairs.

### The lines this document argued from are not set at the size it assumed

The audit above scored shifts in em and then multiplied by 64 px, described as
"the reel's 64 px headline". The reel has no such line. `text-[64px]` is used
for `1×`, `4×` and `6.6x`, all of which contain **zero** kerned pairs; the copy
lines are 38 px, the section titles 76 px, the hero 104 px. So:

- `Ta` in `a Tailwind subset` is **−4 px**, not the −7.4 px recorded above,
  because that line is set at 38 px.
- The worst accumulated line is **−7 px**, not 12.6 px, for the same reason.
- The largest shift in the film is on a line the audit never named:
  `remove the browser`, −13 px at 76 px bold.

The conclusion survives with different numbers and a different exemplar. The
premise that produced the old ones — that an em-relative measurement can be
scaled to a size chosen by hand — is the error, and it is the same shape as
costing a wrap strategy that had been deleted.

### 39% of the reel's glyphs cannot kern, by construction

Frames 0–112 are **byte-identical** between the two builds, PNG for PNG.
`layout --at 100` reports 52 visible text nodes, every one of them holding
exactly one character, and together they spell the opening card: `PocketJS
Motion` at 104 px over `Deterministic video rendering. No browser.` at 38 px.
The sentence this document opened with as the worst line in the reel is on
screen there, kerned by nothing.

`stagger()` in `compositions/reel/gen.ts` emits one `<Text>` per character so
each glyph can carry its own entrance. Kerning is a within-run adjustment and a
one-character node is a one-glyph run, so `prev_gid` is always absent and no
pair ever applies. Counting the source: **587 single-character `<Text>` nodes
against 44 multi-character ones, 587 of 1507 glyphs — 39% — in a form the pair
table cannot reach.**

This is not a defect in the patch and it is not fixable in the core without
shaping across sibling nodes, which would break the run contract. It is a
property of per-character kinetic typography, and it means the film's most
kerning-sensitive sentence — `Deterministic video rendering. No browser.`,
the −0.197 em line this document opened with — appears twice: staggered, where
kerning is inert, and as one string near the end, where it takes the full
−7 px. A generator that wanted kerning under a per-character entrance would
have to apply the deltas itself as explicit offsets.
