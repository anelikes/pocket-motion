/**
 * The vendored tree is not ready until `framework/src/styles.generated.ts`
 * exists, and these are the four places that now say so.
 *
 * The hole this closes is in `src/vendor/mirror.ts`: upstream gitignores that
 * file, a build's pass 1 CREATES it and pass 2 RESOLVES it off disk, and a
 * fresh checkout therefore asks Bun to find a path it looked for and missed
 * moments earlier. Run 33621096945 is the one that did not, and a sweep on the
 * same runner put a number on it: 6 of 20 mirror-less builds failed there,
 * against 0 of 25 in Linux containers and 0 on macOS.
 *
 * WHAT EACH TEST WOULD CATCH, because a guard that cannot go red is a claim
 * about a guard:
 *
 *  - `bun run vendor` leaving no mirror. Red before the seed landed: a fresh
 *    `bun run vendor` produced a `framework/src/` with 58 files and none of
 *    them this one. Run below by deleting it and re-running the script, which
 *    is the same path a fresh clone takes once the tree is already there.
 *  - `doctor` calling such a tree ready. Red before `vendorProblems` learned
 *    the field: every other thing a build needs from the vendored tree — the
 *    pin, the patches, the wasm — was checked, and the one that broke a fresh
 *    checkout was not.
 *  - A build spawned through `withBuildLock` finding it absent. Red before the
 *    seed moved inside the lock: `tests/build-lock.test.ts` deletes the mirror
 *    on purpose and a person can too, so "vendor seeded it once" is not the
 *    same claim as "no build starts without it".
 *  - The seed drifting from what the vendored tree imports. Red if upstream
 *    adds a binding to the generated module, or moves `DEFAULT_FONT_SLOT`:
 *    the placeholder is a literal in this repository and nothing else would
 *    notice.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { checkVendor } from "../src/cli/commands/doctor.ts";
import { MIRROR_SEED, mirrorPath, seedMirror } from "../src/vendor/mirror.ts";
import { vendorProblems, vendorStatus } from "../src/vendor/status.ts";
import { withBuildLock } from "../src/vendor/build-lock.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const MIRROR = mirrorPath(VENDOR);

process.env.POCKETJS_ROOT = VENDOR;

/** Put back whatever was there, so a failure here costs the next test nothing. */
let saved: string | null = null;

beforeAll(() => {
  if (!existsSync(join(VENDOR, "tools", "build.ts"))) {
    throw new Error(`vendor pocketjs missing at ${VENDOR} — run bun run vendor`);
  }
  saved = existsSync(MIRROR) ? readFileSync(MIRROR, "utf8") : null;
});

afterAll(() => {
  // A table that was here is put back byte for byte. Nothing here is put back
  // as ABSENT: leaving the tree in the one state this whole file exists to
  // prevent would be a test that costs the next command the defect.
  if (saved === null) seedMirror(VENDOR);
  else writeFileSync(MIRROR, saved);
});

