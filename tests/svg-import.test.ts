/**
 * `<Svg src parts>` (patches/0053): an SVG file expanded by the build into
 * Views and `<Path>`s.
 *
 * Four layers, each held where it can be. The document half
 * (`framework/compiler/svg-tree.ts`): the equivalent path of every basic
 * shape, transforms and the viewport folded into the outline in SVG's order,
 * each part's box its own bounds, paint mapped to class tokens, and every
 * element that is not imported refused by name. The expansion in the
 * collector: outlines baked as literals, a `parts` entry joined to its part's
 * classes as one literal the provenance record holds, a key naming no id
 * refused where it is written, and a cached transform dropped when the file
 * it read changes. The lint, which refuses a missing or unimportable file
 * without building. And `layout`'s reading of one picture's parts.
 *
 * Each test names the edit that turns it red; the 0053 header records them.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runBuild } from "../src/cli/build.ts";
import { resolveComposition, unwrapResolve } from "../src/cli/resolve.ts";
import { findingsFor, type FindingNode } from "../src/render/findings.ts";
import { CODE_IMAGE_MISSING, lintImages } from "../src/lint/images.ts";
import { CODE_SVG_MISSING, CODE_SVG_UNSUPPORTED, lintSvgTrees } from "../src/lint/svg-trees.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");

interface SvgPart {
  kind: "group" | "path";
  id?: string;
  cls: string;
  d?: string;
  children: SvgPart[];
}
interface SvgTreeModule {
  importSvg(text: string, size?: { width?: number; height?: number }): {
    width: number;
    height: number;
    clip: boolean;
    parts: SvgPart[];
    ids: string[];
    skipped: Map<string, string>;
  };
}
interface JsxPluginModule {
  transformFile(
    path: string,
    src: string,
    framework: "solid",
  ): Promise<{ code: string; classAttrStrings: string[]; pathDecls: Array<{ d: string[] }> }>;
}
// Computed specifiers, as the catalogue gates do: `vendor/` does not typecheck
// under this repository's settings.
const svgTree = (await import(`${VENDOR}/framework/compiler/svg-tree.ts`)) as SvgTreeModule;
const jsxPlugin = (await import(`${VENDOR}/framework/compiler/jsx-plugin.ts`)) as JsxPluginModule;

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(dir);
  return dir;
}

const svg = (body: string, root = 'width="100" height="100"'): string => `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`;
const only = (text: string, size?: { width?: number; height?: number }): SvgPart => {
  const parts = svgTree.importSvg(text, size).parts;
  expect(parts).toHaveLength(1);
  return parts[0]!;
};
/** `absolute left-[Xpx] top-[Ypx] w-[Wpx] h-[Hpx] …` -> [x, y, w, h]. */
const box = (cls: string): number[] => {
  const m = /^absolute left-\[(-?\d+)px\] top-\[(-?\d+)px\] w-\[(\d+)px\] h-\[(\d+)px\]/.exec(cls);
  expect(m, cls).not.toBeNull();
  return m!.slice(1).map(Number);
};

