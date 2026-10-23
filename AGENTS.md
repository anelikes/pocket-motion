# AGENTS.md

Pocket Motion renders compositions to frames deterministically, with no
browser and no decoder in the render path. `AUTHORING.md` is the author-facing
document — what a composition may contain and how to build one. This file is
the builder-facing one: the rules this repository has paid for, each stated so
it can be checked rather than remembered.

## The two invariants

Every defect worth recording here has had one of two shapes, plus a short list
that fits neither and is kept separate below. Naming them turns a review from
open-ended inspection into two questions with known answers to look for.

### In-picture means declared

**Every input that can move a pixel must be reconstructable from the
composition's declared inputs.** The declared inputs are the sidecar
(`pocket-motion.json`), the pak the build bakes, and the frozen ingest
artifacts the sidecar names. Anything else that reaches a pixel — a value a
host computes, a file a build discovers, a default a resolver supplies, a
version of a tool that happens to be installed — is undeclared, and its effect
on the output is real whether or not anyone can see it.

The test is not "does it render". It is: **given this repository at this
revision, on another machine, is the same picture derivable?** A digest that
reproduces on one machine and not another has not failed the render; it has
found an input nobody declared.

### A command claims only what it examined

**A command that passes states something about what it examined, never about
what it did not.** `check` reports realm cleanliness and op counts over the
window it names; it says nothing about whether anything is on screen. `trace`
reports that a frame sequence is stable; a stable sequence of the wrong
picture is stable. Widening what a command inspects is a feature; widening
what it *claims* without widening what it inspects is the defect found here
most often.

## What the two have caught

Each entry is a defect that actually shipped, the mechanism that answers it
now, and the file or test that holds that mechanism. Where nothing holds it,
that is said rather than implied.

- **Pixels arriving from outside the sidecar.** A render path decoded and drew
  footage by hand, so `check` and `trace` never saw the inputs that were
  moving pixels — declared. Footage is now one sidecar declaration opened in
  one place (`openFootage`, `src/cli/footage.ts`) by every command that
  produces frames. `compositions/footage-tracks` is the worked fixture and is
  in both ledgers; `tests/footage-cli.test.ts` holds the refusals and
  `tests/footage.test.ts` drives the layer against a manifest built in memory.
- **A fit that was defaulted rather than stated.** A bare `scale=W:H` squeezed
  any clip whose aspect differed from its drawn size, silently and
  reproducibly — declared. `openFootage` refuses a drift of a pixel or more
  unless the sidecar names a `fit`, and refuses before paying for the ingest
  (`tests/footage-cli.test.ts`, "aspect drift").
- **An asset that was inferred, not declared.** A still picture is discovered
  by a regex over class literals, and upstream's build bakes a 32×32
  checkerboard for a missing one and exits 0 — declared. `lint` and `check`
  refuse it (`src/lint/images.ts`), fixture `compositions/missing-image`,
  which traces green on purpose.
- **A message that enumerated a set it had not read.** The unknown-root-key
  diagnostic listed five of the six allowed keys, so the field added to make
  digests reproducible was itself undiscoverable and a typo was told the
  correct spelling did not exist — seen. `CAPABILITIES.md` is generated from
  `src/catalog/surface.ts`, and gate G5 in `tests/catalog.test.ts` fails when a
  key exists in `src/manifest/sidecar.ts` with no row behind it.
- **Document order deciding what is on screen, with every gate green.** A
  caption was painted over by later footage while `lint`, `check`, `trace` and
  `diff` all passed — seen. `layout` now says which of covered and
  invisible-by-declaration a dark node is, `visibility` sweeps that
  classification over a span and fails on a named node, and `assert` checks
  what the composition is FOR against the same reading. The predicate is
  `src/render/visibility.ts`; the fixtures are `compositions/occluded`,
  `compositions/spanned` and `compositions/layout-codes`; the gates are
  `tests/visibility.test.ts`, `tests/assert.test.ts` and `tests/cli.test.ts`.
- **Half a delivery with no declaration at all.** Music beds, gain envelopes
  and mux passes were hand-rolled per composition, and one of them probed
  guessed paths for a voice track whose absence shipped silently — declared.
  Sound is now a sidecar schema of four roles, resolved and built into a mix
  graph by `src/sound/mix.ts` and muxed by `render`;
  `compositions/sound-roles` declares one element of each and
  `tests/sound.test.ts` holds it. The four shapes that were still built by
  hand — a gain envelope, a silent tail, an element mixed only if present, a
  duck for a whole cut — are declared in the same schema now, and the entry
  for them is in the next section; what the schema still cannot say is in
  the one after.
- **Digests that no fresh build reproduced.** Recorded digests that rebuilt
  from the bundle they were taken against and from no newly built one —
  declared, because what produced the artifact was written down nowhere. Every
  build now writes `build.json` beside the bundle and a bundle without one is
  refused (`src/cli/build.ts`, `src/render/build-record.ts`); `identity`'s
  `toolchain` component hashes that record rather than the Bun this process
  happens to be running (`tests/identity.test.ts`, `tests/cli.test.ts`).
- **A verification that read windows carrying no evidence.** `sound --verify`
  reported every element of a correct mix absent, because the residual was
  measured in windows where the source was itself silent — where a muxed
  element and a missing one are indistinguishable — seen. Windows are now
  placed on voiced material and a per-window floor decides which of them carry
  evidence (`src/sound/verify.ts`, `tests/sound.test.ts`).

Four defects are **not** instances of either invariant, and forcing them in
would make both rules useless.

Two are resource or transport limits. A `FootageLayer` held a whole decoded
track resident at ~13 GiB; a layer now holds one decoded frame for its life
and `preview` allows one session at a time (`src/preview/host.ts`). And
`--json` queued past the 64 KiB pipe buffer while `process.exit` truncated it,
so any reader applying backpressure got a partial object — `applyEmit` now
waits for the flush before the process ends (`src/cli/emit.ts`,
`tests/emit.test.ts`).

The other two are hand-written prose going stale, both in `AUTHORING.md`: a
capability described before it had shipped, and a build command whose
`--outdir` named a directory nothing used. Commands in that document and in
`skills/pocket-motion/SKILL.md` are now executed by `tests/authoring.test.ts`,
and `tests/residue.test.ts` keeps a vocabulary of removed material out of the
tree. **A paragraph that merely describes a capability is still not pinned by
a test** — that hole is open, and it is the reason both documents state
mechanisms with the file or test beside them.

## What enforces them today

- `lint` checks that the sidecar is valid and the source is mount-only
  (`src/lint/mount-only.ts`); the runtime refuses `Date`, `Math.random` and
  locale formatting outright, which is what `compositions/malicious` pins.
- `check` asserts zero guest ops on **every frame of a window** — not a sample
  of it, and not the whole film either: the window is `--frames`, defaulting to
  `min(30, durationFrames)`, and the line it prints names the number it used.
  A short window is enough because the op count is only one third of the
  verdict. `after(10, …)` issues nothing for 600 frames and then mutates the
  world, so no finite window can decide it — but `totalPendingWork` sees it
  booked on frame 0, and the static mount-only lint sees its import, over every
  source in the composition rather than the entry alone. `check` fails on any
  of the three. `compositions/late-timer` is the fixture, and
  `tests/cli.test.ts` asserts that the halves catch it independently, so
  neither is load-bearing for the other.
- `scripts/digests.ts` rebuilds every listed composition through the command
  the CLI itself prints, and **refuses to run unless every composition in the
  tree is either measured or excused in `EXEMPT` with a written reason**. It
  also re-runs each generator and refuses when the committed sources differ
  from what the generator produces, which is the only thing that catches a
  hand-edit to a generated composition file — `compositions/reel`'s sidecar is
  written by `gen.ts`, so an edit made directly to it survives until the next
  generator run and then disappears. It takes the bundle and pak's mtime/size
  after the build and again after the trace, and **refuses the run when they
  moved** — a digest is a claim about the artefact this run built, and nothing
  holds `dist` exclusively: `preview` rebuilds into the same directory when a
  source changes under it, a second ledger run writes the same files, and a
  person can build by hand. The race is not prevented, because a lock would
  have to span the whole run; it is made impossible to pass silently
  (`src/cli/artefacts.ts`). A change under `compositions/` is not
  verified until this has been run.
- `trace` reports input identity (`src/render/identity.ts`) next to the frame
  digest: bundle, pak, sound-free sidecar, fonts, frozen footage, render
  parameters, and the toolchain that BUILT the artifact. A mismatch names the
  component that moved. `DELIBERATELY_ABSENT` is the list of inputs excluded
  from identity, each with a reason, checked by `tests/identity.test.ts`.
- **Every build writes `build.json` beside the bundle, and a bundle without
  one is refused.** `src/cli/build.ts` is the one place a build is spawned —
  the `build` command, `render --spec`, preview's hot reload and both ledgers
  all go through it — so nothing this repository builds is unattributable. The
  record holds the Bun, the pinned upstream commit, every `patches/*.patch` by
  sha256, and the build argv (repo-relative, so the checkout's location is not
  an input; `--hz` and `--density` are written down in it). No timestamp: a
  clock reading is not an input. `identity`'s `toolchain` component hashes
  that file rather than the Bun this process happens to be running — the
  running Bun answers "what is here now", not "what made this".

  Three things are refused rather than reported, all in
  `src/render/build-record.ts`, all in the shape `assertBakedTickRate` set: no
  readable record; a recorded Bun that is not the running one (the guest
  executes on the running one while the pak came out of the recorded one); and
  a patch set that has moved on disk since (the message names the patch). The
  message quotes `bun src/cli/main.ts build <dir>` and NOT upstream's
  `tools/build.ts`, which writes no record — printing that as the fix for a
  missing record would be a loop. `tests/cli.test.ts` holds all three.
