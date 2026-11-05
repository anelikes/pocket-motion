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
- **An artifact a warm cache served from a recipe the tree no longer runs.**
  The footage cache key held what the sidecar decides and nothing the ingest
  code decides, so an edit to a scaler flag left every warm `dist` rendering
  the bytes the previous flags made — and a flag that moves bytes only on x86
  would have shown nothing on the machine where it was edited. Recorded as a
  hole rather than seen moving a digest — declared. The key now carries the
  ingest argv and the ffmpeg build (`src/cli/footage.ts`), and
  `tests/footage-cli.test.ts` plants an older recipe's artifact and requires a
  re-decode.
- **An identity that named the directory a build ran in.** The same sources
  staged into two directories, built from a project outside the checkout or
  against an installed package reported two identities with every frame
  equal, so `render --spec` reported none and a batch deduplicated only
  because its staging paths were named after their content — declared. The
  bundle's module names (`patches/0051`), `build.json`'s argv
  (`src/render/build-record.ts`) and the wasm (`patches/0052`,
  `scripts/vendor.ts`) carry no directory now; `tests/build-location.test.ts`
  holds it.
- **A verification that read windows carrying no evidence.** `sound --verify`
  reported every element of a correct mix absent, because the residual was
  measured in windows where the source was itself silent — where a muxed
  element and a missing one are indistinguishable — seen. Windows are now
  placed on voiced material and a per-window floor decides which of them carry
  evidence (`src/sound/verify.ts`, `tests/sound.test.ts`).
- **A delivered file whose container, colour and length were defaults.**
  `render --format webm` on a composition with sound wrote an ISO MP4 of VP9
  and AAC under the `.webm` name, its alpha gone, and `--format mov` exited 1;
  every encoded file was converted to YUV with swscale's default BT.601 matrix
  and tagged with nothing, so a player taking BT.709 for untagged HD showed
  255 green as 216; and the mix ended with its last element, a 1 s audio
  stream in a 2 s film — declared. The mux writes the container `--format`
  names (`src/sound/mux.ts`), the conversion names BT.709 and the stream
  carries it (`DELIVERY_COLOUR`, `src/render/encode.ts`), and every mix is
  padded to the film (`src/sound/mix.ts`). `tests/format.test.ts` reads
  each back out of the file.

- **An emoji drawn as an empty box with every gate green.** The hajibang
  port's title carried an emoji no declared face mapped: the build baked what
  the face had, the core laid the codepoint out and drew the tofu box,
  counted the miss on a counter nothing read, and `lint`, `check`, `trace`
  and the digest all passed — seen. A face that can supply such codepoints is
  now declared, `fonts.fallback` (`--font-fallback`), and never looked up on
  the host; the core keeps the distinct codepoints that missed
  (`ui_glyph_missed`, `patches/0063`); `check` fails naming each codepoint
  and every text node whose string carries it, `trace` and `render` print
  them and put `missingGlyphs` in `--json`, and `render --spec` refuses the
  job before its first frame reaches the encoder (`src/text/missing.ts`). A
  glyph the core cannot draw as declared — a colour glyph with a composite
  or a focal radial, a codepoint that is a picture only inside a shaped
  sequence — is left out of the slot by name at build, so it takes the same
  road. `tests/colour-glyphs.test.ts` holds it.

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
  sha256, and the build argv with every path relative to what it belongs to
  (next entry; `--hz` and `--density` are written down in it). No timestamp:
  a clock reading is not an input. `identity`'s `toolchain` component hashes
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
- **Where a build runs is not an input.** One set of declared inputs built
  from this checkout, from a randomly named staging directory, from a project
  outside the repository reached through a symlink, or against an installed
  package writes one bundle, one pak and one `build.json`, and reports one
  identity. Three routes carried the directory into the bytes, and each is
  closed where it started:

  - **The bundle's module names.** Bun writes each module's name above its
    code, and the name is its realpath relative to the build process's cwd
    — not `root` (measured on Bun 1.3.11). So a staged job's app was
    `// dist/captions-job-Xq3/main.tsx`, a project outside the checkout named
    every framework module `// ../../../Users/<someone>/…/vendor/pocketjs/…`,
    and an installed package `// node_modules/pocket-motion/vendor/…`.
    `patches/0051` (class `upstream`) renames each by what it is, after pass
    2, from the metafile: relative to the PocketJS tree
    (`framework/src/index.ts`), `./` and relative to the composition's
    directory (`./app.tsx`), `.entries/` under `--outdir`, from the last
    `node_modules/`, or else relative to the composition. Bun can print a
    module's name line twice (an entry that exports has its namespace object
    placed ahead of its imports), so every such line is rewritten, and Bun's
    transpiler, which drops comments, must print the same program before and
    after: a template literal repeating a name line fails the build rather
    than being rewritten, and so does a module with code and no name line.
  - **`build.json`'s argv.** The entry is written relative to the
    composition's directory and `--outdir` relative to the record itself
    (`main.tsx`, `--outdir=.`), the compiler relative to this package, and a
    face the sidecar names by an absolute path relative to the project
    (`relativise`, `src/render/build-record.ts`). Relative to the repository,
    as it was, the entry and outdir named the composition's path, so one job
    staged twice was two `toolchain` components.
  - **The wasm.** rustc writes every reachable panic's source path into the
    module as cargo hands it over, and folds cargo's `-C metadata` into every
    symbol's crate disambiguator; for a path dependency outside the
    workspace root that hash is of its absolute path, and the disambiguators
    order the module's functions. `engine/wasm` is a workspace of its own and
    reached pocketjs-core as `../core`. `patches/0052` (class `motion`) makes
    it `core`, a symlink cargo does not resolve, so the core is a member
    hashed and handed to rustc by a relative path; `scripts/vendor.ts`
    remaps cargo's home for the registry crates, through `--config` because
    `RUSTFLAGS` would replace 0022's `+simd128`. Before, the module carried
    24 absolute paths, 18 into the checkout and 6 into `~/.cargo/registry`,
    and two copies of `engine/` with every path remapped still differed in
    18,502 bytes; after, it carries none, `target_features` still names
    `simd128`, and builds from this worktree and two scratch directories
    were byte-identical.

  `tests/build-location.test.ts` builds `compositions/vector-paths` from the
  checkout, a `mkdtemp` under `dist/` and a symlinked project in the
  system's temp directory and holds bundle, pak, `build.json` and identity
  equal; red with 0051's rename disabled (both copies, `bundle`) and with
  the record's old anchors restored (the staged copy, `toolchain`). The same file renders
  one `render --spec` job twice and holds the identities equal, and
  `tests/package.test.ts` holds an installed package's identity for `smoke`
  equal to this checkout's, component by component, and is red on `bundle`
  alone with the rename disabled.
  `tests/bundle-names.test.ts` holds the naming rules and both refusals.
  Measured on the ledger: every one of its 42 bundles changed bytes, in 45
  to 47 name lines each and in no other line, and every frame digest is
  unchanged; each of the 42 rebuilt from a randomly named directory at the
  same depth wrote the same bundle, pak and `build.json`.
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
  namespace, where 0051 names it by its place in the tree,
  `framework/src/styles.generated.ts`; when the backport landed on
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
  composition — 200 names over the tree as it stands — and reading it by
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
  Four lines are load-bearing. **A name the tree does not carry is a FAILURE,
  not a skip** — otherwise renaming a `debugName` turns every assertion about it
  green at once, which is the cheapest way for this to stop meaning anything.
  A name the tree carries whose node no sampled frame laid out — it or an
  ancestor `display: none`, or an ancestor at opacity 0, at every one — fails
  too, since nothing was measured, and the detail says that and names the
  frames rather than "no node carries the debugName", which the hajibang
  port's twenty-rank request was told 40 times about nodes the tree carried.
  **Every verdict is about the sampled frames**, and the printed line and the
  JSON's `grid` name them; `--samples <durationFrames>` is the exact case.
  **The sampled frames are the even grid plus what each assertion names**
  (`assertionFrames`, `src/render/assertions.ts`): an `inPicture` window's
  ends, an `entersBy` frame, an `exitsBy` frame and the one after it, and —
  read in a second boot once the first sweep has run — every frame between a
  `before` node's first showing and the sample before it, so two entrances
  inside one stride are not a tie. An even grid alone decides a window
  narrower than its stride by where the stride falls: on the twenty-rank
  request, 1 s a rank over 1,125 frames, 24 samples step every 49 and 66 of
  107 assertions failed on a correct film; with the named frames all 107
  hold over 109 sampled frames. `compositions/short-sections` is that shape
  at fixture size — eight 9-frame ranks under a 13-frame stride, 8 of 19
  red on the even grid, green on the default grid and at every frame — and
  `tests/assert.test.ts` is red with `assertionFrames` emptied, with the old
  message, and with `pinFrames` emptied. **`dwellFrames` is
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
- **Dashes, a morph between unlike keys and motion along a path are three
  declarations, each with a stated rule** (`patches/0045`, `0046`, class
  `motion`, and `src/anim/path-motion.ts`; the design and the numbers in
  `patches/0045-path-primitives.design.md` and `baselines/path-primitives.md`).
  A dash pattern is style, not geometry — props 187-192, no op, no table —
  and with none the core calls 0042's trim itself, so every stroke without
  one is the bytes it was. The pattern is measured from each subpath's start,
  so a trim reveals dashes without moving them; a zero-length dash is a dot
  of its caps, wound so it joins the stroke's union; a pattern that would
  draw solid is refused at the class, not drawn solid under a class that says
  dashed. A morph whose keys' commands line up bakes the bytes 0043 baked
  (three such key sets pinned by hash); keys drawn separately are equalised
  by four rules in order — key 0 as written, pairing by size, a whole key
  reversed or none, closed starts at the least squared distance, every key
  cut at every key's vertices — splitting cubics only, so each key keeps its
  outline. Motion along a path is baked by the kit into translate and rotate
  keyframes, `atan2Deg` instead of the host's `Math.atan2` because the angle
  reaches the pak. The core's guards are `engine/core/src/path_tests.rs`, the
  compiler's and the kit's `tests/path-primitives.test.ts` and catalogue rows
  `paint.dash`, `animation.morph` and `declare.motionPath`; all 17 core
  defects in `baselines/path-primitives/redcheck.py` and all 17 host-side
  ones in `redcheck-ts.ts` beside it were watched red.
  `compositions/path-primitives` is the fixture, in both ledgers; its test
  reads the movers' centres off `layout` against the outline and the dashed
  connector's pixels against its pattern.
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
- **An SVG file can be imported as parts, and what it cannot carry is
  refused by name** (`patches/0053`, class `motion`). `<Svg src parts>` is
  expanded by the build ahead of the collector (`framework/compiler/svg-tree.ts`
  and the expander in `jsx-plugin.ts`) into a View per `<g>` with an id and a
  `<Path>` per shape, every id a `debugName`, so `assertions[]` and
  `visibility` reach a part by the name the file gave it. Two choices carry
  it. The file's transforms, viewBox and preserveAspectRatio are FOLDED into
  the outlines — rotations and skews through `cosSinDeg`, so the pak does not
  depend on the host's `Math.cos`, the hole `bake-svg.ts` still has — and each
  part's node is its own bounds on whole px, so it turns and scales about its
  own centre and its View's transform props hold the author's animation
  rather than the file's. And a `parts` entry is joined to its part's paint
  tokens at BUILD time as one literal carrying the entry's location: a node
  takes one class string, a string joined at mount is one the build never
  compiled, and the provenance record (`0012`) would not reach it — with the
  join written as a `+`, a token that does not parse compiles to nothing and
  the build exits 0. A cached transform holds the files its expansions read
  by sha256, because the cache key is the module's own text and an edit to
  the `.svg` alone would rebuild the old picture. `lint` and `check` read the
  same elements (`src/lint/svg-trees.ts`, `svg.missingFile` and
  `svg.unsupported`), and the image lint no longer reads an `<Svg>`'s `src`
  as a picture name, since the build never sees that literal. The canvas is
  named `svg:<src>`, and `content_overlap` does not pair two nodes inside one:
  `compositions/svg-import` produced 14 findings at its last frame, every one
  two lighthouse parts the file draws over each other. Fixture
  `compositions/svg-import`, in both ledgers, its sidecar asserting the order
  the parts are drawn in; `tests/svg-import.test.ts` and catalogue gate G10
  hold the rest, every guard watched red by `baselines/svg-import/redcheck.ts`
  (`runs/redcheck.txt`).
