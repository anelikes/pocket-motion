# SVG import and outlines read at mount — measurements

Patches `0053` (`<Svg src parts>`) and `0054` (`<Path>` outlines a mount
computes). Every number here was taken on 2026-11-05 on an Apple M4, Bun
1.3.11, with other sessions holding the machine at a load average between 7
and 38; each says how it was taken.

## Literal-only compositions bake the bytes they baked

`baselines/svg-import/pak-identity.ts` builds every composition of the digest
ledger through `runBuild` — the path the ledger and the CLI take — and hashes
its pak, its bundle and its `<output>.paths.json` when there is one. Run once
with `0053` and `0054` moved out of `patches/` and the tree re-vendored
(`runs/pak-identity-without.json`), once with them
(`runs/pak-identity-with.json`):

| | of 42 |
|---|---:|
| pak byte-identical | 42 |
| took the mount path (a `paths.json` written) | 0 |
| bundle byte-identical | 0 |

Every bundle moved, and by the framework alone: `setPath` in
`framework/src/native-tree.ts` carries `0054`'s `ui.__unbakedPath` hook and a
longer refusal message, and every bundle carries `setPath`. The `Svg`
function `0053` adds is tree-shaken out of a bundle that does not import it
(checked on `smoke` and `vector-paths`: the hook present, the stub absent).
The frame digests are the full ledger run's (below).

## Both ledgers

`bun scripts/digests.ts`: 44 compositions match — the 42 recorded before,
every digest unchanged, and the two fixtures recorded here with
`--write --only`. `bun scripts/visibility.ts`: 51 compositions match;
`svg-import` sweeps 16 named nodes and `data-chart` 6, none failing. Both
runs were taken before the two-`<Svg>` fix below; after it, `--only` on the
two fixtures reproduced their digests. The expander the fix changed runs only
on a module that imports `Svg`, which `svg-import` alone does.

## The chart computed at mount against the same chart written out

`compositions/data-chart` computes four outlines at mount. A copy of it with
the four strings from its `main.paths.json` written as `d="…"` literals bakes
the **same pak, byte for byte** — the inventory's entries follow the literal
ones, and this chart has none. Build wall time, warm transform cache, four
alternating runs each, load average 15:

| | s |
|---|---|
| computed at mount: two builds, two mounts | 1.00, 1.02, 1.24, 0.90 |
| written as literals: one build | 0.53, 0.45, 0.46, 0.48 |

So the mount path costs about half a second here: one more build and two
boots of a 1920×1080 world with 18 nodes.

## Red checks

`bun baselines/svg-import/redcheck.ts`, `runs/redcheck.txt`: 27 defects, each
test green on the tree first, each red with its defect in. The first run had
four the harness did not execute as intended — three edits that removed or
added a patch line and so broke a hunk's count, and a circle mutation that
flipped the sweep flag, which draws a different curve through the same points
rather than the circle backwards, and was GREEN. All four were rewritten as
one-line replacements of the defect itself.

Three were added after a read of the expander found a defect no test had
reached: a module with two `<Svg>` elements added the `View` and `Path`
import specifiers once per element, and the second pair collided with the
first — `Duplicate declaration "SvgView"` from Babel, because a specifier
added for one element is not a scope binding until the crawl at the end. The
test was run red on the tree before the fix, and the fix (names held per
import declaration) has its own mutation in the harness, as do two refusal
messages reworded in the same pass. In the third run 26 of the 27 were red;
the 27th was GREEN because the mutation itself was wrong — it cleared the map
of added names after reading from it, so the second element still got the
first's — and, rewritten to read from a cleared map, it is red. Both are in
`runs/redcheck.txt`.

## The overlap finding inside one picture

Before the `svg:<src>` carve-out, `layout --at 140` on `compositions/svg-import`
produced 14 `content_overlap` findings, every one a pair of lighthouse parts
the file draws over each other (horizon and rock, rock and tower, sea and
rock, …). After it, none at any sampled frame; the 25 that remained across
`verify`'s five frames were `text_not_painted` on parts trimmed or scaled to
nothing before their turn, excused in the sidecar's `layoutAllow` as
`compositions/vector-paths` excuses its signature.
