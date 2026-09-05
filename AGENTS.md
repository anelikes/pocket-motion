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
  `tests/sound.test.ts` holds it. Four shapes the schema still cannot express
  are in the next section.
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
- **One build at a time, because a build writes outside its own `--outdir`.**
  Upstream's pass 1 writes `framework/src/styles.generated.ts` into the SHARED
  vendored tree and pass 2 resolves that path, so "two builds into two
  directories" is not two independent builds.
  `withBuildLock` (`src/vendor/build-lock.ts`) holds them apart in this process
  and, through a lock file under `vendor/pocketjs/.cache/`, across processes —
  the ledgers, preview's hot reload, a second CLI. `runBuild`, `openMeasurer`
  and `scripts/fit-probe.ts` all take it; a build spawned straight from
  `bun vendor/pocketjs/tools/build.ts` still does not, which is the same
  boundary `build.json` already draws.

  **The damage is a wrong number, not a failed build**, and that decided the
  design. Two things were measured before anything was written: `Bun.write`
  never leaves a file missing or empty — one process rewriting a 200 KB
  stand-in 84k times against another statting it 5.1M times reports 0 of each —
  and every build writes the mirror in its own pass 1 before its own pass 2
  reads it, so "one build removes it while another resolves it" is not a
  window that exists. The window that does exist is between a write and a
  reader that pairs the file with a pak, and `src/text/measure.ts` is the only
  such reader: it takes the px -> slot table straight back out of the mirror to
  check it against its own build's atlases. A composition build landing in that
  gap replaces the table. Reproduced by starting one 300 ms into a measurement
  build, `verifySlots` refuses with `styles.generated.ts is not this build's` —
  so a correct pair of builds fails, and the reverse pairing would have been
  the advances of a different font size with nothing to show why. That is also
  why this is a lock and not a retry-on-failed-build: in the reproduction the
  build that lost the file exited 0, and a retry would have had nothing to
  retry. `measure.ts` used to hold a queue of its own covering measurement
  builds against each other, which left the direction that actually happens
  open. `tests/build-lock.test.ts` is the guard; its timing sweep is red at
  150-500 ms with the lock reverted.
- **A FRESH tree has no `styles.generated.ts` at all, and that is a different
  fault from two builds sharing it.** The file is upstream-gitignored, so it
  appears the first time a build runs — and both passes of that same build
  touch it in the wrong order. Pass 1 resolves the import at
  `framework/src/index.ts:52` (`tools/build.ts:248`) and MISSES, a probe that
  is wasted anyway because `walk` returns for that filename at line 270. Pass 1
  then writes the file (line 311). Pass 2 resolves it OFF DISK, because
  `jsxPlugin` serves the contents from memory but registers no `onResolve` for
  a relative specifier under `framework === "solid"`. Whether Bun finds a file
  created after it looked in that directory is not this repository's to decide,
  and upstream does not try: `tools/site-build.ts` writes the same four-export
  stub before it builds anything, "to seed a positive resolution before Bun can
  cache the missing path".

  **It happens at a rate, and the rate was measured rather than guessed.** A
  fresh Linux CI checkout failed the first build of a run this way, in
  `tests/preview.test.ts`'s `beforeAll`, with
  `Could not resolve: "./styles.generated.ts"` on stderr after that same
  build's stdout had printed the table it had just written. Put back on the
  same runner as a sweep — mirror and transform cache deleted before each
  build, upstream's builder spawned directly — **6 of 20 failed**. Every
  environment reachable locally is green on that sweep: 25 mirror-less
  cold-cache builds in Linux containers on amd64 and arm64, and every attempt
  on macOS. So it is not a commit and not a platform, and nothing here can
  make Bun re-read a directory it has already listed. What is fixed is the
  STATE.

  `scripts/vendor.ts` seeds the stub, so no tree this project sets up is
  mirror-less, and `withBuildLock` seeds it again inside the lock, because a
  tree can lose the file afterwards (`tests/build-lock.test.ts` removes it on
  purpose). A seed never overwrites: it fills an absence, and the first build
  replaces it. `vendorProblems` now reports an absent mirror, so `doctor` calls
  such a tree unready instead of a build saying `Could not resolve` two passes
  later. `src/vendor/mirror.ts` holds all of it; `tests/vendor-mirror.test.ts`
  is the guard and its four cases go red with each half reverted — including
  the placeholder drifting from what the vendored tree imports, which is a
  literal in this repository that nothing else would notice.
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
  composition — 67 names over the tree as it stands — and reading it by
  composition is the point: 13 of them are `footage:<track>/tile:<col>:<row>`,
  which `src/cli/footage.ts` REFUSES a bound track without, so they are a
  protocol rather than a declaration; the rest are the fixtures and the four
  labels `footage-tracks` draws. `reel`, the one composition here at film
  length, records **0 named of 631 nodes** and so cannot fail this gate at all.
  A buried tile is a real finding and is the layer the occlusion defect came
  from, but that defect's caption was not a tile, and nothing at film length
  names its captions.
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
  and a white full-bleed child under a rotated square-cornered window is
  byte-identical to a white rotated box over 54 size/angle cases
  (`engine/core/src/tests.rs`, red with the level builder made binary).
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
  every composition that declares footage — 2 of the ledger's 22 today. The
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