- **A `d` computed at mount is baked from the mounted tree** (`patches/0054`,
  class `motion`; `src/cli/build.ts`, `src/render/path-inventory.ts`). The
  collector reports every `d` it cannot read and the build prints them on one
  `paths at mount:` line; only then does `runBuild` mount the bundle with
  `ui.__unbakedPath` installed, collect every key the tree asked for and did
  not find, write them to `<output>.paths.json` beside the pak, build again
  with `--path-inventory=` — the argv `build.json` records, so identity's
  `toolchain` component carries it — and mount the rebuilt bundle, which must
  ask for nothing. That second mount is not a formality: the bundle's
  `PATH_IDS` differ between the two builds, and a composition whose outlines
  depend on them is refused (`tests/path-inventory.test.ts` constructs one by
  reading its own table). The inventory adds no input: it is a function of
  the bundle, computed in the render's realm, which refuses the clock,
  randomness and locale formatting. A composition whose every `d` is a literal
  prints no line, is never mounted at build and builds once: over the 42
  compositions of the digest ledger, built through `runBuild` with and without
  both patches, every pak is byte-identical and none took the mount path;
  every bundle moved, by `setPath`'s hook, which every bundle carries
  (`baselines/svg-import.md`). `compositions/data-chart` computes four
  outlines from rows in another module, and the same chart with them written
  as literals bakes the same pak byte for byte; the mount path costs it one
  build and two boots, 0.90-1.24 s a build against 0.45-0.53 s. Fixture
  `compositions/data-chart`, in both ledgers.
- **A job is a spec, and the sample is not the job.** `render --spec job.json`
  stages a throwaway copy of the composition (`src/cli/stage-sources.ts`), runs
  the generator into it, builds, encodes and removes the tree, so a batch never
  edits the composition it renders from. The spec parser
  (`src/manifest/spec.ts`) refuses unknown keys, and `--frames`, `--fps`,
  `--width`, `--height`, `--supersample`, `--bundle` and `--pak` are refused
  alongside `--spec`, because a job is a complete description rather than a
  patch on the sample. `trace` does not accept `--spec`, so a job never enters
  the identity ledger; `render --json` reports its identity, which the staging
  directory's name does not reach (the entry above). `tests/spec.test.ts`
  drives the path and
  `tests/lower-third.test.ts` drives the template with the most inputs.
