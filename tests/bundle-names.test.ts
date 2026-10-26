/**
 * `patches/0051-location-free-bundle-names.patch`: the names a bundle gives
 * its modules, and the two cases where the build refuses to rename one.
 *
 * `tests/build-location.test.ts` is the end-to-end half — one composition
 * built from three directories, three identical bundles. This is the rules,
 * each on paths constructed here, and the cases no composition in the tree
 * reaches. A module Bun prints in two runs — an entry that exports, whose
 * namespace object comes ahead of its imports under a second name line — has
 * both lines renamed; the first form of this module required exactly one and
 * refused that bundle, which `tests/style-table.test.ts`'s control app is.
 * A template literal that repeats a module's name line is refused: with the
 * transpiler comparison removed from `renameBundleModules` the string is
 * rewritten and the test goes red. And a module that put code in the bundle
 * with no name line at all is refused; with that check removed nothing is
 * renamed and the test goes red.
 */

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

const VENDOR = resolve(import.meta.dir, "..", "vendor", "pocketjs");
interface Anchors {
  readonly tree: string;
  readonly app: string;
  readonly outdir: string;
  readonly cwd: string;
}
interface Metafile {
  readonly inputs: Record<string, unknown>;
  readonly outputs: Record<string, { readonly inputs?: Record<string, { readonly bytesInOutput?: number }> }>;
}
const { bundleModuleName, renameBundleModules, BundleNameError } = (await import(
  join(VENDOR, "framework/compiler/bundle-names.ts")
)) as {
  bundleModuleName: (key: string, a: Anchors) => string;
  renameBundleModules: (code: string, m: Metafile, output: string, rename: (key: string) => string) => string;
  BundleNameError: new (message: string) => Error;
};

const anchors = {
  tree: "/srv/pkg/node_modules/pocket-motion/vendor/pocketjs",
  app: "/srv/project/compositions/card",
  outdir: "/srv/project/dist/compositions/card",
  cwd: "/srv/project",
};

describe("bundleModuleName", () => {
  const name = (abs: string) => bundleModuleName(abs, anchors);

  test("a module is named by the tree, the app, the outdir or its package — never the machine", () => {
    expect(name(`${anchors.tree}/framework/src/index.ts`)).toBe("framework/src/index.ts");
    expect(name(`${anchors.tree}/node_modules/solid-js/dist/solid.js`)).toBe("node_modules/solid-js/dist/solid.js");
    expect(name(`${anchors.app}/app.tsx`)).toBe("./app.tsx");
    expect(name(`${anchors.app}/parts/title.tsx`)).toBe("./parts/title.tsx");
    expect(name(`${anchors.outdir}/.entries/main.ts`)).toBe(".entries/main.ts");
    expect(name("/srv/project/node_modules/lodash-es/clamp.js")).toBe("node_modules/lodash-es/clamp.js");
    expect(name("/srv/project/compositions/shared/theme.ts")).toBe("../shared/theme.ts");
  });

  test("a key is read relative to the cwd Bun named it from", () => {
    // What Bun prints: the realpath relative to the build's cwd, through the
    // machine's own directories when the module is outside it.
    expect(name("compositions/card/main.tsx")).toBe("./main.tsx");
    expect(name("../pkg/node_modules/pocket-motion/vendor/pocketjs/framework/src/host.ts")).toBe(
      "framework/src/host.ts",
    );
    expect(bundleModuleName("../../framework/src/host.ts", { ...anchors, cwd: `${anchors.tree}/a/b` })).toBe(
      "framework/src/host.ts",
    );
  });

  test("the tree comes first, so an app inside it keeps the name a build from the tree's root gives it", () => {
    const inTree = { ...anchors, app: `${anchors.tree}/apps/hero`, cwd: anchors.tree };
    expect(bundleModuleName("apps/hero/app.tsx", inTree)).toBe("apps/hero/app.tsx");
    expect(bundleModuleName("framework/src/index.ts", inTree)).toBe("framework/src/index.ts");
  });

  test("a namespaced module keeps its namespace and loses the machine's path", () => {
    expect(
      bundleModuleName(`pocketjs-generated-styles:${anchors.tree}/framework/src/styles.generated.ts`, anchors),
    ).toBe("pocketjs-generated-styles:framework/src/styles.generated.ts");
    expect(bundleModuleName("virtual:theme", anchors)).toBe("virtual:theme");
  });
});

describe("renameBundleModules", () => {
  const metafile = (inputs: Record<string, number>) => ({
    inputs: Object.fromEntries(Object.keys(inputs).map((k) => [k, {}])),
    outputs: {
      "dist/main.js": {
        inputs: Object.fromEntries(Object.entries(inputs).map(([k, n]) => [k, { bytesInOutput: n }])),
      },
    },
  });
  const rename = (key: string) => (key.startsWith("compositions/card/") ? `./${key.slice(18)}` : key);

  test("each name line is rewritten and nothing else is", () => {
    const code = ["(() => {", "  // vendor/x.ts", "  var x = 1;", "", "  // compositions/card/app.tsx", "  log(x);", "})();", ""].join("\n");
    const out = renameBundleModules(
      code,
      metafile({ "vendor/x.ts": 13, "compositions/card/app.tsx": 9 }),
      "dist/main.js",
      rename,
    );
    expect(out).toBe(code.replace("// compositions/card/app.tsx", "// ./app.tsx"));
  });

  test("a module printed in two runs has both name lines renamed", () => {
    // What Bun writes for an entry that exports: its namespace object ahead
    // of the module it imports, then its body, each under its name.
    const code = [
      "(() => {",
      "  // compositions/card/main.tsx",
      "  var exports_main = {};",
      "",
      "  // vendor/x.ts",
      "  var x = 1;",
      "",
      "  // compositions/card/main.tsx",
      "  var SPARE = x;",
      "})();",
    ].join("\n");
    const out = renameBundleModules(
      code,
      metafile({ "vendor/x.ts": 13, "compositions/card/main.tsx": 40 }),
      "dist/main.js",
      rename,
    );
    expect(out).toBe(code.replaceAll("// compositions/card/main.tsx", "// ./main.tsx"));
  });

  test("a template literal repeating a renamed module's name line fails the build, naming the line", () => {
    const code = ["(() => {", "  // compositions/card/app.tsx", "  log(`", "  // compositions/card/app.tsx", "`);", "})();"].join("\n");
    expect(() =>
      renameBundleModules(code, metafile({ "compositions/card/app.tsx": 20 }), "dist/main.js", rename),
    ).toThrow(BundleNameError);
    expect(() =>
      renameBundleModules(code, metafile({ "compositions/card/app.tsx": 20 }), "dist/main.js", rename),
    ).toThrow("line 4, `// compositions/card/app.tsx` — inside a template literal");
  });

  test("a module that put code in the bundle with no name line fails the build", () => {
    expect(() =>
      renameBundleModules("(() => {\n  log(1);\n})();\n", metafile({ "compositions/card/app.tsx": 9 }), "dist/main.js", rename),
    ).toThrow("has no name line");
  });

  test("a module that put no code in the bundle is not looked for, and a string equal to its name stays", () => {
    const code = "(() => {\n  log(`\n  // compositions/card/types.ts\n`);\n})();\n";
    expect(
      renameBundleModules(code, metafile({ "compositions/card/types.ts": 0 }), "dist/main.js", rename),
    ).toBe(code);
  });
});
