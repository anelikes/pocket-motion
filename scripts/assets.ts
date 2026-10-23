#!/usr/bin/env bun
/**
 * Fetch the third-party assets this repository depends on but does not carry:
 * the audio the reel muxes, and the CJK face nothing Latin can substitute for.
 *
 * Every `assets/<kind>/manifest.json` is a list of {path, url, bytes, sha256}
 * relative to its own directory, and this walks all of them.
 *
 * The bytes are not in the repository because they dwarf it. Audio is ~4 MB of
 * media no test and no golden ever reads — `src/render/` and the frame hash
 * never open an audio file, since audio is muxed in a separate pass. Noto Sans
 * SC is ~17 MB for the pair, against 1.6 MB of tracked source. Carrying either
 * makes the repository mostly not be the thing it exists for.
 *
 * They are also not deleted, merely unversioned, which is the arrangement
 * `vendor/` already uses: ignored, but reconstructible by one command. That is
 * the condition for ignoring anything here. An ignored dependency with no way
 * to rebuild it is a dependency only its author can satisfy, and its absence
 * shows up as something quieter than an error — this project has been bitten
 * twice, by a stale `pocketjs.wasm` that would have silently sampled nearest,
 * and by a missing `node_modules` that read as a patch fault.
 *
 * So: every entry carries its source URL and the SHA-256 of the exact bytes the
 * work was made against. A file that arrives different is a failure, not a
 * warning. A re-encoded track would shift the beat grid the reel is pinned to
 * (127.7 BPM, phase 421 ms) and every cut in it; a different revision of a font
 * changes advances, so it changes where every line breaks and every frame the
 * renderer produces (`src/render/identity.ts`).
 *
 * That last point is why fetching a font is not a weaker arrangement than
 * checking one in. The README's objection is to a build reaching into
 * `~/Library/Fonts` for whatever happens to be installed. Bytes pinned by
 * digest are the same bytes on every machine or the build stops.
 *
 *   bun scripts/assets.ts             # fetch whatever is missing, verify all
 *   bun scripts/assets.ts --check     # verify only; never touch the network
 *   bun scripts/assets.ts --force     # re-fetch everything
 *   bun scripts/assets.ts --kind fonts,synthetic   # only those manifests
 *
 * `--kind` exists for the Docker image, which reproduces the digest ledger and
 * needs the faces the compositions bake but not the audio `reel` muxes: the
 * ledger hashes frames, and the frame hash never opens an audio file. An image
 * that fetched the Mixkit tracks would carry them to wherever it was pushed.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

interface Entry {
  readonly path: string;
  /**
   * Absent for bytes that were GENERATED rather than fetched.
   *
   * No URL resolves to them, so they are tracked in git instead
   * (`assets/synthetic/`), and what this script owes them is the other half of
   * the contract: verify the digest, and never claim to be able to fetch them
   * back. The command that produced them is recorded in their own manifest,
   * beside the ffmpeg version it was run on.
   */
  readonly url?: string;
  readonly bytes: number;
  readonly sha256: string;
}

const ROOT = resolve(import.meta.dir, "..");
const ASSETS = join(ROOT, "assets");

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const force = argv.includes("--force");
const kindArg = argv.find((a) => a.startsWith("--kind="))?.slice("--kind=".length)
  ?? (argv.includes("--kind") ? argv[argv.indexOf("--kind") + 1] : undefined);
const kinds = kindArg === undefined ? null : new Set(kindArg.split(",").filter(Boolean));

const digest = async (path: string): Promise<string> =>
  new Bun.CryptoHasher("sha256").update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest("hex");

/** Every `assets/<kind>/manifest.json`, paired with the directory it governs. */
async function manifests(): Promise<{ kind: string; dir: string; entries: Entry[] }[]> {
  const out: { kind: string; dir: string; entries: Entry[] }[] = [];
  for (const kind of await readdir(ASSETS)) {
    const dir = join(ASSETS, kind);
    const file = join(dir, "manifest.json");
    if (!existsSync(file)) continue;
    if (kinds !== null && !kinds.has(kind)) continue;
    out.push({ kind, dir, entries: JSON.parse(await Bun.file(file).text()) as Entry[] });
  }
  if (kinds !== null) {
    const unknown = [...kinds].filter((k) => !out.some((m) => m.kind === k));
    if (unknown.length > 0) {
      throw new Error(`assets: no assets/<kind>/manifest.json for --kind ${unknown.join(", ")}`);
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind));
}

/** Where a reader is told to look when a URL has moved. */
const provenanceOf = (dir: string, kind: string): string =>
  existsSync(join(dir, "ATTRIBUTION.md")) ? `assets/${kind}/ATTRIBUTION.md` : `assets/${kind}/README.md`;

let fetched = 0;
let present = 0;
let total = 0;
const bad: string[] = [];
const missing: string[] = [];

for (const { kind, dir, entries } of await manifests()) {
  for (const e of entries) {
    total++;
    const dest = join(dir, e.path);
    const label = `${kind}/${e.path}`;

    if (!e.url) {
      // Generated: tracked in git, so absence is not something a fetch fixes.
      if (!existsSync(dest)) {
        missing.push(`${label} (generated — see ${provenanceOf(dir, kind)}; not fetchable)`);
        continue;
      }
      present++;
    } else if (force || !existsSync(dest)) {
      if (checkOnly) {
        missing.push(label);
        continue;
      }
      console.log(`assets: fetching ${label} (${(e.bytes / 1048576).toFixed(1)} MB)`);
      const res = await fetch(e.url);
      if (!res.ok) {
        throw new Error(
          `PocketJS Motion: ${e.url} returned ${res.status}.\n` +
            `${label} is listed in ${provenanceOf(dir, kind)}; if the source has moved, ` +
            `record the new URL there and regenerate the manifest rather than substituting a file.`,
        );
      }
      await mkdir(dirname(dest), { recursive: true });
      await Bun.write(dest, await res.arrayBuffer());
      fetched++;
    } else {
      present++;
    }

    if (existsSync(dest)) {
      const got = await digest(dest);
      if (got !== e.sha256) bad.push(`${label}\n    expected ${e.sha256}\n    got      ${got}`);
    }
  }
}

if (missing.length > 0) {
  console.error(
    `assets: ${missing.length} file(s) absent — run \`bun scripts/assets.ts\`:\n` +
      missing.map((m) => `  ${m}`).join("\n"),
  );
  process.exit(1);
}

if (bad.length > 0) {
  console.error(
    `assets: ${bad.length} file(s) do not match the manifest:\n  ${bad.join("\n  ")}\n\n` +
      "These are the exact bytes the work was made against. A re-encoded track moves the\n" +
      "beat grid (127.7 BPM, phase 421 ms) and with it every cut pinned to it; a different\n" +
      "font revision moves every advance, so every line break and every frame. This is an\n" +
      "error rather than a warning. Re-fetch with --force, or update the manifest deliberately.",
  );
  process.exit(1);
}

console.log(
  `assets: ${total} file(s) verified` +
    (fetched ? `, ${fetched} fetched` : "") +
    (present && fetched ? `, ${present} already present` : ""),
);
