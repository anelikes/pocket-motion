/**
 * The upstream tree this project vendors, pinned.
 *
 * Here rather than in `scripts/vendor.ts` because two things read it and only
 * one of them is a script: `scripts/vendor.ts` clones and patches, and
 * `src/render/build-record.ts` writes the commit into every artifact's
 * `build.json` so a bundle says which upstream produced it. A `src/` module
 * importing the script would run its `main()`.
 *
 * Bump deliberately: the files in `patches/` are written against this tree,
 * and `patches/README.md` records which of them still apply to upstream main.
 */
export const UPSTREAM = {
  // The organisation was renamed from pocket-stack (pocket-nexus/pocketjs#505).
  repo: "https://github.com/pocket-nexus/pocketjs.git",
  // main on 2026-10-22: "feat(microts): show the home page counter in Solid
  // and Vue (#602)".
  commit: "66caf4e5",
} as const;
