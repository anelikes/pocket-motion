/**
 * The `<Path>` outlines a composition's mount computes.
 *
 * The build bakes every `d` it can read where the source wrote it
 * (`patches/0043`). One it cannot read — imported from another module, or
 * built at run time from data, as `line()(rows)` builds a chart's — used to
 * be refused at mount. A composition is mount-only (`check` fails one that
 * issues a guest op after mount or books work for later), so every outline
 * it will ever draw exists, with its final value, in the tree right after
 * mount. So the build mounts the bundle once, takes every key the tree asked
 * for and did not find, bakes them, and mounts the result again: that second
 * mount must find every one. The reasoning is `docs/text-shaping.design.md`'s
 * run inventory, applied to outlines.
 *
 * The inventory adds no input. It is a function of the bundle, computed in
 * the realm every render runs in, which refuses `Date`, `Math.random` and
 * locale formatting; it is still written beside the pak, so a reader can see
 * what was baked from a mount. What the realm does not pin is the host's
 * `Math.sin`, `cos`, `pow`, `exp`, `log` and `atan2`: a `d` computed through
 * one of them is this machine's (AGENTS.md, "What does not reach them yet").
 *
 * The hook is `ui.__unbakedPath` (`patches/0054`): with it installed, a key
 * the bundle did not bake is handed to the host and the node draws no
 * outline; without it, every render, a strict host refuses the key as before.
 */

import { existsSync } from "node:fs";

import { hardenedBootWorld } from "../runtime/boot.ts";

/** One outline a mount asked for: a `<Path>`'s morph keys and its viewBox. */
export interface MountedOutline {
  readonly d: readonly string[];
  readonly viewBox?: string;
}

/** The file `--path-inventory=` reads: `{ "outlines": MountedOutline[] }`. */
export interface PathInventory {
  readonly outlines: readonly MountedOutline[];
}

/** The `PATH_IDS` key `framework/src/path-key.ts` writes, read back. */
export function parsePathKey(key: string): MountedOutline {
  let v: unknown;
  try {
    v = JSON.parse(key);
  } catch {
    throw new Error(`a mounted <Path> key is not JSON: ${key.slice(0, 120)}`);
  }
  if (
    !Array.isArray(v) ||
    v.length !== 2 ||
    !Array.isArray(v[0]) ||
    !v[0].every((d: unknown) => typeof d === "string") ||
    (v[1] !== null && typeof v[1] !== "string")
  ) {
    throw new Error(`a mounted <Path> key is not [d[], viewBox | null]: ${key.slice(0, 120)}`);
  }
  return { d: v[0] as string[], ...(v[1] !== null ? { viewBox: v[1] as string } : {}) };
}

/**
 * Mount a built bundle and return every outline its tree asked for that the
 * bundle did not bake, in the order the mount asked, each once.
 */
export async function unbakedOutlines(options: {
  readonly bundlePath: string;
  readonly pakPath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}): Promise<MountedOutline[]> {
  const keys: string[] = [];
  const seen = new Set<string>();
  const world = await hardenedBootWorld({
    bundlePath: options.bundlePath,
    ...(existsSync(options.pakPath) ? { pakPath: options.pakPath } : {}),
    width: options.width,
    height: options.height,
    hz: options.fps,
    // No frame is rendered: the inventory is read off the mount.
    shutter: null,
    wrapOps: (ops) => {
      ops.__unbakedPath = (key: unknown): void => {
        const k = String(key);
        if (seen.has(k)) return;
        seen.add(k);
        keys.push(k);
      };
      return ops;
    },
  });
  // The mount ran when the bundle was evaluated; one guest turn flushes
  // anything it deferred to the first frame, as every render's first frame does.
  world.frame(0);
  return keys.map(parsePathKey);
}
