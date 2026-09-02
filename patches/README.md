# patches/

Engine and compiler changes this project needs and upstream does not carry.
`scripts/vendor.ts` clones `pocket-stack/pocketjs` at the pinned commit
(`UPSTREAM.commit` in `scripts/vendor.ts`), applies every `*.patch` here in
sorted order, and rebuilds `hosts/web/pocketjs.wasm`. **`vendor/` is never
edited**: a change to engine behaviour is a new file here.

Sorted order is load-bearing where one patch's tests call a helper another
defines — `0008` uses the `raster_fb` helper `0007` adds to
`engine/core/src/tests.rs`.

## What each one does, and where it stands upstream

| # | what it changes | upstream | applies to main |
|---|---|---|---|
| 0001 | `MAX_FONT_SLOTS` 24 → 64, and the build assigns slots from the sizes a composition actually uses instead of a fixed seven-size table (`compositions/typography` is the fixture) | unsubmitted | **no** — `engine/core/src/text.rs` |
| 0002 | refuses a font size whose baked cell would exceed the atlas header's u8 `cellH` and names the largest px that fits, instead of clamping and truncating the glyph | unsubmitted | yes |
| 0003 | read-only counts of pending timers, frame hooks, queued effects and service pumps, so a host can ask what the framework is still holding; the structural half of `check` | unsubmitted | **no** — `framework/src/index.ts` |
| 0004 | a wasm entry point that carries `spec::img` flags into `upload_texture` (`FLAG_LINEAR` bilinear sampling, `FLAG_RLE`); `Ui::upload_texture_flags` could always do it, nothing exposed it | unsubmitted | yes |
| 0005 | `set_image_uv`: a plain Image samples a sub-rect of its texture rather than the whole of it — the tile grid every footage track draws through | unsubmitted | **no** — `engine/core/src/tree.rs`, `engine/wasm/src/lib.rs`, `framework/src/host.ts`, `hosts/web/wasm-ops.js` |
| 0006 | glyph outlines fill by non-zero winding rather than even-odd | **#271 merged the contour-closing half**; the winding rule itself was not submitted | **no** — `framework/compiler/bake-font.ts` |
| 0007 | `debug_hide(slot)`: a draw-time skip of one node and its subtree, which is how `layout` answers "is this in the picture" in pixels and how `visibility` classifies covered against invisible-by-declaration | unsubmitted | yes |
| 0008 | a POLY op, so rotated solid geometry carries coverage instead of being drawn as an axis-aligned box | **#301 open.** The reviewer's redesign is at its head (`20b663c`): coverage computed once in core, PSP eating the same spans. The patch here is the earlier design, which computes it in `raster.rs`. **Whether the two are byte-identical on the software path has not been measured** | **no** — `contracts/spec/gen-rust.ts`, `contracts/spec/spec.ts`, `engine/core/src/spec.rs`, `engine/core/src/tests.rs` |
| 0009 | font atlas v3 → v4: a GPOS kerning-pair section the baker writes and the core applies in `measure_run` / `layout_run`; v2 and v3 still load | unsubmitted | **no** — `framework/compiler/bake-font.ts` |
| 0010 | publishes the baked tick rate out of the bundle as `__pocketTickHz`, so `assertBakedTickRate` can refuse a bundle baked at a rate this realm does not step | unsubmitted | **no** — `framework/src/index.ts` |
| 0011 | an `animate-<name>` naming nothing is a build error listing the declared names, instead of dropping the whole class literal silently | unsubmitted | yes |
| 0012 | records which string literals are, on some execution, the WHOLE value of a `class=` attribute, so 0011 can refuse a bad animation name in one of them whatever else the literal holds — and prose stays safe by where it was written rather than by token count | unsubmitted | **no** — `framework/compiler/tailwind.ts` |

`test/poly-span-oracle` (**#333, draft**) locks POLY spans against a 4×4 sample
oracle. It is a test branch upstream, not a patch here.

## How the last column was measured

Not from memory. A detached worktree of the sibling `pocket-stack/pocketjs`
checkout at **`origin/main` = `7842d09`** (2026-09-02), then, per patch,
`git apply --check`, and then a second pass applying them in sorted order into
the same tree. **Both passes give the same verdict: 4 apply, 8 refuse**, and the
files named above are the ones `git apply` reports. Only `0012` moves between
the two runs — alone it fails at `tailwind.ts:715`, after `0011` at `:811` —
and it refuses either way, so no refusal here is a sibling dependency standing
in for upstream drift.

The column says whether the diff still lands, and nothing more. It is not a
claim that upstream still lacks the behaviour: `0006` applies to no line of
today's `bake-font.ts` and half of what it was written for is merged. Re-measure
before reading it as a rebase estimate; the number was 7 of 12 in mid-August.

The pin is a different question. Every patch applies at `UPSTREAM.commit` by
construction — `bun run vendor` fails loudly otherwise — so this table is about
the cost of moving the pin, which is deliberately not a release blocker.
