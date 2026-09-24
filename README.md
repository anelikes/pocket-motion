# Pocket Motion

Deterministic video rendering for [PocketJS](https://pocketjs.dev) compositions — no browser.

> **Status:** renders a composition to frames and MP4 with no browser and no
> decoder in the render path, guarantees that the same declared inputs produce
> byte-identical frames on another machine, and proves it on every push by
> rebuilding every composition in the tree on Linux/x86-64 against digests
> recorded on macOS/ARM.

## What this is

A PocketJS composition renders to MP4 through the same `no_std` Rust core that
drives the framework on device — no Chrome, no CDP, no CSS engine, no wall clock.

Removing the browser buys two things at once:

- **Determinism by construction.** The frame is a pure function of the tick index.
  Nondeterministic globals are poisoned in the guest context, not merely linted.
- **Speed.** Measured 4.1×–8.8× faster per frame than HyperFrames, single-thread
  against single-thread, on the same machine.

Both come from the same decision. Neither is a separate feature.

Footage that changes size on screen is filtered correctly up to 2×
minification and aliases beyond it — measured, with the boundary in
[`phase4-minification.md`](./baselines/phase4-minification.md).

## Measured, not claimed

| | ms/frame | parallelism |
| --- | ---: | --- |
| HyperFrames `nyt-graph` 1080p | 38.19 | 1 worker |
| HyperFrames `nyt-graph` 1080p | 32.20 | 10 workers |
| PocketJS 50 elements 1080p | 4.32 | 1 thread |
| PocketJS footage + 20 overlays 1080p | 9.24 | 1 thread |

Apple M4. Method, caveats and the Linux/beginframe investigation are in
[`baselines/hyperframes-m4.md`](./baselines/hyperframes-m4.md).

**The claim is scoped**: faster *within the vocabulary a PocketJS composition can
express*. Against a raw Skia rasterizer the software core loses by 16–86×; the moat
is the browser-free pipeline and the determinism contract, not the rasterizer.

## Scope

Does four things:

1. A deterministic guest harness
2. composition → frame sequence, with a `seekFrame` contract
3. frames → rawvideo → ffmpeg
4. `--json` introspection and verification commands

A job spec is build-time JSON a generator reads once; it is not passed into
the guest. **Creation workflows, intent routing and a studio UI are not here;
the skill that teaches an agent this contract is.**

### Deliberately does not do

Each of these was decided against for a reason, not left undone.

- **A studio editor, a hosted `publish` page, a player component.** Reading a
  render and looking at it is `preview`'s job, and `preview` serves the same
  bytes `frame` writes. The product that *writes* compositions is a layer
  above this one and does not belong inside the contract it renders through.
- **Media supply — stock music, sound effects, images, TTS, background
  removal — and cloud rendering.** Every one of them is a vendor dependency,
  and none of them has anything to do with whether two machines produce the
  same frame. Bytes that reach a pixel have to be declared and pinned here;
  fetching them is somebody else's command.
- **Shader transitions, 3D, Lottie, a canvas runtime.** These are outside the
  vocabulary a composition can express, and they satisfy neither admission
  rule: none is expressible as a baked timeline, and none reproduces byte for
  byte across architectures without a GPU contract this project does not have.
- **Footage effects and colour grading.** Filtering a clip — a grade, a
  denoise, mip levels — belongs to the ingest, where the result is a frozen
  artifact with a digest. What the rasteriser does draw is declared in a class
  literal and travels in the draw list, where `check`, `trace` and
  `visibility` read it: text stroke, a node's blur, drop shadow and glow,
  blend modes, and multi-stop, radial and text gradients (`patches/0017`–`0019`; costs in
  [`paint-effects.md`](./baselines/paint-effects.md)). A backdrop blur — one
  that reads what is beneath a node — is not among them.

## Relationship to upstream

Vendors [`pocket-stack/pocketjs`](https://github.com/pocket-stack/pocketjs) rather
than forking it, following the upstream convention recorded in its `docs/STRUCTURE.md`:

> Standalone products keep the `pocket-<name>` separate-repo convention and do not move in.

Twelve patches make up the difference, each a diff against the pinned commit;
[`patches/README.md`](./patches/README.md) says what each one changes, where it
stands upstream, and whether it still applies to upstream's main.

Two small changes are intended as upstream PRs because they help the framework
itself. `update_texture` for `PSM_8888` is the missing counterpart to the existing
`update_texture_t8`. `ui_upload_texture_flags`
([`patches/0004`](./patches/0004-upload-texture-flags.patch)) exposes a core method
the wasm host never exported: `Ui::upload_texture_flags` has always existed, but
every route to it ran through a pak entry or a tileset, so a host uploading pixels
it generated itself could only get the nearest-sampling default — right for pixel
art drawn 1:1, wrong for anything the rasteriser resamples.

Two others were planned and are no longer needed. `RgbaWindowTarget` (band-parallel
raster) was dropped because measurement showed the rasteriser is not the constraint —
at 1.19 ms/frame it costs less than half of the SHA-256 frame hash
([`phase5-throughput.md`](./baselines/phase5-throughput.md)). `Ui::snapshot`/`restore`
turned out to be unnecessary: a mount-only composition keeps its whole frame state in
the core's linear memory, so the host copies that memory directly and upstream needs
no new API.

## Layout

```
src/          the host: harness, frame source, render, lint, introspection
compositions/ the compositions, including the introduction reel
baselines/    measured baselines — competitors and this project's own
scripts/      vendor.ts rebuilds vendor/, assets.ts fetches the fonts and audio
assets/       fonts, audio (fetched — see below) and the synthetic clips and tones
```

Two things are deliberately not versioned, on one rule: **an ignored dependency
has to be rebuildable by a single command**, or it becomes a dependency only its
author can satisfy, and its absence shows up as something quieter than an error.
`vendor/` comes back from `scripts/vendor.ts` at a pinned commit plus `patches/`.
The reel's audio comes back from `scripts/assets.ts`, which verifies every file
against the SHA-256 of the exact bytes the cut was made against — a re-encode
would move the measured beat grid and with it every cut pinned to it.

The frame hash never opens an audio file. Audio is muxed in a separate pass
after the frames are hashed; `render` reads declared sound files for that
pass, `trace` does not. The fonts are the deliberate exception — the build
bakes them into the pak, so they are in the repository with their licence.

## For agents

[`skills/pocket-motion/SKILL.md`](./skills/pocket-motion/SKILL.md) is the whole
contract condensed into one file: what a composition may contain, the loop from
`init` through `verify` and `snapshot` to `render`, the `--json` conventions
every command follows, and what this substrate deliberately does not do.

`verify` is the command that loop turns on. It runs `lint`, `check`,
`keyframes`, `visibility`, `layout` at sampled frames and `assert` into one
`--json` envelope whose sections are those commands' own output verbatim, so
one exit code answers "is this composition sound" and the envelope says which
part was not. Every command line in the skill is executed by
`tests/authoring.test.ts` under the same rule `AUTHORING.md`'s are, so a flag
that stops existing fails a test rather than an agent.

## Contributing

[`CONTRIBUTING.md`](./CONTRIBUTING.md) is the setup and the checks a change has
to pass. [`AGENTS.md`](./AGENTS.md) states the two invariants those checks
exist to hold, and [`AUTHORING.md`](./AUTHORING.md) is the document for writing
a composition rather than changing the renderer.

Security reports go to [`SECURITY.md`](./SECURITY.md), which is also the file
that says plainly what is and is not a security boundary here: building a
composition runs its code, and the determinism guards are not a sandbox.

## License

[MIT](./LICENSE) — same as upstream PocketJS. [`NOTICE`](./NOTICE) summarises
every third-party component and points at the authoritative record for each.

**This software uses HarmonyOS Sans Fonts.** Copyright 2021 Huawei Device Co., Ltd.,
licensed under the HarmonyOS Sans Fonts License Agreement — full text at
[`assets/fonts/HarmonyOS_Sans_LICENSE.txt`](./assets/fonts/HarmonyOS_Sans_LICENSE.txt).
The faces are redistributed unmodified; see [`assets/fonts/README.md`](./assets/fonts/README.md)
for the per-condition compliance record.

Audio under `assets/audio/` is Mixkit-licensed for commercial use with a recorded
source URL per file ([`ATTRIBUTION.md`](./assets/audio/ATTRIBUTION.md)).
