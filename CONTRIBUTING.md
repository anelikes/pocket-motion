# Contributing

Pocket Motion renders compositions to frames deterministically, with no
browser and no decoder in the render path. The claim it exists to hold is that
**the same input produces byte-identical frames on another machine**. Most of
the rules below are that claim, made checkable.

Read [`AGENTS.md`](AGENTS.md) before changing anything under `src/`,
`scripts/` or `patches/` — it states the two invariants every change is
measured against, and what enforces them today.
[`AUTHORING.md`](AUTHORING.md) is the document for writing a composition.

## Setup

```bash
bun install
bun run vendor            # clones pinned PocketJS, applies patches/, builds the wasm core
bun scripts/assets.ts     # fetches the pinned fonts and audio, verifies every SHA-256
```

`bun run vendor` needs a Rust toolchain with the `wasm32-unknown-unknown`
target. `scripts/assets.ts` needs network on first run and nothing afterwards.
**Rendering and footage ingest need `ffmpeg` and `ffprobe` on PATH** — both,
separately: a source's dimensions and duration are probed before the ingest is
paid for, so a tarball carrying only `ffmpeg` fails later and further in.

Ask rather than find out:

```bash
bun src/cli/main.ts doctor
```

Seven checks — the running Bun against the one the ledger was recorded on and
every `build.json` names, rustup and the wasm target, `ffmpeg` and `ffprobe`,
the vendored tree at its pin with the patches applied, the fetched assets, and
free disk — each with what was observed and, when it failed, the command that
repairs it. `--json` always exits 0 and puts the verdict in `ok`; in a terminal
a failing check exits 1.

## Before you open a pull request

```bash
bun test ./tests/
bunx tsc --noEmit
bun src/cli/main.ts verify compositions/<name>   # the composition you changed
bun scripts/digests.ts      # only if you touched anything under compositions/
bun scripts/visibility.ts   # the same, and for the same reason
```

`verify` runs `lint`, `check`, `keyframes`, `visibility`, `layout` at sampled
frames and `assert` into one `--json` envelope, and its exit code is the
verdict. Run it on the composition you touched before either ledger: a ledger
run is minutes and tells you a digest moved, while `verify` is seconds and
tells you which gate is unhappy.

`bun scripts/digests.ts` rebuilds every listed composition through the command
the CLI itself prints and compares the trace against `baselines/digests.json`.
It refuses to run unless every composition in the tree is either measured or
excused in `EXEMPT` with a written reason, so a composition cannot fall out of
coverage quietly. **A change under `compositions/` is not verified until this
has been run.** `scripts/visibility.ts` is the same shape applied to what is on
screen: per composition it records the failing node names, how many nodes carry
a `debugName`, and how many paint and are never shown, so a gate quietly
covering less than it did is a diff rather than a memory.

A full digest run leaves the decoded RGBA of every footage track beside its
bundle — the source frames each track can show, not its whole clip: 789 MiB
over five files, measured 2026-10-26 by clearing them first and running the
whole ledger serially. That measurement is what the script's banner
and `doctor` both quote — `doctor` fails below it and calls the headroom thin
below 3x it — and a full run re-reads `dist/` at the end and says so if what it
left has moved away from the recorded figure. The bytes are re-derivable from
the tracked clips and safe to delete (`find dist -name '*.rgba' -delete`).

If a digest or a visibility row moves and the change was intended, re-record
with `--write` and say in the commit message what moved and why.

## The package and the image

```bash
bun scripts/pack.ts --dry-run   # what npm would put in the package, and whether it dropped anything
bun scripts/pack.ts             # dist/pack/pocket-motion-<version>.tgz; never publishes
docker build -t pocket-motion . && docker run --rm pocket-motion
```

`npm pack` at the repository root refuses: upstream's `.gitignore` inside
`vendor/pocketjs` would drop the wasm and the compiler's `node_modules`, so
`scripts/pack.ts` stages the package from an explicit list and its header
says what is in it and why it is prebuilt. `tests/package.test.ts` holds npm's
own file list and installs the tarball into an empty project, so it needs
`npm` on PATH and, the first time, the registry for the compiler's native
binding. A change to what `src/` reads from `vendor/pocketjs` at run time is a
change to `VENDOR_ENTRIES` or `VENDOR_FILES` there.

The image runs the whole digest ledger on linux/amd64 from a context with no
`vendor/`, `node_modules/` or `dist/`. A pin that moves in
`.github/workflows/determinism.yml` moves in the `Dockerfile` too;
`tests/docker.test.ts` fails until it does.

## Rules that are not style preferences

**Never edit `vendor/`.** It is rebuilt from `patches/NNNN-*.patch` applied in
sorted order against the pinned upstream commit. A change to engine behaviour
is a new patch, numbered after the last one.

**A guard only guards if the regression actually fails it.** Introduce the
defect, watch the check go red, revert. A guard added without that step is an
assertion about a guard, not a guard.

**A command claims only what it examined.** `check` reports realm cleanliness
and op counts over the window it names; it says nothing about whether anything
is on screen. Widening what a command inspects is a feature. Widening what it
*claims* without widening what it inspects is the defect this project has
found most often.

**Every input that can move a pixel must be reconstructable from the
composition's declared inputs** — the sidecar, the pak the build bakes, and
the frozen ingest artifacts the sidecar names. A value a host computes, a file
a build discovers, a default a resolver supplies, or a version of a tool that
happens to be installed is undeclared, and its effect is real whether or not
anyone can see it.

**Compositions are mount-only.** After mount, all motion comes from baked
keyframe timelines the core plays itself. `Date`, `Math.random` and locale
formatting are refused outright — `compositions/malicious` is the fixture that
pins it.

## Commits

Conventional Commits for the subject line: `type(scope): summary`. The body
should say what moved and what measurement says so.

Prose in `AGENTS.md`, `AUTHORING.md` and composition notes states the mechanism
directly: no slogans, no personification, no empty intensifiers, no imported
architecture jargon. Those two files are the register reference.

## Reporting a problem

A determinism failure is the interesting kind of bug. If a digest reproduces on
your machine and not on another, that is not a render failure — it has found an
input nobody declared. Include the output of `bun scripts/digests.ts`, your OS
and architecture, `bun --version`, and the `trace --json` identity block.

Security issues go to [`SECURITY.md`](SECURITY.md) instead, not the issue
tracker.
