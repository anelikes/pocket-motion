# path-primitives — dashes, morphs between unlike keys, motion along a path

Three primitives a GSAP user reaches for, one quadrant each and a fourth for
dashes under a trim: `patches/0045` (dashes), `patches/0046` (morph
equalisation) and `src/anim/path-motion.ts` (motion along a path). The design
is `patches/0045-path-primitives.design.md`. 1920×1080, 150 frames at 30 fps.
Every node that moves or draws carries a `debugName`, and
`pocket-motion.json` asserts what each is for against the picture.

| node | what it shows | what it took |
|---|---|---|
| connector-dashed | a `stroke-dash-[12_8]` line between two boxes | its box touches the two boxes and overlaps neither, so `layout` reports nothing; `tests/path-primitives.test.ts` reads row 130 of frame 0 and finds lit pixels exactly where `[12, 8]` from x = 280 puts dashes |
| connector-dotted | `stroke-dash-[0_16] stroke-cap-round`: every dash zero-length, so every dash is a disc | nothing |
| connector-marching, selection | the offset run back one period, `linear infinite` (`dashOffset` 0 → -20 over 1 s; `stroke-dashoffset` 0 → -12 over 600 ms) | frames 30 apart are one picture in the marching connector's region and frames 7 apart are not (the test); the selection's region is left out of that comparison because it marches on its own 600 ms |
| play-pause | a play triangle (one subpath, three lines) into pause bars (two subpaths, four lines each), held at each end | the triangle pairs with the left bar (largest area first, ties in written order) and the right bar grows from its own centre |
| heart-star | six cubics into ten lines, gradient fill through `bg-clip-path` | equalised to 15 cubics a key |
| ring-square | two concentric circles under `fill-evenodd` into a square | the hole has no partner and closes to the centre of its own box, (50, 50) |
| route | a dashed route drawn on by `trimEnd` | covered at frames 0 and 1: its first few drawn pixels sit under the dot and the dart waiting at its start. The sidecar asserts it from frame 2 and `layoutAllow` says why |
| dart, trail | a dart flying the route with `rotate: true`, a dot 400 ms behind it, both from `motionPath` called in `pocket.config.ts` | the route is written twice, in `main.tsx` for `<Path>` and in the config for the kit, and the test holds the copies equal. Keys on odd ticks, so every frame's position is on the curve; the test reads both centres off `layout` at seven frames |
| dashed-ring | `stroke-dash-[22_14]` with round caps drawn on by `trimEnd`: the dashes appear where the pattern puts them, none slides | trimmed to nothing before tick 12, invisible by declaration — `layoutAllow` says so |
| orbit-track, orbiter | a dot circling a dotted ellipse, `iterations: "infinite"` | the follower placed with the track's box (`path: { box }`), so the dot rides the drawn track |

Both ledgers carry it. `check` passes with no op after mount: every moving
thing is a baked timeline.
