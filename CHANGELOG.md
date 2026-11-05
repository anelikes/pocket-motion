# Changelog

Tags are cut from `main`. Each entry says what a composition can now
declare, what it costs, and whether any recorded digest moved.

## v0.6.0 — unreleased

Usable from another project, and reproducible with one command. Nothing new
to declare; every digest recorded before this reproduces unchanged.

### Added

- **`src/api.ts`**: `build`, `trace`, `render`, `verify` and `doctor` as
  functions, each returning the object its command prints with `--json` —
  the same dispatch, the same redaction, the same `runId`.
  `tests/api.test.ts` holds each equal to the CLI run as a process.
- **An npm package**, `pocket-motion`, Bun-only, staged by
  `scripts/pack.ts` and not yet published: the CLI as the `pocket-motion`
  bin, the API as the package's export, and the patched compiler,
  framework and wasm rasteriser prebuilt inside it, so a consumer needs
  neither Rust nor git. 16.9 MiB packed, 77 MiB unpacked, `typescript`
  included because the builder imports it. An empty project that installs
  it traces `smoke` to its ledger digest.
- **A Dockerfile** that builds the repository from nothing on linux/amd64
  with CI's pins and runs the digest ledger. Under emulation on an M4, all
  38 digests reproduced with the image's own wasm.
- `bun scripts/assets.ts --kind fonts,synthetic` fetches and verifies only
  the named manifests.

### Changed

- `render --json` carries `identity`, the value `trace` reports, beside
  `digest`. A `--spec` job carries none.
- `build.json` records a composition's paths relative to the composition's
  own repository as well as this one, so a project that installed the
  package writes a record that does not say where it sits. Every record in
  this repository is byte-identical to before.
- `doctor` in an installed package checks the prebuilt tree against
  `vendor/prebuilt.json` and loads the compiler; `rustup` and `assets` say
  they do not apply there.

### Fixed

- **A composition with `sound` rendered to `webm` or `mov` is that
  container.** The mux wrote an MP4 under the requested name — VP9 and AAC
  with the alpha gone, in a `.webm` — and failed on every `.mov`. WebM now
  carries Opus at 48 kHz, MOV 24-bit PCM at 48 kHz and MP4 AAC as before,
  each with the video stream and its alpha copied.
- **Every encoded file is BT.709, converted and tagged.** The RGB → YUV
  conversion used swscale's default BT.601 matrix and the file named none,
  so a player taking BT.709 for HD showed saturated colours up to 40 levels
  off. No recorded digest moved: frames are hashed before the encode.
- **The audio stream is as long as the picture.** A mix whose last element
  ended early ended the audio there; every mix is now padded with silence
  to the film.
- `*.sound.json` is named after the whole delivered file
  (`hero.mp4.sound.json`, where it was `hero.sound.json`), so `hero.mp4`
  and `hero.webm` keep a record each. `render --json` prints the path.
- `sound --verify` reads its windows from one decode of the delivery, so a
  correct Opus WebM is not read 8 ms early and failed.
- ffmpeg is told the container with `-f`, so `--format mov --out cut`
  renders, and `-fflags +bitexact` now reaches the muxer instead of the
  input, so a delivery carries no muxer version.

## v0.5.0 — 2026-09-26

The same pictures, rendered with less memory and less work. Nothing new
to declare; every digest recorded before this release reproduces
unchanged.

### Changed

- **The pak crosses into the sandbox as a latin1 string**
  (`src/harness/sandbox.ts`), not as an array of one number per byte.
  Booting a world over a 51 MB pak takes 0.05 s instead of 0.6 s and grows
  the process by 0.1 GB instead of 1.1 GB, which is what bounds how many
  worlds, and so render workers, fit in memory.
- **TEX_QUAD takes its sampling taps per column and per row**
  (`patches/0021`, class upstream): a tap on a texel centre reads one
  texel instead of four, and a transparent RGBA8888 texel there is
  skipped. Byte-identical by construction; a core test holds it to the
  per-pixel sampler it replaced.
- **The wasm core builds at `opt-level = 3` with simd128**
  (`patches/0022`, class motion), was `"s"`: the same pixels, a module
  of 513 KB instead of 312 KB. Built with Rust 1.97.1.
- `baselines/affine-texture.md` says its wasm table predates 0022.

Measured on two 1080x1080 Peesuto lyric films, a serial raster pass over
every frame in one process, Bun 1.3.11 on an M4 (instructions retired,
because the machine carried other load; every frame hash unchanged):

| film | frames | peak RSS | boot | instructions |
|---|---:|---:|---:|---:|
| classic zh | 720 | 1.83 → 0.57 GB | 0.70 → 0.33 s | 573 → 351 G (−39%) |
| night zh | 701 | 2.14 → 0.62 GB | 0.80 → 0.29 s | 797 → 412 G (−48%) |

In the raster pass alone, 0021 removes 27% (classic) and 41% (night) of
the instructions and 0022 a further 9% and 7%; its CPU time, best of two
or three runs, went from 20.8 to 17.6 s and from 30.1 to 17.7 s.