- **A build writes inside its own `--outdir`, so builds run side by side.**
  Until upstream #591 (`586428b2`) — backported as a patch first, and on the
  pin since it moved to 66caf4e5 — pass 1 wrote `framework/src/styles.generated.ts`
  into the SHARED vendored tree and pass 2 resolved that path off disk, so two
  builds into two directories were not two independent builds. That one file
  failed in two shapes. A composition build landing between a measurement
  build's write and its read-back replaced the px -> slot table and
  `verifySlots` refused with `styles.generated.ts is not this build's` —
  still 3 of 10 overlapping pairs on the pre-#591 tree with the lock bypassed,
  measured 2026-10-22. And on a fresh tree, where the file is gitignored and
  absent, pass 2 had to find a path pass 1 had probed and missed:
  `Could not resolve: "./styles.generated.ts"` on 6 of 20 cold builds on a
  Linux CI runner and on none of 25 in local containers or any on macOS. It
  cost a cross-process build lock, a seeded placeholder and a `doctor` check.

  Pass 1 now writes `<outdir>/<output>.styles.ts`; `jsxPlugin` resolves the
  framework's `styles.generated` import itself and serves this build's table
  from memory, so pass 2 never asks the disk for it; and the framework's file
  is a committed empty table no build writes. Upstream resolves the import
  into a namespace of its own, and Bun then names the module in the bundle
  by its absolute path — the checkout's location, in every bundle.
  `patches/0023-style-table-file-namespace.patch` keeps it in the file
  namespace, where the name is repo-relative; when the backport landed on
  the old pin, all 45 compositions' bundles and paks were byte-identical
  before and after it.
  `src/text/measure.ts` and `scripts/fit-probe.ts` read the slot table from
  their own build's `main.styles.ts`. The lock, the seed and the check are
  deleted, each because its reason was measured gone: a build moves nothing in
  the vendored tree but `.cache/transforms/` entries, which are
  content-addressed and read as a miss when torn; a build on a tree with no
  `styles.generated.ts` at all bundles its own table; and the
  measurer-beside-a-composition-build sweep that guarded the lock is 0 of 34
  red with no lock, over offsets where the two builds overlapped by up to
  670 ms. `tests/style-table.test.ts` holds the first two, the absolute-path
  property and the sweep; the first went red with the backport moved out of
  `patches/` on the old pin, the second with the `onResolve` removed — as
  `Could not resolve: "./styles.generated.ts"`, the CI failure's message, on
  every run — and the third is red on main's own namespace form, which is
  why 0023 exists. `scripts/vendor.ts` removes each file a patch creates
  before applying it, because a file the pin's `.gitignore` covers survives
  `git clean -fd` and `git apply` refuses to create a file that is already
  there.
- **The interception is a path comparison, so a miss is refused.** `jsxPlugin`
  serves the table for one path, compared as a string. Bun hands it realpaths
  on both sides, so a symlinked tree (`tests/authoring.test.ts` builds in one),
  a case-variant spelling on a case-insensitive volume and `/tmp` against
  `/private/tmp` all intercept — each was built and checked. A second FILE
  does not: a copy of `framework/src` reached by a relative path, or any module
  named `styles.generated.ts`, was bundled from disk. With the committed empty
  copy `mount` throws `unknown class ... (dynamic classes must be ternaries of
  full literals)`, a diagnosis that points elsewhere; with a stale copy — what
  the framework's file held after any build before #591 — a red class rendered
  blue and the build exited 0, as it still does on main's form. 0023 carries a
  refusal upstream does not: such a load fails the build naming both paths.
  `tests/style-table.test.ts` is red without it, and says which pixel shipped.
- Each composition builds into its own dist directory, under ONE root, keyed
  by its path relative to the repository (`src/cli/resolve.ts`). Two things
  used to go wrong here and both are now one derivation. The key was the last
  segment, so two cuts differing only above it — `nested/a/9x16` and
  `nested/b/9x16` — shared a directory, and a build of either overwrote the
  other's bundle while `trace`, which does not build, reported the wrong
  film's pixels under the right film's name. And the ROOT was a fixed
  `<dir>/../../dist`, so how deep a composition sat decided which of three
  roots it landed in — two of them inside the source tree preview watches, and
  a `--outdir` written from prose rather than copied out of the printed
  command landed in whichever one the prose described. `repoRootOf` is the
  only derivation of the repository root now, and the dist root, the sidecar's
  relative font paths and the build's cwd all come through it:

  | composition | dist directory |
  |---|---|
  | `compositions/open` | `dist/compositions/open` |
  | `compositions/nested/a/9x16` | `dist/compositions/nested/a/9x16` |

  **Any tool that walks `compositions/` must still exclude `dist` by NAME AT
  ANY DEPTH**, not as a leading segment. Nothing this CLI spawns writes there
  any more, but a tree built before the roots were merged carries
  `compositions/dist` and `compositions/<name>/dist`, and a build run by hand
  takes whatever `--outdir` it is given. `tests/cli.test.ts` pins the two dist
  paths above and `tests/preview.test.ts` pins the exclusion.
- `compositions/nested/a/9x16` and `compositions/nested/b/9x16` are the dist
  key's own red case: one `compositionId`, one basename, one dist root, two
  different pictures, both in the ledger. `tests/cli.test.ts` asserts they
  resolve to different directories AND that the pair is the shape the key
  exists for; keying dist on `basename(dir)` turns it red.
- `layout` reports `inPicture` for every node by removing it and re-rendering,
  so "is this visible" is answered in pixels rather than from a rect — the
  rect is captured before the opacity cull and proves nothing about it. The
  same `debug_hide` is read a second time against `ui_draw_hash`, which hashes
  the draw list without rasterising, and the two together say WHY a node is
  dark: it emitted geometry and none survived (covered), or it emitted none
  (invisible by declaration — the walk returns above it at `op <= 0.0`, so
  inherited opacity is included without anyone reading it).
  `src/render/visibility.ts` holds the predicate and the table.
- **Seven finding CODES sit on top of that**, in `src/render/findings.ts`, so a
  caller can branch on a name instead of parsing a sentence: `text_not_painted`
  and `text_occluded` are the two dark states renamed, and the other five are
  `panel_out_of_canvas`, `escaped_container`, `content_overlap`,
  `text_box_overflow` and `clipped_text`. The last two are measured in PIXELS,
  not from a build-time advance table: `probe()` already hides the node and
  rasterises for `inPicture`, so the bounding box of the pixels that changed —
  the node's INK — comes out of a render that was happening anyway. The advance
  table was the first design and is not reachable: resolving a node to a font
  slot means joining its class string to a style record through ids the build
  assigned, and the DevTools tree carries no style id. Two carve-outs are
  measured rather than assumed. **Containment is not a collision** — a full-bleed
  background contains the caption over it, and without that rule every named
  background produced one finding per named thing drawn on it. **Touching is not
  overlapping** — a tile grid's neighbours share an edge, and
  `footage:<track>/tile:<col>:<row>` is the commonest `debugName` anywhere.
  Measured over the tree at one frame each, 26 compositions produce 27 findings
  and every one was checked by hand and is true. **None of them fails
  anything**: `layout` exits 0 carrying all of them, `verify --strict` is what
  turns one into an exit code, and the sidecar's `layoutAllow` is what turns one
  off — a node name, one of four scopes, and a `reason` the parser refuses to
  accept blank. An excused finding stays in `--json` with the sentence attached
  as `allowedBy`, because a suppressed reading nobody can read back is worse
  than a noisy one. Fixture: `compositions/layout-codes`, one named node per
  code plus one excused; gates: `tests/catalog.test.ts` G8 (the predicate,
  against geometries copied out of that fixture) and `tests/cli.test.ts` (the
  renderer, that it still produces them).
- **`panel_out_of_canvas` is narrower than its name and the measurement is why.**
  Layout CLAMPS every box to the viewport before anything can read it: a node
  declared at `left-[2000px] w-[300px]` on a 1920-wide canvas comes back
  `1920,y 0x120`, one at `left-[-300px]` comes back `0,y 0x80`, and one 200 px
  tall starting 40 px above the bottom comes back 40 px tall. So a PARTIAL
  overhang leaves no trace in the numbers and nothing here claims one; what
  survives the clamp is the degenerate case — zero extent on one axis, sitting
  on the edge it went off — and that is exactly what the code reports. The
  first version tested "the box is not inside the viewport" and could not fire
  at all, on any composition in this tree.
