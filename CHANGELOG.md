# Changelog

Tags are cut from `main`. Each entry says what a composition can now
declare, what it costs, and whether any recorded digest moved.

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

- Multi-stop, angled and radial gradients, gradient text.
- Images that are not a power of two, or larger than 512 px.
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
