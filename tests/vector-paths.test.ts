/**
 * Vector paths (patches/0042, 0043) where the core's own tests cannot reach.
 *
 * Coverage, stroke outlining, trim and morph are held in the core
 * (`engine/core/src/path_tests.rs`, each test red under an edit the 0042
 * header lists), and the collector and the tokens in the catalogue (G6, G9).
 * What is left is the host side of the declaration: that the build names an
 * outline it refuses at the line that wrote it, that mount refuses one the
 * build did not bake rather than drawing nothing, and that the arc
 * conversion — the one place the build does trigonometry — is the same bits
 * on every host. This suite runs on Linux/x86-64 in the determinism workflow,
 * which is what makes the last a cross-host check rather than a recording.
 *
 * Each test names the edit that turns it red; the 0043 header records them.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { hardenedBootWorld } from "../src/runtime/boot.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");

interface PathDataModule {
  compilePathEntry(keys: readonly string[], viewBox?: string): { verbs: number[]; shapes: number[][] };
  cosSinDeg(deg: number): [number, number];
}
// Computed specifier, as the catalogue gates do: `vendor/` does not typecheck
// under this repository's settings.
const pathData = (await import(`${VENDOR}/framework/compiler/path-data.ts`)) as PathDataModule;

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A one-module app built by the vendored build, the way G6b builds one. */
function build(lines: readonly string[]): { dir: string; exitCode: number; stderr: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-paths-")));
  scratch.push(dir);
  writeFileSync(
    join(dir, "main.tsx"),
    ['import { mount } from "@pocketjs/framework";', 'import { Path, View } from "@pocketjs/framework/components";', ...lines, ""].join("\n"),
  );
  const run = Bun.spawnSync(
    ["bun", "tools/build.ts", join(dir, "main.tsx"), "--no-config", "--hz=60", `--project-root=${dir}`, `--outdir=${join(dir, "out")}`],
    { cwd: VENDOR, stdout: "pipe", stderr: "pipe" },
  );
  return { dir, exitCode: run.exitCode, stderr: run.stderr.toString() };
}

function boot(dir: string) {
  return hardenedBootWorld({
    bundlePath: join(dir, "out", "main.js"),
    pakPath: join(dir, "out", "main.pak"),
    width: 320,
    height: 180,
    hz: 30,
    renderScale: 1,
    shutter: null,
    buildCommand: "bun tools/build.ts main.tsx --hz=60",
  });
}

const bits = (v: number): string => {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, v, true);
  return b.getUint32(0, true).toString(16).padStart(8, "0");
};