## v0.4.0 — 2026-09-24

Gradients beyond two stops, gradient text, and pictures of any size. Every
digest recorded before this release reproduces unchanged.

### Added

- **Gradient paint** (`patches/0019`, class motion, ops 69/70). Up to six
  stops (`from-*`, `via-*`, `to-*` with `N%` positions, or an arbitrary
  `bg-[linear-gradient(…)]` / `bg-[radial-gradient(…)]`), any angle
  (`bg-linear-N`, `bg-linear-[Ndeg]`, `bg-linear-to-t|r|b|l`), radial
  (`bg-radial`: the farthest-corner ellipse about the centre), and gradient
  text (`bg-clip-text`). Interpolated premultiplied. Angle, stop colours
  and positions animate. A literal with only `bg-gradient-to-* from-* to-*`
  keeps the two-stop path word for word. Fixture: `compositions/gradients`.
  Cost at 1080p on an M4: a full-frame four-stop ground +5.5 ms, gradient
  text on six 96 px lines +0.6 ms.
- **Images of any size** (`patches/0020`, class motion). An image is 1 to
  2048 px per side, a power of two or not (`IMG_MAX_DIM`); sprite atlases,
  tilesets and footage tiles keep powers of two at most 512. The job spec's
  logo rule follows. Fixture: `compositions/images`.

### Changed

- `baselines/paint-effects.md` re-taken with the gradient cases; the rows
  shared with v0.3.0 moved by 1–3 ms, the spread between runs.

### Not in this release

- Conic gradients; radial shapes or centres other than the centred
  farthest-corner ellipse.
- Backdrop blur.

## v0.3.0 — 2026-09-24

Mixed faces, outlined and glowing text, blur and blend modes. Every digest
recorded before this release reproduces unchanged; the new fixtures are new
ledger rows.

### Added

- **Named font faces** (`patches/0016`, class upstream). The sidecar's
  `fonts` keeps `regular`/`bold` as the default pair and accepts
  `faces: { <name>: { regular, bold } }`; a class literal selects one with
  `font-[name]`. At most 8 faces, declared files at most 64 MiB in total,
  all faces sharing one table of 128 atlas slots (`MAX_FONT_SLOTS` 64 →
  128). The build takes `--font-face-regular=<name>=<path>` and
  `--font-face-bold=<name>=<path>` and refuses an undeclared face.
  `openMeasurer` measures per face: `faces` in the options,
  `{ px, bold, face }` size requests, `measure(px, bold, face)`,
  `lineHeight(px, bold, face)`. Each face file is an identity component
  (`font:<face>/<file>`). Fixture: `compositions/faces`.
- **Text stroke** (`patches/0017`, class motion, op 66).
  `text-stroke-[Npx]`, `text-stroke-<color>`, `text-stroke-outside`
  (default, under the fill) / `text-stroke-center` (over it), hollow text
  with `text-transparent`; at most 64 px. Width and colour animate
  (`textStrokeWidth`, `textStrokeColor`, or `-webkit-text-stroke-*`).
  Fixture: `compositions/stroke`.
- **Filter layers** (`patches/0018`, class motion, ops 67/68). A node and
  its subtree drawn as one layer and filtered: `blur-*` (standard
  deviation, up to 128 px), `drop-shadow-*` / `text-shadow-*` (x, y, blur
  radius, colour), `glow-[B]` / `glow-<color>` / `glow-gain-[N]`, and
  `mix-blend-normal|multiply|screen|overlay|plus-lighter`. Blur and every
  shadow value animate, including as a CSS `filter` keyframe value. Layers
  nest four deep. Fixture: `compositions/filters`.
- `scripts/paint-bench.ts` and `baselines/paint-effects.md`: per-frame cost
  of each effect at 1080p on an M4 — over a 2.5 ms frame of six 96 px
  lines, an outside stroke on every line +16.9 ms, a centred one +29.5 ms,
  a glow on every line +10.4 ms, `blur-md` over the block +21.9 ms,
  `mix-blend-screen` over it +3.0 ms.
- CAPABILITIES.md: a `fonts.faces` row owning twelve probed diagnostics and
  a new `paint` group (`font-[name]`, text stroke, blur, drop shadow, blend),
  each probed against the vendored compiler.

### Not in this release

- Multi-stop, angled and radial gradients, gradient text (v0.4.0).
- Images that are not a power of two, or larger than 512 px (v0.4.0).
- Backdrop blur (a filter that reads what is beneath a node).

## v0.2.1 — 2026-09-22

Filesystem paths derived with `fileURLToPath`, so a checkout under a path
with a space builds.

## v0.2.0 — 2026-09-22

`overflow-mask` (`patches/0013`), an alpha-carrying framebuffer
(`patches/0014`) and the cached metrics-only measurement pass
(`patches/0015`).

## v0.1.0

The first public tree: patches 0001–0012.