- **A job's render checks the job's own assertions.** The staged tree is the
  only place a job's `assertions[]` exist and it is removed when `render`
  returns, so `render --spec` evaluates them there, after the build and before
  the encode: `assert`'s own function (`assertComposition`,
  `src/cli/commands/assert.ts`) and its JSON, carried verbatim as
  `assertions` in `--json` — per job for a directory of jobs. A job one fails
  is refused, exit 1, nothing written, the failing frames named; refusing
  before the encode is the order `openFootage` keeps with the ingest.
  **On by default, because of what it was measured to cost**: CPU over the
  whole job (stage, build, render, encode) on an M4 at a load of 25–50, a 6 s
  alpha captions job 9.3 s → 10.0 s, a 3.4 s burn-in over footage
  13.5 s → 17.8 s, and a 60 s transcript of 132 words, 283 frames sampled,
  57.8 s → 66.4 s — 7 to 32%; on hajibang's three ported requests `assert`
  alone is 8 to 16% of `render`. A sidecar that declares no assertions
  returns before booting. `--no-assert` skips the check, for the run that
  wants the video of a failing job; it is refused without `--spec`, where
  `render` checks nothing and `assert <dir>` is the command.
  `tests/spec.test.ts` stages `compositions/short-sections` under a sidecar
  the job writes, since no shipped template can write a false assertion, and
  is red with the check removed.
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
  `60/fps`-th tick, the LAST of each frame's window (`clockOfFrame`, next
  entry), so an instant on an even tick at 30 fps — tick 0 included — is
  never observed and the first frame past it shows it a tick under way. It
  is reported, not failed — 955 of `reel`'s 1160 timeline uses (707 baked
  entries, shared across style records) declare one, so a gate would be red
  on the ledger from the day it landed. A timeline whose delay outlives its
  clock **is** failed: it is a declared animation no frame of that
  composition can show. Fixture: `compositions/late-anim`, which `lint`,
  `check` and `trace` all pass.
  **Two more readings come off the same table, both reported rather than
  failed, and the tree was measured before that was decided.** A step no
  longer than one rendered frame that a sampled tick lands strictly inside
  is shown part-way by that frame — a `gin 34ms` gate from an even tick at
  30 fps arrives a frame late and grey, which is how `rename-card`'s close
  first rendered; `shutter` and `rename-card` carry the same 578 of them, in
  456 timeline uses of the opening `rename-card` keeps, all in the 34 ms
  cadence shutter measured off its recording, so failing on them would fail
  two films for a frame each. The kit-built films report too and carry no
  gate at all — the open entry below says why. And a property two animations
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
  `late-anim` carries one of each (`gated`, `contended`), every composition's
  count of each is in `baselines/keyframes-phase.md`, and
  `tests/keyframes.test.ts` is red on each with its predicate removed. The
  bake rate it places those timelines on is ASSUMED, not read: the rate is
  published by the bundle and this command does not boot. `readTimelines`
  takes it as a required input rather than defaulting to 60, so no caller can
  inherit it silently, and the printed header names the number. The
  assumption is bounded rather than safe — `assertBakedTickRate` refuses a
  bundle baked at another rate, so a pak this would misread is a pak no
  command can render. It reads a track of any length — it decodes through
  the vendored `decodeStyleTable`, which reads 0050's wide count — and the
  long-track block of `tests/keyframes.test.ts` holds every timeline of
  `compositions/long-track` to the segments its keyframe set declares and
  reads the camera's cut after its 2,000th segment, which a decoder reading
  the count's low byte would never reach.
- **Which tick a frame shows is one function, and it is read off pixels.**
  The host steps the core `60/fps` ticks per frame and rasterises after the
  last of them, frame 0 included, and the core samples a timeline at its
  clock before advancing it (`tick_timelines`, from 0 at
  `restart_timelines`). So frame `f` shows clock `(f + 1) · 60/fps − 1` —
  `f` at 60 fps, `2f + 1` at 30, `3f + 2` at 20 — and `clockOfFrame`
  (`src/runtime/clock.ts`) is the one statement of it: `keyframes`, the
  captions template's `clockAt` and the motion kit's header derive from it.
  `keyframes` used to take the FIRST tick, `f · 60/fps`, which agrees at
  60 fps only; below it every phase-dependent reading sat a tick off.
  `late-anim`'s `gated` step over ticks 3 to 5 was reported half done by
  frame 2 and was at full opacity there, and the instants called unsampled
  at 30 fps were exactly the ones the render samples. The fixture now
  carries a `ruler` moving a pixel a tick, retimed so each node is what its
  name says on this grid, and `tests/keyframes.test.ts` reads the ruler out
  of `frame`'s PNGs at 20, 30 and 60 fps and holds the readings to the same
  PNGs through the frame numbers `keyframes` now reports (`observedFrame`,
  `PartialCut.frame`): the frame it names inside `gated`'s step reads 125
  red between frames of 2 and 248. With the first-tick placement put back,
  eight of that file's cases fail, both pixel tests among them. Readings
  that depend on the segments alone — contention, jumps, `neverStarts`,
  `endsPastWindow`, period and loop drift — are identical per timeline in
  all 55 compositions on both grids (`baselines/keyframes-phase/measure.ts`
  stops on a difference); `neverStarts` was already on the right side,
  since the last frame shows tick `durationFrames · 60/fps − 1`. No digest
  moved: what moved is what `keyframes` says about a pak.
- **A baked track holds up to 65,535 segments**
  (`patches/0050-long-animation-tracks.patch`, class `upstream`). The 255 a
  track held was the format's: `segCount` is the second byte of a track
  header, the encoder threw above it and the core read one byte, while the
  baker had no limit of its own. So `src/anim/sampled.ts` refused more than
  250 keys, and a film-length move was keyed once per eight frames or split
  by hand. A `segCount` byte of 0, which every earlier core refuses, is now
  followed by a u16 count, written only above 255, so a table with no long
  track is the bytes it was: every bundle and pak of the digest ledger built
  byte-identical before and after the patch (`baselines/long-tracks.md`).
  The count goes no further than a timeline's own u16 period allows, since
  every segment spans at least a frame, and the kit now refuses the period
  instead (`Reg`, `MAX_TICKS`). `sample_track` walked from the first segment
  on every tick and now searches on `t1`; that is the walk's answer only for
  sorted, disjoint segments, so the parser refuses any other order rather
  than trusting it. A 7.5-minute camera track — six tracks of 13,500
  segments — traced in 2.4 s of user CPU searching against 4.0 s walking,
  every frame hash equal. **Chaining was measured and refused.** A long track
  split into consecutive animations on one property in one comma list renders
  byte for byte like the single track without a shutter. Under one, the later
  animation's start is a fill-less edge, which the shutter never samples
  across, so the samples on the earlier side of a hand-off are clamped to its
  value: with the hand-off on a sampled tick, frame 150 of 300 differed at
  180° and at 360° (`baselines/long-tracks/chain.ts`), and `keyframes`
  reports no jump there. At 60 fps every tick is a frame's, and the same
  chain with its hand-off on an even tick, which showed nothing at 30 fps,
  differs at frame 300 of 600. `compositions/long-track` is the
  fixture, in both ledgers: a camera whose six transform tracks carry 2,003
  segments each and cut to the last station at tick 4100, past the 2,000th,
  and a frame counter whose units glyphs carry 841 each.
  `tests/long-track.test.ts` reads every station at the canvas centre on its
  arrival from `layout`, runs the sidecar's assertions, and carries a
  kit-written 70-second move through the vendored baker, encoder and decoder
  segment for segment; it is red with 0050 out of `patches/` and with the
  kit's 250-key refusal restored. The patch's own tests hold the format and
  the search, each red under an edit its header names.
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
- **A size the atlas cannot hold is baked as outlines, and the switch-over
  is measured rather than assumed** (`patches/0063`, class `motion`; the
  numbers and their reproducers in `baselines/vector-glyphs.md`). The FONT
  ATLAS stores its cell, baseline, line height, advances and kern deltas in
  bytes, so `patches/0002` refused a size whose cell passed 255 px, and its
  cells stay upright under a rotation. A FONT VECTOR blob carries the same
  quantities from the same formulas in u16/i16 fields and the glyphs as
  outlines; `bakeAtlases` bakes one where the cell would pass 255 px or the
  literal says `text-vector`, and the build says which and why. The core
  lays the run out as an atlas run and fills each glyph's layers as PATH
  ops through the node's world affine, rounding the anchor to a pixel
  exactly where GLYPH_RUN rounds it, so the turn and the scale reach the
  glyph and the static case lands where the atlas would. At each face's
  ceiling — 176 px Noto Sans SC Bold, 211 px Inter — `tests/vector-glyphs.test.ts`
  holds every advance, kern pair, baseline, cell and line height of the
  vector slot equal to the atlas slot's over the whole collected charset,
  and the drawn ink within a pixel at every edge and 0.5% apart pixel for
  pixel with each cell's anchor half a pixel off the grid (the bound is
  1.5%; left unrounded, the anchor measured 2.96%). One px past the ceiling bakes rather than
  being refused. A face with COLR draws its glyphs as layers — solid, or a
  gradient under PAINT_PUSH, whose stop bound went from 6 to 16 for Noto's
  colour lines (a class literal's gradient keeps 6, its style props' count)
  — in a vector slot as the glyph, and in an atlas slot as a supplement the
  run draws after its cells. `colr.ts` flattens COLR v0 and v1 and refuses by
  name what the core cannot draw: of Noto Color Emoji's 1,469 colour
  codepoints 1,398 draw, and every other is listed by
  `baselines/vector-glyphs/refused.ts`. The core's own tests
  (`engine/core/src/vector_text_tests.rs`) hold the blob's refusals, the
  wide metrics, the PATH emission, the turn, the supplement and the
  gradient mapping. Every guard here and in `tests/colour-glyphs.test.ts`
  was watched red by `baselines/vector-glyphs/redcheck.ts`.
  `compositions/hero-type` is the fixture, in both ledgers: a 480 px CJK
  hero rising scaled and turned, a turning `text-vector` character, a
  turning colour glyph from a vector slot, and a 64 px title with two
  emoji from the atlas slot's supplement, its sidecar asserting each is up.