describe("the document: shapes, transforms and the viewport fold into each part's outline", () => {
  // Red with the circle started at (cx - r, cy), or swept counter-clockwise:
  // a draw-on would start where a browser's does not.
  test("a circle starts at (cx + r, cy) and runs clockwise, as SVG 2 writes its path", () => {
    const p = only(svg('<circle cx="50" cy="50" r="20" fill="#fff"/>'));
    expect(box(p.cls)).toEqual([30, 30, 40, 40]);
    // Box-relative: the start is the right-most point, the first quarter ends at the bottom.
    // Box-relative: the start is the right-most point; a quarter is two cubics
    // of 45 degrees (0043's arc conversion), and the first quarter ends at the bottom.
    expect(p.d!.startsWith("M40 20C")).toBe(true);
    const ends = [...p.d!.matchAll(/C(?:\S+ ){4}(\S+) ([^C Z]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(ends[0]![1]).toBeGreaterThan(20);
    expect(ends[1]).toEqual([20, 40]);
  });

  // Red with the transform list composed leftmost-first (bake-svg's order
  // before 0040): the point lands at (220, 20).
  test("a transform list applies its rightmost function first", () => {
    const p = only(svg('<path d="M10 10 L11 10" transform="translate(100 0) scale(2)" stroke="#fff" stroke-width="0.5"/>', 'width="400" height="100"'));
    const [x, y] = box(p.cls);
    expect([x, y]).toEqual([119, 19]);
  });

  // Red with rotate() through Math.cos/Math.sin: cos(90deg) comes back
  // 6e-17 and the outline is off the integer grid.
  test("a quarter turn is exact, and the stroke widens the box by half its width", () => {
    const p = only(svg('<g transform="rotate(90 50 50)"><line x1="10" y1="10" x2="90" y2="10" stroke="#000" stroke-width="2"/></g>'));
    expect(box(p.cls)).toEqual([89, 9, 2, 82]);
    expect(p.d).toBe("M1 1L1 81");
  });

  // Red with the meet/slice choice or the alignment fractions swapped.
  test("viewBox and every preserveAspectRatio place the picture as a browser does", () => {
    const at = (par: string): number[] =>
      box(only(svg('<rect x="0" y="0" width="100" height="50" fill="#fff"/>', `width="200" height="200" viewBox="0 0 100 50" preserveAspectRatio="${par}"`)).cls);
    expect(at("xMidYMid meet")).toEqual([0, 50, 200, 100]);
    expect(at("xMinYMin meet")).toEqual([0, 0, 200, 100]);
    expect(at("xMaxYMax")).toEqual([0, 100, 200, 100]);
    expect(at("xMidYMid slice")).toEqual([-100, 0, 400, 200]);
    expect(at("xMinYMid slice")).toEqual([0, 0, 400, 200]);
    expect(at("none")).toEqual([0, 0, 200, 200]);
  });

  test("a stroke width is in the element's units, scaled with the viewBox", () => {
    const p = only(svg('<line x1="0" y1="5" x2="10" y2="5" stroke="#fff" stroke-width="1"/>', 'width="300" height="150" viewBox="0 0 20 10"'));
    expect(p.cls).toContain("stroke-[15px]");
  });

  // Red with the similarity test removed: the stroke would be drawn one width
  // where SVG draws it wider along one axis.
  test("a stroke under a non-uniform map is refused, naming the element", () => {
    expect(() => svgTree.importSvg(svg('<path id="p" d="M0 0 L10 10" stroke="#fff"/>', 'width="200" height="100" viewBox="0 0 10 10" preserveAspectRatio="none"'))).toThrow(
      /^<path id="p"> \(line 1\): it is stroked under a transform that is not a uniform scale and rotation/,
    );
    // The same map with no stroke is only geometry.
    expect(() => svgTree.importSvg(svg('<path d="M0 0 L10 10 L0 10 Z" fill="#fff"/>', 'width="200" height="100" viewBox="0 0 10 10" preserveAspectRatio="none"'))).not.toThrow();
  });

  test("paint: the cascade, style=\"\", named colours, currentColor and opacities", () => {
    const parts = svgTree.importSvg(
      svg(
        '<g fill="tomato" stroke="currentColor" color="#00ff00" stroke-width="2">' +
          '<rect id="a" x="10" y="10" width="20" height="20" fill-opacity="0.5" stroke="none"/>' +
          '<rect id="b" x="40" y="10" width="20" height="20" style="fill: rgb(0, 0, 255); stroke-linejoin: round" opacity="0.25"/>' +
          '<rect id="c" x="70" y="10" width="20" height="20" fill="inherit" fill-rule="evenodd" stroke-linecap="square"/>' +
          "</g>",
      ),
    ).parts;
    const [a, b, c] = parts.map((p) => p.cls.replace(/^absolute \S+ \S+ \S+ \S+ ?/, ""));
    expect(a).toBe("fill-[#ff634780]");
    expect(b).toBe("fill-[#0000ff] stroke-[#00ff00] stroke-[2px] stroke-join-round opacity-25");
    expect(c).toBe("fill-[#ff6347] fill-evenodd stroke-[#00ff00] stroke-[2px] stroke-cap-square");
  });

  test("an unnamed group is folded into its children; a named one is a View holding them in its own box", () => {
    const text = svg(
      '<g transform="translate(10 0)"><rect id="loose" x="0" y="0" width="10" height="10" fill="#fff"/></g>' +
        '<g id="pair"><rect id="l" x="20" y="20" width="10" height="10" fill="#fff"/><rect id="r" x="50" y="40" width="10" height="10" fill="#fff"/></g>',
    );
    const tree = svgTree.importSvg(text);
    expect(tree.parts.map((p) => p.id)).toEqual(["loose", "pair"]);
    expect(box(tree.parts[0]!.cls)).toEqual([10, 0, 10, 10]);
    const pair = tree.parts[1]!;
    expect(pair.kind).toBe("group");
    expect(box(pair.cls)).toEqual([20, 20, 40, 30]);
    expect(pair.children.map((c) => box(c.cls))).toEqual([[0, 0, 10, 10], [30, 20, 10, 10]]);
    expect(tree.ids).toEqual(["loose", "pair", "l", "r"]);
  });

  test("an editor's unit on the root's size is refused with what to give instead", () => {
    const text = svg('<rect id="a" width="10" height="10" fill="#fff"/>', 'width="210mm" height="297mm" viewBox="0 0 210 297"');
    expect(() => svgTree.importSvg(text)).toThrow('width="210mm" is not a number of user units (percentages and units other than px are not read) - give the <Svg> width and height in px');
    expect(svgTree.importSvg(text, { width: 420, height: 594 }).ids).toEqual(["a"]);
  });

  test("an id inside <defs> is known, as an element that is not drawn", () => {
    const tree = svgTree.importSvg(svg('<defs><path id="hidden" d="M0 0 L1 1"/></defs><rect id="a" width="10" height="10" fill="#fff"/>'));
    expect(tree.ids).toEqual(["a"]);
    expect(tree.skipped.get("hidden")).toBe("it is inside <defs>, which is not drawn");
  });

  // Red with any entry dropped from REFUSED_ELEMENTS: the element would fall
  // through to "is not an element this import reads", or inside <defs> be
  // skipped without a word.
  const REFUSED: Array<[string, RegExp]> = [
    ['<defs><linearGradient id="g"/></defs>', /^<linearGradient id="g"> \(line 1\): gradients are not imported/],
    ['<radialGradient id="g"/>', /^<radialGradient id="g"> \(line 1\): gradients are not imported/],
    ['<clipPath id="c"><rect width="1" height="1"/></clipPath>', /^<clipPath id="c"> \(line 1\): clip paths are not imported/],
    ['<use href="#a"/>', /^<use> \(line 1\): <use> is not imported/],
    ["<style>rect { fill: red }</style>", /^<style> \(line 1\): style sheets are not imported/],
    ["<text>hello</text>", /^<text> \(line 1\): text is not imported/],
    ['<filter id="f"/>', /^<filter id="f"> \(line 1\): filters are not imported/],
    ['<g><mask id="m"/></g>', /^<mask id="m"> \(line 1\): masks are not imported/],
    ['<path d="M0 0 L1 1" fill="url(#g)"/>', /^<path> \(line 1\): fill="url\(#g\)" paints with a paint server/],
    ['<path d="M0 0 L1 1" stroke-dasharray="2 2"/>', /^<path> \(line 1\): stroke-dasharray="2 2" is not carried by the import/],
    ['<rect id="x" width="1" height="1"/><rect id="x" width="1" height="1"/>', /^<rect id="x"> \(line 1\): id "x" is also on line 1/],
  ];
  for (const [body, want] of REFUSED) {
    test(`refused: ${body.slice(0, 40)}`, () => {
      expect(() => svgTree.importSvg(svg(body))).toThrow(want);
    });
  }
});

/** A module in a scratch directory beside `pic.svg`, transformed by the real collector. */
async function transform(source: string, picture: string): Promise<{ dir: string; result: Awaited<ReturnType<JsxPluginModule["transformFile"]>> }> {
  const dir = tempDir("motion-svg-");
  writeFileSync(join(dir, "pic.svg"), picture);
  const file = join(dir, "main.tsx");
  writeFileSync(file, source);
  return { dir, result: await jsxPlugin.transformFile(file, source, "solid") };
}

const PICTURE = svg('<g id="pair"><rect id="l" x="20" y="20" width="10" height="10" fill="#fff"/><circle id="dot" cx="70" cy="70" r="5" fill="#f00"/></g>');
const MODULE = (parts: string): string =>
  [
    'import { mount } from "@pocketjs/framework";',
    'import { Svg, View } from "@pocketjs/framework/components";',
    "mount(() => (",
    '  <View class="w-full h-full">',
    `    <Svg src="./pic.svg" debugName="pic" class="absolute left-[5px]" parts={${parts}} />`,
    "  </View>",
    "));",
    "",
  ].join("\n");

describe("the expansion: outlines as literals, a part's classes as one literal", () => {
  // Red with the expander left out of transformFile's plugins: no outline is
  // collected and the module calls the runtime stub.
  test("every shape is an outline the collector bakes; the parts entry is joined into a class= literal", async () => {
    const { result } = await transform(MODULE('{ l: "animate-draw", dot: "opacity-50" }'), PICTURE);
    expect(result.pathDecls).toHaveLength(2);
    // Placed in the group's box, which starts at the rectangle.
    expect(result.classAttrStrings).toContain("absolute left-[0px] top-[0px] w-[10px] h-[10px] fill-[#ffffff] animate-draw");
    expect(result.classAttrStrings).toContain("absolute left-[45px] top-[45px] w-[10px] h-[10px] fill-[#ff0000] opacity-50");
    // The author's own class and the canvas, as whole class= values too.
    expect(result.classAttrStrings).toContain("absolute left-[5px]");
    expect(result.classAttrStrings).toContain("w-[100px] h-[100px] overflow-hidden");
    expect(result.code).toContain('"svg:./pic.svg"');
    expect(result.code).not.toMatch(/\bSvg\b\(/);
  });

  // Red with the key check removed: the entry is dropped and the part never
  // animates.
  test("a parts key naming no id is refused at the key, listing the file's ids", async () => {
    await expect(transform(MODULE('{\n  missing: "animate-draw" }'), PICTURE)).rejects.toThrow(
      /main\.tsx:6:3: <Svg>: parts names "missing", which no element of \.\/pic\.svg carries as its id \(its ids: pair, l, dot\)$/,
    );
  });

  test("a parts value the build cannot join is refused at the value", async () => {
    await expect(transform(MODULE('{ l: ["animate", "draw"].join("-") }'), PICTURE)).rejects.toThrow(
      /main\.tsx:5:82: <Svg>: parts\["l"\] must be a class literal or a ternary of them/,
    );
  });

  test("a ternary in a parts value becomes a ternary of two whole literals", async () => {
    const { result } = await transform(MODULE('{ dot: Math.abs(-1) > 0 ? "opacity-50" : "opacity-25" }'), PICTURE);
    expect(result.classAttrStrings).toContain("absolute left-[45px] top-[45px] w-[10px] h-[10px] fill-[#ff0000] opacity-50");
    expect(result.classAttrStrings).toContain("absolute left-[45px] top-[45px] w-[10px] h-[10px] fill-[#ff0000] opacity-25");
  });

  // Red with the View and Path specifiers added per element rather than per
  // import: the second element's names are not yet scope bindings, so the
  // module imports SvgView twice and Babel refuses the duplicate.
  test("two <Svg> elements in one module share one pair of added imports", async () => {
    const source = MODULE('{ l: "opacity-50" }').replace(
      "  </View>",
      '    <Svg src="./pic.svg" debugName="again" parts={{ dot: "opacity-25" }} />\n  </View>',
    );
    const { result } = await transform(source, PICTURE);
    expect(result.pathDecls).toHaveLength(4);
    expect(result.code.match(/\bView as SvgView\b/g)).toHaveLength(1);
    expect(result.code.match(/\bPath as SvgPath\b/g)).toHaveLength(1);
  });

  // Red with `svgDepsHold` returning true: the second transform is a cache
  // hit on the module's unchanged text and bakes the old rectangle.
  test("a cached transform is dropped when the file it expanded changes", async () => {
    const { dir, result } = await transform(MODULE("{}"), PICTURE);
    expect(result.classAttrStrings).toContain("absolute left-[20px] top-[20px] w-[55px] h-[55px]");
    writeFileSync(join(dir, "pic.svg"), PICTURE.replace('x="20"', 'x="25"'));
    const file = join(dir, "main.tsx");
    const again = await jsxPlugin.transformFile(file, MODULE("{}"), "solid");
    expect(again.classAttrStrings).toContain("absolute left-[25px] top-[20px] w-[50px] h-[55px]");
  });
});

/** A one-module app built by the vendored build (as tests/vector-paths.test.ts builds one). */
function build(source: string, picture: string | null): { dir: string; exitCode: number; stderr: string } {
  const dir = tempDir("motion-svg-build-");
  if (picture !== null) writeFileSync(join(dir, "pic.svg"), picture);
  writeFileSync(join(dir, "main.tsx"), source);
  const run = Bun.spawnSync(
    ["bun", "tools/build.ts", join(dir, "main.tsx"), "--no-config", "--hz=60", `--project-root=${dir}`, `--outdir=${join(dir, "out")}`],
    { cwd: VENDOR, stdout: "pipe", stderr: "pipe" },
  );
  return { dir, exitCode: run.exitCode, stderr: run.stderr.toString() };
}

describe("the build refuses what it cannot expand, where the source wrote it", () => {
  // 0012/0041's rule reaching a parts value: the joined literal is the whole
  // value of a class= attribute. Red with the join building a `+` expression
  // instead of a literal: the token is a fragment and is never refused.
  test("a token in a parts value that does not parse is refused at the value", () => {
    const { exitCode, stderr } = build(MODULE('{\n  l: "left-[1e-14px]" }'), PICTURE);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('error: main.tsx:6:6: class "absolute left-[0px] top-[0px] w-[10px] h-[10px] fill-[#ffffff] left-[1e-14px]" does not compile');
  }, 120_000);

  test("a missing file is refused at the src", () => {
    const { exitCode, stderr } = build(MODULE("{}"), null);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/error: main\.tsx:5:14: <Svg>: src "\.\/pic\.svg" names no file/);
  }, 120_000);

  test("an element that is not imported is refused at the src, naming it", () => {
    const { exitCode, stderr } = build(MODULE("{}"), svg('<linearGradient id="sky"/>'));
    expect(exitCode).toBe(1);
    expect(stderr).toContain('error: main.tsx:5:14: <Svg>: ./pic.svg: <linearGradient id="sky"> (line 1): gradients are not imported');
  }, 120_000);
});

describe("lint refuses a missing or unimportable file without building", () => {
  function composition(picture: string | null): string {
    const dir = tempDir("motion-svg-lint-");
    mkdirSync(join(dir, "art"));
    if (picture !== null) writeFileSync(join(dir, "art", "pic.svg"), picture);
    writeFileSync(join(dir, "main.tsx"), MODULE("{}").replace("./pic.svg", "./art/pic.svg"));
    return dir;
  }

  // Red with the existence check removed from lintSvgTrees, and — for the
  // image half — with images.ts reading the src literal as a picture name:
  // the same absence reported twice, once as an image the build never bakes.
  test("a missing file is svg.missingFile at the src, and not an image", async () => {
    const dir = composition(null);
    const entryPath = join(dir, "main.tsx");
    const svgFindings = await lintSvgTrees({ entryPath });
    expect(svgFindings.map((f) => [f.code, f.line, f.column])).toEqual([[CODE_SVG_MISSING, 5, 14]]);
    const imageFindings = await lintImages({ entryPath, compositionDir: dir });
    expect(imageFindings.filter((f) => f.code === CODE_IMAGE_MISSING)).toEqual([]);
  });

  test("a file the import refuses is svg.unsupported, with the import's message", async () => {
    const dir = composition(svg("<text>hi</text>"));
    const findings = await lintSvgTrees({ entryPath: join(dir, "main.tsx") });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe(CODE_SVG_UNSUPPORTED);
    expect(findings[0]!.message).toContain("<text> (line 1): text is not imported");
  });

  test("the fixture lints clean", async () => {
    const findings = await lintSvgTrees({ entryPath: join(ROOT, "compositions/svg-import/main.tsx") });
    expect(findings).toEqual([]);
  });
});

describe("layout reads one picture's parts as one picture", () => {
  const node = (id: number, name: string, box: [number, number, number, number], container: FindingNode | null): FindingNode => ({
    id,
    name,
    box: { x: box[0], y: box[1], w: box[2], h: box[3] },
    inPicture: true,
    container,
  });

  // Red with the onePicture() carve-out removed: two parts of the lighthouse
  // that the file draws over each other are a finding at every frame.
  test("two parts in one svg: canvas are not a collision; a part, or the picture, and a node outside are", () => {
    const root = node(1, "stage", [0, 0, 1000, 1000], null);
    const canvas = node(2, "svg:./pic.svg", [100, 100, 400, 400], root);
    const tower = node(3, "tower", [200, 150, 100, 300], canvas);
    const rock = node(4, "rock", [150, 400, 200, 60], canvas);
    const caption = node(5, "caption", [250, 420, 300, 40], root);
    const codes = findingsFor({ nodes: [root, canvas, tower, rock, caption], viewport: { x: 0, y: 0, w: 1000, h: 1000 }, allow: [] })
      .filter((f) => f.code === "content_overlap")
      .map((f) => [f.name, f.with]);
    expect(codes).toEqual([
      ["svg:./pic.svg", 5],
      ["tower", 5],
      ["rock", 5],
      ["caption", 2],
      ["caption", 3],
      ["caption", 4],
    ]);
  });
});

describe("the fixture draws its parts one by one", () => {
  // The whole path end to end: the file expanded, its parts' classes joined,
  // the outlines baked, and `assert` reading the parts by their ids. Red with
  // the join dropping the parts entry (`combine` returning the part's own
  // literal): every part is drawn at frame 0 and every `before` fails.
  test("compositions/svg-import builds and its sidecar's assertions hold", async () => {
    const fixture = unwrapResolve(
      await resolveComposition({ dir: join(ROOT, "compositions/svg-import"), flags: { json: false }, requireBundle: false }),
    );
    await runBuild(fixture);
    const run = Bun.spawnSync(["bun", "src/cli/main.ts", "assert", "compositions/svg-import", "--json"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const report = JSON.parse(run.stdout.toString()) as { ok: boolean; assertions: Array<{ node: string; predicate: string; ok: boolean }> };
    expect(report.assertions.filter((r) => !r.ok)).toEqual([]);
    expect(report.assertions).toHaveLength(15);
    expect(report.ok).toBe(true);
  }, 300_000);
});