- `visibility` (`src/cli/commands/visibility.ts`) sweeps that classification
  over evenly spaced frames — `--samples`, default 24, first and last
  included — and **fails on a node carrying a `debugName` in either of two
  states: it emits geometry and no sampled frame shows any of it, or a sampled
  frame shows it and a LATER one has it covered**. The second is the shape a
  caption buried by the shot after it has. The exact condition that separates
  it from a cross-fade is narrower than "an ordinary dissolve", and the fixture
  pins both halves: a dissolve whose outgoing half reaches zero **no later
  than** its incoming half turns opaque is covered at no frame at all — it
  contributes pixels for the whole overlap and then stops emitting geometry, so
  it reads on-screen and then invisible by declaration (`spanned`'s
  `crossfade`, 0 covered frames). Give that same dissolve a 1200 ms exit under
  a 400 ms entrance and its tail paints with every pixel hidden for 24 frames:
  `spanned`'s `trailing` is covered after being shown, **fails**, and the film
  is fine. That is the reading's real reach, and it is a red case in the
  fixture rather than a caveat in prose — from the picture alone nothing
  separates those 24 frames from a caption the next shot ate, and separating
  them is the join listed as missing below. The ordering is load-bearing too:
  covered BEFORE the last frame that shows it is a reveal, which passes
  (`spanned`'s `revealed`, the only one in the tree). The name is load-bearing
  and measured rather than assumed: `baselines/visibility.json` records, per
  composition, how many nodes paint and are never shown and which named ones
  fail. As it stands 21 nodes paint and are never shown and exactly 2 are
  named — `buried` in `compositions/occluded` and `buried` in
  `compositions/layout-codes`, both fixtures and both recorded as failures.
  The other 19 are `reel`'s and are correct: a text run that is one space, and
  odometer digits riding an `overflow-hidden` strip. Fixtures:
  `compositions/occluded`, where `buried` and `shown` are the same component
  differing only in document order, one red and one green;
  `compositions/late-anim`'s `unplayed` is the other side, never shown and
  correctly not failed because it emits nothing; `compositions/spanned` carries
  the burial, both dissolves and the reveal side by side.
- **What that gate actually reaches is narrower than "a named node", and a
  total hides it.** `baselines/visibility.json` carries the count per
  composition — 153 names over the tree as it stands — and reading it by
  composition is the point: 19 of them are `footage:<track>/tile:<col>:<row>`
  (15 of bound tracks, which `src/cli/footage.ts` REFUSES a track without, and
  4 that `kenburns` and `shimmer` push into), so they are a protocol rather
  than a declaration; 22 are the words the two captions samples name; the rest
  are the fixtures and the four labels `footage-tracks` draws. `reel`, the one
  composition here at film length, records **0 named of 631 nodes** and so
  cannot fail this gate at all. A buried tile is a real finding and is the
  layer the occlusion defect came from, but that defect's caption was not a
  tile. Nothing written by hand at film length names its captions; the
  captions template is the one generator that names every word it draws, so a
  caption job is the one place this gate reaches every caption whatever the
  length.
- `scripts/visibility.ts` is what keeps those numbers from being a memory. It
  sweeps every composition — swept by default, `EXEMPT` costs a written reason,
  the same coverage gate `scripts/digests.ts` uses and the same discovery rule
  — and holds three things per composition in `baselines/visibility.json`: the
  failing node NAMES, how many nodes carry a `debugName` (the gate's reach,
  which nothing else in the tree would notice shrinking), and how many paint
  and are never shown. `compositions/occluded` records `failures: ["buried"]`,
  so the fixture coming back clean fails the run — the guard's own red case is
  pinned rather than remembered. A change under `compositions/` is not verified
  until this and `scripts/digests.ts` have both been run.
- **`assertions[]` in the sidecar is what a composition is FOR, checked against
  the picture.** Every generator in this tree already asserts its own intent and
  every one of those assertions is about a NUMBER the generator computed — so a
  caption can be computed correctly, laid out correctly, painted over, and leave
  all of them true. An entry names a node's `debugName` and exactly one of
  `inPicture [from,to]`, `entersBy`, `exitsBy`, `insideBox`, `dwellFrames`,
  `before`; `assert` evaluates them from the same classification `visibility`
  sweeps, with `insideBox` reading the layout codes.
  Three lines are load-bearing. **A name the tree does not carry is a FAILURE,
  not a skip** — otherwise renaming a `debugName` turns every assertion about it
  green at once, which is the cheapest way for this to stop meaning anything.
  **Every verdict is about the sampled frames**, and the printed line names the
  grid; `--samples <durationFrames>` is the exact case. **`dwellFrames` is
  defined conservatively**: the longest run of CONSECUTIVE sampled frames
  showing the node, measured first-to-last plus one, so a run of one sample
  spans one frame however wide the stride. Red case:
  `compositions/spanned`'s `spanning` asserted `inPicture: [0, 239]` fails with
  the 17 sampled frames it is covered at; `revealed` asserted `entersBy` its
  real first frame passes and fails one sample earlier. Both are in
  `tests/assert.test.ts` against one sweep, NOT written into that fixture's
  sidecar — its `baselines/visibility.json` row is a recorded red case and a
  fixture edited for a test's convenience stops being what the other tests read.
  `identityProjection` drops the key, so no assertion can move a digest.
- **`verify` is every gate in one envelope, and each section is the
  sub-command's own JSON verbatim.** `lint`, `check` (as `realm`), `keyframes`,
  `visibility`, `layout` at sampled frames, `assert` — in that order, under
  those keys. Not a summary of each: `tests/verify.test.ts` compares them field
  by field against those commands run alone, because a re-shaped section is a
  second implementation of the gate and the second one is the one nobody tests.
  An ERROR is a section whose own verdict is false; a WARNING is an active
  layout finding, and `--strict` is what makes warnings count. `MOTION_RUN_ID`
  reaches the envelope through `applyEmit`, which does it for every `--json`
  object this CLI writes; this command reads it only for its human line, and
  under emit's own constant, so there is one spelling and one place.
  **The grids are not the same and that is deliberate**:
  `--samples` / `--at` decide the LAYOUT frames — five by default, because a
  layout frame costs a boot — while `visibility` and `assert` sweep their own
  default grid, which is exactly what makes those sections comparable to the
  standalone commands. The 64 KiB flush path is what `applyEmit` already gives
  every command, and the envelope is the largest object it carries. Two tests
  cover it and only one is a guard: the spawned one holds a 150 KB envelope to
  arriving whole through a reader that sleeps 400 ms first, and **removing the
  `await` from `applyEmit` leaves it green** — Bun 1.3.11 on darwin blocks on a
  full pipe rather than queuing. So the guard is the unit one, which fakes a
  queued write and asserts `applyEmit` does not resolve until the callback
  fires; that one goes red on the same edit.
- `snapshot` writes several frames at once, and **its un-annotated PNG is the
  same bytes `frame --at N` writes** — asserted in `tests/snapshot.test.ts`,
  the same claim `/frame` makes and made the same way. `--annotate` writes a
  SECOND file beside it with `layout`'s boxes, node names and finding codes
  drawn over the picture, host-side on a copy of the RGBA buffer
  (`src/render/annotate.ts`, a 5×7 uppercase font and an integer scale, so
  every glyph edge lands on a pixel boundary). It is never drawn through the
  composition: a debug layer inside the guest is geometry in the draw list,
  moves `ui_draw_hash` and the frame hash with it, and turns every later
  reading into a reading of a different picture — which is exactly why
  `src/render/visibility.ts` clears the inspect latch before every hash.
  The tree comes from `scratchTree`, a throwaway world, because `getTree` costs
  a frame turn and taking it on the source would move the clock the snapshot is
  a picture of. The test that holds the overlay to a copy is the ZOOM one: the
  clean PNG is written before the overlay exists, so comparing clean files
  could never catch an overlay drawn in place, and a crop taken beside one can.
- **`overflow-mask` is the first op this repository draws and upstream does
  not** (`patches/0013-mask-op.patch`, class `motion`; the design and every
  decision made against it in `patches/0013-mask-op.design.md`). A node's
  children and its own ground are clipped to its outline — the rounded
  rectangle under its transform — through MASK_PUSH/MASK_POP at 64 and 65,
  whose coverage is POLY's own: the row walk is one `PolyScan` shared by both,
  and a full-screen white RECT under a MASK_PUSH of a rotated box's POLY
  vertices is byte-identical to that POLY over 54 size/angle cases
  (`engine/core/src/tests.rs`, red with the level builder made binary). The
  outline itself is NOT rounded to pixels (`patches/0024`): MASK_PUSH carries
  f32 vertices and `PolyScan` works in sixteenths of a pixel, POLY's whole
  pixels entering it multiplied by 16, which leaves every POLY byte-identical.
  Rounded, each edge moved up to half a pixel per axis — a band of content as
  long as the window's side outside a turned window — and a square-cornered
  window at a fractional position was its rounded-OUT AABB. The guard turns a
  120 px window about its corner from -90 to +90 degrees in quarter degrees
  and fails on any pixel inked with every sample outside the outline: 21,193
  pixels at 659 of 721 angles before, none after.
  Nested masks multiply exactly, which is why the outline is clipped to the
  viewport and not to the scissor: a vertex that clipping creates rounds to a
  pixel, and against an ancestor's unrounded AABB that moved an edge by half
  a pixel. The scissor stays in place around the mask, so every guarantee
  built on it holds. Two things it does not do are stated in the design:
  glyph or image masks, and any backend but this one. `compositions/masked`
  is the fixture, in both ledgers, its sidecar asserting what each window is
  for; its `wipe-a-label` is recorded as a `visibility` failure because a
  wipe covers what it wipes, the same reading `spanned`'s trailing dissolve
  gets. `verify`, `check`, `layout` and `visibility` see the op through the
  draw list as they see a scissor; a node a mask leaves no pixel of reads as
  covered, a third cause under an existing name.
- **Motion blur is a declared shutter, evaluated and averaged in the core**
  (`patches/0034-shutter.patch`, class `motion`; the design and every number
  it rests on in `docs/shutter.design.md` and `baselines/shutter.md`). The
  sidecar's `shutter: { angle, samples }` makes every frame an exposure: the
  core re-evaluates each playing baked timeline's TRANSFORM tracks at
  `samples` instants centred on the frame's tick (`Ui::shutter_sample`, exact
  i64 fractions of a tick), rasterises each, and averages premultiplied in
  u32, rounding half up. Three properties hold it to the unblurred film and
  each is a test. A one-sample exposure is the tick by construction — the
  samples are centred — and the fixture traces equal frame for frame at
  N=1 (`tests/shutter.test.ts`). Opacity, colour and layout keep the tick
  in every sample, so a gate is never integrated and the dark-node
  classification reads the same; and no sample crosses a keyframe jump, so a
  cut is never a streak (the core's `shutter_*` tests, red under each
  one-line edit the patch header lists). Higher bake rates were measured and
  refused: they move the UNBLURRED film (175 of `transitions`' 756 frames at
  240 Hz). `BootOptions.shutter` has NO default, so every boot site states
  which exposure it renders and the type checker found all of them; the
  measurer and a tree read pass `null` and say why. A declared shutter on a
  core without the exports is refused at boot rather than rendered sharp.
  `layout`, `visibility` and `assert` ask in-picture of the exposure (and
  `paints` of every sample's draw list) and read rects and ink at the tick;
  `check` renders none and prints that the exposure is outside its verdict.
  Checkpoints skip the 5×-framebuffer scratch, which `ui_exposure_reserve`
  sizes before the first snapshot so a restore never reallocates it.
  `compositions/shutter-blur` is the fixture, in both ledgers; it traced to
  the stage-1 prototype's recorded digests at N = 1, 4 and 8 before its
  `known` and `peek` nodes were added.

  **What a presence check costs under it, measured** (2026-10-23, Apple M4,
  10 cores, 32 GB, Bun 1.3.11; every row and how it was taken in
  `baselines/shutter.md`, "Stage 3"). A probe of the exposure is `samples`
  rasters, and on `compositions/mg-hud` — 11,510 nodes, 0.15–0.47 s a
  raster — `assert` with three assertions was stopped after 28 CPU minutes
  at 120° × 12. Most of what it was doing was not the shutter: it
  rasterised the whole frame to read each rect, 1,330 rects a frame there,
  and probed all 593 named or text nodes for verdicts about three. Rasters
  over the default 24-frame grid, counted at the core's exports, and seconds
  at a load average of 10–17:

  | `mg-hud` `assert` | no shutter | 120° × 4 | 120° × 12 |
  | --- | ---: | ---: | ---: |
  | main | 35,265 | 48,567 | 75,327 |
  | now | 102 — 64 s | 432 — 211 s | 1,248 — 526 s |
  | now, `--read tick` | | | 102 — 69 s |

  At the 0.4 s a raster those runs average, main's was 4 to 8½ hours. Two
  changes take out work no line of output read and change no output: a rect
  is read after a draw walk (`ui_draw_hash`, about 7 ms there), because the
  walk is what fills the latch; and `assert` classifies only the names its
  assertions mention, ancestors still measured so `insideBox` reads the same
  container. `assert`, `layout` and `visibility --json` are byte-identical to
  main's on all eight compositions that declare assertions and on
  `spanned`, `occluded` and `footage-tracks`. What is left is the shutter's
  own factor, and `--read tick` (`layout`, `visibility`, `assert`, `verify`)
  removes it by classifying the frame's own tick, with `read: "tick"` in
  `--json` and a printed line saying so. It is never the default because it
  is a different picture: `shutter-blur`'s `peek` lies under a blade turning
  half a revolution a tick, covered at every frame's tick and in the picture
  of every exposure, and the tick reading fails it where the exposure passes
  it (`tests/shutter.test.ts`, `tests/verify.test.ts`). The other direction,
  a node the average fades below one level, is stated there and not pinned.
  Two candidates were measured and not taken. Reusing the tick raster as the
  exposure where no sample's draw list differs is exact — an exposure of
  identical samples is that sample byte for byte — and holds at 0 of 24 grid
  frames of `mg-hud` and of `shutter-blur`, where something always moves. A
  coarser default grid under a shutter narrows the default claim to buy what
  `--samples` already buys on request.
- **The four mix shapes that used to be hand-rolled are sidecar keys, and
  each is measured where it can be.** `envelope` on any element (points on
  the element's own clock, so a dialogue line's stays on its clip),
  `bed.ducks` (windows on the composition clock, independent of any line),
  `optional` on any element, and `silentTailMs` on the sound block —
  parsed in `src/manifest/sidecar.ts`, catalogued as probed rows, rendered
  by `src/sound/mix.ts`. Every element's level is ONE piece of data,
  `elementLevel` (gain × envelope × ducks), which the graph renders as a
  `volume` expression and `sound --verify` reads as the level it expects —
  so a graph that drops a term is a measured mismatch rather than agreeing
  with itself: with the dialogue envelope left out of the fixture's mix a
  window sits 3.06 dB outside its range, with the cut duck left out 6.0 dB,
  against at most 0.018 dB for the correct mix, and the tolerance is 1 dB.
  Three properties were measured before they were written down. A WAV leg
  arrives in 4096-sample frames and `eval=frame` reads `t` once per frame,
  so a duck engaged up to 85 ms late; `asetnsamples=n=480` ahead of a
  varying `volume` makes it 10 ms. The codec carries sound one frame window
  past its last input — a gate exactly at the tail left 1092 non-zero s16
  samples in the fixture's 500 ms tail, 43 ms before it none — so the mixer
  stops sound `SILENT_TAIL_GUARD_MS` (50) early and the bed's fade-out
  completes there; the tail itself is still MEASURED after the mux, on the
  decode the manifest hashes, and `render` exits 1 when a sample is not zero.
  And a mono leg in a stereo mix is upmixed at −3.01 dB, so the level check
  reads the source through the mix's own layout. `optional` is a flag, never
  an inference: `render` prints which way each went and writes `mixed` into
  `*.sound.json`, `sound --verify` says `skipped`, and an element without the
  flag is refused when absent exactly as before. A window where the DECLARED
  level puts an element under the floor carries no evidence and is dropped,
  which is why an envelope that takes a line to 0 is not read as the line
  stopping. `compositions/sound-roles` declares one of each and its frame
  digest did not move, sound being outside identity; `tests/sound.test.ts`
  holds every guard above and each was seen red on its defect, the CLI
  render of the fixture included.
- **A vector outline is baked data a style prop selects, drawn by one op**
  (`patches/0042`, `0043`, class `motion`; the design and every place the
  landing departs from its prototype in `patches/0042-vector-paths.design.md`,
  the numbers in `baselines/vector-paths.md`). `<Path d viewBox>` is a View
  whose `d` the build normalises to move, line, cubic and close and writes
  into a PATH TABLE after the ANIM TABLE in `styles.bin`, counted by the
  header's formerly reserved u16 — so a composition with no `<Path>` writes
  the bytes it did, and no recorded digest moved. Per frame the core morphs
  an entry's keys, flattens its cubics in local space, trims and strokes it,
  maps it through the world affine and emits PATH (71), whose coverage is
  POLY's 4x4 lattice with a top-left rule: two paths sharing an edge split
  its samples. Because it is a draw-list op, `ui_draw_hash`, `visibility`,
  `layout` and `check` read it as they read any other, and a path trimmed to
  nothing is invisible by declaration, not covered. Two things are refused
  rather than drawn wrong: morph keys whose commands differ after
  normalisation (at the build, at the line that wrote them — a resampled
  correspondence is a picture nobody declared), and an outline the build
  could not read where it was written (at mount, naming it — not a node
  that silently draws nothing). An arc becomes cubics with no
  transcendental: unit-vector bisection and square roots, so a pak's bytes
  do not depend on the host's `Math.sin`; `tests/vector-paths.test.ts` pins
  two arcs' bits and runs on Linux/x86-64 in the determinism workflow. The
  core's guards are `engine/core/src/path_tests.rs` (a brute-force
  reference over 480 random ops, the seam partition, the stroke union, 16
  scene digests), each watched red by `baselines/vector-paths/redcheck.py`;
  the host's are `tests/vector-paths.test.ts` and catalogue gates G6 and G10,
  watched red by `redcheck-ts.ts` beside it. `compositions/vector-paths` is
  the fixture, in both ledgers, its sidecar asserting that the caption is up
  before the signature is drawn — which a draw-on ignoring its trim fails.
