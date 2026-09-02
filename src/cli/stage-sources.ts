/**
 * Files a staged job copies from a composition directory.
 * Generated sources and the generator stay behind; the job's generate() writes
 * those. A later pocket.config.ts in the template directory is picked up.
 */

import { copyFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const STAGE_SKIP = new Set(["gen.ts", "app.tsx", "pocket-motion.json", "spec.default.json"]);

export async function copyStageSources(from: string, to: string): Promise<string[]> {
  const copied: string[] = [];
  for (const name of (await readdir(from)).sort()) {
    if (STAGE_SKIP.has(name) || name.startsWith(".")) continue;
    const src = join(from, name);
    if (!(await stat(src)).isFile()) continue;
    await copyFile(src, join(to, name));
    copied.push(name);
  }
  return copied;
}
