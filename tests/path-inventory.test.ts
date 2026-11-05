/**
 * `<Path>` outlines a mount computes (patches/0054, src/render/path-inventory.ts).
 *
 * The collector reports every `d` it cannot read; the build prints them on
 * one line; `runBuild` mounts the bundle only then, bakes the keys the tree
 * asked for through `--path-inventory=`, and mounts the result again, which
 * must ask for nothing more. Held here: each step, that a composition whose
 * every `d` is a literal never takes the path, and the refusal when the two
 * mounts disagree.
 *
 * Each test names the edit that turns it red; the 0054 header records them.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runBuild } from "../src/cli/build.ts";
import { resolveComposition, unwrapResolve } from "../src/cli/resolve.ts";
import { parsePathKey, unbakedOutlines } from "../src/render/path-inventory.ts";
import { hardenedBootWorld } from "../src/runtime/boot.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");

interface JsxPluginModule {
  transformFile(path: string, src: string, framework: "solid"): Promise<{ unreadPaths: Array<{ line: number; column: number }>; pathDecls: unknown[] }>;
}
const jsxPlugin = (await import(`${VENDOR}/framework/compiler/jsx-plugin.ts`)) as JsxPluginModule;

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const HEAD = ['import { mount } from "@pocketjs/framework";', 'import { Path, View } from "@pocketjs/framework/components";'];

/**
 * A scratch composition laid out as one in this repository is —
 * `<root>/compositions/<name>/main.tsx` — so `repoRootOf` gives `<root>`,
 * and the object `runBuild` takes, by hand.
 */
function composition(lines: readonly string[]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "motion-mount-paths-")));
  scratch.push(root);
  const dir = join(root, "compositions", "c");
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, "main.tsx");
  writeFileSync(entry, [...HEAD, ...lines, ""].join("\n"));
  const outDir = join(root, "dist", "c");
  return {
    dir,
    outDir,
    c: {
      dir,
      buildArgs: ["bun", join(VENDOR, "tools/build.ts"), entry, `--outdir=${outDir}`, "--framework=solid", "--hz=60", "--no-config"],
      bundlePath: join(outDir, "main.js"),
      pakPath: join(outDir, "main.pak"),
      width: 320,
      height: 180,
      fps: 30,
    },
  };
}

const SQUARE = 'class="w-[100px] h-[100px] fill-white"';

describe("the collector reports the d it cannot read", () => {
  // Red with the collector's unread push removed: nothing reports the site,
  // the build prints no line, and runBuild never mounts.
  test("a computed d and a forwarded prop are unread; a literal is not", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-unread-")));
    scratch.push(dir);
    const file = join(dir, "main.tsx");
    const src = [
      ...HEAD,
      'const PARTS = ["M0 0 L100 0", "L100 100 Z"];',
      "function Fwd(props: { d: string }) {",
      `  return <Path d={props.d} ${SQUARE} />;`,
      "}",
      "mount(() => (",
      '  <View class="w-full h-full">',
      `    <Path d={PARTS.join(" ")} ${SQUARE} />`,
      `    <Path d="M0 0 L10 0 L10 10 Z" ${SQUARE} />`,
      '    <Fwd d="M0 0 L20 0 L20 20 Z" />',
      "  </View>",
      "));",
      "",
    ].join("\n");
    const res = await jsxPlugin.transformFile(file, src, "solid");
    expect(res.unreadPaths).toEqual([
      { line: 5, column: 16 },
      { line: 9, column: 11 },
    ]);
    expect(res.pathDecls).toHaveLength(2);
  });
});

