---
name: pocket-motion
description: Write, build and verify a deterministic video composition with PocketJS Motion — JSX plus a Tailwind subset rendered to byte-identical frames with no browser, no headless Chrome and no screenshot loop. Use when authoring or changing a composition under compositions/, when a render has to reproduce exactly, or when a caption, title card, lower third, chart or footage cut needs to be checked without looking at it.
---

# PocketJS Motion

A composition is a small PocketJS app — JSX components styled with a Tailwind
subset — rendered to MP4 by a `no_std` Rust core compiled to wasm. The same
input produces byte-identical frames on any machine, and every command answers
one assertable question with `--json`.

`AUTHORING.md` is the full document. This is what an agent needs to hold at
once. When the two disagree, `AUTHORING.md` is right and this file is stale —
say so rather than working around it.

## The contract

A composition is a directory under `compositions/`:

```
compositions/<name>/
├─ main.tsx            entry: mounts the app
├─ app.tsx             the component tree (often written by gen.ts)
├─ pocket.json         upstream manifest: id, entry, viewport
├─ pocket-motion.json  the sidecar: durationFrames, fps, supersample, …
├─ pocket.config.ts    optional: named keyframes and animations
└─ gen.ts              optional: the build step that writes app.tsx
```

**Mount once. Nothing runs per frame.** There are no per-frame callbacks, no
timers, no effects, and no signals that change after mount. The guest realm
refuses `Date`, `Math.random`, `Intl` and locale formatting outright: touching
one throws with the alternative named. `lint` and `check` are what enforce it.

**Mount-only is not "no data-driven timing".** It means timing is decided
BEFORE the build. A beat grid, a transcript with word-level timestamps, a data
series, a per-item stagger — all of them are numbers your `gen.ts` turns into
animation delays. What cannot exist is timing that only becomes known while the
frames are being produced.

**Three node types**: `View`, `Text`, `Image` from
`@pocketjs/framework/components`. Styling is a Tailwind subset — flex layout,
size, inset, gap, padding, `bg-*`, four-direction linear gradients, `rounded`,
`opacity`, `border`, `shadow`, 2D/3D transforms, and an arc primitive.
Arbitrary values use brackets: `w-[880px]`, `text-[38px]`. The authoritative
list is the compiler, `vendor/pocketjs/framework/compiler/tailwind.ts`; check
there before assuming a familiar name is a typo.

**Motion is baked timelines, not code.** Declare keyframes and named animations
in `pocket.config.ts`, then reference them as `animate-<name>` in a class
literal. Class strings must be static literals — the compiler reads them at
build time. A misspelt `animate-*` written as the whole value of a `class=`
attribute is a build error listing the names that exist; one assembled out of
pieces (`"animate-lid-" + which()`) carries no evidence and is silently
dropped, so write whole literals.

**A window has a shape.** `overflow-mask` clips a node's children and its own
ground to its outline (rounded corners, rotation) where `overflow-hidden`
clips to the box: a growing circle, a diagonal wipe, a rounded card. Write the
radius in px on an animated window, spell a negative angle as 360 minus it,
and keep a scene still inside a rotated window by rotating it back about the
same `origin-*` point. `compositions/masked` is the worked example. It is this
repository's op, not upstream's: keep to `overflow-hidden` where a composition
must stay portable.

**Timing is quantised twice.** A duration in ms bakes to whole frames at 60 Hz,
and the render then samples every `60 / fps`-th tick. At 30 fps only even ticks
are observed, so 45/90/135/180 ms land on frames 4/6/8/12 — gaps of 2, 2, 4
where four equal ones were written. Write times that are whole rendered frames
when the spacing carries meaning, and run `keyframes` to see which declared
instants the render never samples.

**Text does not wrap or shrink.** A `Text` run breaks only on an explicit `\n`,
and text wider than its box draws past it or is clipped by an
`overflow-hidden` ancestor. Multi-line and fitted text is decided before
`app.tsx` exists, by measuring with the renderer's own advance tables
(`src/text/measure.ts`, `src/text/fit.ts`); `compositions/copy/gen.ts` is the
worked example. Every font size is baked, so only sizes that appear in class
literals get an atlas. `scale` transforms move glyphs but never resize them.

**What does not exist**: blur, masks (only `overflow-hidden` rect clipping),
blend modes, multi-stop or radial gradients, runtime media effects.