describe("the style mirror is part of a ready vendored tree", () => {
  test("this tree has one — the state every build assumes", () => {
    expect(existsSync(MIRROR)).toBe(true);
  });

  test("`bun run vendor` puts it back when it is missing", async () => {
    rmSync(MIRROR, { force: true });
    expect(existsSync(MIRROR)).toBe(false);
    // --no-wasm: the rasteriser is already built and rebuilding it is a
    // minute of cargo for a question about one text file. Everything else the
    // script does — checkout, clean, re-apply the patches, seed — runs.
    // POCKETJS_ROOT is dropped rather than inherited: to `scripts/vendor.ts`
    // it names a CLONE SOURCE, and this file sets it to the vendored tree for
    // everything else here. Passing it through would ask the script to clone
    // the tree from itself the day this runs against a checkout that has none.
    const { POCKETJS_ROOT: _unused, ...env } = process.env;
    const p = Bun.spawn(["bun", "scripts/vendor.ts", "--no-wasm"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    expect(`${code}\n${out}${err}`).toStartWith("0");
    expect(out).toContain("seeded framework/src/styles.generated.ts");
    expect(existsSync(MIRROR)).toBe(true);
  }, 300_000);

  test("doctor refuses a tree that lost it, and names it", async () => {
    rmSync(MIRROR, { force: true });
    const absent = await checkVendor();
    expect(absent.ok).toBe(false);
    expect(absent.detail).toContain("styles.generated.ts");
    // And the sentence is the status module's, not doctor's own reading.
    expect(vendorProblems(await vendorStatus()).join("\n")).toContain("styles.generated.ts");

    seedMirror(VENDOR);
    const present = await checkVendor();
    expect(present.ok ? "ok" : present.detail).toBe("ok");
    expect(present.detail).toContain("styles.generated.ts present");
  });

  test("no build starts without it: the lock seeds before the work runs", async () => {
    rmSync(MIRROR, { force: true });
    // What a build would see at the moment it is spawned — read inside the
    // critical section rather than after it, because after it a build would
    // have written a real table and the question would answer itself.
    const seenByTheWork = await withBuildLock("a probe", async () => existsSync(MIRROR));
    expect(seenByTheWork).toBe(true);
  }, 30_000);

  test("a seed never overwrites a table a build wrote", () => {
    writeFileSync(MIRROR, "export const STYLE_IDS = { real: 1 };\n");
    expect(seedMirror(VENDOR)).toBe(false);
    expect(readFileSync(MIRROR, "utf8")).toContain("real");
  });
});

/**
 * Member names of an object type literal, given the text just past its `{`.
 *
 * Depth 0 is the members' own level; a `{` inside a member's TYPE (and the
 * `<>` of a generic, whose commas separate type arguments rather than
 * members) is skipped over. Stops at the closing brace.
 */
function topLevelMembers(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let atMemberStart = true;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === "{" || c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth--;
    else if (c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0) {
      if (c === ";" || c === ",") atMemberStart = true;
      else if (atMemberStart && /[A-Za-z_$]/.test(c)) {
        const name = /^[A-Za-z_$][\w$]*/.exec(body.slice(i))![0];
        names.push(name);
        i += name.length - 1;
        atMemberStart = false;
      }
    }
  }
  return names;
}

describe("the placeholder answers what the vendored tree asks of it", () => {
  /**
   * Every named binding imported from the mirror, read out of the tree rather
   * than remembered: the three framework entry points take `STYLE_IDS`, and
   * `src/text/measure.ts` reads `FONT_SLOTS` back out of it after its own
   * build. A `import { X } from "./styles.generated.ts"` upstream adds later
   * lands here without anyone editing this list.
   */
  function importedBindings(): Set<string> {
    const found = new Set<string>();
    const roots = [
      join(VENDOR, "framework", "src"),
      join(VENDOR, "framework", "compiler"),
      join(VENDOR, "tools"),
      join(ROOT, "src"),
      join(ROOT, "scripts"),
    ];
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    for (const r of roots) if (existsSync(r)) walk(r);
    for (const f of files) {
      if (f === MIRROR) continue;
      const src = readFileSync(f, "utf8");
      // Static: `import { A, B as C } from ".../styles.generated.ts"`.
      for (const m of src.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*["'][^"']*styles\.generated\.ts["']/g,
      )) {
        for (const part of m[1]!.split(",")) {
          const name = part.trim().split(/\s+as\s+/)[0]!.trim();
          if (name) found.add(name);
        }
      }
      // Dynamic, as `src/text/measure.ts` reads it: the `as { X: … }` cast
      // beside the import is what names the binding. The member types nest
      // braces (`Record<number, { px: number }>`), so this counts depth
      // rather than splitting on separators — splitting returned `{ px` and
      // `bold` from a type nobody imports.
      for (const m of src.matchAll(/import\(\s*`[^`]*styles\.generated\.ts[^`]*`\s*\)/g)) {
        const after = src.slice(m.index + m[0].length);
        const open = /^\s*\)?\s*as\s*\{/.exec(after);
        if (!open) continue;
        for (const name of topLevelMembers(after.slice(open[0].length))) found.add(name);
      }
    }
    return found;
  }

  test("the scan reaches the importers it is supposed to", () => {
    const names = [...importedBindings()].sort();
    // If this ever comes back empty the two tests below would pass over
    // nothing, which is the shape this whole file exists to catch one level up.
    expect(names).toContain("STYLE_IDS");
    expect(names).toContain("FONT_SLOTS");
  });

  test("the seed exports every binding something imports from it", async () => {
    const path = join("/tmp", `pocketjs-motion-mirror-seed-${Bun.nanoseconds()}.ts`);
    writeFileSync(path, MIRROR_SEED);
    try {
      const mod = (await import(path)) as Record<string, unknown>;
      const missing = [...importedBindings()].filter((n) => !(n in mod));
      expect(missing.join(", ") || "none").toBe("none");
    } finally {
      rmSync(path, { force: true });
    }
  });

  test("DEFAULT_FONT_SLOT is the vendored compiler's number, not a remembered one", async () => {
    const tailwind = (await import(
      join(VENDOR, "framework", "compiler", "tailwind.ts")
    )) as { DEFAULT_FONT_SLOT: number };
    const declared = /export const DEFAULT_FONT_SLOT = (\d+);/.exec(MIRROR_SEED);
    expect(declared?.[1]).toBe(String(tailwind.DEFAULT_FONT_SLOT));
  });
});