- **A delivered file is read back the way a player reads it.** Frame
  digests are taken before the encoder, so nothing about the file itself was
  checked until `tests/format.test.ts`'s "delivered files, read back" drove
  the encode leg and the sound mux with a field of flat patches and a 1 s
  tone under a 2 s film, in all three containers, alpha and not. What it
  holds, each measured on main first and each seen red with its fix taken
  out:
  - **The container.** Read from the bytes, not from ffprobe's `format_name`,
    which is `matroska,webm` for both Matroska flavours and one string for
    MP4 and MOV: the `ftyp` brand (`isom`, `qt  `) and the EBML DocType
    (`webm`). Both legs name it with `-f`; inferred from `--out`, a `--format
    mov --out cut` that `render` accepts failed in ffmpeg. With sound, MP4
    carries AAC, WebM Opus at 48 kHz (WebM carries Opus or Vorbis and nothing
    else), MOV 24-bit PCM at 48 kHz, the ProRes container's own convention.
  - **The alpha through the mux.** The video stream is copied, and the test
    decodes it on both sides of the mux and requires the same bytes. For VP9
    it also reads the track's AlphaMode element, which is what a browser
    reads: ffprobe's `alpha_mode` tag is derived — on a remuxed file it comes
    back as `ALPHA_MODE`, from a SimpleTag the remux copied — and stripping
    stream metadata in the mux removes the element while the decoded alpha
    still compares equal through libvpx, so only the element catches it.
  - **The colour.** The RGB → YUV `scale` names `out_color_matrix=bt709`
    and `out_range=tv`, and primaries and transfer go on the frames with
    `setparams`: ffmpeg 8.0's encoder takes them from the frames, and with
    the four output options and no `setparams` the stream came out tagged
    with matrix and range only. On 8.0 the output `-colorspace` drives the
    negotiation too, so tags without the named matrix also convert BT.709 —
    measured — and the matrix is named anyway so the conversion does not
    rest on that. The decode honours the tags, BT.709 where there are none;
    every patch is within 1 level through H.264 and VP9 and 0 through ProRes,
    against 39 and 40 on main. BT.601 pixels under BT.709 tags — the
    combination a tag must not paper over — read back 7 of 8 patches out, up
    to 39 levels; grey is the same under either matrix. Naming BT.601 in the
    `scale` while the output asks BT.709 is not that combination on 8.0: it
    inserts a second, YUV-to-YUV conversion and lands 4 patches 4–5 levels
    out, grey included, which is why both read one `DELIVERY_COLOUR`.
    ProRes has no range field, in its bitstream or MOV's `colr`, so its range
    reads absent and decoders take video range.
  - **The length.** Every mix graph ends with `apad` to the film, and the
    mux's `-t` cuts one that runs longer. Audio and video agree to one codec
    frame both as the container states them and as a decode yields samples:
    MP4 states 2.000 s for both and decodes 20 ms over, inside AAC's 1024
    samples; WebM states 2.008 s for Opus and decodes exactly 2.000; MOV is
    exact both ways.
  - **No muxer version in the container.** `-fflags +bitexact` sat before
    `-i` in both legs, where it acts on the demuxer, and every delivery
    carried `encoder=Lavf62.3.100`. It is an output flag now.

  Two readers had to move with it. `sound --verify` reads every window from
  one decode of the delivery rather than seeking into it, because an input
  `-ss` is not on one clock across containers: out of the MP4 a window cut at
  0.75 s matched the full decode sample for sample, out of the Opus WebM it
  matched 384 samples (8.0 ms) earlier, which put the fixture's 440 Hz
  narration nearly in antiphase and read the bed's level window at +6.0 dB
  against a declared −24.4. And `*.sound.json` is named after the whole delivered file —
  `hero.mp4.sound.json`, where it was `hero.sound.json` — because `hero.mp4`
  and `hero.webm`, one `<video>`'s two sources, shared one record. The
  CLI half renders `compositions/sound-roles` to WebM and MOV: the 500 ms
  tail is digital silence through Opus and PCM with the same 50 ms guard, and
  `sound --verify` passes every element in both. ffmpeg 8.0 prints `Error
  parsing Opus packet header` once when it decodes any Opus WebM it wrote,
  this repository's or one from `lavfi` alone; the decode is complete to
  the sample, the last 20 ms at full level.
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
  synthetic tracks — every one produces the whole-clip digest
  `baselines/ingest-bytes.json` records, so the aarch64 path already is that reference
  and the flags move no recorded digest on this machine.
  `tests/footage-cli.test.ts` pins the string for all three fits — a fit that
  keeps `lanczos` and loses `accurate_rnd` decodes to different bytes on x86
  and the same bytes here, so nothing local would report it.
