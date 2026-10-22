/**
 * A build's style table is its own: written beside its bundle, served to pass 2
 * from memory, and never read off a file another build can write.
 *
 * Upstream pocket-nexus/pocketjs#591 (586428b2) — backported onto the old
 * pin, and on the pin itself since 66caf4e5, with
 * `patches/0023-style-table-file-namespace.patch` carrying the backport's two
 * departures from upstream's form. Before it, pass 1 wrote
 * `vendor/pocketjs/framework/src/styles.generated.ts` — one file shared by
 * every build on the machine — and pass 2 resolved that path off disk. That
 * one file was the reason for a cross-process build lock, a seeded placeholder,
 * a `doctor` check and an intermittent `Could not resolve` on fresh Linux
 * checkouts. Now pass 1 writes `<outdir>/<output>.styles.ts`, `jsxPlugin`
 * resolves the framework's import itself and serves this build's table from
 * memory, and the framework's file is a committed empty table no build writes.
 *
 * WHAT EACH TEST WOULD CATCH, each watched red on 2026-10-22:
 *
 *  - "nothing in the vendored tree but the transform cache": the property
 *    that made the build lock removable. Red with 0023 moved out of
 *    `patches/`, where the build rewrites `framework/src/styles.generated.ts`.
 *    The day a pin or a patch adds another shared write, this is what says
 *    the lock question is open again.
 *  - "a bundle names no absolute path": red with upstream's own form of the
 *    interception (re-measured on 66caf4e5 with 0023 removed), which resolves into a `pocketjs-generated-styles`
 *    namespace and so prints `// pocketjs-generated-styles:/Users/...` — the
 *    checkout's location — above the table in every bundle. Before 0023 no
 *    bundle here carried one, and with this form `smoke`'s bundle is byte for
 *    byte the one built before it.
 *  - "a tree with no style module on disk": red with the `onResolve` removed
 *    from the patch — pass 2 then resolves the import off disk, and on a tree
 *    that has lost the file it fails `Could not resolve`, which is the CI
 *    failure's message, now deterministic instead of 6 in 20.
 *  - "a second copy is refused": red with the refusal removed from the patch
 *    (re-measured on 66caf4e5 with 0023 removed: rgba(0,0,255,255) for red).
 *    The build then exits 0, the app's `mount` registers the copy's empty
 *    table, and the frame below comes back the clear colour instead of red —
 *    a picture with every class literal unstyled, a clean realm and a stable
 *    digest.
 *  - "the measurer and a composition build overlap": the timing sweep that
 *    used to guard the build lock, run with no lock at all. On the pre-0023
 *    design with the lock bypassed it was red at 3 of 10 offsets
 *    (`openMeasurer: the slot table has no entry for 37px regular ... —
 *    styles.generated.ts is not this build's`); on 0023 it was 0 of 34 over
 *    offsets where the two builds' spans overlapped by up to 670 ms.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { runBuild } from "../src/cli/build.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { hardenedBootWorld } from "../src/runtime/boot.ts";
import { openMeasurer } from "../src/text/measure.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const FRAMEWORK_TABLE = join(VENDOR, "framework", "src", "styles.generated.ts");

process.env.POCKETJS_ROOT = VENDOR;

const FACE = {
  regular: join(ROOT, "assets/fonts/HarmonyOS_Sans_Regular.ttf"),
  bold: join(ROOT, "assets/fonts/HarmonyOS_Sans_Bold.ttf"),
};

const scratch: string[] = [];
function tmp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pocketjs-motion-style-table-")));
  scratch.push(dir);
  return dir;
}

/** Upstream's builder, spawned the way `src/text/measure.ts` spawns it. */
async function build(entry: string, outdir: string): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(
    ["bun", join(VENDOR, "tools/build.ts"), entry, `--outdir=${outdir}`, "--framework=solid", "--hz=60"],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, out, err };
}

/**
 * Every file in the vendored tree a build could write, by mtime and size.
 *
 * `node_modules` and the cargo targets are left out: nothing a build runs
 * writes there, and together they are most of the tree's files.
 */
function snapshot(): Map<string, string> {
  const seen = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "target" || e.name === ".git") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const s = statSync(p);
        seen.set(relative(VENDOR, p), `${s.mtimeMs}:${s.size}`);
      }
    }
  };
  walk(VENDOR);
  return seen;
}

/** How many entries the bundle's `STYLE_IDS` literal has. */
function bundledStyleIds(bundlePath: string): number {
  const bundle = readFileSync(bundlePath, "utf8");
  const body = /var STYLE_IDS = \{\n([\s\S]*?)\n\s*\};/.exec(bundle)?.[1] ?? "";
  return body.split("\n").filter((l) => /: \d+,?$/.test(l)).length;
}

