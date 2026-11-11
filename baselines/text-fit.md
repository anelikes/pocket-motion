# Fit, wrap and clamp in layout — what was measured

`patches/0059` evaluates `text-fit-[..]`, `text-wrap` and `line-clamp-N` in
the core's layout and records what a clamp left out. This file holds the
measurements the design was chosen on and the ones that check it. Measured
on 2026-11-06, Apple M4, Bun 1.3.11, pin 66caf4e5 + 45 patches, on a machine
other sessions were loading (the load average is given beside each run that
timing depends on).

## How a fitted size reaches the frame: a ladder of slots, not one slot scaled

Two ways were open. A **ladder** bakes every rung as its own slot and draws a
fitted run through GLYPH_RUN from the rung's atlas, exactly as a run declared
at that size draws. A **scale** bakes the top rung only and draws it scaled
by `rung / max`, which is the path an axis-aligned `scale` already takes in
`emit_text` (one glyph-page TEX_QUAD per glyph). Both were measured with what
the tree draws today — text declared at each rung, and text declared at the
top rung under `scale-N` — so the numbers are what each option would have
drawn. `baselines/text-fit/ladder-vs-scale.ts` is the script;
`runs/ladder-vs-scale*.json` and `runs/pixels-*.png` are its output.

**Build cost of a ladder** (Noto Sans SC Bold; one `Text` per rung; median
of three builds; load 12-14):

| charset | rungs | sizes | pak bytes | build CPU |
| --- | ---: | --- | ---: | ---: |
| ASCII and 9 Latin-1 / punctuation characters | 1 | 88 | 1,186,992 | 1.29 s |
| Latin | 5 | 88 76 64 56 48 | 3,474,640 | 1.78 s |
| Latin | 8 | `[48..88]` | 5,206,960 | 1.64 s |
| ASCII and 1,000 CJK ideographs | 1 | 88 | 12,813,232 | 2.24 s |
| 1,000 CJK ideographs | 5 | 88 76 64 56 48 | 37,311,168 | 3.67 s |
| 1,000 CJK ideographs | 8 | `[48..88]` | 55,944,720 | 5.04 s |

The baker bakes every collected character into every slot, so a ladder's
pak grows with rungs times charset; CPU grows less, because the outline
parse is shared.

**Pixels of the scale** against a native bake, glyph by glyph (`a g W e 8
@ 价 格 東`, ink boxes aligned at their top-left corners), and a 27-glyph
run's ink width:

| rung | scale | mean abs coverage difference | worst glyph | ink size differs by | run ink width, ladder / scale |
| ---: | ---: | ---: | ---: | ---: | --- |
| 76 | 0.8636 | 14.91 | 29.58 | 4 px | 1114 / 1110 |
| 64 | 0.7273 | 9.68 | 24.54 | 2 px | 939 / 935 |
| 56 | 0.6364 | 19.05 | 29.14 | 2 px | 819 / 818 |
| 48 | 0.5455 | 21.01 | 32.13 | 2 px | 703 / 701 |

(Coverage levels out of 255, averaged over the union of the two ink boxes.)

**Render cost** of 40 runs of 27 glyphs at the four rungs, CPU per frame from
`trace --no-reuse` (61 frames less 1, over 60; five runs; load 13-14):

| | CPU per frame, median | samples |
| --- | ---: | --- |
| ladder (GLYPH_RUN) | 10.28 ms | 7.77 9.34 10.28 10.38 11.21 |
| scale (glyph-page TEX_QUAD) | 92.31 ms | 83.81 87.25 92.31 94.36 96.24 |

**The ladder was taken.** The scale costs nine times the frame and draws
other pixels than a run declared at the size; the ladder costs atlases at
build time and draws the bytes a declared run draws, which
`tests/text-fit.test.ts` holds pixel for pixel on `compositions/text-fit`'s
twins. The cost is the author's to choose, rung by rung: `text-fit-[a,b,c]`
names the rungs, and a range is refused past eight.

## The guards, watched red

Every guard in the patch and the host was seen red under the edit it names.
`baselines/text-fit/redcheck.py` (core, `cargo test --offline`) and
`baselines/text-fit/redcheck-ts.ts` (host) make the edit, run the test and
restore the file; `runs/redcheck-core.txt` and `runs/redcheck-host.txt` are
their output — 12 of 12 and 11 of 11 RED.

## The batch-QA card, fitted by layout

`docs/batch-qa-prototype.md` ran one product card over 1,000 generated rows
with every field fitted by its generator before the build, and found 83
variants with a box pushed out of its container by a long name, price or
disclaimer. The same rows were run twice on this tree, side by side, three
variants at a time (dropped to two after 30 s above load 30; load 30-110,
ending at 9):