- **Ingest decodes what a composition can show, and its cache key is what a
  decode runs** (`src/cli/footage.ts`, `src/footage/ingest.ts`). A track can
  show source frames `[sourceFrame, sourceFrame + min(endFrame,
  durationFrames) - startFrame)` (`reachableSpan`) — the sidecar's
  `durationFrames`, not a `--frames` given to one command, so `check` and
  `trace` read one artifact. Tracks that decode to the same bytes — one
  source by content, one drawn size, `fit` and `tile` — share one artifact
  holding the union of their spans in order; the layer finds a source frame
  through the manifest's spans and refuses one outside them, where it used to
  clamp. Before, every track decoded its whole clip: `captions/burn-zh` kept
  179 frames for a 101-frame window, and `footage-tracks` decoded one clip
  whole twice for its windows at [0, 60) and [89, 179), which are now one
  150-frame artifact. The decode still starts at the clip's first frame and
  stops at the last span's end, and frames outside the spans stream through
  and are dropped before the disk. It does not seek, and that was measured:
  `-r` counts from the first frame it is handed, and on the 24 fps clip read
  at 30 an input seek to frame 20 decoded [20, 140) to the same bytes while a
  seek to frame 89 decoded [89, 179) to different ones. Byte identity was
  measured too: all five artifacts the ledger ingests are byte slices of the
  whole decodes, whose digests `baselines/ingest-bytes.json` keeps beside each
  span, and no frame digest moved. Identity's `footage:<id>` components
  moved with every artifact that is now less than its clip — all but
  `wide-contain`, whose window is its whole clip — because they hash the
  artifact.

  The key (`footageCacheKey`) is the source's sha256, the drawn size, fps,
  `fit`, `tile`, the spans, the RECIPE — the argv minus the source path, from
  `ingestArgv`, which also builds the argv the decode runs — and a digest of
  all of `ffmpeg -version`. It used to hold what the sidecar decides and
  nothing the ingest code decides, so a changed scaler flag left a warm
  `dist` serving the old recipe's artifact, and CI, which starts with no
  `dist`, could not see it. The ffmpeg build is in it because a hit has to be
  what a miss would decode, and a miss runs the installed ffmpeg: the H.264
  decode is bit-exact by specification, but the RGBA conversion, the resample
  and `-r`'s choice of picture are library and fftools code, and
  `accurate_rnd`/`bitexact` pin how one build rounds on two architectures,
  not what another release computes. That costs one re-decode per artifact
  after an ffmpeg upgrade. Identity still leaves the build out
  (`DELIBERATELY_ABSENT`), and the artifact standing in front of it is now
  always the installed build's. A cut that changes the frames shown
  re-decodes its span; one that only moves them in the film does not. An
  artifact is written beside and renamed over, so a process reading the old
  one keeps its inode, and a directory under `footage/` that no track reads is
  removed — which is where a tree built before spans keeps `wide-return`'s
  whole decode. `tests/footage-cli.test.ts` holds it: the union test is red
  with the whole clip decoded, with the spans' offsets dropped from the
  layer's addressing, and with the prune removed; the planted-artifact test,
  whose control shows a planted artifact IS a hit under today's recipe, is
  red with the recipe out of the key; the key's unit test is red with the
  ffmpeg build out.
- **The determinism claim is checked on a machine that is not the author's.**
  `.github/workflows/determinism.yml` runs the suite, the typecheck and the
  digest ledger on every push, on Linux/x86-64, against digests recorded on
  macOS/ARM — so every green run is a cross-platform reproduction per
  composition rather than one afternoon of hand-run commands. The whole ledger,
  never `--only` over a subset: a subset turns the workflow green while it
  checks less than its name claims. ffmpeg is pinned in the workflow rather than
  taken from whatever the image carries, because the frozen ingest artifact
  stands in front of the decoder and its bytes are an input to the digest of
  every composition that declares footage — 3 of the ledger's 42 today. The
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
  `trace`, `render`, `concat`, `verify`, `assert`, `layout` and `doctor`. Each turns
  its options into the argv the command would be typed with, runs it through
  `dispatch` (`src/cli/main.ts` — the parser, the command, and the
  conversion of a thrown error into `{ ok: false, error, exitCode }` that
  `main` used to hold inline), and returns it through `jsonPayload` and
  `envelope`, which are what `--json` writes through. So an API result is
  redacted and carries `runId` exactly as the printed object does, and
  nothing re-derives a verdict. `tests/api.test.ts` runs the CLI as a
  separate process with a hand-typed argv and requires equal objects;
  `render` may differ in `elapsedMs` and `msPerFrame` and nothing else. Red
  with `envelope()` skipped: eight of the nine parity cases.
- **The MCP server is the API, served.** `pocket-motion mcp`
  (`src/mcp/server.ts`) offers `verify`, `assert`, `layout`, `render`,
  `concat`, `trace` and `doctor` as tools over newline-delimited JSON-RPC on stdio. A
  tool's arguments are its API function's options with the composition as
  `dir`, and its result is that function's object, as `structuredContent`
  and as text; nothing in the server reads a verdict except to set
  `isError`, which means the object carries an `error` — `verify` saying no
  is the reading that was asked for, not a tool that failed. What an argv
  cannot carry — a cancel and per-frame progress — reaches `render` and
  `trace` as a `RunContext` through `dispatch` (`src/cli/types.ts`), and
  moves no field of a result that is not cancelled. Four mechanisms, each
  measured red in `tests/mcp.test.ts`, which drives the server as a
  separate process. **A cancelled render leaves no file it wrote**: a
  container is encoded to a hidden sibling and renamed over `--out` only
  when complete (`partialPathOf`, `src/cli/commands/render.ts`), so `--out`
  keeps what it held before — written straight to `--out`, the earlier
  delivery came back as the first bytes of an mp4 — and a cancelled png-seq
  render removes its frames. **The loop yields a macrotask a frame when it
  has a signal** (`src/render/render.ts`): a hash-only loop otherwise never
  lets stdin be read (a 20 ms timer fired once in 120 frames of `trace`),
  and without it a cancelled trace reached frame 450 of 450 and a cancelled
  png-seq render was not stopped in two minutes, while the mp4 cases stayed
  green on the encoder pipe's flush. **Every tool but `doctor` takes one
  turn** (`Turns`), because the rasteriser is wasm on the server's one
  thread and two calls would interleave rather than run side by side —
  bypassed, a second render reported frame 1 before the first had answered.
  **stdout is the protocol's alone**: a `--spec` job imports a generator into
  the server, so `console.log` and `process.stdout.write` both go to stderr
  while it serves; each half was red on its own, because Bun's `console.log`
  does not go through `process.stdout.write`. A client that closes stdin,
  or sends SIGTERM or SIGINT, cancels whatever is running and the server
  exits once it has unwound — without the signal handler, SIGTERM killed it
  mid-render with exit 143.
  Argument types and names are checked against each tool's schema, since
  `alpha: "false"` would reach the parser as `--alpha=false`; every value the
  CLI checks is still the CLI's to refuse. `skills/pocket-motion/SKILL.md`
  documents it, and its launch line runs under the fence gate.
- **`render --json` carries `trace`'s identity**, from one function
  (`compositionIdentity`, `src/cli/commands/trace.ts`), so a delivery holds
  the pair another machine checks with `trace`. A `--spec` job carries its
  own. It used to carry none, measured: one job staged twice moved both the
  `toolchain` and the `bundle` components, because the staged directory's
  random name was in `build.json`'s argv and in the bundle's module names.
  Neither is now ("Where a build runs is not an input"), and
  `tests/build-location.test.ts` renders one spec twice to one identity and
  a spec differing in one line of copy to another.
- **A frame the core would draw the same is not drawn again, and every
  frame is still hashed** (`src/render/reuse.ts`). `render()` — so `render`,
  `trace` and both ledgers — skips the raster of a frame whose draw-list hash
  (`ui_draw_hash`; under a shutter `ui_draw_hash_exposure`, every sample
  folded in order) and raster revision both equal the previous frame's, and
  delivers the previous frame's pixels. The pair is the core's own condition
  for nothing to repaint (`DamageTracker::prepare`, with the target, which a
  render never changes). The revision is the core's counter of texture, font
  atlas and style changes, exported by `patches/0055` (class `upstream`):
  a TEX_QUAD carries a texture handle the walk never resolves, so a freed
  bound texture leaves the words equal while the image leaves the frame. The
  frame hash is taken of every delivered frame, reused or not, so the digest
  examines every frame and the ledger — recorded with no reuse — is the check:
  all 45 compositions match with it on, and `trace --no-reuse` rasterises
  every frame for anyone who wants the comparison again. Over the 42 the
  ledger held when it was measured, the key held on 3,052 of 9,664 frames,
  never on a frame whose pixels moved, and saw 3,052 of the 3,131 whose
  pixels held. Under a shutter the key has to be
  the exposure's: an animation ending on a frame's tick leaves the next
  tick's draw list equal while the exposure before it was blurred.
  `tests/reuse.test.ts` holds that on a fixture it stages, the freed texture
  on `compositions/images`, and the plain case on `captions/highlight`, each
  red under the edit its header names. What it saves depends on how heavy a
  held frame's raster was: `transitions`, 403 of 756 frames held at 21 ms
  each, traces in 38% less CPU and renders in 13% less; a caption template's
  raster is about a millisecond, so its holds save little while every frame
  is still hashed. The key costs 0.07–13% of the raster on a frame that
  changes (`baselines/raster-reuse.md`).