- **`doctor` asks before a build answers late.** `src/cli/commands/doctor.ts`
  reports seven checks, each with what was observed and, when it failed, the
  command that repairs it: the running Bun against the one
  `baselines/digests.json` was recorded on and every `build.json` names; rustup
  and the `wasm32-unknown-unknown` target; `ffmpeg` and `ffprobe` separately,
  because footage probes a source's dimensions and duration before paying for
  the ingest and a tarball carrying only one of the two fails later and further
  in; the vendored tree at the pin with the patches applied;
  `assets/*/manifest.json` fetched and matching; and free disk against the
  ledger's own high-water mark. **`--json` always exits 0** and puts the verdict
  in `ok`, so an agent asking what to do next gets the report instead of a
  shell that threw it away; without `--json` a failing check exits 1.
  `tests/doctor.test.ts` holds the exit-code split and that a failing check
  carries a command.
- **`init` copies a fixture that already passes**
  (`src/cli/commands/init.ts`), so the first thing that fails in a new
  composition is the change its author made rather than one of the agreements
  between files they have not read yet. Three refusals are the content:
  `app.tsx` is not copied when a `gen.ts` sits beside it, because seeding a
  tree with generated output whose generator has not run is how a hand edit to
  a generated file starts; a non-empty target directory is refused rather than
  merged into; and a target outside `compositions/` is refused, because a
  composition derives the repository root from its own location and names fonts
  and clips repo-relative. A declared asset that is not on disk is refused
  before anything is written, naming `bun scripts/assets.ts`.
  `tests/init.test.ts` drives it end to end, including the nested case where
  every relative import that escapes the composition directory is re-resolved
  for the new depth.
- **A footage track is one fact written twice, so one place writes both
  halves.** `tileNodes` returns the placeholder `Image` nodes and
  `footageTrack` returns the sidecar entry (`src/footage/declare.ts`), both
  derived from one drawn width and height — including `grid`, which is
  therefore never typed. `openFootage` refuses the track when tree and sidecar
  disagree, but **the drawn size IS the ingested size**, so an edit that moves
  both consistently stretches the picture instead of failing and nothing
  downstream can tell. `lint` warns (`footage.tileNamedByHand`) on a
  tile-shaped `debugName` it cannot attribute to a `tileNodes` call — a
  text-level check, so the message says what it cannot see, and `openFootage`
  is still what refuses a track whose tiles are actually missing.
  `compositions/kenburns` and `compositions/shimmer` carry tile-shaped names
  and are correctly not warned about: they declare no `footage` at all and
  their textures are pushed by probe scripts. `tests/tiles.test.ts` and
  `tests/footage-cli.test.ts` hold it.
- **A referenced image with no file behind it is refused by `lint` and
  `check`** (`src/lint/images.ts`), which is this repository's answer to a
  build that bakes a 32×32 checkerboard and succeeds — pak valid, render green,
  digest stable and reproducible, while every neighbouring absence (a missing
  footage source, a missing face, a window past the end of a clip) is loud.
  The discovery has to be upstream's or it would be answering about a
  different set of files: the same regex, over string LITERALS only, across
  the entry and the relative imports reachable from it — not the composition
  directory's other files, because `compositions/lower-third/gen.ts` names
  `logo.png` as a job template string and is a program that WRITES the
  composition rather than one the build compiles. The three places are the
  composition's own directory and the VENDORED tree's `assets/images/` and
  `assets/`, which is where upstream looks and not where the prose used to say.
  `compositions/missing-image` is the fixture and traces green on purpose;
  `check` asks before booting, because a clean realm is exactly what a missing
  picture leaves behind.
- **An SVG either bakes as written or stops the build.** The build's baker
  (`framework/compiler/bake-svg.ts`, `patches/0040`) used to scan a file for
  three tag names and drop the rest — a `<text>`, a rect's `rx`, a transform
  on a circle, paint on a `<g>` — so a picture could lose parts of itself
  with every gate green; and it decided each subsample against every edge,
  which on a 952-cell hex grid took 23 minutes of CPU, so a film rasterised
  its own PNGs instead. It now walks the document, draws strokes, arcs and
  `<g transform>`, and refuses what would paint and is not drawn, naming it.
  Its coverage is a scanline held to the old baker kept verbatim as the
  vendored `tests/fixtures/bake-svg-reference.ts`, count for count: every
  shipped SVG at densities 1-3, seeded random fills and discs, and fills
  whose edges pass through sample positions so the crossing's last bit
  decides — the only cases that catch the same line computed from its other
  endpoint, which no shipped SVG and about one random fill in 1,500 does.
  `compositions/probe` bakes `mark.svg` and is in the digest ledger.
  `tests/svg-bake.test.ts` holds it here; the vendored suite of the same
  name, which this repository's `bun test ./tests/` does not run, holds
  the rest.
