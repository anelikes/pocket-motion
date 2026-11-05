# Agent adoption eval: ten requests, two runs

An agent working on another project declined pocket-motion, citing its SVG
animation, missing mipmaps and motion blur, large text, silent unknown
classes, segment rendering, colour filters and transform origin. Several of
those have shipped since. This measures what is left, from an agent's side:
ten motion-graphics requests of the kind such an agent would build in HTML and
GSAP, each handed to a fresh agent with this repository and
`skills/pocket-motion/SKILL.md` and nothing else, each checked against an
acceptance the agent never saw, the whole suite run twice.

The suite and its runner are [`evals/agent-tasks/`](../evals/agent-tasks/);
its README says how to run it again. Measured 2026-11-06 on main at
`d9ba1a2` (patches through 0055; colour filters, PR #24, and mipmaps, PR #25,
not merged), with Claude Opus 5.5 agents.

## Answer

**Every run delivered and every delivery passed its acceptance: 20 of 20.**
Acceptance is not where pocket-motion loses agents. It loses them on the way:
a run took 30 to 117 tool calls (median 56.5), 54 % of them reading
documents and source rather than running anything, and 17 of 20 runs opened the vendored engine's source to find out something no document
said — the class compiler (`tailwind.ts`) and the animation compiler
(`animation.ts`) most of all.

**Three requests were met only by building around a missing capability,** in
both runs:

| request | what was missing | what the agent built instead |
|---|---|---|
| kinetic typography, a 340 px hero word | a face bakes up to its 255 px cell (210 px of Inter) | the face's glyph outlines as `<Path>`s, from opentype.js in a `gen.ts` — with its own GPOS kerning reader in one run, because opentype.js reads none of Inter's |
| image wall with fine texture, pushing in | mipmaps or any prefilter for a still; upright pictures placed on whole pixels | a Lanczos resample in `gen.ts`, and a cover for the seams the pixel snapping opens: 12 full-wall textures in one run, a full-wall plate under the tiles in the other |
| colour-graded slideshow | colour filters (`saturate`, `grayscale`) | the grade baked into the stills by `gen.ts`, the move to black and white a cross-fade between two baked copies |

Each workaround is something a GSAP author does not write: a font reader, a
resampler, a colour matrix. The agents' versions pass their acceptance; the
number that would move is how many of the ten requests need one. Two more
requests needed a smaller one in both runs — the logo's `<style>` sheet
flattened by hand, the icons' SVGs parsed into `d` strings — and the friction
below is what every run paid on top.

## What was measured

Each task (`evals/agent-tasks/tasks/<NN-name>/`) is a brief, inputs generated
locally (SVGs written as Illustrator and Figma export them, JSON, seeded
procedural photos with a one-pixel fabric panel) and an acceptance:

- **`assertions[]`** written over the delivered sidecar for one `assert`:
  the order and timing the brief states, read from the picture.
- **Observable criteria** read off `layout` and the frames: the draw-on is
  progressive and not a fade, the morph changes the outline and is not a
  cross-fade, the chart's lines go through the data on one linear axis, the
  hero word's edges ramp over at most two pixels, the wall's fabric panel has
  no moiré, the grade is 60 % saturation and the last frame is grey, the packet
  turns along its path.
- **`verify`** passes, as the repository's own gate.
- **The delivered video** has the canvas, the frame count and (for the
  captions overlay) an alpha channel.

Each run had its own `git clone` of `d9ba1a2` outside this checkout, with the
suite removed from it, and the brief as its only task-specific text. What an
agent did is read from its Claude Code transcript: wall time, tool calls,
which calls only read, which files they read, every CLI diagnostic its
commands printed, and its own final report of where it got stuck.

**The checks were checked.** Two acceptances were held against reference
compositions written for the purpose (logo, icon morph: 10 of 10 each), and
negative controls were run where a criterion could pass the wrong film — a
fade in place of a draw-on fails `draw-on-progressive`, a hero word baked at
176 px and scaled 2.4× fails `hero-crisp` (edge ramps 3 px against 1 px at
native size), a packet with `rotate: false` fails `packet-turns` (8° against
114°). Five criteria were wrong and were changed: four failed correct films
in the first run — frames of a supersampled film were read at the
supersampled size; the chart's line was read together with a legend and
labels drawn in its colour; a turning packet was read from its node's box,
which stays square at every angle; the Ken Burns zoom was read from a rect,
which `layout` clamps to the canvas — and one asked more than its brief: it
required the packet in sight inside the Process box, and the second run drew
it under the box. Each was confirmed on the frames before it was changed, and
all 20 runs were checked again under the final criteria.