describe("runBuild bakes what the mount computes", () => {
  // Red with runBuild ignoring the line (no inventory, no second build): the
  // bundle builds and the render's strict mount refuses the outline.
  test("a d computed at mount is baked from an inventory and draws", async () => {
    const { c, outDir } = composition([
      'const PARTS = ["M0 0 L100 0", "L100 100 Z"];',
      "mount(() => (",
      '  <View class="w-full h-full bg-black">',
      `    <Path d={PARTS.join(" ")} ${SQUARE} />`,
      "  </View>",
      "));",
    ]);
    const record = await runBuild(c);
    const inventoryPath = join(outDir, "main.paths.json");
    expect(JSON.parse(readFileSync(inventoryPath, "utf8"))).toEqual({ outlines: [{ d: ["M0 0 L100 0 L100 100 Z"] }] });
    // Relative to the record's own directory, as `--outdir=.` is (build-record.ts).
    expect(record.argv.at(-1)).toBe("--path-inventory=main.paths.json");
    const world = await hardenedBootWorld({ bundlePath: c.bundlePath, pakPath: c.pakPath, width: 320, height: 180, hz: 30, shutter: null });
    world.frame(0);
    world.tick();
    world.tick();
    const px = world.render();
    const at = (x: number, y: number) => px[(y * 320 + x) * 4]!;
    expect(at(80, 20)).toBe(255);
    expect(at(20, 80)).toBe(0);
  }, 120_000);

  // Red with the paths-at-mount line printed for every build: the literal-only
  // composition is mounted (harmless) — and with runBuild writing the
  // inventory unconditionally, its argv gains the flag.
  test("a composition whose every d is a literal is built once, as before", async () => {
    const { c, outDir } = composition([
      "mount(() => (",
      '  <View class="w-full h-full">',
      `    <Path d="M0 0 L100 0 L100 100 Z" ${SQUARE} />`,
      "  </View>",
      "));",
    ]);
    const record = await runBuild(c);
    expect(existsSync(join(outDir, "main.paths.json"))).toBe(false);
    expect(record.argv.some((a) => a.startsWith("--path-inventory="))).toBe(false);
  }, 120_000);

  // Red with the second mount removed from runBuild: the build succeeds and
  // the render refuses the outline the inventory did not hold.
  test("a mount that computes different outlines once its own are baked is refused", async () => {
    // The composition reads its own bundle's PATH_IDS, so baking what it
    // computed changes what it computes: the defect the second mount exists
    // to catch, constructed on purpose.
    const { c } = composition([
      'import { PATH_IDS } from "../../vendor/pocketjs/framework/src/styles.generated.ts";',
      "mount(() => (",
      '  <View class="w-full h-full">',
      `    <Path d={"M0 0 L" + (10 + Object.keys(PATH_IDS).length) + " 0 L10 10 Z"} ${SQUARE} />`,
      "  </View>",
      "));",
    ]);
    // The import above is relative to a repository root that holds vendor/:
    // link this checkout's vendor into the scratch root.
    const root = resolve(c.dir, "../..");
    Bun.spawnSync(["ln", "-s", join(ROOT, "vendor"), join(root, "vendor")]);
    await expect(runBuild(c)).rejects.toThrow(/mounts 1 more: what the composition draws depends on something that changed between the two builds/);
  }, 120_000);

  // Red with the build's inventory loop skipping the compile (a d that does
  // not parse reaches the pak's encoder, which throws unlocated).
  test("an outline computed at mount that does not parse is refused naming the inventory", async () => {
    const { c } = composition([
      'const BAD = ["M0 0 L10", "0 Z 5"];',
      "mount(() => (",
      '  <View class="w-full h-full">',
      `    <Path d={BAD.join(" ")} ${SQUARE} />`,
      "  </View>",
      "));",
    ]);
    await expect(runBuild(c)).rejects.toThrow(/main\.paths\.json: outline 0, computed at mount: <Path> d does not bake: unknown command "5"/);
  }, 120_000);

  test("a mount that throws is reported as the reason the outlines could not be read", async () => {
    const { c } = composition([
      "mount(() => {",
      '  if (typeof globalThis.ui === "object") throw new Error("boom at mount");',
      `  return <Path d={["M0 0", "L1 1"].join(" ")} ${SQUARE} />;`,
      "});",
    ]);
    await expect(runBuild(c)).rejects.toThrow(/1 <Path> d attribute\(s\) are not literals, so the build mounts the bundle to read their outlines, and the mount failed: .*boom at mount/);
  }, 120_000);
});

describe("the inventory itself", () => {
  test("a key is read back as the d and viewBox path-key.ts wrote", () => {
    expect(parsePathKey('[["M0 0 L1 1"],null]')).toEqual({ d: ["M0 0 L1 1"] });
    expect(parsePathKey('[["M0 0","M1 1"],"0 0 10 10"]')).toEqual({ d: ["M0 0", "M1 1"], viewBox: "0 0 10 10" });
    expect(() => parsePathKey('{"d":1}')).toThrow(/is not \[d\[\], viewBox \| null\]/);
  });

  // The fixture: four outlines computed from rows in another module, every
  // one baked, and its rebuilt bundle's mount asking for none.
  test("compositions/data-chart bakes its four computed outlines and mounts clean", async () => {
    const chart = unwrapResolve(await resolveComposition({ dir: join(ROOT, "compositions/data-chart"), flags: { json: false }, requireBundle: false }));
    const record = await runBuild(chart);
    expect(record.argv.at(-1)).toBe("--path-inventory=main.paths.json");
    const inventory = JSON.parse(readFileSync(join(ROOT, "dist/compositions/data-chart/main.paths.json"), "utf8")) as { outlines: unknown[] };
    expect(inventory.outlines).toHaveLength(4);
    expect(await unbakedOutlines(chart)).toEqual([]);
  }, 180_000);
});