- **A job is a spec, and the sample is not the job.** `render --spec job.json`
  stages a throwaway copy of the composition (`src/cli/stage-sources.ts`), runs
  the generator into it, builds, encodes and removes the tree, so a batch never
  edits the composition it renders from. The spec parser
  (`src/manifest/spec.ts`) refuses unknown keys, and `--frames`, `--fps`,
  `--width`, `--height`, `--supersample`, `--bundle` and `--pak` are refused
  alongside `--spec`, because a job is a complete description rather than a
  patch on the sample. `trace` does not accept `--spec`, so a job never enters
  the identity ledger. `tests/spec.test.ts` drives the path and
  `tests/lower-third.test.ts` drives the template with the most inputs.
- **A caption job asserts every word against the picture.** `template:
  "captions"` (`src/captions/`) turns a WhisperX, OpenAI or own-schema
  transcript into a composition in which every word is a node named `w<i>`
  and the sidecar carries one `inPicture` per word over its window: its
  frames, clipped to its page. The first frame is the hard one and was
  measured rather than assumed — one-tick gates at known delays, read back
  through `layout --at` at 15, 30 and 60 fps, show that frame `f` samples
  every timeline at clock `(f + 1) · 60 / fps − 1`, and a timeline is still
  at its first keyframe on the tick its delay names. So every entrance
  starts one tick before the clock its word's first frame samples
  (`gateInTick`, `src/captions/clock.ts`) rather than at the word's ms,
  which bakes to that tick or later — later for 25.6% of start times at 30
  fps and 99.8% at 60, counted over 0–10 s in 0.1 ms steps. Moved onto the
  sampled clock, all nine words of `compositions/captions/burn-zh` fail
  `assert --samples 101` at exactly their first frame, and all five styles
  fail the every-frame sweep in `tests/captions.test.ts`, which runs at 30
  and 60 fps. One reading the first draft rested on was measured and
  dropped: a clip window closed to zero width emits no geometry, so
  `visibility` reads it as invisible by declaration and never as covered,
  and the gate that draft put on every closing window changed nothing at any
  of `burn-zh`'s 101 frames. And a page that ends on the film's last frame
  writes no exit: the exit would start on the first tick past the clock,
  which `keyframes` fails as motion no frame can show — `verify` on
  `burn-zh` found it, and the sweep now holds `keyframes` to exit 0 for
  every style. The layout's refusals are the other half: a spaced-language
  word too wide at `minSize`, and words starting on one frame that cannot
  share a page, both stop the job instead of drawing past the line
  (`tests/captions-layout.test.ts`).
- `assertBakedTickRate` (`src/runtime/boot.ts`) refuses a bundle whose baked
  tick rate is not the 60 Hz this realm steps. `--hz=N` compiles into the
  bundle and the keyframe baker stores every delay and segment endpoint as a
  frame count at that rate, so a bundle built at another rate plays all its
  motion at `60/N` speed with nothing reporting it — valid pak, clean realm,
  stable reproducible digest. Upstream checks this for native hosts only
  (`assertNativeHostContract`); the web/wasm adapter is strict-injected and
  never reaches it, and the rate was not readable from outside the bundle at
  all until `patches/0010-publish-baked-tick-rate.patch`. An absent marker is
  refused rather than read as 60. The build command the CLI prints now carries
  `--hz=60` so the rate is stated rather than inherited from a default.
  `tests/tick-rate.test.ts` is the guard.
- `keyframes` (`src/cli/commands/keyframes.ts`) reads the style table and the
  ANIM TABLE out of the pak and places every baked timeline on the grid the
  render samples. Timelines bake at 60 Hz; the render looks at every
  `60/fps`-th tick, so an instant on an odd tick at 30 fps is never observed
  and appears at the next one. It is reported, not failed — 958 of `reel`'s
  1160 timeline uses (707 baked entries, shared across style records) declare
  one, so a gate would be red on the ledger from the day it landed. A timeline
  whose delay outlives its clock **is** failed: it is a declared animation no
  frame of that composition can show. Fixture:
  `compositions/late-anim`, which `lint`, `check` and `trace` all pass.
  **Two more readings come off the same table, both reported rather than
  failed, and the tree was measured before that was decided.** A step no
  longer than one rendered frame that a sampled tick lands strictly inside
  is shown part-way by that frame — a `gin 34ms` gate at an odd tick at
  30 fps arrives a frame late and grey, which is how `rename-card`'s close
  first rendered; `shutter` carries 376 of them and `rename-card` 217, all
  in the 34 ms cadence shutter measured off its recording, so failing on
  them would fail two films for a frame each. And a property two animations
  of one comma list write at once: the core takes the LAST animation
  currently writing a property and `both`/`backwards` fill is writing from
  tick 0 (`tick_timelines`, `engine/core/src/lib.rs`), so a later tween whose
  `from` carries opacity under `both` shows that opacity from the first frame
  and the earlier gate never reaches the picture — `transitions`' incoming
  scene at 0.72 before its cut. The reading is the span where the earlier one
  is RUNNING while the later one writes; a hand-off from a held end value is
  not reported. 63 in `reel`, 18 each in `shutter` and `rename-card`, 20 over
  the `captions/*` — every one checked is the last ticks of an earlier tween
  or gate written over by the next animation on the same node (a word's exit
  starting before its entrance has finished, a slide's eased tail under the
  next slide), which is why it reports rather than fails.
  `late-anim` carries one of each (`gated`, `contended`) and
  `tests/keyframes.test.ts` is red on each with its predicate removed. The
  bake rate it places those timelines on is ASSUMED, not read: the rate is
  published by the bundle and this command does not boot. `readTimelines`
  takes it as a required input rather than defaulting to 60, so no caller can
  inherit it silently, and the printed header names the number. The
  assumption is bounded rather than safe — `assertBakedTickRate` refuses a
  bundle baked at another rate, so a pak this would misread is a pak no
  command can render.
- `preview` is the only browser in this project, and it is a display: the
  pixels are the host's. `/frame` returns the SAME PNG BYTES `frame --at N`
  writes, asserted rather than intended (`tests/preview.test.ts`), which is
  what makes the page evidence instead of a rehearsal — a preview that renders
  in a browser cannot make that claim, because its preview and its render are
  two executions. `/watch` opens on those frames and swaps to an encoded
  viewing copy when there is one, so scrubbing and stepping never wait on an
  encode; the copy is `veryfast`/`crf 23` and is **not** the delivery encode,
  only its frames. Both pages address FRAMES, so a position carries to
  `frame --at`, `layout --at` and `visibility` by being read off. The rail is
  keyed by PATH, never `compositionId`: two pairs in this tree share an id
  (`compositions/malicious` with `compositions/smoke`,
  `compositions/nested/a/9x16` with `compositions/nested/b/9x16`).
  Watching rebuilds through `buildSpawn` — the argv the ledger runs — so a hot
  reload cannot produce an artefact no other command would; `--no-watch` turns
  it off. One session at a time, because a `FootageLayer` holding a whole
  decoded track was ~13 GiB resident.
- **The footage and sound vocabularies each have one fixture that declares
  everything they can express**, so a change to either has something to be
  red against. `compositions/footage-tracks` is four windows over three
  synthetic clips: one clip mapped twice through `sourceFrame`, one
  `fit: "cover"`, one `fit: "contain"`, and one track drawn at its own aspect
  so the fit is correctly absent. `compositions/sound-roles` is one element
  of each of the four roles, its dialogue line pinned to a footage track's
  clock rather than the film's — `sound` prints the composition frame that
  inverts to, and `render` then `sound --verify` reports all four present.
  Both are in the digest ledger; `sound-roles`'s entry is a claim about its
  PICTURE, because sound is outside identity. Their clips and tones are
  `assets/synthetic/`, generated by ffmpeg from `lavfi` sources, with the
  exact command and the `ffmpeg -version` first line recorded per file in
  `assets/synthetic/manifest.json` — the bytes are tracked because they reach
  the pak, and a reader can rebuild them rather than only verify them.
- `openFootage` (`src/cli/footage.ts`) refuses a source whose aspect
  drifts a pixel or more from its drawn size unless the sidecar names a `fit`,
  and refuses before paying for the ingest rather than after.
- **A measurement pass can be cached, and the cache can never be drawn.**
  `openMeasurer` with `cache: { charset }` measures against a metrics-only
  bake of the whole charset at every requested size, built on the first miss
  and booted per call (`src/text/measure.ts`;
  `patches/0015-metrics-only-atlas.patch`, class `upstream`, adds
  `--metrics-only` to the baker: real advances, kerning, baseline and line
  height, 1x1 empty cells, `FONT_FLAG_METRICS_ONLY` in the header). Measured
  on the paste template's charset — ASCII, CJK punctuation and the 3755
  level-1 GB2312 characters — one 72 px bold slot is 30.1 MB with coverage
  and under 64 KB without, and the per-call cost goes from a build (~1.1 s)
  to a boot (~50 ms). The key is both faces by content, the size set, the
  density, the charset and the baker's own source, so an edit to
  `bake-font.ts` retires every cache it wrote; the slot table is written to
  `slots.json` at build time, so a hit never reads a style module. A
  string with a character outside the charset falls back to the per-call
  build, correct rather than refused. Two refusals keep the artifact in its
  lane: `hardenedBootWorld` refuses a pak carrying a metrics-only atlas
  unless the caller is the measurer, because such a pak measures text and
  draws none of it — a blank frame with a clean realm and a stable digest;
  and `verifySlots` still runs on a hit. Two misses on one key — in one
  process or two, since no lock orders them — each build into a fresh
  `mkdtemp` directory and one rename wins; a per-process directory failed
  4 of 9 such pairs. `tests/measure.test.ts` holds all five claims and its
  header records the edit that turns each one red.
- **The framebuffer carries alpha** (`patches/0014-transparent-clear.patch`,
  class `motion`). The rasteriser clears to TRANSPARENT black and
  `RgbaTarget::blend` composites straight-alpha src-over when the destination
  is not opaque; when it is, the expression is the one the buffer always had,
  verbatim, so every composition that declares a ground renders byte for byte
  as before and the digest ledger is the check — `compositions/alpha`, the
  only root here with no `bg-*`, is the one entry that moved. `render
  --alpha` still measures and prints the smallest alpha byte it saw, so the
  claim is a number: 0 on `alpha`, 255 on anything with a full-bleed ground.
  `tests/format.test.ts` asserts the 0. Four Rust tests hold the blend, and
  the red case is recorded in the patch header: with the general path
  replaced by the opaque expression, three of them fail. What this does NOT
  change is the RGB565 targets, which have no alpha byte, and it does not
  reach the hosts upstream presents to — which is why it is class `motion`.
- Ingest records the ffmpeg version into each artifact's manifest, and
  `assets/*/manifest.json` pins every fetched byte by sha256.