/** The centre pixel of frame 0 of a build, as `r,g,b,a`. */
async function centrePixel(outdir: string): Promise<string> {
  const world = await hardenedBootWorld({
    bundlePath: join(outdir, "main.js"),
    pakPath: join(outdir, "main.pak"),
    width: 64,
    height: 64,
    hz: 30,
    shutter: null,
  });
  world.frame(0);
  for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
  const rgba = world.render();
  const mid = ((world.physicalHeight >> 1) * world.physicalWidth + (world.physicalWidth >> 1)) * 4;
  return Array.from(rgba.subarray(mid, mid + 4)).join(",");
}

let committed = "";

beforeAll(() => {
  if (!existsSync(join(VENDOR, "tools", "build.ts"))) {
    throw new Error(`vendor pocketjs missing at ${VENDOR} — run bun run vendor`);
  }
  committed = readFileSync(FRAMEWORK_TABLE, "utf8");
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  // One test removes the framework's file on purpose; a failure there must
  // not leave the tree without it.
  writeFileSync(FRAMEWORK_TABLE, committed);
});

describe("a build's style table is its own", () => {
  test("it lands beside the bundle, and nothing in the vendored tree but the transform cache moves", async () => {
    const outdir = tmp();
    const before = snapshot();
    const r = await build(join(ROOT, "compositions/smoke/main.tsx"), outdir);
    expect(`${r.code}\n${r.err}`).toStartWith("0");
    const after = snapshot();

    const moved = [...after]
      .filter(([path, sig]) => before.get(path) !== sig)
      .map(([path]) => path)
      .concat([...before.keys()].filter((path) => !after.has(path)));
    const outsideCache = moved.filter((path) => !path.startsWith(".cache/transforms/"));
    expect(outsideCache.join("\n") || "none").toBe("none");

    const copy = join(outdir, "main.styles.ts");
    expect(r.out).toContain(`-> ${copy}`);
    const table = (await import(copy)) as { STYLE_IDS: Record<string, number>; STYLE_COUNT: number };
    expect(table.STYLE_COUNT).toBeGreaterThan(0);
    expect(Object.keys(table.STYLE_IDS).length).toBeGreaterThan(0);

    // And pass 2 bundled that table: the bundled `STYLE_IDS` has this
    // build's entries, where the file on disk has none. (`STYLE_COUNT` is
    // tree-shaken; nothing in the bundle reads it.)
    expect(bundledStyleIds(join(outdir, "main.js"))).toBe(Object.keys(table.STYLE_IDS).length);
    expect(readFileSync(FRAMEWORK_TABLE, "utf8")).toBe(committed);
  }, 120_000);

  test("a bundle names no absolute path, so the checkout's location is not in it", async () => {
    const outdir = tmp();
    const r = await build(join(ROOT, "compositions/smoke/main.tsx"), outdir);
    expect(`${r.code}\n${r.err}`).toStartWith("0");
    const bundle = readFileSync(join(outdir, "main.js"), "utf8");
    // Bun names each module above its code by its path relative to the
    // build's cwd; the served table is one of them.
    expect(bundle).toContain("\n  // vendor/pocketjs/framework/src/styles.generated.ts\n");
    const absolute = bundle.split("\n").filter((l) => l.includes(ROOT) || l.includes(outdir));
    expect(absolute.join("\n") || "none").toBe("none");
  }, 120_000);

  test("the framework's own module is the committed empty table", async () => {
    const mod = (await import(FRAMEWORK_TABLE)) as Record<string, unknown>;
    expect(mod.STYLE_IDS).toEqual({});
    expect(mod.STYLE_COUNT).toBe(0);
    expect(mod.FONT_SLOTS).toEqual({});
    // The slot a module imported without a build falls back to, read from the
    // vendored compiler rather than remembered: 0001 reassigns slots.
    const tailwind = (await import(join(VENDOR, "framework/compiler/tailwind.ts"))) as {
      DEFAULT_FONT_SLOT: number;
    };
    expect(mod.DEFAULT_FONT_SLOT).toBe(tailwind.DEFAULT_FONT_SLOT);
  });

  test("a tree with no style module on disk still builds with its table", async () => {
    // The state a fresh checkout's FIRST build used to be in, made
    // unconditional: pass 2 never asks the disk for this path, so its absence
    // is not a state a build can see.
    rmSync(FRAMEWORK_TABLE, { force: true });
    try {
      const outdir = tmp();
      const r = await build(join(ROOT, "compositions/smoke/main.tsx"), outdir);
      expect(`${r.code}\n${r.err}`).toStartWith("0");
      expect(bundledStyleIds(join(outdir, "main.js"))).toBeGreaterThan(0);
      expect(existsSync(FRAMEWORK_TABLE)).toBe(false);
    } finally {
      writeFileSync(FRAMEWORK_TABLE, committed);
    }
  }, 120_000);
});