**Conditions.** The first five runs went up to three at a time; the machine's
1-minute load then rose to 100–570 from other work (simulators, Chrome, other
sessions), and the rest ran one at a time, each started only with at least
20 % of memory free. Wall times are recorded with the load at launch and are
readings of the machine as much as of the agent; nothing below compares them.

## Per task

Both runs of every task were accepted. "Calls" is tool calls in each run,
"reading" the share of them that only read; "built around" is what an agent
wrote because the vocabulary could not say the brief.

| task | accepted | calls (r1, r2) | reading | built around |
|---|---|---|---:|---|
| 01 logo draw-on from an SVG | 2/2 | 57, 51 | 54 % | the `<style>` sheet flattened by hand, both runs |
| 02 icon morph | 2/2 | 40, 49 | 57 % | the SVGs parsed into `d` literals, both runs; r1 also paired the keys by hand |
| 03 line chart from JSON | 2/2 | 53, 60 | 46 % | — |
| 04 leaderboard from JSON | 2/2 | 57, 61 | 55 % | — |
| 05 lower third | 2/2 | 68, 37 | 55 % | r2 had its generator write `pocket.config.ts` so the wipe ends at the measured width; r1 sized the bar by layout and wiped it with a scale |
| 06 kinetic type, 340 px hero | 2/2 | 68, 76 | 61 % | **glyph outlines as `<Path>`s, both runs** |
| 07 image wall push-in | 2/2 | 117, 98 | 54 % | **a band-limiting resample in `gen.ts` and a fix for the seams, both runs** |
| 08 captions from word timestamps | 2/2 | 35, 30 | 51 % | — (the captions template) |
| 09 dashed connector, packet on a path | 2/2 | 51, 56 | 41 % | — |
| 10 colour-graded slideshow | 2/2 | 45, 59 | 61 % | **the grade baked into the stills, both runs** |

The captions request, which the repository has a template for, cost the
fewest calls in both runs (35 and 30); the image wall, which met two gaps at
once, the most (117 and 98).

Every run, as `run.ts report` prints it with the reading columns added.
Wall time was taken under the load beside it and is not compared with
anything.

| run | task | criteria | wall | load at launch | calls | reading | engine files read | friction lines |
|---|---|---|---:|---:|---:|---:|---:|---:|
| r1 | 01 logo | 10/10 | 10 min | 12.6 | 57 | 32 | 4 | 7 |
| r1 | 02 icon | 10/10 | 9 min | 12.6 | 40 | 22 | 2 | 4 |
| r1 | 03 chart | 11/11 | 12 min | 12.6 | 53 | 24 | 2 | 7 |
| r1 | 04 leaderboard | 9/9 | 29 min | 18.1 | 57 | 30 | 3 | 4 |
| r1 | 05 lower third | 10/10 | 22 min | 14 | 68 | 37 | 4 | 8 |
| r1 | 06 kinetic hero | 9/9 | 16 min | 384 | 68 | 43 | 4 | 7 |
| r1 | 07 photo wall | 12/12 | 39 min | 40 | 117 | 59 | 5 | 9 |
| r1 | 08 captions | 6/6 | 6 min | 10.2 | 35 | 18 | 0 | 3 |
| r1 | 09 diagram | 11/11 | 15 min | 10.9 | 51 | 31 | 2 | 9 |
| r1 | 10 slideshow | 11/11 | 11 min | 4.9 | 45 | 30 | 5 | 7 |
| r2 | 01 logo | 10/10 | 8 min | 4.4 | 51 | 26 | 2 | 9 |
| r2 | 02 icon | 10/10 | 7 min | 2.9 | 49 | 29 | 5 | 4 |
| r2 | 03 chart | 11/11 | 13 min | 4.3 | 60 | 28 | 1 | 6 |
| r2 | 04 leaderboard | 9/9 | 12 min | 3.3 | 61 | 35 | 2 | 6 |
| r2 | 05 lower third | 10/10 | 7 min | 7.3 | 37 | 21 | 1 | 6 |
| r2 | 06 kinetic hero | 9/9 | 17 min | 8 | 76 | 45 | 3 | 8 |
| r2 | 07 photo wall | 12/12 | 43 min | 11.7 | 98 | 58 | 5 | 9 |
| r2 | 08 captions | 5/5 | 6 min | 5.8 | 30 | 15 | 0 | 7 |
| r2 | 09 diagram | 11/11 | 16 min | 6.9 | 56 | 13 | 0 | 5 |
| r2 | 10 slideshow | 11/11 | 13 min | 3.3 | 59 | 33 | 7 | 9 |