- **The ingest names the scaler's rounding, not only its kernel.** Every
  `scale` in the `-vf` chain carries `flags=lanczos+accurate_rnd+bitexact`,
  and the invocation adds `-flags +bitexact` and
  `-sws_flags +accurate_rnd+bitexact` beside the `-fflags +bitexact` that was
  already there. The reason is the first Linux run of the ledger with footage
  present: every composition reproduced the macOS/ARM digests byte for byte
  except the two that declare footage, so everything downstream of the decode
  crossed the architecture intact. H.264 decoding to YUV is bit-exact by spec,
  so the divergence is the yuv420p→rgba conversion and the resample, where
  swscale's x86 assembly for `yuv2packedX` has a fast rounding and an accurate
  one and picks the fast one by default; `SWS_ACCURATE_RND` picks the one that
  agrees with the C reference. Measured here before the flags landed: with
  them, without them, and under `-cpuflags 0` — twelve decodes over the three
  synthetic tracks — every one produces the digest already in
  `baselines/ingest-bytes.json`, so the aarch64 path already is that reference
  and the flags move no recorded digest on this machine.
  `tests/footage-cli.test.ts` pins the string for all three fits — a fit that
  keeps `lanczos` and loses `accurate_rnd` decodes to different bytes on x86
  and the same bytes here, so nothing local would report it.
- **The determinism claim is checked on a machine that is not the author's.**
  `.github/workflows/determinism.yml` runs the suite, the typecheck and the
  digest ledger on every push, on Linux/x86-64, against digests recorded on
  macOS/ARM — so every green run is a cross-platform reproduction per
  composition rather than one afternoon of hand-run commands. The whole ledger,
  never `--only` over a subset: a subset turns the workflow green while it
  checks less than its name claims. ffmpeg is pinned in the workflow rather than
  taken from whatever the image carries, because the frozen ingest artifact
  stands in front of the decoder and its bytes are an input to the digest of
  every composition that declares footage — 3 of the ledger's 40 today. The
  visibility ledger is NOT run there; it is a local step before a pull request
  and nothing on a runner would notice it going stale.
- `CAPABILITIES.md` is generated from `src/catalog/surface.ts` by
  `scripts/catalog.ts`, and `tests/catalog.test.ts` holds it to the
  implementation from both sides: no diagnostic or key exists in
  `src/manifest/sidecar.ts` without a row, and no row states a constraint
  without an input that the parser actually rejects. Each row carries how far
  it was checked — `probed` means a violation was constructed and refused,
  `pinned` means the literal was found in the named file and nothing more.
  A row may not claim more than that.
- The animation vocabulary is catalogued too, and probed against the compiler
  rather than the sidecar parser: it has no diagnostic codes and refuses by
  throwing, so a `BakeProbe` registers a theme, compiles a class literal and
  asserts what came back (G6). Twelve rows cover the shorthand grammar,
  easings, keyframe selectors, the animatable property set, `%`/`calc()`/
  `var()`, `alternate`, both-ends pinning, `animate-loop-[..]` and `--hz`.
  G3 was widened at the same time — it only ever looked at a row's
  diagnostics, so a `probed` row with no diagnostics and no probe passed it
  without executing anything.
- **`tests/authoring.test.ts` executes TWO documents under one rule:**
  `AUTHORING.md` and `skills/pocket-motion/SKILL.md`. The second is what an
  agent that has never seen this repository reads, so a stale command in it is
  the same defect one level worse — the reader has nothing else to check it
  against. Each document gets its OWN scratch tree, so a command that only
  works because the other document built something is caught rather than
  inherited. Every `bun` line inside a bash fence is classified: run (the CLI,
  the catalogue, upstream's builder), out of scope by prefix (the two ledgers,
  and anything that mutates the checkout — each with its reason in the test),
  or skipped with a `# not run: <reason>` the document carries. **A line
  matching none of those fails the test**, so a command cannot enter the
  document without someone deciding whether it is checked, and a placeholder
  in a runnable line is a failure rather than a silent skip. Fences run in
  ORDER, in a scratch tree of symlinks with its own `dist/`, so the build
  fence supplies the artifacts the command fence reads and the checkout's own
  artifacts do not move under it.
- **`tests/residue.test.ts` reads every tracked text file and fails on a
  vocabulary.** It is the other half of the same hole: the authoring gate
  proves a command still runs, and this one proves a name nothing in the tree
  carries any more is not still being pointed at from prose or a comment. It
  reads `git ls-files -s` rather than `git ls-files`, because the mode is what
  separates a symlink from a file — `CLAUDE.md` is a symlink to this file, and
  following it would report one file's text under two paths.
- `patches/0011-loud-unknown-animation-name.patch` makes an `animate-<name>`
  that names nothing a build error listing the declared names, instead of
  dropping the whole class literal. The old behaviour cost the node every
  other utility in the same literal and said nothing, so a one-letter typo in
  an animation name read as a layout bug. It fires only when the literal
  carries another utility token: the compiler is offered **every string
  literal in the module** as a class candidate, so a lone `animate-<word>`
  may be prose, and upstream pins that case (`tests/tailwind.test.ts`,
  "prose safety").
- `patches/0012-class-attribute-provenance.patch` gives that refusal the
  evidence the token count was standing in for. The collector already had a
  `JSXAttribute` visitor watching for `class`; it now records as
  `classAttrStrings` every literal that IS, on some execution, **the whole
  value** of that attribute — direct, a backtick with nothing interpolated
  into it, and the arms of a ternary or a short-circuit. `build.ts` passes
  them to `compileClasses`, and
  `parseClassLiteral` refuses a bad `animate-*` in one of them whatever else
  the literal holds. **A sentence cannot be the value of a `class=`
  attribute**, so prose safety is now a property of where the literal was
  written rather than of how many tokens it happened to carry — upstream's
  `animate-imagination` case still returns null. Without it the residue was
  the WRAPPER IDIOM, not a corner: 13 literals in this tree are an animation
  and nothing else, every one of them in `reel` and every one a
  `<View class="animate-so5638">` window written by a generator with a numeric
  name — the least-read animation names in the repository, and where a
  generator bug would land.
- **"Whole value" is the rule, and it decides three edges that reading the
  code casually gets wrong.** An operand of `+` is a fragment:
  `"animate-lid-"` in `class={"animate-lid-" + which()}` is never the class
  the node gets, and recording it would turn a construct upstream compiles
  into a build error naming a half-token nobody wrote. A backtick with
  nothing interpolated IS the whole value, and upstream refuses only an
  INTERPOLATED template — so while `addAttr` had no `TemplateLiteral` branch,
  one quote character decided whether a misspelt animation was loud or
  silent: `class="animate-x-typo"` failed the build and
  ``class={`animate-x-typo`}`` compiled and dropped it. An interpolated one is
  a fragment for the same reason `+` is, and it can reach `addAttr` inside a
  ternary arm where upstream's refusal does not look. And the left operand of
  `&&` is never the value — a non-empty string is truthy, so the result is
  always the right — while `||` and `??` take both arms, because there the
  left one can be. Gate **G7** (`tests/catalog.test.ts`) holds all of it:
  eleven modules through the real `transformFile`, each pinning the recorded
  set exactly. G6 hands `fromClassAttribute` to the parser by hand, so it
  could only ever say what the parser does with the evidence, never where the
  evidence comes from.
- **The same evidence now refuses any token that does not parse, not only an
  animation name** (`patches/0041-loud-unparseable-class-token.patch`, class
  `upstream`). A class literal compiles whole or not at all, so one token —
  `left-[1e-14px]` from a generator that printed a float through `String(n)`,
  `rotate--18` where the compiler reads only `rotate-N` with N >= 0 — took
  every other utility of the literal with it. On this host that was not
  silent but misattributed: mount threw `unknown class "…" (dynamic classes
  must be ternaries of full literals)`, naming neither the token nor the
  cause, and an arm mount never took was reported by nothing. A literal in
  `classAttrStrings` now has every such token gathered and is refused, and
  `tools/build.ts` names each at the literal's file, line and column. A
  message names a rewrite (`left-[0.00000000000001px]`, `rotate-342`,
  `left-[-12px]`) only when that rewrite parses, and says so when it does not
  (`opacity-[1e-7]`). Prose with no provenance still compiles to nothing, and
  the left of `&&` keeps upstream's warning. When it landed no literal in the
  tree was refused — 8,140 `class=` literals over 69 files. **G6** holds the
  refusal and its messages (row `class.unparsed-token`, plus eleven overflow,
  shutter and paint probes that had asserted the drop) and **G6b** the located
  build error, both in `tests/catalog.test.ts`; the patch header lists the
  edit that turns each red.
- **The transform cache needs no shape marker.** `hashKey` already mixes in
  `compilerImplementationHash()`, which walks the local imports out of
  `jsx-plugin.ts` and digests every source it reaches — and `CacheEntry` is
  declared in that file, so the edit that adds a field is itself in the key.
  Measured on the edit that removed the marker: `compositions/smoke` went from
  626 cache entries to 656, all 30 of its modules missing. An earlier revision
  carried a `CACHE_SHAPE` constant and a comment saying a stale hit would come
  back `undefined` and turn the diagnostic off quietly; both halves were
  wrong — the hit is unreachable, and `build.ts` iterates the field, so an
  `undefined` would throw rather than go quiet.
- **The API is the CLI's `--json`, returned.** `src/api.ts` exports `build`,
  `trace`, `render`, `verify` and `doctor`. Each turns its options into the
  argv the command would be typed with, runs it through `dispatch`
  (`src/cli/main.ts` — the parser, the command, and the conversion of a
  thrown error into `{ ok: false, error, exitCode }` that `main` used to hold
  inline), and returns it through `jsonPayload` and `envelope`, which are
  what `--json` writes through. So an API result is redacted and carries
  `runId` exactly as the printed object does, and nothing re-derives a
  verdict. `tests/api.test.ts` runs the CLI as a separate process with a
  hand-typed argv and requires equal objects; `render` may differ in
  `elapsedMs` and `msPerFrame` and nothing else. Red with `envelope()`
  skipped: six of eight cases.
- **`render --json` carries `trace`'s identity**, from one function
  (`compositionIdentity`, `src/cli/commands/trace.ts`), so a delivery holds
  the pair another machine checks with `trace`. A `--spec` job carries none,
  measured: one job staged twice moved both the `toolchain` and the `bundle`
  components, because the staged directory's random name is in
  `build.json`'s argv and in the bundle's module comments.
