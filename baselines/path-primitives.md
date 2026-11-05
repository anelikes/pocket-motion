# Path primitives — the numbers

What `patches/0045-path-primitives.design.md` rests on, each with the command
that produced it. Measured 2026-11-05 on an Apple M4 (10 cores, 32 GB), Bun
1.3.11, rustc 1.97.1, on main 524173f (66caf4e5 + 37 patches) with 0045 and
0046 added; the machine was shared, load average 10-60 while these ran.

## Red checks

- `python3 -I baselines/path-primitives/redcheck.py vendor/pocketjs/engine/core`
  — the core half of 0045: 17 defects, each written into the source, its
  test run, the source restored. All 17 RED, the path suite green first
  (`runs/redcheck-0045.txt`). Two more defects were tried on the first run
  and came back GREEN — clipping a dash to the subpath at its start, and at
  its end — because the trim spans, which lie in [0, total], clip every dash
  again: the clipping was redundant rather than unguarded, and it was
  removed rather than kept as code no test can see.
- `bun baselines/path-primitives/redcheck-ts.ts` — the compiler half of 0045,
  0046 and `src/anim/path-motion.ts`: 17 defects, a defect in a patch
  written into one of its `+` lines and the vendored tree rebuilt from it
  (`scripts/vendor.ts --no-wasm`). All 17 RED, each test green first
  (`runs/redcheck-ts.txt`).

## Dashes

- With no pattern `dash()` is `trim()`, the same call; with one of the six
  solid patterns (none, all zero, negative, NaN, infinite, five lengths)
  under three trims, the stroke's words equal the trimmed stroke's, and
  `[7, 0]`, `[7, 0]` offset 3.5 and `[2, 0, 3, 0]` equal the solid stroke
  (`a_solid_pattern_is_the_trim_byte_for_byte`).
- Eleven patterns on a 97-unit line against an f64 reference that walks the
  pattern entry by entry: every piece and dot within 1e-3 units
  (`dashes_lie_where_the_pattern_puts_them`).
- Ten zero-length dashes, width 4: round caps cover 10 discs of radius 2 to
  within 5% (counted in 1/16 px samples), square caps 10 squares of 16 px²
  within 2%, butt caps nothing (`a_zero_length_dash_is_a_dot_of_its_caps`).
- A line of a million units at `[0.25, 0.25]` stops at 65,536 dashes; the
  test, with the one beside it, finishes in under 10 ms in a release build
  (`a_pattern_finer_than_its_outline_stops_at_the_budget`).
- `compositions/path-primitives`, frame 0, row 130 from x 282 to 677: every
  pixel lit exactly where `[12, 8]` from x 280 puts a dash, the four columns
  at each dash edge left out for their partial coverage
  (`tests/path-primitives.test.ts`).

## Morph equalisation

`bun baselines/path-primitives/equalise-cost.ts` — build-time cost of
`compilePathEntry` on keys whose commands differ, fastest of 5:

| keys | cubics a key, baked | ms |
|---|---:|---:|
| play -> pause (3 lines; 2 x 4 lines) | 11 | 1.14 |
| heart -> star (6 cubics; 10 lines) | 15 | 0.93 |
| ring -> square (2 x 8 arc cubics; 4 lines) | 16 | 0.85 |
| blob -> star (96 cubics; 240 lines) | 335 | 6.30 |
| wave -> zigzag + 2 (300 cubics; 200 lines + 2 x 3) | 505 | 1.48 |

The start search (rule 3) is the quadratic part: 64 samples for each of a
key's vertices and 64 fractions, on closed pairs only, which is why the open
wave costs less than the closed blob with fewer cubics.

Keys whose commands line up, sha256 of `JSON.stringify(compilePathEntry(keys))`
before 0046 (the pin with 0001-0043 and 0050) and after, equal:

| keys | sha256 |
|---|---|
| vector-paths' blob, circle -> star | `d82c552d8fb4cc8ce583a5f82f7d2c9af497be33d7dcff817e2e9641e2ea83f9` |
| vector-paths' wave, up -> down | `0e601b239f270bfc12ca20d700d3d9657fc148f78ea5ee7d082514b1c29c34e7` |
| a square, its lines as cubics, the square | `7321c0f339ce6615aaea3c5e55351659e28d03f22724428592f0de5696c4b4dc` |

One outline written three other ways (another start with an edge split,
the other winding, its subpaths in the other order) equalises to the same
points as itself: the largest difference between keys is 0.

## Motion along a path

`bun baselines/path-primitives/chord.ts` — how far the node strays from the
curve between keys, px, the largest over the move:

| motion | fastest, px a tick | every 2: at ticks | every 2: between | every 1: at ticks | every 1: between |
|---|---:|---:|---:|---:|---:|
| fixture fly / trail: the route, 3600 ms, swoop | 20.9 | 3.750 | 3.729 | 0.000 | 1.048 |
| fixture orbit: the ellipse, 2400 ms, linear | 7.4 | 0.194 | 0.190 | 0.000 | 0.048 |
| circle r 200, 2000 ms | 10.5 | 0.274 | 0.270 | 0.000 | 0.069 |
| circle r 100, 1000 ms | 10.5 | 0.548 | 0.539 | 0.000 | 0.137 |
| circle r 100, 500 ms | 20.9 | 2.186 | 2.151 | 0.000 | 0.548 |
| circle r 50, 500 ms | 10.5 | 1.093 | 1.076 | 0.000 | 0.274 |

"At ticks" is every integer tick, which a 60 fps film shows; the keys are
tick 0, the odd ticks and the last, which are what a 30 fps film shows, and
there the error is 0 by construction. "Between" is eight instants inside
each tick, what a shutter samples. Each row is the sagitta `(v k)^2 / (8 R)`
of a chord k ticks long on the tightest radius at that speed: the fixture's
route loops at about 58 px.

`atan2Deg` against the host's `Math.atan2` over 1,000 directions of
magnitude 1 to 1,000: under 1e-12 degrees apart; exact on the axes and
diagonals (`tests/path-primitives.test.ts`).

`compositions/path-primitives` through `layout` at frames 0, 20, 37, 55, 80,
100 and 149: the dot and the orbiter's centres, and the dart's at the first
and last, on the outline within the box's 1 px rounding.

## Ledgers

- `bun scripts/digests.ts`, the whole ledger with 0045 and 0046 applied:
  43 compositions match, every digest recorded before this change among them
  unchanged, and `compositions/path-primitives` recorded at
  `af7442eb…` over 150 frames.
- `bun scripts/visibility.ts`: 50 compositions match; `path-primitives`
  sweeps 20 named nodes, none never shown and none buried after being shown.
- `bun src/cli/main.ts assert compositions/path-primitives --samples 150`:
  18 assertions, 0 failing; `check`: realm clean, 0 ops after mount.
