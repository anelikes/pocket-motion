# The frame hash — portability of `fast`, 2026-08-13

`phase5-throughput.md` found the determinism oracle costing more than twice the
renderer: 2.71 ms to SHA-256 a 1080p frame against 1.19 ms to rasterise it. It
also found that wyhash (`Bun.hash`) does the same job in 0.24 ms, and left the
option in `src/render/hash.ts` **opt-in and unreachable from the CLI**, with a
one-word note: *Pending*.

The reason it was pending is the whole point of the project. Every claim here
rests on frame hashes agreeing across machines, and only SHA-256 had been through
that check. wyhash is integer-only and *ought* to be portable — but "ought to" is
not what this project ships.

Reproduce with [`scripts/hash-vectors.ts`](../scripts/hash-vectors.ts).

## Method

Twenty fixed vectors, generated rather than random so any two machines hash the
same bytes without shipping a fixture: empty, single bytes, sizes either side of
every 8/16/32/64-byte boundary where a word- or vector-at-a-time implementation
would change code path, runs of zeros and of `0xff`, 64 KB of LCG noise, and a
full 8.3 MB 1080p RGBA frame. Plus that frame with **one bit flipped**, so a hash
that quietly ignored part of its input would show up as agreement on a
distinction it should have made rather than as a match.

Then the same thing end to end: `trace compositions/smoke`, 450 frames at
1920×1080, on both platforms under both algorithms.

## Two axes, not one

The plan only asked for architecture. Architecture is not the axis that would
have bitten.

**`Bun.hash` is Bun's implementation detail, not a standard.** SHA-256 is defined
by a document and cannot change; wyhash-via-`Bun.hash` is whatever that release
of Bun does. A digest recorded today and compared after a Bun upgrade is exactly
the failure upstream hit — its golden suite compares PNG bytes, so all 54 goldens
broke across a Bun upgrade while the pixels were identical
(pocket-stack/pocketjs#263). So the version axis was measured too.

| | `fast` (wyhash) | `sha256` |
| --- | --- | --- |
| darwin/arm64, Bun 1.3.11 *(baseline)* | — | — |
| linux/x64, Bun 1.3.11 | 20/20 identical | 20/20 identical |
| linux/x64, Bun 1.1.45 | 20/20 identical | 20/20 identical |
| linux/x64, Bun 1.2.23 | 20/20 identical | 20/20 identical |
| linux/x64, Bun 1.3.14 | 20/20 identical | 20/20 identical |

End to end, `compositions/smoke`, 450 frames:

| algorithm | darwin/arm64 | linux/x64 | |
| --- | --- | --- | --- |
| `fast` | `92983ca47691bfd3…` | `92983ca47691bfd3…` | every frame identical |
| `sha256` | `947ec6d2c3b94680…` | `947ec6d2c3b94680…` | every frame identical |

**That second row is worth more than the first.** The cross-platform determinism
claim was measured at Phase 0; the core has since taken `patches/0004` and
`patches/0005` and the footage tiling changed. This re-proves it after all of
that, not just for the new hash.

## What it costs

`compositions/reel` as it stood that day — the v7 cut, 846 frames at 1920×1080 —
`trace` (render + hash, no encode). The reel is 1071 frames since the v8 recut;
the ratio is what this table is for, not the wall time:

| | wall | ms/frame |
| --- | ---: | ---: |
| `--hash sha256` | 4.51 s | 5.33 |
| `--hash fast` | 2.40 s | **2.85** |

**1.87×**, repeatable across runs, and more than Phase 5's frame-parallel work
achieved. Phase 5 measured the predicted end state at 3.54 ms/frame; the
rasteriser has since had two patches, and the number came out better.

## The default stays `sha256`

Verified does not mean default, and the reason is not caution.

**Every digest recorded in `baselines/` is a SHA-256 digest** — the reel's
(`82f2361f885b529b…` since the v8 recut, `9afd9bf701ca97d8…` before it), Phase
0's cross-platform `a202fab2d036cbe1…`, Phase 1–2's footage identities. Those are the project's evidence. Switching the default would
not invalidate the claims, but it would mean a reader running `trace` gets a
different number than the document says and has to discover why.

And four Bun versions is evidence, not a guarantee. SHA-256 will still be
SHA-256 in ten years; `Bun.hash` is whatever Bun decides. An archival digest
should not depend on a decision someone else gets to make.

So: `--hash fast` is now a real flag on `trace` and `render`, verified, and worth
using whenever the output is the video rather than the number. The digest that
goes in a document stays SHA-256.

## Caveat

linux/x64 here is a container on Apple Silicon, so the x86_64 Bun binary runs
under Docker Desktop's translation rather than on x86 hardware. For an
integer-only hash that exercises the same code path and the same binary, which
is what is being tested — but it is not a native x86 run, and the distinction is
recorded rather than glossed.