- **The npm package is staged, never packed from the checkout.**
  `scripts/pack.ts` assembles `dist/pack/pocket-motion` from an explicit
  list, because npm honours `vendor/pocketjs`'s own `.gitignore`, which
  ignores `node_modules` and `hosts/web/pocketjs.wasm` — measured, and naming
  them in `files` does not override it; the root `prepack` refuses with the
  command that packs. The vendored tree ships prebuilt rather than through a
  `postinstall`: Bun runs no dependency's lifecycle script unless the
  consumer trusts it, nothing hosts an artifact a fetch could verify, and the
  compiler's 119 npm packages are copied as `bun install --frozen-lockfile`
  laid them out, so the JSX transform that writes a bundle cannot float with a
  consumer's resolver. `framework/src` and `contracts` ship whole; of the
  compiler, `tools/` and `microts/`, only what the import graph reaches from
  the five entries `src/` loads. That graph includes `typescript` at 66caf4e5,
  23 MB of the package's 77 MiB unpacked: `tools/build.ts` imports microts'
  AOT compiler at module scope and its first line imports `typescript`, so
  every build loads it. The one platform-native package, the
  JSX-vapor compiler's binding, is declared as an exact-version
  `optionalDependency` instead of copied, so the tarball does not depend on
  where it was packed. `vendor/prebuilt.json` stands in for git: upstream,
  every patch and every file by sha256, which `doctor` hashes in an install
  (`src/package/prebuilt.ts`) before loading the compiler in a child process —
  the load is where a platform with no binding shows up.
  `tests/package.test.ts` reads `npm pack --dry-run`'s own list, and installs
  the real tarball into an empty project where `smoke` traces to its ledger
  digest through the package's bin. Red, measured at 66caf4e5: shipping
  upstream's `.gitignore` drops 4054 of 4410 files; staging with no
  `optionalDependencies` fails `doctor` with `Cannot find native binding`.
- **A consumer's `build.json` is relative to the consumer.** `relativise`
  (`src/render/build-record.ts`) tries this package's root and then the
  composition's repository root — the cwd `buildSpawn` builds from — so a
  project that installed the package records `compositions/card/main.tsx`,
  not where the project sits. In this repository the two roots are one
  directory and every record is the bytes it was. `tests/identity.test.ts`
  records one build from two project locations; red with the package root
  alone.
- **The Docker image is the workflow's run.** `Dockerfile` builds the
  repository from nothing on linux/amd64 and runs `bun scripts/digests.ts`.
  Bun is pinned by image digest, ffmpeg is the workflow's asset by the
  workflow's sha256, Rust is 1.97.1, and `tests/docker.test.ts` holds the Bun
  and ffmpeg pins equal to `.github/workflows/determinism.yml` and to the
  ledger's recorded Bun (red on one changed digit). Upstream is fetched as the
  one pinned commit, depth 1, over HTTP/1.1 and retried, rather than cloned
  whole by `scripts/vendor.ts` — which reuses a present tree and checks the
  pin out itself — because the full clone failed mid-transfer at 707 s on a
  slow link; the fetch needs the full sha, which the same test holds to
  `UPSTREAM.commit`. It fetches `bun scripts/assets.ts --kind
  fonts,synthetic` — the frame hash never opens audio, so the Mixkit tracks
  stay out of an image that might be pushed — and runs `git init` over the
  copied source, because composition discovery asks git and a build context
  carries no `.git`. Measured on an M4 under Rosetta, from a context with no
  `vendor/`, `node_modules/` or `dist/`: at e0b37e20 on 2026-10-22, all 36
  ledger digests reproduced in 593 s for the run; at 66caf4e5 on 2026-10-23,
  all 38, `reel` and both footage compositions among them, in 1708 s on a
  machine other jobs held at a load average between 60 and 220, so that time
  says nothing about the image. The README's form, which builds from the
  repository's URL, has not been run — it needs this on the default branch of
  a reachable repository.

## What does not reach them yet

- **The shutter blurs baked timelines and nothing else.** Tracks `animate()`
  and transitions spawn, springs and physics keep their tick value in every
  sample; a mount-only composition cannot start one after mount, and one
  started during mount and still running holds rather than blurs. Footage
  content is not resampled in time — every sample of a frame draws the same
  decoded texture — though a track's tiles moved by a timeline blur like any
  node. `lint`'s two `shutter.*` warnings read the source text: ancestry is
  lexical within one file and the keyframes an `animate-*` names are not
  read, so a hold under an ancestor that only fades is warned about too, and
  a hold placed by a component in another file is not seen. A probe of the
  exposure still costs `samples` rasters, and `visibility` probes every named
  or text node, not only asserted ones: on `mg-hud` at 120° × 12 that is
  39,864 rasters over the default grid, about 4½ hours at its raster cost,
  against 3,322 and 20 minutes with `--read tick` — the reading that misses
  `peek`. `reel` declares no shutter.
- **A path's trim and morph do not blur, and nothing caches its geometry.**
  The shutter integrates transform tracks only, so a moving `<Path>` blurs
  and a draw-on's tip does not. The geometry is rebuilt every frame — and
  under a shutter every sample — from the table: stage 1 measured a 1080p
  frame of 300 paths of 67 cubics at 20-70 ms of wasm, against 1.19 ms for a
  frame of the reel, so a dense illustration is a cost no ledger composition
  carries yet.
- **Abutting paths are still two blends.** The partition gives each seam
  sample to one path, but a pixel half-covered by each is blended twice, so
  a seam between two shapes of one colour lets `(1 - h_a/16)(1 - h_b/16)` of
  the ground through; stage 1's fan of 24 wedges shows faint radial lines. A
  coverage-merging op would close it and is not built.
- **The collector reads a module's own literals.** A `d` imported from
  another module, or computed at run time, is refused at mount rather than
  baked; generators write literals, which is what every composition here
  does, but a hand-written film that keeps its outlines in a shared module
  meets the refusal.

Stated rather than smoothed. Each is a known hole, not an oversight.

- **The pak format still does not carry its toolchain; the record beside it
  does.** `build.json` covers everything this repository builds — the Bun, the
  pinned upstream commit, every patch by sha256, the build argv — and every
  command refuses a bundle without one, so an artefact produced here is
  attributable. What it does not cover is a pak that arrives on its own: the
  record is a neighbour, not a header, so a pak copied out of a dist directory
  or lifted from an archive remains unattributable. Closing that properly
  means a pak-format change, which is upstream's.
