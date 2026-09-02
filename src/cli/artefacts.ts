/**
 * What a build left behind — asked two different questions, on purpose.
 *
 * "Did anything write these files" and "is this a different picture" are not
 * the same question, and one function answering both got one of them wrong.
 * They are `artefactKey` and `artefactDigest` below, and the difference is
 * mtime against content.
 */

import { statSync } from "node:fs";

import type { ResolvedComposition } from "./resolve.ts";

/**
 * DID ANYTHING TOUCH THESE FILES — mtime and size, cheap enough for a loop.
 *
 * `scripts/digests.ts` asks this either side of a trace, because a digest is a
 * claim about the artefact the ledger built and the ledger has no exclusive
 * hold on `dist`: preview rebuilds into the same directory when a source
 * changes, and a person can run the build by hand. That claim is about the
 * FILES, not about their content — a second build writing identical bytes is
 * still a build the ledger did not make, and the run should be re-run rather
 * than trusted. mtime is the right answer there, and it is the cheap one.
 */
export function artefactKey(c: ResolvedComposition): string {
  return [c.dir, stamp(c.bundlePath), stamp(c.pakPath)].join("|");
}

/**
 * IS THIS A DIFFERENT PICTURE — the bytes, hashed.
 *
 * Preview asks this after every rebuild, to decide whether reopening the
 * session is worth a boot, and the answer decided by mtime is always yes: the
 * build rewrites both files unconditionally. So every save anywhere under
 * `compositions/` — the tree is watched whole — tore down the world, booted it
 * again and re-encoded the whole viewing copy, for a composition whose bytes
 * had not moved. Editing a sibling cut, or the file a shared module lives in
 * and then reverting it, cost a full reboot of a film nobody had touched.
 *
 * `trace` hashes the same two files for input identity. This is that cost,
 * paid once per rebuild rather than once per frame, against a boot it saves.
 */
export async function artefactDigest(c: ResolvedComposition): Promise<string> {
  return [c.dir, await fileDigest(c.bundlePath), await fileDigest(c.pakPath)].join("|");
}

function stamp(path: string): string {
  try {
    const s = statSync(path);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "absent";
  }
}

async function fileDigest(path: string): Promise<string> {
  try {
    const bytes = await Bun.file(path).arrayBuffer();
    return new Bun.CryptoHasher("sha256").update(new Uint8Array(bytes)).digest("hex");
  } catch {
    return "absent";
  }
}
