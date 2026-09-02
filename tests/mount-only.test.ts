/**
 * Acceptance tests for mount-only static lint + runtime oracle.
 */

import { describe, expect, test } from "bun:test";
import {
  lintSource,
  type LintFinding,
} from "../src/lint/mount-only.ts";
import { countingOps, type OracleReport } from "../src/lint/oracle.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function codes(findings: readonly LintFinding[]): string[] {
  return findings.map((f) => f.code);
}

function findCode(
  findings: readonly LintFinding[],
  code: string,
): LintFinding | undefined {
  return findings.find((f) => f.code === code);
}

// ===========================================================================
// Static lint
// ===========================================================================

describe("lintSource — forbidden imports", () => {
  test("onFrame from @pocketjs/framework/*", () => {
    const src = `import { onFrame } from "@pocketjs/framework/frame";\n`;
    const findings = lintSource(src, "app.ts");
    expect(findings.length).toBe(1);
    const f = findings[0]!;
    expect(f.code).toBe("mountOnly.forbiddenImport");
    expect(f.file).toBe("app.ts");
    expect(f.line).toBe(1);
    expect(f.column).toBe(10); // 'onFrame' starts after "import { "
    expect(f.message).toContain("onFrame");
  });

  test("onButtonPress from framework package", () => {
    const src = `import { onButtonPress } from "@pocketjs/framework/input";\n`;
    const findings = lintSource(src, "a.ts");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("mountOnly.forbiddenImport");
    expect(findings[0]!.message).toContain("onButtonPress");
    expect(findings[0]!.column).toBe(10);
  });

  test("createSpriteAnimation from framework package", () => {
    const src = `import { createSpriteAnimation } from "@pocketjs/framework/sprite";\n`;
    const findings = lintSource(src, "a.ts");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("mountOnly.forbiddenImport");
    expect(findings[0]!.message).toContain("createSpriteAnimation");
  });

  test("after / virtualNow / simulationHz from .../clock", () => {
    const src = [
      `import { after } from "@pocketjs/framework/clock";`,
      `import { virtualNow, simulationHz } from "../clock";`,
      ``,
    ].join("\n");
    const findings = lintSource(src, "a.ts");
    expect(findings.length).toBe(3);
    expect(codes(findings).every((c) => c === "mountOnly.forbiddenImport")).toBe(
      true,
    );
    const names = findings.map((f) => f.message);
    expect(names.some((m) => m.includes("'after'"))).toBe(true);
    expect(names.some((m) => m.includes("'virtualNow'"))).toBe(true);
    expect(names.some((m) => m.includes("'simulationHz'"))).toBe(true);
    // line/column of first import
    expect(findings[0]!.line).toBe(1);
    expect(findings[0]!.column).toBe(10);
    // second line has two names
    const line2 = findings.filter((f) => f.line === 2);
    expect(line2).toHaveLength(2);
    expect(line2[0]!.column).toBe(10); // virtualNow
    expect(line2[1]!.column).toBe(22); // simulationHz — after "virtualNow, "
  });

  test("runEffect / installEffectDriver from .../effects", () => {
    const src = `import { runEffect, installEffectDriver } from "@pocketjs/framework/effects";\n`;
    const findings = lintSource(src, "a.ts");
    expect(findings).toHaveLength(2);
    expect(findings[0]!.message).toContain("runEffect");
    expect(findings[1]!.message).toContain("installEffectDriver");
    expect(findings[0]!.column).toBe(10);
    expect(findings[1]!.line).toBe(1);
  });

  test("SCREEN_W / SCREEN_H from anywhere", () => {
    const src = [
      `import { SCREEN_W } from "@pocketjs/framework/layout";`,
      `import { SCREEN_H } from "./constants";`,
      ``,
    ].join("\n");
    const findings = lintSource(src, "a.ts");
    expect(findings).toHaveLength(2);
    expect(findings[0]!.message).toContain("SCREEN_W");
    expect(findings[1]!.message).toContain("SCREEN_H");
    expect(findings[1]!.line).toBe(2);
  });

  test("Gallery / DeepZoom / OSK / TextField / VirtualList from .../components", () => {
    const src = [
      `import { Gallery, DeepZoom } from "@pocketjs/framework/components";`,
      `import { OSK, TextField, VirtualList } from "./components";`,
      ``,
    ].join("\n");
    const findings = lintSource(src, "a.ts");
    expect(findings).toHaveLength(5);
    for (const f of findings) {
      expect(f.code).toBe("mountOnly.forbiddenImport");
    }
    const joined = findings.map((f) => f.message).join("\n");
    for (const name of [
      "Gallery",
      "DeepZoom",
      "OSK",
      "TextField",
      "VirtualList",
    ]) {
      expect(joined).toContain(`'${name}'`);
    }
  });

  test("import alias still flags the original name", () => {
    const src = `import { onFrame as tick } from "@pocketjs/framework/frame";\n`;
    const findings = lintSource(src, "a.ts");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("mountOnly.forbiddenImport");
    expect(findings[0]!.message).toContain("onFrame");
    expect(findings[0]!.column).toBe(10);
  });

  test("export-from re-export is also flagged", () => {
    const src = `export { after } from "@pocketjs/framework/clock";\n`;
    const findings = lintSource(src, "a.ts");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("mountOnly.forbiddenImport");
    expect(findings[0]!.column).toBe(10);
  });

  /**
   * The import clause is matched with `[\s\S]*?`, so a match anchored on the
   * word "import" inside a COMMENT runs across the newline and swallows the
   * real statement below it, up to its `from "…"`. That match is discarded for
   * sitting outside code, but the regex cursor stayed past what it ate, so the
   * real import was never seen: the violation degraded to a bare-identifier
   * finding whose message said "not imported here" about a plain import, and
   * lost the module specifier that names the rule.
   *
   * A composition explaining itself in prose is the normal case, not an exotic
   * one — `compositions/late-timer` tripped this by describing what it does.
   */
  describe("a commented-out keyword must not swallow the next statement", () => {
    const shapes: Array<[string, string]> = [
      ["plain", `// the import sits here\nimport { after } from "@pocketjs/framework/clock";\n`],
      ["aliased", `// no import of a timer here\nimport { after as delay } from "@pocketjs/framework/clock";\n`],
      ["export keyword", `// re-export helpers\nexport { P } from "./p.ts";\nimport { onFrame } from "@pocketjs/framework";\n`],
      ["block comment", `/* import notes */\nimport { runEffect } from "@pocketjs/framework/effects";\n`],
    ];

    for (const [label, src] of shapes) {
      test(label, () => {
        expect(codes(lintSource(src, "a.ts"))).toEqual(["mountOnly.forbiddenImport"]);
      });
    }

    test("prose alone still produces nothing", () => {
      const src = `// this module exports the panel and imports nothing odd\nimport { Text } from "@pocketjs/framework/components";\n`;
      expect(lintSource(src, "a.ts")).toHaveLength(0);
    });
  });

  test("frame hooks from a non-framework path are not forbiddenImport", () => {
    const src = `import { onFrame } from "./reexport";\n`;
    const findings = lintSource(src, "a.ts");
    // Import path is not @pocketjs/framework/* → no forbiddenImport;
    // local binding suppresses bare identifier.
    expect(findings).toHaveLength(0);
  });

  test("clock names from non-clock modules are not forbiddenImport", () => {
    const src = `import { after } from "./helpers";\n`;
    const findings = lintSource(src, "a.ts");
    expect(findings).toHaveLength(0);
  });
});