```bash
# not run: 45 minutes each — the runs this section reports
bun scripts/batch-qa.ts --out dist/batch-qa/run-gen --jobs 3 --max-load 30 --evidence 0 --encode-every 0
bun scripts/batch-qa.ts --out dist/batch-qa/run-eng --jobs 3 --max-load 30 --evidence 0 --encode-every 0 --fit engine
bun baselines/text-fit/batch-compare.ts dist/batch-qa/run-gen dist/batch-qa/run-eng
```

The first is the prototype's card unchanged. The second is the same card
(`appSourceEngine`, `scripts/batch-qa/template.ts`) with the generator's
ladders as `text-fit-[..]`, its line budgets as box heights (`max-h-*`: two
lines of the name's 88 px, three of the claim's 40) and clamps (three name
lines and four claim lines, what each box holds at its smallest rung; four
disclaimer lines, what the legal strip holds), and the generator's break
opportunities written into the text as U+200B (`markBreaks`). Geometry,
motion, sidecar and the judging rule (`judge`, `variant.ts`: six layout
codes and every assertion gated, `text_truncated` not) are the same, so a
row's two verdicts differ only in where its fit was decided.
`runs/batch-compare.json` is the comparison.

**The generator's card reproduced the prototype exactly**: 777 pass, 128
fail, 95 refused, and the same 83 rows with a box out of its container.

| | pass | fail | refused |
| --- | ---: | ---: | ---: |
| fitted by the generator | 777 | 128 | 95 |
| fitted by layout | 821 | 84 | 95 |

**The 83 rows whose box left its container**, with the fit in layout:

| outcome | rows |
| --- | ---: |
| the box stays inside, and `text_truncated` says what was left out | **44** — 20 names, 24 disclaimers |
| still out of its container | **39** — every one a price |
| inside, with nothing reported | 0 |

- **The 44 are no longer geometry failures, and none of them is silent.** A
  name too long for its box at 48 px is clamped to three lines with an
  ellipsis; a disclaimer longer than its strip is clamped to four. The 24
  disclaimers are the rows whose `insideBox` assertion failed — they now
  pass it, and the legal copy they lost is a finding a platform can refuse
  on: the judging rule here does not gate `text_truncated`, and a delivery
  rule for legal text should.
- **The 39 prices are the template's declaration working as written.** A
  price is one line or a different price, so it is not wrapped or clamped;
  at the ladder's 52 px floor it is still wider than the badge's room, the
  badge grows with it, and `escaped_container` reports it as before. It is
  not `text_truncated`: its box grows to hold the whole run, so a rung held
  that box. Only a template change (a lower floor, a wider badge, a refusal
  in the platform) makes these rows pass.
- **No row that passed with the generator fails with layout.** 44 rows
  changed verdict, all of them from fail to pass.

**What the hard box costs.** The generator's name budget was advisory: it
picked the largest size whose block fit two lines of 88 px, and when none
did it drew the smallest anyway, letting the box grow into whatever room
the card had. Layout's card makes the budget a box, so a name that needs
more than three lines at 48 px is clamped. `text_truncated` fires on 179
rendered rows — 155 names, 16 claims, 24 disclaimers — and **135 of the
names are rows the generator's card passed with the name drawn whole**,
over three to six lines (60 of them the generator itself predicted would
not fit). Every one is reported; none is silent; but they are text the
first card showed and the second does not. A template that wants long names
to take spare room bounds them by that room, which the generator could not
see and a flex column can.

**Words cut between letters**: 85 rows with the generator (a cut in 85
names and 58 claims), 78 with layout (78 names, 16 claims, every one of
those 16 in a row whose name was cut too). Layout cuts a word only at the
smallest rung, after every larger rung was tried without one; the
generator's `wrapLines` cut by grapheme at whatever size it settled on.
Every one is a German row (73) or a duplicate of one (5): a compound of
four to eight stems wider than the 992 px column at 48 px. No gate reads a
cut, and `fit.split` is where it is counted.

**Sizes taken**, name field, rendered rows:

| px | 88 | 76 | 64 | 56 | 48 |
| --- | ---: | ---: | ---: | ---: | ---: |
| generator | 631 | 33 | 20 | 117 | 104 |
| layout | 617 | 33 | 20 | 51 | 170 |

(14 rendered rows have an empty name, which takes no box and no record.)

**Cost per rendered variant**, medians:

| | pak | build wall | fit step | variant CPU | peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| generator | 2.26 MB | 1.30 s | 50 ms | 5.10 s | 618 MB |
| layout | 5.02 MB | 1.40 s | 17 ms | 5.37 s | 684 MB |

The pak is 2.2 times larger because every rung of every ladder is baked —
twelve slots against the four the generator's card named — and that is the
cost the ladder was chosen with. The fit step is a cmap read instead of a
measurer boot. Refusals are the same 95 rows, found by the cmap read in
17 ms instead of the measurer's 50.
