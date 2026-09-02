# Fonts

## Why these are pinned

A render's identity includes the exact font bytes (`src/render/identity.ts`).
A build that reaches for a font in `~/Library/Fonts` produces frames nobody
else can reproduce, which is the one thing this project exists to prevent.
The typeface a composition is baked with is therefore pinned — the Latin faces
by being checked in, the CJK pair by digest in
[`manifest.json`](./manifest.json). Both give the same guarantee; only one of
them costs 17 MB in every clone.

| face | how | why |
| --- | --- | --- |
| HarmonyOS Sans Regular + Bold | checked in, 290 KB | `compositions/reel` |
| Noto Sans SC Regular + Bold | fetched, 17 MB | the only way to put Chinese on screen |

## HarmonyOS Sans (Regular, Bold)

Used by `compositions/reel`. Chosen over the vendored Inter for the reel's
display sizes: a tighter, slightly more humanist grotesque with real weight
contrast at 128 px, where Inter reads as a system default.

- Copyright 2021 Huawei Device Co., Ltd.
- Licence: **HarmonyOS Sans Fonts License Agreement**, vendored verbatim at
  [`HarmonyOS_Sans_LICENSE.txt`](./HarmonyOS_Sans_LICENSE.txt)
- Source: the `HarmonyOS_Sans` directory of the official distribution

### Licence compliance

The grant covers what this repository does with the files — it permits
bundling and redistributing **unmodified** copies with any software other than
font software, royalty-free — subject to four conditions. Each is discharged
here:

| condition | how it is met |
| --- | --- |
| 1 · prominent notice that HarmonyOS Sans is used | stated in the root [`README.md`](../../README.md) |
| 2 · no modifications | the two `.ttf` files are **byte-identical to the official distribution** (verified by SHA-256, below) |
| 3 · no stand-alone redistribution | the faces ship as part of the renderer, never on their own; the reel is a work created *with* the font, which the agreement excludes from this limitation |
| 4 · retain the copyright notice and agreement | `HarmonyOS_Sans_LICENSE.txt` carries both, unedited |

```
4f00c7e80329238d0b6fc58e5c829c4086432ba9fa1a8c5ca3da9a0442ce0452  HarmonyOS_Sans_Regular.ttf
7f973862c42353c9cc372dc2ae891d12c9ea5fe2a01b449adaf1eade9b469b47  HarmonyOS_Sans_Bold.ttf
```

Those digests are the redistribution check for condition 2, not the render
identity — that one hashes the same files for a different reason (`identity.ts`)
and the two must not be conflated: a font swap changes the frames, a font *edit*
would breach the licence.

### One reading recorded rather than assumed

Condition 2 governs the **font files**. The build also bakes those outlines into
a coverage atlas inside `app.pak`, which is a rasterised derivative rather than a
copy of the font software. This is read as a work created by using the font —
the category the agreement explicitly permits distributing — because the atlas
carries no outlines and cannot be installed or used as a typeface. The redistributed
artefact that the licence governs is the `.ttf` pair, and it is untouched.

If that reading ever needs to not be load-bearing, the exit is one line in
`scripts/build-reel.ts`: `--font inter` bakes the OFL-licensed Inter Display faces
already vendored under `vendor/pocketjs/assets/fonts/`. The only thing it changes
is the frame digest.

## Noto Sans SC (Regular, Bold)

Used by `compositions/copy`, and by anything else with Chinese in it. Neither
Latin face maps a single CJK codepoint — HarmonyOS Sans here is the Latin-only
cut, and Inter Display maps none either — so before this the repository could
not put Chinese on screen at all, and text that tried came out as tofu with
**widths that measured perfectly consistently and meant nothing**
(`baselines/text-fitting.md`).

- Copyright the Noto Project Authors
- Licence: **SIL Open Font License 1.1**, vendored verbatim at
  [`NotoSansSC_LICENSE.txt`](./NotoSansSC_LICENSE.txt)
- Source: `notofonts/noto-cjk` at tag `Sans2.004`, `Sans/SubsetOTF/SC/`
- Pinned by SHA-256 in [`manifest.json`](./manifest.json); fetch with
  `bun scripts/assets.ts`

### Why fetched rather than checked in

The pair is 17 MB against 1.6 MB of tracked source. Ignoring it is safe for the
reason ignoring audio is safe: `scripts/assets.ts` rebuilds it from a pinned URL
and verifies the digest, so it is a dependency anyone can satisfy in one
command. It is safer than audio, in fact — a font is baked into the pak at build
time, so its absence fails the build immediately rather than quietly.

OFL 1.1 permits bundling and redistribution, including for sale, so nothing here
turns on the choice; it is a repository-weight decision, not a licence one. The
one condition that would bite is renaming: the OFL forbids distributing a
**modified** face under the same name, and the atlas the build bakes is a
rasterised derivative rather than a copy of the font software — the same reading
already recorded for HarmonyOS Sans above.

### It found a bug in the baker

The first Noto bake rendered as fragments: hollowed strokes, letters reduced to
solid blocks. `framework/compiler/bake-font.ts` never closed a contour, relying
on opentype.js paths ending on their own start point — which TrueType outlines
happen to do and CFF ones do not. Fixed in
`patches/0006-bake-font-close-contours.patch`, which leaves every TrueType bake
in this repository **byte-identical**, the reel's included.

## Alternatives measured

Rendered as specimens at the reel's real sizes and strings before choosing:

| family | verdict |
| --- | --- |
| Inter / Inter Display | clean, no character at 128 px; already vendored, OFL |
| **HarmonyOS Sans** | **chosen** — refined, clean raster, real bold |
| GeistMono | thematically apt, but the variable file bakes at one weight, so no bold |
| Montserrat | visible raster artefacts (stray ink above several glyphs) |