- **Nothing joins a baked timeline to the span the node is actually shown
  for.** `keyframes` reads the schedule out of the pak without booting, so a
  timeline on a node behind an opaque clip reports exactly as one in plain
  view. A caption buried by the next shot no longer needs that join —
  `visibility` catches it from the picture alone — but "this declared
  animation moves no pixel" still does, and the join is known to be available:
  a node's class literal recompiled in process bakes a timeline that is present
  in the pak's ANIM TABLE by CONTENT, measured across thousands of timeline
  uses with no miss and no ambiguity (compare the bezier through `Math.fround`;
  the pak's floats have been through f32 and freshly baked ones have not).
  Applied naively the join says "a declared fade-out that runs while the node
  is covered", and that is NOT a defect predicate — the outgoing half of a
  cross-fade is exactly that, and correct. Reported, the number would be worth
  having; failed on, it is noise.
- **Sound is outside input identity by construction**, not by omission: audio
  is a separate mux pass and the frame hash never opens an audio file, so
  `identityProjection` drops the `sound` key and a test proves two sidecars
  differing only in one produce a single identity. The schema buys static
  checks — declared, resolvable, correctly placed, refused by `lint` when the
  file is absent — and it does not buy digest coverage. Say so wherever it is
  documented.
- **What the sound schema still cannot say, and what `sound --verify` still
  does not read.** The four hand-rolled shapes are declared now (previous
  section). What remains:
  - a duck with an attack and a release: `ducks[]` and a narration `duck`
    switch at their edges, within one 480-sample block. A ramped dip is
    expressible only as the bed's `envelope`, which sets the bed's level
    rather than attenuating whatever the level is
  - more than one bed: a second music track can be placed as a cue with an
    `envelope`, but `ducks[]` and narration ducks act on the bed alone, so a
    cross-fade between two tracks that a voice must also duck cannot be said
  - `optional` makes the delivered audio depend on whether a file was in the
    tree when `render` ran. That is recorded in `*.sound.json` and nowhere
    else — sound is outside identity, so no ledger notices an optional element
    going missing between two renders of the same sidecar
  - `sound --verify` checks a level only where the declaration varies it,
    one window per piece; a constant `gain`, the bed's fades and a piece
    shorter than a window and its margins are not read, and the windows
    where two ducks overlap below the floor are counted as unexamined
  - the 50 ms guard is two AAC frames at 44.1 kHz. A mix at a lower rate,
    where two frames are longer, is not prevented — the measurement after the
    mux is what would refuse it
- **The two ProRes/VP9 facts a reader would get wrong from the argv**, both
  pinned so they are not rediscovered: ProRes 4444 is asked for as
  `yuva444p10le` and DECODES as `yuva444p12le`, because the 4444 bitstream is
  12-bit; and VP9 stores alpha out of band, so an alpha WebM's video stream
  still reports `pix_fmt=yuv420p` and the evidence is the container's
  `alpha_mode` tag. A test asserting `pix_fmt=yuva420p` would be red on a
  correct file.
- **The largest bakeable text size is a property of the face, not of the
  format.** The FONT ATLAS header stores `cellH` as a u8, so
  `patches/0002-loud-font-cell-limit.patch` refuses a size whose cell would
  exceed 255 px and names the largest that fits:
  `maxPx = floor(px * 255 / wantCellH)`, where `wantCellH` is
  `round(ascender * px / unitsPerEm) + ceil(-descender * px / unitsPerEm)` and
  so comes from that family's own `hhea`. Computed over the four faces in
  `assets/fonts`: **Noto Sans SC bakes up to 176 px, HarmonyOS Sans up to
  217 px** — CJK ascent and descent run taller against the same 1000 upem
  (1160/−288 against 928/−244). The ceiling is a property of the family, not
  the weight: Bold and Regular of each share an `hhea` and share a ceiling.
  The message is correct at the moment it fires and carries the answer. What
  nothing says, at the place it matters, is that **the number a composition
  records beside a hero size is not transferable** — swapping the face changes
  the ceiling, and a size that baked yesterday is refused today with no edit
  to the size itself.
- **A full ledger run's disk cost is set by the footage in the tree, and
  only the ledger can measure it.** Ingest decodes each footage track to raw
  RGBA next to the bundle and leaves it there. Measured 2026-10-22 by
  clearing `dist/**/*.rgba` and running the whole ledger serially: 6 `.rgba`
  files totalling 1,381,017,600 bytes — 1.3 GiB — from 1.5 MB of tracked
  clips. 659,865,600 of those bytes are one 44 KB clip, the one
  `compositions/captions/burn-zh` burns its captions into: ingest decodes a
  source whole at the drawn size, here 179 frames at 720×1280, whatever
  window the track uses. A tree carrying recorded material at film length
  reached 92 files and 120 GB and filled a 1.8 TiB volume, and the ingest
  that hit the wall reported `No space left on device` from ffmpeg rather
  than anything about capacity. That measurement is `FULL_RUN_RGBA_BYTES`
  (`src/cli/disk.ts`), in bytes because bytes are what was read, and both
  readers derive from it: `doctor` FAILS below it and passes calling the
  headroom thin below `HEADROOM_MULTIPLE` times it, and `scripts/digests.ts`
  prints the same two numbers before it starts. It used to be a HIGH-WATER
  MARK from a tree that no longer exists — 52 files and 64 GiB, measured
  2026-08-20 — and gating on that made `doctor` red on every hosted runner,
  11.6 GiB free against a 64 GiB threshold, which took the `AUTHORING.md`
  and `SKILL.md` command gates down with it because both run `doctor` out of
  a documented fence. Three failures, one stale number.
  `tests/doctor.test.ts` pins the verdict at each end of the band, and is
  red at 11.6 GiB the moment the constant goes back to 64. A composition
  added tomorrow moves the need and nothing else would notice, so a full run
  re-reads `dist/` at the end and reports when what it left disagrees with
  the constant by a file or by more than 5%. The bytes are re-derivable and
  safe to delete.
- **Nothing reads `baselines/ingest-bytes.json`.** It is a hand-recorded file
  no command, test or workflow opens, and `.github/workflows/determinism.yml`
  says so in the comment that pins ffmpeg. So when a footage composition's
  frame digest moves on another machine, the file that would separate "the
  decoder produced different bytes" from "the renderer disagreed" has to be
  compared by a person reading `dist/**/footage/*/manifest.json` by hand. That
  is how the one cross-architecture divergence so far was attributed: by
  reasoning about which compositions failed, not by measuring the artifact.
  The five rows are also the whole of what it covers — the artifacts the two
  synthetic-clip fixtures ingest — so a check that read them would say nothing
  about a track added tomorrow.
- **The ingest recipe is not in the footage cache key.** `footageCacheKey`
  (`src/cli/footage.ts`) hashes the source sha256, tile, fps, drawn width and
  height, frame count and resolved `fit` — everything the sidecar decides, and
  nothing the ingest code decides. Change the `-vf` string or a scaler flag
  and a tree with a warm `dist` reuses the artifact the old recipe produced,
  silently, until someone deletes it. CI is unaffected because a fresh
  checkout has no `dist` to hit, which is exactly why this would not be
  noticed there. The workaround is `find dist -name '*.rgba' -delete`, which
  works because `readCache` wants all three of `cache.json`, `manifest.json`
  and `frames.rgba` and takes a missing one as a miss. Stating the recipe in
  the key would be the fix, at the cost of re-decoding every track once.
- **An SVG's angles go through the host's `Math`.** `rotate()` and an
  arc's x-axis-rotation take `Math.cos` and `Math.sin`, and `skewX`/`skewY`
  take `Math.tan`, in the baker that writes the pak — upstream's choice for
  `rotate()`, kept so the shipped icons bake to their old bytes. Whether
  those agree bit for bit between the Bun on macOS/arm64 and the one on
  Linux/x86-64 has not been measured, and nothing would report it: the one
  SVG in the digest ledger (`compositions/probe/mark.svg`) has no angle in
  it. An angle that is a multiple of 90 degrees is not exempt — `cos(90°)`
  comes back as 6e-17, not 0.
- **Two builds into ONE directory are ordered by nothing.** Builds into
  different directories share nothing but the content-addressed transform
  cache. Into the same one, identical inputs write identical bytes — three
  concurrent builds of `compositions/smoke`, five rounds, every artifact equal
  to a serial build's — but different inputs leave each file to its last
  writer, so a bundle and a pak can come from two builds. `withBuildLock` used
  to order the writers and never the readers; `scripts/digests.ts`'s
  mtime/size check is what makes a moved artefact impossible to pass silently,
  and it covers a ledger run and nothing outside one.
- **An installed package's bundle is not this checkout's bundle, and
  identity says so while the picture does not.** Measured on `smoke`, built
  here and built in a project that installed the tarball, at e0b37e20 and
  again at 66caf4e5: the frame digest,
  `pak`, `params`, `sidecar` and `toolchain` agree, and `bundle` does not.
  Bun's bundler writes each module's path relative to the build's cwd into a
  comment, and the framework sits at `vendor/pocketjs/framework/src/…` here
  and at `node_modules/pocket-motion/vendor/pocketjs/framework/src/…` there —
  and at a third path under a linker that does not hoist. So two installs with
  one layout share an identity, and an install and a checkout do not. Hashing
  the bundle with those comments normalised, or building from a cwd that makes
  the framework's path independent of the install, would close it; neither is
  done.
- **An installed package still speaks as a checkout in places.** Refusals
  print `bun src/cli/main.ts build <dir>` and `bun scripts/assets.ts`, which a
  consumer does not have (`bunx pocket-motion build <dir>` is the command
  there), and `--json` redacts `$REPO` as the PACKAGE directory, so a
  consumer's own paths come back as `$HOME/…`. `init` copies its fixtures
  out of this repository's `compositions/`, which the package does not carry,
  and refuses a target outside that tree, so a consumer cannot use it at all.
  And a build writes into the package: `buildEnv` (`src/vendor/cache.ts`)
  points upstream's transform cache at
  `node_modules/pocket-motion/vendor/pocketjs/.cache`, so an install on a
  read-only filesystem cannot build.
- **What the package was checked on is one platform.** The install test has
  run on darwin-arm64 only, at the time of writing; it is in the suite CI runs
  on linux-x64, which is where the second platform will be measured. The
  binding is declared for the fourteen platforms its compiler lists; Windows
  has not been tried, and `doctor`'s disk check reads `df`.
- **Nothing records the rustc that compiled the wasm, and the same rustc does
  not give the same wasm.** `vendor/prebuilt.json` pins the wasm's bytes;
  `scripts/vendor.ts` compiles it with whatever rustup runs and writes no
  note, so a version recorded at pack time would describe a compile nothing
  saw. Measured at 66caf4e5 with rustc 1.97.1 (`8bab26f4f`) throughout:
  914,481 and 914,321 bytes from two checkouts on one Mac, and 913,329 bytes
  in the linux/amd64 image, which reproduced all 38 digests (at e0b37e20:
  513,402 on the Mac, 513,135 in the image). Two checkouts on one machine
  already differ, so where the checkout sits is enough to move the bytes:
  the wasm keeps panic locations as absolute paths, 23 of them in the packed
  wasm — 17 into the checkout and 6 into `~/.cargo/registry` — and **a
  packed tarball names the packing user's home directory**.
  `--remap-path-prefix` in the wasm build would make the bytes
  path-independent; nothing passes it. The frames do not depend on the
  difference, which is the observation identity's omission of the wasm rests
  on, and why the package ships one wasm instead of a compile per machine.
  The Dockerfile pins 1.97.1; the workflow takes stable.
- **A caption job's own assertions are never evaluated.** `render --spec`
  stages the job's composition — sidecar `assertions[]` included — renders it
  and deletes it, and nothing evaluates the assertions of the job in between.
  What holds the word-window claim is the generator: `tests/captions.test.ts`
  sweeps all five styles at every frame, and the two samples are in both
  ledgers. A transcript shaped unlike anything those cover is a picture
  nothing has checked. Run on a sample, `assert` with its default 24 samples
  passes only because every window in those two transcripts is at least as
  wide as the stride; an assertion whose window holds no sample fails, so a
  job of real length needs `--samples <durationFrames>`.
- **The five caption styles exist twice.** `compositions/captions/highlight`
  and its four siblings are still the ports of the HyperFrames catalog, with
  their own generators and hand-picked phrasing; `src/captions/styles.ts`
  re-expresses the same five treatments for any transcript, with the one-tick
  lead and the nested entrance and exit wrappers the ports do not have. A
  change to one does not reach the other. Pointing the ports at the template
  would move their digests and their visibility counts, so it is a recorded
  change to five deliveries rather than a refactor.

## Working rules

- Conventional Commits for the subject line: `type(scope): summary`.
- Never edit `vendor/`. It is rebuilt by `scripts/vendor.ts` from
  `patches/NNNN-*.patch` applied in sorted order against the pinned upstream
  commit. A change to engine behaviour is a new patch, and a patch is one of
  two classes (`patches/README.md`): `upstream`, a change that belongs in
  pocket-nexus/pocketjs and is rebased onto its main when submitted — the
  declaration layer, target-independent; or `motion`, a change this
  rasteriser needs and no upstream target will draw, never submitted, with
  the reason on a `pocket-motion-only:` line in the patch's own header —
  the paint layer. A `motion` draw-list op takes a code at or above
  `MOTION_DRAW_OP_BASE` (64, `src/vendor/draw-ops.ts`): upstream allocates
  densely from 1 and took 10 for `surfaceQuad` after `0008` had given 10 to
  POLY, which is 11 since the pin moved to 66caf4e5, as in #301.
  `tests/patches.test.ts` holds the classification and the range, and goes
  red on the number collision the day the pin moves onto one. Whatever
  the class, an op is still declared in the class literal and emitted by
  `draw.rs` — never a host-side pass over the finished frame, which `check`,
  `visibility` and `ui_draw_hash` would not see.
- **A guard only guards if the regression actually fails it.** Introduce the
  defect, watch the check go red, revert. A guard added without that step is
  an assertion about a guard, not a guard.
- **Verify the world, not the self-report.** Re-run the command, re-read the
  file, re-derive the digest. This applies to a subagent's report and to your
  own scratch scripts, which are the least-tested code in any session.
- Prose states the mechanism directly. No slogans, no personification, no
  empty intensifiers, no imported architecture jargon. `AUTHORING.md` and this
  file are the register reference.