- **The mp4's encode leg is chosen, and refused where it would not be what
  it says** (`src/render/encode.ts`). `render --preset` is libx264's;
  `--encoder h264_videotoolbox` is macOS's hardware encoder at constant
  quality `-q:v 87` with its software fallback off. One function,
  `encoderSettings`, builds the argv and is what `render --json` reports as
  `encoder`. Refused, with exit 2 before anything boots: either flag with
  webm, mov or png-seq, the hardware encoder with `--alpha`, a preset with
  the hardware encoder, and any encoder name not measured here; and with
  exit 1 before the boot, an encoder `ffmpeg -encoders` does not list, which
  is every Linux host. Measured in `baselines/encode-cost.md`: at libx264's
  own bitrate VideoToolbox lost 6.7 dB PSNR on a 10 s 1080p title and 15.1 dB
  on the hajibang ranking film, its `-b:v` saturates near 5 Mb/s whatever it
  is asked for, and `-q:v 87` is the lowest setting that matched libx264's
  default (`medium`, CRF 16) in PSNR and SSIM on both, at 2.8× and 3.9× the
  bytes, for about a fifth of the encode's CPU. **The hardware encoder's mp4
  is not the same bytes on another machine**; the digest does not depend on
  it, and MP4 bytes were never the determinism claim. On Linux the lever is
  the preset: `veryfast` took 41–51% off the encode's CPU for about 3 dB
  PSNR, `faster` 19–26% for about 1.5.
  `tests/reuse.test.ts` reads a VideoToolbox file back where ffmpeg has the
  encoder and asserts the refusal where it does not; the second branch was
  run here through a `PATH` shim whose `ffmpeg -encoders` omits it.
- **A film split into segments joins to the film `trace` reports, and the
  join reads its own output back.** `render --range <first>..<last>`
  renders a segment: every earlier frame runs its boundary, guest turn and
  ticks exactly as a whole render runs them and is not drawn
  (`render()`'s `range`, `src/render/render.ts`), and the segment is written
  with `<out>.segment.json` — its frame hashes, the film's identity, the hash
  algorithm and the encoder argv. `concat` joins segments from anywhere;
  `render --workers N` is N `render --range` children and the same join
  (`src/render/parallel.ts`, `src/render/segment.ts`), so the local path and
  the distributed one are one path. `planJoin` refuses mixed identity, gaps,
  overlaps and mixed encoding before a byte is joined; the media is checked
  against its manifest; and a measured bitstream mismatch is refused: libx264
  writes no reorder delay for a segment of one or two frames, and a stream
  copy across two delays had the demuxer rewriting decode timestamps. After
  the stream copy the file is read back — one packet per frame, increasing
  decode timestamps, a keyframe at every segment start, presentation
  timestamps exactly `i / fps`, every decoded frame equal to its segment's
  own decode — and that read-back is what found the join's real defect: the
  concat demuxer offsets each file by its container duration, an x264 MP4's
  passes through its edit list and can come out short (a 26-frame segment of
  synthetic frames read 13302 ticks of 1/15360 for 13312), and 5 of the 42
  ledger compositions failed at `--workers 4`, every one split into unequal
  segments. Durations are now written from frame counts, and WebM's
  millisecond timestamps are rewritten from the packet index. Sound is muxed once over the joined film, through
  the one function the one-shot render uses (`deliverSound`), and the joined
  film's decoded audio hashes equal to a one-shot render's.
  `tests/segments.test.ts` holds three segments of `sound-roles` — footage
  presented every frame, a declared mix — to `trace` hash for hash, every
  refusal through `planJoin` and through the CLI, and each container's
  timestamps; its header lists the edit that turns each red. A folded frame
  keeps its frame boundary for a measured reason: footage tiles hold the
  last frame presented to them once a track's window has passed, and with
  the boundaries of folded frames skipped `footage-tracks`' digest moved
  while `sound-roles`, which never shows a held frame, stayed green — so
  `footage-tracks --workers 4` is in that file too.
  `baselines/segments/ledger.ts` renders every ledger composition with
  `--workers` against its recorded digest: 42 of 42 at `--workers 7`. What
  splitting buys is measured in `baselines/segments.md`, and on one machine
  it is little: beside other sessions on an M4, `--workers` saved at most
  11 % of wall time for 21–69 % more CPU, because a one-process render
  already keeps libx264 on the cores. Across machines it is the point: the
  1665-frame hajibang ranking in 16 segments costs 1.8–4.2 s a segment and
  8.0 s to join, against 51.3 s whole. What the join does not claim: the
  joined bytes are not a one-shot encode's (rate control and keyframes see
  one segment at a time), and `concat` takes the footage identity components
  from the segments rather than ingesting, and lists them. Both commands go
  through the MCP mechanisms above: the join is written to a hidden partial
  and renamed over `--out` once read back, a cancel kills `--workers`'
  children and takes back what was written, and `render --spec --workers`
  stages, builds and asserts the job once before any worker starts.
  `--range` refuses `--spec`, because `concat` joins against a composition
  directory and a job's exists only inside its staging.
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
- **A consumer's `build.json` says nothing about where the consumer is.**
  `relativise` (`src/render/build-record.ts`) writes the entry relative to
  the composition and `--outdir` as `.`, then tries this package's root for
  the compiler and the composition's repository root — the cwd `buildSpawn`
  builds from — for a face named by an absolute path, so a project that
  installed the package records `main.tsx` and
  `vendor/pocketjs/tools/build.ts`, not where either sits.
  `tests/identity.test.ts` records one build from two project locations;
  red with the package root alone.
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
- **Text is not shaped, so an emoji sequence is refused rather than
  formed.** A flag is two regional indicators joined by the font's GSUB, a
  family is emoji joined by ZWJ, a skin tone and a keycap combine with what
  precedes them; the core lays out one glyph per codepoint. Each such
  codepoint is left out of the slot and reported as tofu, so the sequence
  fails `check` instead of drawing as its pieces. Shaping
  (`docs/text-shaping.design.md`) is what would form them.
- **The slot's own face wins over the fallback chain, presentation selector
  or not.** Noto Sans SC maps U+26A0 ⚠ and draws it in the text colour,
  `fonts.fallback` declared or not, and U+FE0F asks for nothing here — it is
  a codepoint like any other, drawn if a face maps it and reported if none
  does. CSS's order, and the one a composition can predict from its faces.
- **A vector glyph is flattened every frame, and every vector slot carries
  the whole charset.** Nothing caches a glyph's flattened outline across
  frames; the cost per frame is in `baselines/vector-glyphs.md`. The
  collected charset is global, so each vector slot bakes the outline of
  every codepoint its faces map: the fixture's 480 px slot is 50 KB for 112
  glyphs, and a template that declares the 3,755 GB2312 characters would
  carry them in every vector slot it uses.
- **A text stroke on a vector run is outlined, not a distance field, and its
  hollow outside form is drawn centred.** Outside with a fill is a stroke of
  twice the width under the fill, centred is over it — `patches/0017`'s two
  pictures. With no fill, the outside ring cannot be cut from a centred
  stroke without a boolean, so it is drawn centred at the declared width,
  half of it inside the glyph. Colour layers take no stroke in either kind
  of slot. Nothing pins either picture.