describe("lintSource — clean mount-only source", () => {
  test("zero findings for a typical mount-only composition", () => {
    const src = `
import { hostViewport } from "@pocketjs/framework/layout";
import { View, Text } from "@pocketjs/framework/components";

export function App(ops: unknown) {
  const vp = hostViewport(ops);
  return View({ style: { width: vp.w, height: vp.h } }, [
    Text({ content: "hello motion" }),
  ]);
}
`.trimStart();
    const findings = lintSource(src, "App.tsx");
    expect(findings).toEqual([]);
  });
});

describe("lintSource — comments and string literals", () => {
  test("forbidden name inside a line comment is not flagged", () => {
    const src = `
import { View } from "@pocketjs/framework/components";
// do not use onFrame here, or after(), or SCREEN_W
export const x = 1;
`.trimStart();
    expect(lintSource(src, "a.ts")).toEqual([]);
  });

  test("forbidden name inside a block comment is not flagged", () => {
    const src = `
import { View } from "@pocketjs/framework/components";
/* Gallery DeepZoom
   runEffect(installEffectDriver)
   onFrame */
export const x = 1;
`.trimStart();
    expect(lintSource(src, "a.ts")).toEqual([]);
  });

  test("forbidden name inside a string literal is not flagged", () => {
    const src = `
import { View } from "@pocketjs/framework/components";
const tip = "never call onFrame or after or SCREEN_W";
const tip2 = 'Gallery and VirtualList are banned';
export const x = tip + tip2;
`.trimStart();
    expect(lintSource(src, "a.ts")).toEqual([]);
  });

  test("forbidden name inside a template literal text is not flagged", () => {
    const src = `
import { View } from "@pocketjs/framework/components";
const tip = \`avoid onFrame and SCREEN_H\`;
export const x = tip;
`.trimStart();
    expect(lintSource(src, "a.ts")).toEqual([]);
  });
});

