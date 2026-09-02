# Three products read this repository, 2026-08-14

This project's own reading loop manufactures its evidence: fictional clients,
briefs written blind, readers who have never seen the code. That is the right
way to measure whether the contract surface teaches itself, and it has a blind
spot it cannot see from the inside — **whoever sets the exercise picks the
genres**, so a capability nobody's brief asks for stays untested however many
times the loop runs.

Then three real products evaluated this repository as a possible renderer,
independently, and counted their own code while doing it. Two are the same
codebase family (a HyperFrames-based video program, and a second video
product); the third is a second reading of product 2. None of
them was asked for a feature list. All three produced one anyway, and the
three lists agree.

**Their verdicts are not recorded here as findings about this repository.**
All three concluded "do not switch", all three for the same reason — the
rewrite cost of their own composition layer dominates everything else — and
that is a correct product decision that says nothing about the substrate. One
of them put it exactly right: switching is not adopting a smaller base, it is
adopting a smaller base and then rebuilding the layer above it, because
`README.md` says in as many words that the layer above is deliberately not
here. The boundary was read correctly. That is the documentation working.

What is recorded here is the part that loop could not generate.

## The census

Usage counts from their own composition code, not opinions about what a
renderer should have:

| capability | product 1 | product 2 | this repository |
| --- | --- | --- | --- |
| `text-shadow` / text stroke | 10 uses | textfx stroke + shadow | ✗ box shadow only |
| `filter:` / `drop-shadow` | 9 uses | — | ✗ |
| multi-stop or non-axis gradients | 7 uses | used | ⚠ 4 directions, 2 stops |
| `blur()` | 1 use | **the PIP ground is the blurred source** | ✗ |
| mask / `clipPath` | — | face-follow, telescope, keying | ⚠ rect `overflow-hidden` only |
| blend modes | — | textfx | ✗ alpha only |
| `<svg>` charts | 2 (radar) | — | ⚠ build-time bake to a bitmap |
| minification beyond 2× | — | **1080p speaker into a ~320 px PIP** | ⚠ bilinear is exact to 2× |

Every row has a workaround and all three said so; hard-edged text shadows are
two draws of the same string, a radar chart bakes to a bitmap. So this is
**demand evidence, not requirement evidence**. What it is not is speculation:
each row is a count from code that ships.

Set against that loop's own result — **zero** blend / blur / mask triggers in
any exercise it has run — the two are not in conflict. Every brief so far has
been type on a ground. The trigger never fired because the genre never
changed.

## What the census changes

### The mip trigger fired, in a shape this plan did not predict

Mip filtering was scoped narrowly: *a single shot whose zoom range exceeds 4×
and cannot be split into two ingests*. The assumption inside that sentence is
that extreme minification arrives through a **zoom**.

Product 2 puts a 1080p talking head into a ~320 px picture-in-picture. That is
3.4× minification, **steady**, for the length of the shot, with nothing to
split. `baselines/phase4-minification.md` measured where bilinear stops:
2× exactly, because a 2×2 footprint covers the source area once at 2× and
misses most of it beyond.

So the condition is not "zoom range", it is **standing scale factor**, and PIP
is the case that produces it. Recorded as a correction to the trigger, not as
a decision to build.

### Two readers misread mount-only the same way

Both readings of product 2 treated word-level caption timing — entrances driven by
ASR word timestamps — as incompatible with mount-only. It is not: ASR runs
before the render, so word timestamps are a build-time input and bake into
delays exactly like every other time in a composition. One of the two reviews
worked this out and still listed it as a conflict.

Two independent readers tripping in the same place is a documentation defect,
not a misunderstanding. The constraint is **not** "no data-driven timing"; it
is **timing must be decided before the build**. `AUTHORING.md` said what does
not exist and never said that.

### A read-only reader sees a failing test

One review evaluated without running `bun install` or `bun run vendor`, and
reported: 219 tests pass, one fails, typecheck cannot run. The failing test
does name its own fix (`vendor pocketjs missing at … — run bun
scripts/vendor.ts`), so nothing was silent — but a red test among two hundred
reads as *this project has a broken test*, not as *you skipped a setup step*.
The failure is loud in the wrong place: it belongs before the suite runs, not
inside it.

## What is deliberately not taken from this

Product 2 needs multi-track video, human keying, in-browser scrubbing and a
final DOM repair pass. That is a compositing editor, not a motion-graphics
renderer, and the overlap that matters is the effect primitives, not the
editing model. Chasing the editing model turns this into a worse product 2.

Their performance extrapolations are also their own, and one review says so
plainly: the numbers on both sides measure different content, which
`baselines/hyperframes-m4.md` already states about itself.

## The sentence worth keeping

> Don't take its renderer. Take its constraints.

All three landed in the same place: the transferable asset is the contract and
the build-time typography, not the runtime. Two named `src/text/fit.ts` and
`src/text/measure.ts` specifically, and one proposed rebuilding build-time
wrapping on its own stack from them — *measure with the engine that draws* was
the phrase.

That is the strongest external validation this project has had, and it is also a
warning worth writing down: **if the most valuable export is the idea rather
than the artefact, adoption stays at zero and the project remains a
demonstration of itself.** Three serious evaluations, three decisions not to
adopt, all for reasons that no amount of engineering here would change. That
is a product question, and it is now an informed one.