describe("a style table the plugin does not serve is refused", () => {
  /**
   * The interception compares the path an import names with the framework's
   * own. Bun hands the plugin realpaths, so a symlinked tree, a case-variant
   * spelling on a case-insensitive volume and `/tmp` against `/private/tmp`
   * all compare equal — each was built and checked. What does not compare
   * equal is a SECOND file: a copy of `framework/src` reached by a relative
   * import, or any other module named `styles.generated.ts`. Without the
   * refusal that copy is bundled from disk, and the committed copy is empty.
   */
  test("a second copy of the framework's table fails the build and names the file", async () => {
    const RED = "w-full h-full bg-[#ff0000]";
    // Never applied to a node. It is in the table because the compiler is
    // offered every string literal in a module as a class candidate.
    const BLUE = "w-full h-full bg-[#0000ff]";
    const app = (importCopy: boolean): string =>
      [
        "// @title second table",
        'import { mount } from "@pocketjs/framework";',
        'import { View } from "@pocketjs/framework/components";',
        ...(importCopy ? ['import { STYLE_IDS } from "../framework-copy/src/styles.generated.ts";'] : []),
        "",
        `export const SPARE = ${JSON.stringify(BLUE)};`,
        "",
        `mount(() => <View class=${JSON.stringify(RED)} />${importCopy ? ", { styles: STYLE_IDS }" : ""});`,
        "",
      ].join("\n");
    const root = tmp();

    // The control: the same scene through the table the build serves is red.
    mkdirSync(join(root, "control"));
    writeFileSync(join(root, "control", "main.tsx"), app(false));
    const control = await build(join(root, "control", "main.tsx"), join(root, "control-dist"));
    expect(`${control.code}\n${control.err}`).toStartWith("0");
    expect(await centrePixel(join(root, "control-dist"))).toBe("255,0,0,255");

    // A stale copy of a table: the same literals, ids from somewhere else —
    // what `framework/src/styles.generated.ts` held after any build before 0023.
    const ids = ((await import(join(root, "control-dist", "main.styles.ts"))) as {
      STYLE_IDS: Record<string, number>;
    }).STYLE_IDS;
    const copy = join(root, "framework-copy", "src", "styles.generated.ts");
    mkdirSync(join(root, "framework-copy", "src"), { recursive: true });
    writeFileSync(
      copy,
      committed.replace(
        "export const STYLE_IDS: Record<string, number> = {};",
        `export const STYLE_IDS: Record<string, number> = ${JSON.stringify({ ...ids, [RED]: ids[BLUE], [BLUE]: ids[RED] })};`,
      ),
    );
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app", "main.tsx"), app(true));
    const r = await build(join(root, "app", "main.tsx"), join(root, "dist"));
    if (r.code === 0) {
      // Say what shipped rather than only that the build passed.
      throw new Error(
        `the build exited 0 and its centre pixel is rgba(${await centrePixel(join(root, "dist"))}); ` +
          `its class declares rgba(255,0,0,255)`,
      );
    }
    expect(r.err).toContain(copy);
    expect(r.err).toContain("not this build's style table");
  }, 120_000);
});

describe("builds run side by side", () => {
  test("the measurer and a composition build overlap, with no lock between them", async () => {
    const r = await resolveComposition({
      dir: join(ROOT, "compositions/smoke"),
      flags: { json: false },
      requireBundle: false,
    });
    if (!r.ok) throw new Error(r.message);
    const smoke = r.value;
    const failures: string[] = [];
    // A measurement build and a composition build each take ~350-800 ms here;
    // these offsets start the second inside the first.
    for (const offsetMs of [0, 50, 100, 150, 200, 250, 300]) {
      const [measured, built] = await Promise.allSettled([
        (async () => {
          const m = await openMeasurer({
            face: FACE,
            sizes: [{ px: 37 }, { px: 59 }, { px: 83, bold: true }],
            texts: ["measure me"],
          });
          await m.close();
        })(),
        (async () => {
          await Bun.sleep(offsetMs);
          await runBuild(smoke);
        })(),
      ]);
      for (const [what, s] of [
        ["measurer", measured],
        ["composition build", built],
      ] as const) {
        if (s.status === "rejected") {
          failures.push(`+${offsetMs}ms ${what}: ${String((s.reason as Error).message).split("\n")[0]}`);
        }
      }
    }
    expect(failures.join("\n") || "clean").toBe("clean");
  }, 300_000);
});