describe("lintSource — multiple findings", () => {
  test("reports every violation in one file", () => {
    const src = [
      `import { onFrame, SCREEN_W } from "@pocketjs/framework/frame";`,
      `import { after } from "@pocketjs/framework/clock";`,
      `import { Gallery } from "@pocketjs/framework/components";`,
      `onButtonPress();`,
      ``,
    ].join("\n");
    const findings = lintSource(src, "messy.ts");
    // 2 on line 1 (onFrame, SCREEN_W) + after + Gallery + bare onButtonPress = 5
    expect(findings.length).toBe(5);
    expect(
      findings.filter((f) => f.code === "mountOnly.forbiddenImport"),
    ).toHaveLength(4);
    expect(
      findings.filter((f) => f.code === "mountOnly.bareIdentifier"),
    ).toHaveLength(1);
    // All share the file name
    expect(findings.every((f) => f.file === "messy.ts")).toBe(true);
  });
});

describe("lintSource — bare identifiers", () => {
  test("bare use of a forbidden name gets the lower-severity code", () => {
    const src = `
export function setup() {
  onFrame(() => {});
}
`.trimStart();
    const findings = lintSource(src, "a.ts");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.code).toBe("mountOnly.bareIdentifier");
    expect(f.line).toBe(2);
    expect(f.column).toBe(3);
    expect(f.message).toContain("onFrame");
  });

  test("property access is not a bare identifier", () => {
    const src = `
const api = { onFrame: () => {} };
api.onFrame();
`.trimStart();
    const findings = lintSource(src, "a.ts");
    // Object shorthand / method name: `{ onFrame: ... }` uses `onFrame` as
    // property key after `{` — our scanner may still see it as an identifier.
    // Property *access* `api.onFrame` must not flag.
    const accessFlags = findings.filter(
      (f) => f.line === 3 && f.code === "mountOnly.bareIdentifier",
    );
    expect(accessFlags).toHaveLength(0);
  });

  test("imported forbidden name does not also emit bareIdentifier", () => {
    const src = `
import { onFrame } from "@pocketjs/framework/frame";
onFrame(() => {});
`.trimStart();
    const findings = lintSource(src, "a.ts");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("mountOnly.forbiddenImport");
  });

  test("alias import suppresses bare on the local name, not the original", () => {
    const src = `
import { onFrame as tick } from "@pocketjs/framework/frame";
tick();
onFrame(() => {});
`.trimStart();
    const findings = lintSource(src, "a.ts");
    // forbiddenImport for onFrame + bareIdentifier for free onFrame
    expect(findings).toHaveLength(2);
    expect(findCode(findings, "mountOnly.forbiddenImport")).toBeDefined();
    const bare = findCode(findings, "mountOnly.bareIdentifier");
    expect(bare).toBeDefined();
    expect(bare!.message).toContain("onFrame");
    expect(bare!.line).toBe(3);
  });
});

// ===========================================================================
// Runtime oracle
// ===========================================================================

describe("countingOps — never called", () => {
  test("mountOnly true, totalOps 0", () => {
    const inner = {
      setStyle: () => {},
      setProp: () => {},
    };
    const c = countingOps(inner);
    c.beginFrame();
    c.beginFrame();
    c.beginFrame();
    const r = c.report(3);
    expect(r.mountOnly).toBe(true);
    expect(r.totalOps).toBe(0);
    expect(r.framesObserved).toBe(3);
    expect(r.opsPerFrame).toEqual([0, 0, 0]);
    expect(r.opsByName).toEqual({});
  });
});

describe("countingOps — guest calls", () => {
  test("counts guest ops and sets mountOnly false", () => {
    const inner = {
      setStyle: (_n: number, _s: unknown) => "ok",
      setProp: (_n: number, _k: string, _v: unknown) => 42,
    };
    const c = countingOps(inner);
    c.beginFrame();
    (c.ops.setStyle as Function)(1, {});
    (c.ops.setStyle as Function)(2, {});
    (c.ops.setProp as Function)(1, "x", 0);
    const r = c.report(1);
    expect(r.mountOnly).toBe(false);
    expect(r.totalOps).toBe(3);
    expect(r.opsByName).toEqual({ setStyle: 2, setProp: 1 });
    expect(r.opsPerFrame).toEqual([3]);
  });
});