## What does not reach them yet

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
- **`render` mixes from the sound schema, and four shapes it cannot express
  have each had to be built by hand against it.** `compositions/reel` declares
  its bed in the sidecar and `render` muxes that graph;
  `compositions/sound-roles` declares one element of each role. A mix that
  needs any of the following has to be written outside the schema:
  - a gain ramp across a window, or a piecewise-linear gain envelope; the
    schema has one `gain` per element
  - an enforced digital silence at the tail, measured after the mux, with the
    fade-out completing *before* it rather than at the end of the picture
  - a role that is mixed if its file is present and skipped if it is not; the
    schema refuses a missing declared file and has no "if present"
  - a duck applied to a bed for a whole cut, rather than for the span of one
    narration line
  The decision about which of these to add belongs upstream of the mixer.
- **`--alpha` delivers a container, not a picture.** `render --format
  mov --alpha` really does write ProRes 4444 and `--format webm --alpha` a
  WebM with `alpha_mode=1`, both read back with ffprobe in
  `tests/format.test.ts`. What neither carries is information: the rasteriser
  clears the framebuffer to OPAQUE black (`clear_black` calls `fill_opaque`,
  `engine/core/src/raster.rs`), so every frame's alpha byte is 255 whether or
  not the composition declares a ground. Changing the clear is a core change
  and belongs in `patches/`.

  The hole is stated in three places and MEASURED in one, which is the part
  that matters: `render --alpha` scans every frame for the smallest alpha byte
  and prints `alpha floor N`, so the day the clear changes, the number moves
  and the prose does not have to be remembered. `compositions/alpha` is the
  fixture — the only composition here whose root View carries no `bg-*` — and
  it is in both ledgers, its digest being the one in the tree that would move
  if the clear colour did.
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
- **A full ledger run's disk cost is set by the footage in the tree, and only
  the ledger can measure it.** Ingest decodes each footage track to raw RGBA
  next to the bundle and leaves it there. Measured 2026-09-02 by clearing
  `dist/**/*.rgba` and running the whole ledger serially: 5 `.rgba` files
  totalling 721,152,000 bytes — 688 MiB — from 1.5 MB of tracked clips. A tree
  carrying recorded material at film length reached 92 files and 120 GB and
  filled a 1.8 TiB volume, and the ingest that hit the wall reported
  `No space left on device` from ffmpeg rather than anything about capacity.
  That measurement is `FULL_RUN_RGBA_BYTES` (`src/cli/disk.ts`), in bytes
  because bytes are what was read, and both readers derive from it: `doctor`
  FAILS below it and passes calling the headroom thin below `HEADROOM_MULTIPLE`
  times it, and `scripts/digests.ts` prints the same two numbers before it
  starts. It used to be a HIGH-WATER MARK from a tree that no longer exists —
  52 files and 64 GiB, measured 2026-08-20 — and gating on that made `doctor`
  red on every hosted runner, 11.6 GiB free against a 64 GiB threshold, which
  took the `AUTHORING.md` and `SKILL.md` command gates down with it because
  both run `doctor` out of a documented fence. Three failures, one stale
  number. `tests/doctor.test.ts` pins the verdict at each end of the band, and
  is red at 11.6 GiB the moment the constant goes back to 64. A composition
  added tomorrow moves the need and nothing else would notice, so a full run
  re-reads `dist/` at the end and reports when what it left disagrees with the
  constant by a file or by more than 5%. The bytes are re-derivable and safe
  to delete.
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
- **The shared build file is held by a lock, not by isolation.**
  `withBuildLock` serialises every build this CLI spawns, but the file it
  protects — `vendor/pocketjs/framework/src/styles.generated.ts` — is still one
  path shared by every process on the machine. A build started straight from
  `bun vendor/pocketjs/tools/build.ts`, or a second checkout sharing a vendored
  tree, takes no lock and is not seen. Making pass 1 write inside the
  `--outdir` is upstream's change; until then the lock is the whole of the
  protection and `openMeasurer`'s refusal is the only detector.

## Working rules

- Conventional Commits for the subject line: `type(scope): summary`.
- Never edit `vendor/`. It is rebuilt by `scripts/vendor.ts` from
  `patches/NNNN-*.patch` applied in sorted order against the pinned upstream
  commit. A change to engine behaviour is a new patch, and a patch is one of
  two classes (`patches/README.md`): `upstream`, a change that belongs in
  pocket-stack/pocketjs and is rebased onto its main when submitted — the
  declaration layer, target-independent; or `motion`, a change this
  rasteriser needs and no upstream target will draw, never submitted, with
  the reason on a `pocket-motion-only:` line in the patch's own header —
  the paint layer. A `motion` draw-list op takes a code at or above
  `MOTION_DRAW_OP_BASE` (64, `src/vendor/draw-ops.ts`): upstream allocates
  densely from 1 and took 10 for `surfaceQuad` after `0008` had given 10 to
  POLY. `tests/patches.test.ts` holds the classification and the range, and
  goes red on the number collision the day the pin moves onto one. Whatever
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