describe("the build bakes what it can read and names what it refuses", () => {
  // Red with tools/build.ts's PathDataError catch removed: the build still
  // exits 1, on an uncaught throw whose stack names path-data.ts and no line
  // of main.tsx.
  test("morph keys that part are refused at the <Path> that wrote them", () => {
    const { exitCode, stderr } = build([
      "mount(() => (",
      '  <View class="w-full h-full">',
      '    <Path d={["M0 0 L10 0 Z", "M0 0 L10 0 L5 5 Z"]} class="fill-white" />',
      "  </View>",
      "));",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "error: main.tsx:5:11: <Path> d does not bake: morph keys 0 and 1 differ at normalised command 2: key 0 has a close (source command 2), key 1 has a line (source command 2)",
    );
  }, 120_000);

  test("a d that does not parse is refused the same way", () => {
    const { exitCode, stderr } = build([
      "mount(() => (",
      '  <View class="w-full h-full">',
      '    <Path d="M0 0 L10 0 Z 5 5" class="fill-white" />',
      "  </View>",
      "));",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('error: main.tsx:5:11: <Path> d does not bake: unknown command "5" at character 13');
  }, 120_000);
});

describe("mount refuses an outline the build did not bake", () => {
  // Red with native-tree.ts's setPath reduced to its miss counter: the
  // world boots, and the node draws nothing with every gate green.
  test("a d computed at run time is not in the table, and boot says so", async () => {
    const { dir, exitCode, stderr } = build([
      'const PARTS = ["M0 0 L100 0", "L100 100 Z"];',
      "mount(() => (",
      '  <View class="w-full h-full">',
      '    <Path d={PARTS.join(" ")} class="w-[100px] h-[100px] fill-white" />',
      "  </View>",
      "));",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    await expect(boot(dir)).rejects.toThrow(/<Path> outline \[\["M0 0 L100 0 L100 100 Z"\],null\] was not baked/);
  }, 120_000);

  // The control: the same outline written as a literal at the call site of
  // a component that forwards it. Red with the collector reading `d` only on
  // an element named Path.
  test("the same d written as a literal where a component receives it boots and draws", async () => {
    const { dir, exitCode } = build([
      "function Square(props: { d: string }) {",
      '  return <Path d={props.d} class="w-[100px] h-[100px] fill-white" />;',
      "}",
      "mount(() => (",
      '  <View class="w-full h-full bg-black">',
      '    <Square d="M0 0 L100 0 L100 100 Z" />',
      "  </View>",
      "));",
    ]);
    expect(exitCode).toBe(0);
    const world = await boot(dir);
    world.frame(0);
    const px = world.render();
    // Inside the triangle (x > y) is white; across the diagonal is the ground.
    const at = (x: number, y: number) => px[(y * 320 + x) * 4]!;
    expect(at(80, 20)).toBe(255);
    expect(at(20, 80)).toBe(0);
  }, 120_000);
});

describe("the arc conversion is the same bits on every host", () => {
  // Recorded once on darwin/arm64 (Bun 1.3.11) and re-run by the
  // determinism workflow on Linux/x86-64: what it guards is the same bits on
  // another host. On one host it is red with pieces of a quarter turn
  // instead of an eighth (fewer verbs). It is NOT red here with tan(alpha/4)
  // through Math.tan — this host's Math.tan gives the same bits — which is
  // the point: a libm call differs, if it does, on some other machine.
  const CASES: Array<[string, number[], string]> = [
    [
      "M10 50 A40 25 30 1 0 90 50",
      [0, 2, 2, 2, 2],
      "41200000 42480000 4167a956 426cdd77 41b7e87b 42881c32 4206a0c2 429524d8 42314d47 42a22d7e 42611d87 42a98000 4285c666 42a98000 429afe08 42a98000 42abc83e 42a22d7e 42b47379 429524d8 42bd1eb4 42881c32 42bcf52b 426cdd77 42b40000 42480000",
    ],
    [
      "M0 0 a50 50 90 0 1 50 50 q25 -40 50 0 t50 0",
      [0, 2, 2, 2, 2],
      "00000000 00000000 41542c56 00000000 41cfd402 40a89229 420d6bde 416a5088 4232edbb 41c02bfe 42480000 4212f4ea 42480000 42480000 42855555 41baaaab 42a6aaab 41baaaab 42c80000 42480000 42e95555 42995555 43055555 42995555 43160000 42480000",
    ],
  ];
  for (const [d, verbs, want] of CASES) {
    test(d, () => {
      const e = pathData.compilePathEntry([d]);
      expect(e.verbs).toEqual(verbs);
      expect(e.shapes[0]!.map(bits).join(" ")).toBe(want);
    });
  }

  // Red with the `+ 0` dropped (a -0 at 90 and 270 degrees) or with the
  // quarter-turn rotation applied the wrong way round.
  test("degrees are exact at quarter turns and match the reference elsewhere", () => {
    const exact: Array<[number, [number, number]]> = [
      [0, [1, 0]], [90, [0, 1]], [180, [-1, 0]], [270, [0, -1]], [-90, [0, -1]], [450, [0, 1]], [720, [1, 0]],
    ];
    for (const [deg, cs] of exact) {
      const got = pathData.cosSinDeg(deg);
      expect(got).toEqual(cs);
      expect(Object.is(got[0], -0) || Object.is(got[1], -0)).toBe(false);
    }
    for (let deg = -720; deg <= 720; deg += 7.25) {
      const [c, s] = pathData.cosSinDeg(deg);
      const r = (deg * Math.PI) / 180;
      expect(Math.abs(c - Math.cos(r))).toBeLessThan(1e-13);
      expect(Math.abs(s - Math.sin(r))).toBeLessThan(1e-13);
    }
  });
});