**Footage is declared once, by a generator.** `tileNodes` emits the placeholder
`Image` nodes and `footageTrack` emits the sidecar entry, both derived from one
drawn width and height — including `grid`, which is therefore never typed. A
hand-written `footage:<track>/tile:<col>:<row>` name is a lint warning
(`footage.tileNamedByHand`): the addressing scheme is a protocol between the
two halves, and writing it out by hand is how the halves drift apart.

**Name what matters.** A `debugName` on a node is how it opts into the gates:
`visibility` fails only on named nodes, `layoutAllow` and `assertions[]` are
keyed by name. A caption nobody named is a caption no check is about.

## The sidecar

`pocket-motion.json`. Unknown keys are refused, every violation is reported
with a code, and defaults are materialised. `CAPABILITIES.md` is the generated
catalogue of every key and every diagnostic.

```jsonc
{
  "motion": 1,
  "durationFrames": 240,
  "fps": 30,                  // must divide 60
  "supersample": 1,           // 1 | 2 | 4
  "fonts": { "regular": "assets/fonts/NotoSansSC-Regular.otf",
             "bold":    "assets/fonts/NotoSansSC-Bold.otf" },
  "footage": [ /* host-owned tile grids */ ],
  "sound":   { /* bed, narration, dialogue, cues */ },
  "layoutAllow": [
    { "node": "wing", "allow": "overflow",
      "reason": "the cap is drawn wider than the frame it hangs on" }
  ],
  "assertions": [
    { "node": "caption", "inPicture": [0, 71] },
    { "node": "lockup",  "entersBy": 40 }
  ]
}
```

Fonts are an INPUT to the render's identity, not a preference — declare them
or the digest is one nobody else can reproduce. `layoutAllow` excuses one
`layout` finding for one named node and costs a written reason. `assertions[]`
is what the composition is FOR, checked against the picture; one predicate per
entry, from `inPicture [from,to]`, `entersBy`, `exitsBy`, `insideBox`,
`dwellFrames`, `before`.

Neither `layoutAllow` nor `assertions` can move a pixel: input identity drops
both keys, and a test proves it.

## The loop

0. **`doctor`** — is this checkout able to build and render at all? Bun,
   rustup and the wasm target, ffmpeg, `vendor/` at the pinned commit, the
   fetched assets, disk. `--json` always exits 0 and puts the verdict in `ok`,
   and every failing check carries the command that fixes it.
1. **`init`** — copy a fixture out as a starting point. `--example` is required
   when stdout is not a terminal, because there is nothing to ask.
2. **`gen`** — if the composition has a `gen.ts`, run it. It executes at build
   time and may do anything; its OUTPUT is what has to be deterministic. This
   is where measured text, beat grids and data series turn into literals.
3. **`build`** — writes the bundle, the pak, and `build.json` beside them (the
   Bun, the pinned upstream commit, every patch by sha256, the build argv).
   Every command that reads a bundle refuses one with no record beside it.
4. **`verify`** — `lint` + `check` + `keyframes` + `visibility` + `layout` +
   `assert`, in one `--json` envelope. This is the gate.
5. **`snapshot`** — PNGs at sampled frames, `--annotate` for the boxes and
   finding codes drawn over them. This is how you look, when looking helps.
6. **`render`** — the video: `--format mp4|webm|mov|png-seq`, and `--alpha`
   for the three that can carry a channel.

```bash
bun src/cli/main.ts doctor
bun src/cli/main.ts init compositions/my-card --example copy  # not run: it writes a composition into this tree, and `compositions/` in the gate's scratch tree is a symlink to the checkout; tests/init.test.ts drives it end to end
bun compositions/copy/gen.ts     # only when the composition has a generator
bun src/cli/main.ts build compositions/smoke
bun src/cli/main.ts verify compositions/smoke --samples 3
bun src/cli/main.ts snapshot compositions/smoke --out sheet/ --samples 3 --annotate
bun src/cli/main.ts render compositions/smoke --out out.mp4
bun src/cli/main.ts render compositions/smoke --out out.mov --format mov --alpha
```

Then the two ledgers, which are per-tree rather than per-composition. **A
change under `compositions/` is not verified until both have been run**: each
refuses to run unless every composition in the tree is either measured or
excused with a written reason.

```bash
bun scripts/digests.ts     # not run: minutes, and CI runs it — every composition still digests the same
bun scripts/visibility.ts  # not run: the other ledger — every composition swept for buried nodes
```

## The commands

Every one takes a composition directory and supports `--json`. None needs a
browser.