describe("countingOps — asHost exclusion", () => {
  test("calls inside asHost are not counted", () => {
    const inner = {
      uploadTexture: () => "tex",
      setImage: () => "img",
      setStyle: () => "style",
    };
    const c = countingOps(inner);
    c.beginFrame();
    c.asHost(() => {
      (c.ops.uploadTexture as Function)();
      (c.ops.setImage as Function)();
    });
    (c.ops.setStyle as Function)();
    const r = c.report(1);
    expect(r.totalOps).toBe(1);
    expect(r.opsByName).toEqual({ setStyle: 1 });
    expect(r.mountOnly).toBe(false);
  });

  test("asHost-only traffic keeps mountOnly true", () => {
    const inner = {
      uploadTexture: () => {},
      setImage: () => {},
    };
    const c = countingOps(inner);
    for (let i = 0; i < 5; i++) {
      c.beginFrame();
      c.asHost(() => {
        (c.ops.uploadTexture as Function)();
        (c.ops.setImage as Function)();
      });
    }
    const r = c.report(5);
    expect(r.mountOnly).toBe(true);
    expect(r.totalOps).toBe(0);
    expect(r.opsPerFrame).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("countingOps — nested asHost", () => {
  test("depth counter, not a boolean", () => {
    const inner = {
      a: () => "a",
      b: () => "b",
      c: () => "c",
    };
    const c = countingOps(inner);
    c.beginFrame();

    c.asHost(() => {
      (c.ops.a as Function)(); // host
      c.asHost(() => {
        (c.ops.b as Function)(); // still host
      });
      (c.ops.a as Function)(); // still host (outer still open)
    });
    (c.ops.c as Function)(); // guest

    const r = c.report(1);
    expect(r.totalOps).toBe(1);
    expect(r.opsByName).toEqual({ c: 1 });
  });
});

describe("countingOps — opsPerFrame boundaries", () => {
  test("attributes calls to the right frame across beginFrame()", () => {
    const inner = {
      op: () => {},
    };
    const c = countingOps(inner);

    c.beginFrame(); // frame 0
    (c.ops.op as Function)();

    c.beginFrame(); // frame 1
    (c.ops.op as Function)();
    (c.ops.op as Function)();

    c.beginFrame(); // frame 2 — no ops

    c.beginFrame(); // frame 3
    (c.ops.op as Function)();
    (c.ops.op as Function)();
    (c.ops.op as Function)();

    const r = c.report(4);
    expect(r.opsPerFrame).toEqual([1, 2, 0, 3]);
    expect(r.totalOps).toBe(6);
    expect(r.framesObserved).toBe(4);
  });

  test("report pads missing frames with zeros", () => {
    const inner = { op: () => {} };
    const c = countingOps(inner);
    c.beginFrame();
    (c.ops.op as Function)();
    const r = c.report(3);
    expect(r.opsPerFrame).toEqual([1, 0, 0]);
  });
});

describe("countingOps — transparency", () => {
  test("return values pass through unchanged", () => {
    const payload = { n: 7 };
    const inner = {
      createNode: (tag: string) => ({ tag, id: 1 }),
      echo: (x: unknown) => x,
    };
    const c = countingOps(inner);
    const node = (c.ops.createNode as Function)("View");
    expect(node).toEqual({ tag: "View", id: 1 });
    expect((c.ops.echo as Function)(payload)).toBe(payload);
  });

  test("thrown errors pass through unchanged", () => {
    const err = new Error("host boom");
    err.name = "HostError";
    const inner = {
      boom: () => {
        throw err;
      },
    };
    const c = countingOps(inner);
    try {
      (c.ops.boom as Function)();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBe(err);
    }
    // Still counted — guest did call it
    const r = c.report(0);
    expect(r.totalOps).toBe(1);
    expect(r.opsByName).toEqual({ boom: 1 });
  });

  test("asHost return value and throw pass through", () => {
    const c = countingOps({ x: () => 1 });
    expect(c.asHost(() => 99)).toBe(99);
    const err = new Error("host fail");
    try {
      c.asHost(() => {
        throw err;
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBe(err);
    }
  });

  test("non-function properties pass through", () => {
    const meta = { version: 1 };
    const c = countingOps({ meta, setStyle: () => {} });
    expect(c.ops.meta).toBe(meta);
  });
});

describe("countingOps — report shape", () => {
  test("opsByName is a snapshot (mutating return does not affect next report)", () => {
    const c = countingOps({ op: () => {} });
    c.beginFrame();
    (c.ops.op as Function)();
    const r1: OracleReport = c.report(1);
    (r1.opsByName as Record<string, number>).op = 999;
    const r2 = c.report(1);
    expect(r2.opsByName).toEqual({ op: 1 });
  });
});