r2's captions run delivered a `render --spec` job rather than a composition,
so its acceptance is the job's own render and assertions and has no `verify`
row; r1 kept the job as a composition and was checked like the others.

## Friction

Every place an agent got stuck, hit a refusal or worked around something,
from its report and checked against its transcript, merged across runs and
classified by what would have to change. "Runs" counts the 20 runs that hit
it. Items marked **fixed** are in this change, each with the test that holds
it where one applies.

Kinds: **capability** — the vocabulary cannot say it; **docs** — it can, and
no document says how, or one says it wrong; **message** — a refusal or a
reading that sends the reader the wrong way; **ergonomics** — it works and
costs more than it should.

| friction | kind | runs | here |
|---|---|---:|---|
| a node hidden by its own timing reads `text_not_painted` at sampled layout frames; quieting it for `--strict` takes one `layoutAllow` per node, with no frame window, and the `occlusion` scope also excuses a burial | ergonomics | 13 | **documented** what quieting it costs (SKILL.md); a scope with a frame window is not built |
| `<command> --help` printed the whole help, not the command's flags (11 runs asked, by their transcripts; 8 said so) | ergonomics | 11 | **fixed**: the command's header line and the flags its parser takes (`tests/cli.test.ts`) |
| a drop shadow or a `glow-*` layer is counted as a text node's ink, so `text_box_overflow` fires on correct type | message | 6 | not fixed |
| `*.png` is gitignored, so a composition's own pictures are untracked, and `build` runs no generator | docs | 6 | **documented** (AUTHORING.md, "Still pictures") |
| times are milliseconds only and there is no `steps()`: frame-exact cuts are thirds of a millisecond or fractional keyframe percentages | ergonomics | 5 | not fixed |
| a slide-in moves a node out of its parent's box: `escaped_container`, a failing `insideBox` | docs | 4 | **documented**: boxes are read after transforms (SKILL.md, AUTHORING.md) |
| no assertion says a node is not yet shown before frame N | capability | 4 | not fixed |
| `verify` and `assert` take 7–10 minutes on a supersampled or shuttered 8 s film | ergonomics | 4 | not fixed |
| no document names a PNG reader for a generator (`tools/png.ts`'s `decodePNG`) | docs | 3 | **documented** |
| two abutting tiles at a fractional scale, or a `<Path class="inset-0">` beside a label, read `content_overlap`; no allowance covers a group | ergonomics | 3 | not fixed |
| the bake ceiling (255 px cell: 176 px Noto Sans SC, 210 Inter, 217 HarmonyOS) is in AGENTS.md only | docs | 2 | **documented** (SKILL.md, AUTHORING.md) |
| the bake refusal advises a larger logical viewport, which on a film is a larger frame | message | 2 | **fixed**: the build's last line gives the ceiling and the outline route (`tests/cli.test.ts`, red without it) |
| type past the ceiling has no helper: opentype.js outlines by hand, `src/text/outline.ts` throws on Inter, opentype.js reads no kerning from Inter's GPOS | capability | 2 | **documented** which faces read; the helper is not built |
| colour filters: no `saturate`, `grayscale` | capability | 2 | not here (PR #24) |
| no mip chain or prefilter for a still; AUTHORING.md said `linear` filtered correctly to 2× | capability, docs | 2 | **documented** what `linear` is; mipmaps are PR #25 |
| an upright picture lands on whole logical pixels, so a moving grid opens one-pixel seams; `supersample` does not refine it | capability, docs | 2 | **documented**; not fixed |
| Illustrator's default SVG export is a `<style>` sheet, which `<Svg>` refuses | capability, docs | 2 | **documented** the export setting; class selectors are not read |
| an empty `<Svg>` canvas (every part trimmed to nothing) reads `covered`, because its clip is in the draw list | message | 2 | not fixed |
| `<Svg src>` cannot supply morph keys; both runs parsed the SVGs into `d` literals by hand | capability | 2 | not fixed |
| keyframe values are literals: a bar cannot animate to its text's measured width without a generator writing `pocket.config.ts` | capability | 2 | not fixed |
| no `tracking-[Npx]`; tracking is added after the last glyph, so centred text sits half a step left (read in `text.rs` by one run, not measured here) | capability | 2 | not fixed |
| `trace --json` carried no `ok`, though SKILL.md says every payload does | message | 2 | **fixed** for every command (`tests/emit.test.ts`) |
| AUTHORING.md said a `d` shared with `pocket.config.ts` must be written twice, which `patches/0054` made untrue | docs | 2 | **fixed** |
| a captions job kept as a composition (`gen.ts --spec --out-dir`) is in no document | docs | 2 | **documented** (SKILL.md) |
| a captions job's transcript must be a file in the repository, and `render --spec` takes no `--samples` | ergonomics | 2 | not fixed (the brief's two-file rule made the first one bite) |
| a 1→2 subpath morph equalises lopsided (one bar grows from a point); equal-area subpaths pair by their last bits, not written order | capability, docs | 2 | **documented** how commands normalise and that areas compare exactly |
| `frame` and `snapshot` write the supersampled picture | docs | 1 | **documented** (SKILL.md) |
| `insideBox` reads the nearest ancestor only; text inside a sibling plate cannot be asserted | capability | 1 | not fixed |
| caption styles: the highlight's open and close times are fixed, no outline or shadow | capability | 1 | not fixed |
| a Noto Sans SC line box is tall for Latin, so mixed rows sit low | capability | 1 | not fixed |
| `render` has no CRF option | ergonomics | 1 | not fixed |

Seventeen of 20 runs opened the vendored engine's source: the class compiler
(`tailwind.ts`) in 14 and the animation compiler (`animation.ts`) in 11.
SKILL.md sends readers to the first as the authoritative list; what they were
looking for — which utilities take arbitrary values, the keyframe and easing
grammar, which properties animate — has no compact reference, and writing
one is larger than this change.

## Capability gaps, by requests they blocked

A gap blocks a request when no run met the brief without building around
it. Each of these blocked its request in both runs; the photo wall met two.

| gap | request blocked | runs | what the agents built | where it stands |
|---|---|---:|---|---|
| colour filters (`saturate`, `grayscale`, animatable) | graded slideshow | 2/2 | the grade baked into each still by `gen.ts`, the move to black and white as a cross-fade between two baked copies | PR #24 |
| filtered minification of stills (mipmaps or a prefilter) | photo wall | 2/2 | a Lanczos resample in `gen.ts`, with a sine series in place of `Math.sin` so the pak's bytes do not depend on the host | PR #25 |
| sub-pixel placement of upright pictures | photo wall | 2/2 | 12 full-wall textures, alpha outside each cell (100 MB pak, 0.5 s a frame), or a full-wall plate under the tiles | not started |
| display type past the bake ceiling | kinetic hero | 2/2 | glyph outlines from opentype.js as `<Path>`s, kerning read by hand from GPOS in one run | in progress elsewhere, not merged |
| CSS classes in an SVG import | logo draw-on | 2/2 | the `<style>` sheet written onto the shapes by hand | not started |
| morph keys from SVG files | icon morph | 2/2 | the SVGs parsed into `d` literals in `gen.ts`, rects rewritten as paths | not started |

These did not stop a delivery and did stop the agents saying what the film
is for, or made them write more than the request needed:

| gap | requests | runs |
|---|---|---:|
| an assertion that a node is not shown before frame N | chart, photo wall, logo | 4 |
| frame units and stepped easing in the animation shorthand | slideshow, kinetic hero, logo, icon morph, lower third | 5 |
| keyframe values computed from layout (a width that follows its text) | lower third | 2 |
| arbitrary letter spacing, and centred tracking | logo | 2 |
| `insideBox` against a named container, not the nearest ancestor | lower third | 1 |
| caption style timing and text outlines | captions | 1 |

## What this does not measure

- **Two runs of one model.** Ten tasks twice is enough to see which friction
  recurs and not enough to put a rate on it; one task's two runs differed in
  approach (the icon morph was hand-paired in one run and left to the
  equaliser in the other) and agreed on the friction.
- **What an agent reports is not all it hit.** Agents pipe the CLI through
  `tail`, which turns every exit code into 0, so a refusal shows in the
  transcript only as text. The transcript reader collects those lines; the
  friction table was built from both and from reading the frames.
- **The harness adds friction of its own.** 14 of 20 reports noted that a
  new composition must be added to both ledgers and that the eval's rules
  forbade it;
  that is the eval's rule, not the repository's, and is not counted. Agents
  also misread inputs once (an icon run reported its two files swapped; they
  were not).
- **Taste.** The acceptance reads timing, geometry, sharpness and colour,
  not whether a film is good. The agents added eyebrows, legends, glows and
  sweeps nobody asked for; none is scored.

## Running it again

```bash
bun evals/agent-tasks/run.ts list
```

`evals/agent-tasks/README.md` has the rest: `prepare` one checkout per task,
hand each `PROMPT.md` to a fresh agent with nothing added, `record` its
transcript, `check`, `report`. A change that closes a gap is measured by
running the tasks it should move — kinetic hero, photo wall and graded
slideshow for the three above — and comparing tool calls, reading calls and
whether the workaround is still built.
