/**
 * The one file a build both CREATES and RESOLVES, and why a fresh tree seeds it.
 *
 * `vendor/pocketjs/framework/src/styles.generated.ts` is upstream-gitignored,
 * so a fresh checkout does not have it: it appears the first time a build's
 * pass 1 runs. That is a problem because BOTH passes touch it, in the wrong
 * order:
 *
 *  - Pass 1 walks the module graph and calls
 *    `Bun.resolveSync("./styles.generated.ts", framework/src)` for
 *    `framework/src/index.ts:52`'s import (`tools/build.ts:248`). On a fresh
 *    tree that resolve MISSES. It is a wasted probe either way — `walk` returns
 *    immediately for that filename (`tools/build.ts:270`) — but it happens
 *    before the file exists.
 *  - Pass 1 then writes the file (`tools/build.ts:311`).
 *  - Pass 2 resolves the same import off DISK. `jsxPlugin` serves the
 *    CONTENTS from memory but registers no `onResolve` for a relative
 *    specifier under `framework === "solid"`
 *    (`framework/compiler/jsx-plugin.ts:685` is the non-solid branch), so
 *    `Bun.build` has to find the path itself.
 *
 * Whether pass 2 finds a file that pass 1 created after Bun had already looked
 * in that directory is Bun's business, not this repository's. Upstream refuses
 * to depend on it: `tools/site-build.ts` seeds exactly this stub before it
 * builds anything, saying "Seed a positive resolution before Bun can cache the
 * missing path; each app build immediately replaces the stub with its real
 * style table."
 *
 * It is not theoretical. Run 33621096945 on a fresh ubuntu-latest runner failed
 * `tests/preview.test.ts`'s `beforeAll` with
 *
 *     error: Could not resolve: "./styles.generated.ts"
 *         at vendor/pocketjs/framework/src/index.ts:30:48
 *
 * on the FIRST build of the run, after that same build's stdout had printed
 * `tailwind: 24 style record(s) ... -> framework/src/styles.generated.ts`. The
 * two runs before it, on the same runner image with a byte-identical child
 * build, were green — and later in the SAME red run
 * `tests/build-lock.test.ts` deleted the mirror and built twice more without
 * trouble, so it is intermittent rather than a property of that tree.
 *
 * The rate was then MEASURED on the runner rather than left as an impression:
 * a sweep deleting the mirror and the transform cache before each build, with
 * upstream's builder spawned directly, failed 6 of 20. Locally the same sweep
 * is green everywhere reachable — 25 builds in Linux containers on amd64 and
 * arm64, and every attempt on macOS — so nothing here can make the failing
 * case appear on demand, and chasing Bun's directory cache from this
 * repository is not the fix. Making the tree never mirror-less is, which is
 * what upstream does.
 *
 * Two callers, one function: `scripts/vendor.ts` seeds a tree it has just
 * built, and `withBuildLock` (`src/vendor/build-lock.ts`) seeds before every
 * build this repository spawns, because a tree can lose the file afterwards —
 * `tests/build-lock.test.ts` removes it on purpose, and a person can too.
 * Seeding never overwrites: a real table is a build's output and this only
 * fills an absence.
 */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { pocketjsRoot } from "../runtime/boot.ts";

/**
 * The placeholder table, upstream's own.
 *
 * The four exports are the ones `tools/site-build.ts` writes, in its order and
 * with its values. `tests/vendor-mirror.test.ts` holds it to the vendored tree
 * from both sides: every binding the framework imports from this module is
 * exported here, and `DEFAULT_FONT_SLOT` is the number the vendored compiler
 * computes rather than a number remembered from upstream's source.
 *
 * The header says what it is because the first thing anyone does with an
 * unexpected generated file is open it. A build overwrites the whole file, so
 * the header cannot survive into a real table and be read as one.
 */
export const MIRROR_SEED = `// PLACEHOLDER written by pocketjs-motion (src/vendor/mirror.ts), not by a build.
// The real table is written by pass 1 of \`vendor/pocketjs/tools/build.ts\`; this
// exists only so the path RESOLVES on a tree where no build has run yet. See
// that module for why an absent file is not the same as an empty one.
export const STYLE_IDS: Record<string, number> = {};
export const STYLE_COUNT = 0;
export const FONT_SLOTS: Record<number, { px: number; bold: boolean }> = {};
export const DEFAULT_FONT_SLOT = 2;
`;

/**
 * Where the mirror lives under a vendored PocketJS.
 *
 * The root is a parameter because two callers mean two roots: `doctor` and
 * `scripts/vendor.ts` ask about THIS repository's `vendor/pocketjs`, while a
 * build asks about whatever `POCKETJS_ROOT` names, which is what
 * `pocketjsRoot()` returns and what the tests point elsewhere.
 */
export function mirrorPath(root: string = pocketjsRoot()): string {
  return join(root, "framework", "src", "styles.generated.ts");
}

/**
 * Write the placeholder if — and only if — the file is absent.
 *
 * Returns true when it wrote one. A false is the ordinary case: either a build
 * has run, or a previous seed is still there.
 */
export function seedMirror(root: string = pocketjsRoot()): boolean {
  const path = mirrorPath(root);
  if (existsSync(path)) return false;
  // A vendored tree with no `framework/src` is not a tree to repair by
  // creating one; the caller's own check (`vendorProblems`, or the build's
  // spawn) says so far better than a stub in an invented directory would.
  if (!existsSync(dirname(path))) return false;
  writeFileSync(path, MIRROR_SEED);
  return true;
}