| command | the question it answers |
|---|---|
| `doctor` | can this checkout build and render at all, and what fixes each thing that cannot? |
| `init` | a new composition started from a fixture that already passes |
| `lint` | is the sidecar valid, the source mount-only, every referenced image on disk? |
| `check` | does it boot, is the realm clean, is it mount-only at runtime? |
| `build` | the bundle and pak, plus the record of what produced them |
| `keyframes` | the baked timelines: which declared instants fall between rendered frames, which one-frame steps a frame lands inside, and which properties two animations of one comma list write at once |
| `layout --at N` | where every node landed, whether it is in the picture, and the finding codes |
| `visibility` | over sampled frames: is a node you named never shown, or shown and then buried? |
| `assert` | do the sidecar's `assertions[]` hold? |
| `verify` | all of the above, one envelope |
| `snapshot` | PNGs at sampled frames, optionally annotated or cropped |
| `frame --at N` | one frame as a PNG |
| `trace` | the per-frame hash sequence, the digest, and input identity |
| `diff` | the first divergent frame between two traces |
| `render` | the video — `--format mp4\|webm\|mov\|png-seq`, `--alpha` for a channel mov/webm/png-seq can carry |
| `sound` | what sound is declared, whether each file resolves, and `--verify` that each element reached a mix |
| `preview` | a player at `/watch` and a frame debugger at `/`, serving the same bytes `frame` writes |

## `--json` conventions

- Exactly one JSON object on stdout; diagnostics always go to stderr.
- Every payload carries `ok`. Branch on that, not on the text.
- Exit codes: `0` clean, `1` the check failed, `2` the invocation was wrong.
- The write is flushed to the OS before the process exits, so a piped reader
  gets the whole object however large it is.
- Every absolute path is redacted: the checkout becomes `$REPO` and the home
  directory `$HOME`. An envelope is what gets pasted into an issue or another
  agent's context, and a path under the checkout is a fact about the repository
  while one outside it is a fact about the operator. Paths under neither —
  `/usr/local/bin/ffmpeg` — are left alone. stderr is never redacted: that is
  for a person reading a terminal, where a real path is what you paste back.
- `MOTION_RUN_ID` in the environment is echoed back as `runId` on every
  envelope, so one agent turn's `lint`, `check`, `trace` and `verify` join up.
- A command states what it EXAMINED. `check` names the frame window it used;
  `visibility` and `assert` name the sampled frames; `layout` is one frame.
  None of them claims anything about the frames it did not look at, and
  `--samples <durationFrames>` is the exact case when you need it.

## Reading a picture without looking at it

- `layout --at N` gives every node's border-box rect, whether hiding it changes
  a pixel, and seven finding codes: `text_not_painted`, `text_occluded`,
  `panel_out_of_canvas`, `escaped_container`, `content_overlap`,
  `text_box_overflow`, `clipped_text`.
- A finding is REPORTED, never failed on — a node outside its window is not
  painted, and an intended lower third does overlap the shot under it.
  `verify --strict` is what turns one into an exit code, and `layoutAllow` is
  what turns one off.
- Rects are captured before the opacity cull, so a rect is not proof anything
  is on screen. `inPicture` is the proof, and `visibility` sweeps it.
- `snapshot --annotate` draws those boxes over a copy of the frame, host-side.
  The un-annotated PNG is the same bytes `frame --at N` writes.

## What this deliberately does not do

Each of these is a decision with a reason, not a gap to fill.

- **No browser anywhere in the render path.** A preview that renders in a
  browser cannot claim its pixels are the delivery's; here `preview` serves the
  bytes `frame` writes.
- **No runtime blur, masks, blend modes or shader transitions.** They are
  outside the vocabulary and outside what reproduces byte for byte.
- **No per-frame guest code.** Motion is baked timelines, so a frame costs no
  JavaScript.
- **No media supply.** No stock library, no TTS, no background removal, no
  colour grading service. Those are vendor dependencies and have nothing to do
  with the determinism contract.
- **No cloud rendering, no hosted player, no editor.** Reading and looking are
  `preview`'s job; the product that writes is a layer above this one.
- **Sound is outside input identity by construction.** Audio is a separate mux
  pass and the frame hash never opens an audio file. The schema buys static
  checks — declared, resolvable, correctly placed — and not digest coverage.
- **A missing still picture is refused rather than substituted.** Upstream's
  build bakes a checkerboard and succeeds; `lint` and `check` say no.