- **Colour glyphs are measured on one font.** `colr.ts` was written against
  the COLR specification and validated on Noto Color Emoji alone; its
  paints there are solid, linear and concentric radial gradients, transforms,
  and the two composites it refuses. Another COLRv1 face may use a sweep
  gradient, a variable paint or a reflecting colour line: each is refused by
  name and its codepoints reported, never drawn otherwise.
- **A path's trim, morph and dash offset do not blur, and nothing caches its
  geometry.** The shutter integrates transform tracks only, so a moving
  `<Path>` blurs and a draw-on's tip and a march do not. The geometry is rebuilt every frame — and
  under a shutter every sample — from the table: stage 1 measured a 1080p
  frame of 300 paths of 67 cubics at 20-70 ms of wasm, against 1.19 ms for a
  frame of the reel, so a dense illustration is a cost no ledger composition
  carries yet.
- **A node following a path blurs along chords.** `motionPath` keys tick 0,
  the odd ticks and the last, so every frame of a 30 fps film is on the
  curve, shutter or not; between keys the core interpolates linearly, and a
  shutter's samples and a 60 fps film's even ticks see the chord. The
  fixture's own dart strays 3.75 px there (21 px a tick through a 58 px
  loop), its orbiter 0.19 px; `chordError` reports it per move, and nothing
  fails on it. An engine motion path that the shutter integrates would close
  it, and is not built: the design says why and where it would start to
  matter.
- **Equalisation chooses a correspondence by size, not by position.** Two
  keys whose largest shapes sit far apart cross the frame, a hole paired
  with a separate shape morphs through a figure-eight because only a whole
  key is ever reversed, and a corner travels along the other key's edge by
  arc length rather than to its nearest corner. Keys whose commands line up
  bypass the rule entirely.
- **Abutting paths are still two blends.** The partition gives each seam
  sample to one path, but a pixel half-covered by each is blended twice, so
  a seam between two shapes of one colour lets `(1 - h_a/16)(1 - h_b/16)` of
  the ground through; stage 1's fan of 24 wedges shows faint radial lines. A
  coverage-merging op would close it and is not built.
- **An outline computed at mount is as deterministic as the arithmetic that
  computed it.** The realm pins the clock, randomness and locale formatting,
  not `Math.sin`, `cos`, `tan`, `pow`, `exp`, `log` or `atan2`, which
  JavaScriptCore may hand to the host's libm. A chart's `line()` with a linear
  or monotone curve is `+ - * /` and holds across hosts; d3's arc and pie
  generators, `curveCatmullRom` (`Math.pow`) and d3-scale's `nice()` and
  `ticks()` (`Math.log10`, `Math.pow`) do not, and nothing reports a `d` that
  went through one — the determinism workflow would see it only as a
  fixture's digest moving on Linux, and `compositions/data-chart` is written
  to avoid all of them. A build run with upstream's `tools/build.ts` directly
  takes no inventory, and the render's mount refuses what it did not bake.
- **What an `<Svg>` import does not carry.** Gradients, patterns, clip paths,
  masks, filters, `<use>`, `<symbol>`, `<style>` sheets and text are refused,
  not converted. `opacity` on a `<g>` multiplies each part's alpha, so the
  overlapping parts of a translucent group blend one over another where a
  browser composites the group first; nothing refuses or reports it. A stroke
  under a skew or a non-uniform scale is refused rather than outlined. A
  `parts` class that trims or paints is inert on a group's View — only a
  `<Path>` draws an outline — and nothing reports that either. Outlines are
  written in thousandths of a px. The import is Solid's, like `<Path>`.

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
    mux is what would refuse it. Opus and PCM were measured with the same
    guard on `compositions/sound-roles` and leave the tail silent; no other
    mix has been
- **The two ProRes/VP9 facts a reader would get wrong from the argv**, both
  pinned so they are not rediscovered: ProRes 4444 is asked for as
  `yuva444p10le` and DECODES as `yuva444p12le`, because the 4444 bitstream is
  12-bit; and VP9 stores alpha out of band, so an alpha WebM's video stream
  still reports `pix_fmt=yuv420p` and the evidence is the container's
  `alpha_mode` tag — on a file the sound mux rewrote, `ALPHA_MODE`, and the
  element behind it is what the delivery test reads. A test asserting
  `pix_fmt=yuva420p` would be red on a correct file.
- **Which sizes draw from the atlas is a property of the face, not of the
  format.** The FONT ATLAS header stores `cellH` as a u8, so a size whose
  cell — `round(ascender * px / unitsPerEm) + ceil(-descender * px /
  unitsPerEm)`, from the family's own `hhea` — passes 255 px cannot be an
  atlas: **Noto Sans SC up to 176 px, Inter up to 211, HarmonyOS Sans up to
  217**, Bold and Regular of each sharing a ceiling. Above it the build now
  bakes a vector slot (`patches/0063`) where `patches/0002` refused, and
  0002's message fires only for a direct `bakeSlot` call. So swapping the
  face moves the line between the two, and a size that drew from the atlas
  yesterday may draw as outlines today with no edit to the size: the same
  layout — the metrics are one set of formulas — a raster that differs at
  the ink's edge, and the per-frame cost of a flatten and a PATH fill per
  glyph. The build's `font: slot N (…) vector (over the atlas's 255px cell)`
  line is what says which.
- **A full ledger run's disk cost is set by the footage in the tree, and
  only the ledger can measure it.** Ingest decodes the span each footage
  artifact's tracks can show to raw RGBA next to the bundle and leaves it
  there. Measured 2026-10-26 by clearing `dist/**/*.rgba` and running the
  whole ledger serially: 5 `.rgba` files totalling 827,366,400 bytes — 789
  MiB — from 1.5 MB of tracked clips, the largest
  `compositions/captions/burn-zh`'s 101 frames at 720×1280. It was 6 files
  and 1,381,017,600 bytes on 2026-10-22, when ingest decoded every source
  whole whatever window its track used: that one 44 KB clip was 659,865,600
  of them. A tree carrying recorded material at film length
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
  Its five rows are also the whole of what it covers — the artifacts the
  three compositions drawing synthetic clips ingest, each recorded as its
  spans beside the whole-clip decode it is a byte slice of — so a check that
  read them would say nothing about a track added tomorrow.
- **What the footage cache key does not name, and what a span still costs.**
  The key names ffmpeg by all of `ffmpeg -version`: the release, the configure
  line and the version of every library it loaded. An external decoder's
  version — libdav1d, for an AV1 source — is not in that text, and neither is
  a build patched under an unchanged version string; a warm `dist` across
  either serves the previous decode. The fix there is still
  `find dist -name '*.rgba' -delete`, which works because `readCache` wants
  all three of `cache.json`, `manifest.json` and `frames.rgba`. And the frames
  before a clip's first span are decoded and dropped rather than skipped, so a
  ten-second take cut from the end of a minute-long source costs the decode
  of the minute, though not its disk: the seek that would avoid it moves
  bytes, measured above.
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
- **A delivered file's colour and container are measured on ffmpeg 8.0
  only.** The workflow and the image pin it; an installed package runs
  whatever ffmpeg the consumer has, and `doctor` checks that one exists, not
  which. Two parts of the encode leg are there for other versions and were
  reasoned, not run: the colour tags are passed as output options as well as
  on the frames, for an ffmpeg that does not carry frame properties into the
  encoder, and the matrix is named in the `scale`, for one that does not
  negotiate colour spaces. Nothing reports a consumer's file coming out
  untagged.
- **What the package was checked on is one platform.** The install test has
  run on darwin-arm64 only, at the time of writing; it is in the suite CI runs
  on linux-x64, which is where the second platform will be measured. The
  binding is declared for the fourteen platforms its compiler lists; Windows
  has not been tried, and `doctor`'s disk check reads `df`.
- **Nothing records the rustc that compiled the wasm, and whether two
  machines' rustc give one wasm has not been measured since the paths came
  out.** `vendor/prebuilt.json` pins the wasm's bytes; `scripts/vendor.ts`
  compiles it with whatever rustup runs and writes no note, so a version
  recorded at pack time would describe a compile nothing saw. Where the
  checkout sits no longer moves the bytes ("Where a build runs is not an
  input"), but before that the linux/amd64 image built 913,329 bytes against
  the Mac's 914,481 with rustc 1.97.1 (`8bab26f4f`) on both, and how much of
  that gap was the paths is not known: the image has not been rebuilt since.
  The frames do not depend on the difference — the image reproduced all 38
  digests — which is the observation identity's omission of the wasm rests
  on, and why the package ships one wasm instead of a compile per machine.
  The Dockerfile pins 1.97.1; the workflow takes stable.
- **A job is checked against what its generator asserted, at sampled
  frames.** `render --spec` now evaluates a caption job's word windows, at
  both ends of each and on the even grid between, so a transcript shaped
  unlike the two samples is checked at the first and last frame of every
  word. Between those frames it is the sampled-frame claim `assert` always
  makes; `tests/captions.test.ts`'s every-frame sweep of all five styles is
  still what holds the template at every frame. And a job is checked for
  nothing its generator did not write: `copy` and `lower-third` write no
  assertions, so their jobs carry an `assertions` object with no entries and
  a note that the sidecar declares none — `ok: true` there says nothing was
  asserted, not that anything was checked.
- **The five caption styles exist twice.** `compositions/captions/highlight`
  and its four siblings are still the ports of the HyperFrames catalog, with
  their own generators and hand-picked phrasing; `src/captions/styles.ts`
  re-expresses the same five treatments for any transcript, with the one-tick
  lead and the nested entrance and exit wrappers the ports do not have. A
  change to one does not reach the other. Pointing the ports at the template
  would move their digests and their visibility counts, so it is a recorded
  change to five deliveries rather than a refactor.
- **A film is at most 18 min 12 s of one timeline.** A timeline's period,
  its delay and its segment endpoints are u16 frame counts at 60 Hz, so no
  track spans more than 65,535 ticks: `Reg` refuses a longer film and the
  baker refuses a longer duration. Past that, a delay cannot reach a second
  timeline either, so a longer film needs a wider anim entry header — every
  field of it, not one count. Nothing in this tree is longer, and the
  HyperFrames series runs 7.5 minutes.
- **`keyframes` takes a short segment for a cut whatever it does.** The
  part-way reading counts any segment no longer than one rendered frame
  with a sampled tick inside it, and asks neither whether its value changes
  nor whether it continues a move on the same track. `src/anim/sampled.ts`
  keys every move each `MOVE_STEP` — two ticks, one frame at 30 fps — so a
  kit move keyed from an even tick has a frame inside every segment: on the
  corrected grid `mg-hud` reports 2636, `long-track` 2002 and `mg-bauhaus`
  121, and not one is a gate — 2224, 2000 and 119 are segments of keyed
  moves and the rest segments over which nothing changes
  (`baselines/keyframes-phase.md`). Every gate the tree carries is in
  `shutter`, `rename-card`, `shutter-blur` and `late-anim`. Asking both
  questions of the track would separate the two; it is not done, and until
  it is, the reading's count in a kit-built film is not a count of cuts.
- **The shutter still finds a segment by walking.** `within_iteration` in
  `engine/core/src/shutter.rs` (0034) takes `.find` over a track's segments
  for every sample of every integrated track, so under a declared shutter a
  long track costs O(segments) per sample — the cost 0050 removed from the
  tick. Unmeasured at film length: no composition here declares both.
- **A cancel reaches a frame loop and nothing else.** `render` and `trace`
  stop at the next frame; `verify`, `assert` and `layout` sweep through
  `openProber` and the layout walk, which take no signal, so a cancelled one
  runs to the end and holds the server's one turn while it does — a 64 s
  `assert` on `mg-hud` keeps every render queued behind it for 64 s. Inside a
  render, a footage ingest, a job's generator and build, and the sound mux
  are not interruptible either; the cancel is honoured after each, and what
  the mux wrote is then removed. A png-seq render cancelled in a directory
  that already held a sequence removes the frames it wrote, which leaves the
  earlier sequence missing its first frames: the directory is not this
  render's to restore.
- **The MCP server has no `build` tool.** Every tool but `render --spec`
  needs a built composition, and a client with no shell can only read the
  refusal that names the command. `src/api.ts` has `build`; serving it is a
  tool definition away, and the reason it is not one yet is that this server
  was scoped to the six.
- **The reuse sees a hold only where nothing in the draw list moved.** On
  the hajibang ranking film 980 of 1,665 frames are byte-identical to the
  frame before and none is reused: a full-frame dot grid drifts 256 px over
  the film, 0.15 px a frame, so one TEX_QUAD's clipped UV moves every frame
  while nearest sampling moves the dots about every sixth. Seeing those needs
  the raster's own quantisation in the key, or a generator that moves the
  grid in whole pixels, which changes its picture; neither is done, and the
  59% is the most either could take.
- **A reused frame is hashed again, and on light frames the hash is the
  cost.** SHA-256 of a 1080p frame is 2.71 ms in `src/render/hash.ts` and was
  5.6–9.3 ms under the load these measurements ran at, against 0.3–0.8 ms to
  rasterise a caption template's frame. So on those templates most of a held
  frame's cost is still paid. Carrying the previous hash across would remove
  it and make the digest a claim about frames nothing examined; `--hash fast`
  is the existing lever.
- **A frame that changes pays one more draw walk.** The key walks the tree
  and the raster walks it again; `ui_render_scaled` has no form that
  rasterises the list the last walk built. Measured per composition in
  `baselines/raster-reuse.md`; a core export that rasterises the current
  list would remove it.
- **A `--workers` render does not say how many frames it reused.** Each
  segment is a `render --range` process that reuses as any render does —
  its first frame is always rasterised, since the frames it folds are never
  drawn (`tests/reuse.test.ts` starts a segment on a held frame, red when the
  frame before the range is read through the reuse) — but the segment
  manifest carries no count, so `--json` omits
  `reusedFrames` there. `--encoder`, `--preset` and `--no-reuse` are handed
  to every worker; three VideoToolbox segments of `smoke` joined by stream
  copy, passed the read-back and gave `trace`'s digest, checked by hand and
  not held by a test.
- **The hardware encoder was measured on one Mac.** Three encodes on the M4
  decoded to the same frames; no second machine was tried, and VideoToolbox
  on an Intel Mac has no `-q:v` mode, so `--encoder h264_videotoolbox` there
  is untried.

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
- **`bun test ./tests/` runs in two checkouts at once.** A test that writes
  files takes its directory from `scratchDir()` (`tests/scratch.ts`), a fresh
  `mkdtemp` under one root per run, never a fixed path: fixed
  `/tmp/pocketjs-motion-*` paths had two suites deleting each other's builds,
  14 to 34 false failures a run. `tests/isolation.test.ts` reads every test
  file and fails on a `/tmp` literal or a `tmpdir()` outside a `mkdtemp`.
  A test that counts processes counts its own children (`pgrep -P`): the
  preview tests counted every viewing-copy encoder on the machine, and
  another checkout's made them fail. `tests/preload.ts`, which `bunfig.toml`
  loads before every file, refuses a run that inherits `POCKETJS_ROOT`
  rather than overriding it, because Bun gives a child spawned without `env`
  the environment the run started with, and that child would boot the tree
  the variable names.
- Prose states the mechanism directly. No slogans, no personification, no
  empty intensifiers, no imported architecture jargon. `AUTHORING.md` and this
  file are the register reference.
