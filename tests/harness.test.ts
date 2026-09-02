/**
 * Acceptance tests for the deterministic guest harness.
 * Every bullet in the task spec maps to a case below.
 */

import { describe, expect, test } from "bun:test";
import {
  createSandbox,
  DeterminismViolation,
  type Sandbox,
  type ContractSlots,
} from "../src/harness/sandbox.ts";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const PAK_BYTES = [10, 20, 30, 40, 50, 60, 70, 80] as const;
const TREE_FIXTURE = { a: 1, k: [{ n: 2 }, { n: 3 }], s: "ok" } as const;
const LIST_FIXTURE = [10, 20, { z: 30 }] as const;
const BYTES_FIXTURE = new Uint8Array([1, 2, 3, 4, 5]);

class HostWidget {
  tag = "widget";
}

function makeFixtureSlots(): ContractSlots {
  return {
    ui: {
      createNode(x: number) {
        return x + 1;
      },
      setStyle(a: number, b: number) {
        return a + b;
      },
      /** Plain object — must deep-rebuild into the sandbox realm. */
      getTree() {
        return {
          a: TREE_FIXTURE.a,
          k: TREE_FIXTURE.k.map((item) => ({ n: item.n })),
          s: TREE_FIXTURE.s,
        };
      },
      /** Plain array — must deep-rebuild into the sandbox realm. */
      getList() {
        return [LIST_FIXTURE[0], LIST_FIXTURE[1], { z: (LIST_FIXTURE[2] as { z: number }).z }];
      },
      /** Promise is not marshallable. */
      later() {
        return Promise.resolve(1);
      },
      /** Host throws — guest must never see the host Error object. */
      boom() {
        const err = new Error("host boom from ui.boom");
        err.name = "DeterminismViolation";
        throw err;
      },
      /** Host invokes the guest callback with a host-realm payload. */
      onEvent(cb: (payload: { kind: string; n: number }) => unknown) {
        cb({ kind: "click", n: 7 });
      },
      /** TypedArray — rebuild as sandbox Uint8Array with the same bytes. */
      getBytes() {
        return new Uint8Array(BYTES_FIXTURE);
      },
      /** Rejected kinds for message / path assertions. */
      getPromise() {
        return Promise.resolve(0);
      },
      getMap() {
        return new Map([["a", 1]]);
      },
      getWidget() {
        return new HostWidget();
      },
      getFn() {
        return function hostFn() {
          return 1;
        };
      },
      /** Depth-cap probe: nest plain objects `depth` levels deep. */
      getDeep(depth: number) {
        let node: Record<string, unknown> = { v: 1 };
        for (let i = 0; i < depth; i++) {
          node = { c: node };
        }
        return node;
      },
      /** Node-cap probe: a wide plain array of `count` numbers. */
      getWide(count: number) {
        return Array.from({ length: count }, (_, i) => i);
      },
    },
    console: {
      log(..._args: unknown[]) {
        /* host console sink — body intentionally empty for tests */
      },
      warn(..._args: unknown[]) {
        /* host console sink */
      },
    },
    // Host ArrayBuffer — sandbox must rebuild with sandbox intrinsics.
    __pak: new Uint8Array(PAK_BYTES).buffer,
  };
}

function makeSandbox(slots: ContractSlots = makeFixtureSlots()): Sandbox {
  return createSandbox({ slots });
}

/** Assert that evaluating `source` throws (DeterminismViolation or ReferenceError). */
function expectBlocked(sb: Sandbox, source: string): void {
  expect(() => sb.eval(source)).toThrow();
}

/**
 * Guest-thrown DeterminismViolation is an in-sandbox Error — not instanceof the
 * host export. Match on `.name` across the realm boundary.
 */
function expectDeterminismViolation(sb: Sandbox, source: string): void {
  let threw = false;
  try {
    sb.eval(source);
  } catch (e) {
    threw = true;
    expect((e as Error).name).toBe("DeterminismViolation");
  }
  expect(threw).toBe(true);
}

// ---------------------------------------------------------------------------
// A. globals are blocked
// ---------------------------------------------------------------------------

describe("A. globals are blocked", () => {
  const sb = makeSandbox();

  test("Date.now()", () => {
    expectDeterminismViolation(sb, "Date.now()");
  });

  test("new Date()", () => {
    expectDeterminismViolation(sb, "new Date()");
  });

  test("globalThis.Date", () => {
    expectDeterminismViolation(sb, "globalThis.Date.now()");
  });

  test("Math.random()", () => {
    expectDeterminismViolation(sb, "Math.random()");
  });

  test("(1).toLocaleString()", () => {
    expectDeterminismViolation(sb, "(1).toLocaleString()");
  });

  test('"I".toLocaleLowerCase("tr")', () => {
    expectDeterminismViolation(sb, '"I".toLocaleLowerCase("tr")');
  });

  test('"a".localeCompare("b")', () => {
    expectDeterminismViolation(sb, '"a".localeCompare("b")');
  });

  test('Function("return process")()', () => {
    // Function is allowlisted (sandbox realm) but process is absent / blocked.
    expectBlocked(sb, 'Function("return process")()');
  });

  test('(0,eval)("Date.now()")', () => {
    expectDeterminismViolation(sb, '(0,eval)("Date.now()")');
  });

  test("fetch", () => {
    expectBlocked(sb, 'fetch("https://example.com")');
  });

  test("setTimeout", () => {
    expectBlocked(sb, "setTimeout(() => {}, 1)");
  });

  test("setInterval", () => {
    expectBlocked(sb, "setInterval(() => {}, 1)");
  });

  test("performance.now()", () => {
    expectBlocked(sb, "performance.now()");
  });

  test("crypto.getRandomValues", () => {
    expectBlocked(sb, "crypto.getRandomValues(new Uint8Array(8))");
  });

  test("new ShadowRealm()", () => {
    expectDeterminismViolation(sb, "new ShadowRealm()");
  });

  test("WebAssembly", () => {
    expectDeterminismViolation(sb, "WebAssembly.Module");
  });

  test("new WeakRef({})", () => {
    expectDeterminismViolation(sb, "new WeakRef({})");
  });

  test("new FinalizationRegistry(()=>{})", () => {
    expectDeterminismViolation(sb, "new FinalizationRegistry(() => {})");
  });

  test("process", () => {
    expectBlocked(sb, "process");
  });

  test("Bun", () => {
    expectBlocked(sb, "Bun");
  });

  test("require", () => {
    expectBlocked(sb, "require");
  });
});

// ---------------------------------------------------------------------------
// B. contract-slot realm escapes are blocked
// ---------------------------------------------------------------------------

describe("B. contract-slot realm escapes are blocked", () => {
  const sb = makeSandbox();

  test('ui.constructor.constructor("return Date.now()")()', () => {
    expectDeterminismViolation(
      sb,
      'ui.constructor.constructor("return Date.now()")()',
    );
  });

  test('ui.createNode.constructor("return Date.now()")()', () => {
    expectDeterminismViolation(
      sb,
      'ui.createNode.constructor("return Date.now()")()',
    );
  });

  test('ui.setStyle.constructor("return typeof process")()', () => {
    expectDeterminismViolation(
      sb,
      'ui.setStyle.constructor("return typeof process")()',
    );
  });

  test('console.log.constructor("return typeof process")()', () => {
    expectDeterminismViolation(
      sb,
      'console.log.constructor("return typeof process")()',
    );
  });

  test("generic: every slot / every own function .constructor route throws", () => {
    const slots = makeFixtureSlots();
    const sandbox = createSandbox({ slots });

    for (const name of Object.keys(slots)) {
      const value = slots[name];
      // Data buffers are rebuilt, not hardened with a sentinel constructor —
      // their residual Function channel is covered by suite E.
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        continue;
      }
      if (value === null || (typeof value !== "object" && typeof value !== "function")) {
        continue;
      }

      expectDeterminismViolation(
        sandbox,
        `${name}.constructor.constructor("return Date.now()")()`,
      );

      for (const key of Object.keys(value as object)) {
        const member = (value as Record<string, unknown>)[key];
        if (typeof member !== "function") continue;
        expectDeterminismViolation(
          sandbox,
          `${name}.${key}.constructor("return Date.now()")()`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// C. structural assertions
// ---------------------------------------------------------------------------

describe("C. structural assertions", () => {
  const slots = makeFixtureSlots();
  const sb = createSandbox({ slots });

  test("Object.getPrototypeOf(ui) === null", () => {
    expect(sb.eval<boolean>("Object.getPrototypeOf(ui) === null")).toBe(true);
  });

  test("every hardened slot's own constructor is a sentinel", () => {
    const brand = Symbol.for("pocketjs-motion.determinism-sentinel");
    for (const name of Object.keys(slots)) {
      const value = slots[name];
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) continue;
      if (value === null || (typeof value !== "object" && typeof value !== "function")) {
        continue;
      }
      const ctor = sb.eval<unknown>(
        `(function () { return ${name}.constructor; })()`,
      );
      expect(
        ctor !== null &&
          (typeof ctor === "object" || typeof ctor === "function") &&
          (ctor as Record<symbol, unknown>)[brand] === true,
      ).toBe(true);
    }
  });

  test("audit().unclassified is empty", () => {
    const report = sb.audit();
    expect(report.unclassified).toEqual([]);
  });

  test("audit() does not throw", () => {
    expect(() => sb.audit()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// D. the sandbox is still usable
// ---------------------------------------------------------------------------

describe("D. the sandbox is still usable", () => {
  const sb = makeSandbox();

  test("[1,2,3].map(x => x*2).join() → '2,4,6'", () => {
    expect(sb.eval<string>("[1,2,3].map(x => x * 2).join()")).toBe("2,4,6");
  });

  test('JSON.stringify({a:1}) → \'{"a":1}\'', () => {
    expect(sb.eval<string>("JSON.stringify({ a: 1 })")).toBe('{"a":1}');
  });

  test("new Uint8Array(4).length → 4", () => {
    expect(sb.eval<number>("new Uint8Array(4).length")).toBe(4);
  });

  test("Math.floor(2.7) → 2", () => {
    expect(sb.eval<number>("Math.floor(2.7)")).toBe(2);
  });

  test("an async function returns a Promise", async () => {
    const result = sb.eval<Promise<number>>("(async () => 42)()");
    // Cross-realm: not instanceof host Promise, but thenable and awaitable.
    expect(typeof result.then).toBe("function");
    expect(Object.prototype.toString.call(result)).toBe("[object Promise]");
    await expect(result).resolves.toBe(42);
  });

  test("ui.createNode(2) reaches the host function", () => {
    expect(sb.eval<number>("ui.createNode(2)")).toBe(3);
  });

  test("new Uint8Array(__pak).length matches injected byte length", () => {
    expect(sb.eval<number>("new Uint8Array(__pak).length")).toBe(PAK_BYTES.length);
  });
});

// ---------------------------------------------------------------------------
// E. escape hatch is closed but sandbox-Function still works
// ---------------------------------------------------------------------------

describe("E. sandbox Function residual channel", () => {
  const sb = makeSandbox();

  test('__pak.constructor.constructor("return 1+1")() → 2', () => {
    expect(
      sb.eval<number>('__pak.constructor.constructor("return 1+1")()'),
    ).toBe(2);
  });

  test('__pak.constructor.constructor("return Date.now()")() throws', () => {
    expectDeterminismViolation(
      sb,
      '__pak.constructor.constructor("return Date.now()")()',
    );
  });
});

// ---------------------------------------------------------------------------
// F. realm escape via harness machinery
// ---------------------------------------------------------------------------

describe("F. realm escape via harness machinery", () => {
  const sb = makeSandbox();

  // --- the three confirmed escapes (must throw, not return "object") ---

  test("A: Object.getPrototypeOf(Date).constructor(...) is blocked", () => {
    expectBlocked(
      sb,
      'Object.getPrototypeOf(Date).constructor("return typeof process")()',
    );
  });

  test("B: Reflect.getPrototypeOf(Math.random).constructor(...) is blocked", () => {
    expectBlocked(
      sb,
      'Reflect.getPrototypeOf(Math.random).constructor("return typeof process")()',
    );
  });

  test("C: caught error constructor.constructor route is blocked", () => {
    expectBlocked(
      sb,
      `(function () {
        try { Date.now(); } catch (e) {
          return e.constructor.constructor("return typeof process")();
        }
      })()`,
    );
  });

  // --- prototype traps ---

  test("Object.getPrototypeOf(Date) is null", () => {
    expect(sb.eval<boolean>("Object.getPrototypeOf(Date) === null")).toBe(true);
  });

  test("Reflect.getPrototypeOf(Math.random) is null", () => {
    expect(
      sb.eval<boolean>("Reflect.getPrototypeOf(Math.random) === null"),
    ).toBe(true);
  });

  // --- guest error shape ---

  test('caught error: name is DeterminismViolation and constructor.constructor throws', () => {
    const result = sb.eval<{ name: string; ctorRouteThrew: boolean }>(
      `(function () {
        try { Date.now(); } catch (e) {
          var ctorRouteThrew = false;
          try {
            e.constructor.constructor("return typeof process")();
          } catch (_err) {
            ctorRouteThrew = true;
          }
          return { name: e.name, ctorRouteThrew: ctorRouteThrew };
        }
        return { name: "no-throw", ctorRouteThrew: false };
      })()`,
    );
    expect(result.name).toBe("DeterminismViolation");
    expect(result.ctorRouteThrew).toBe(true);
  });

  // --- generic: every poisoned global has null prototype ---

  test("generic: Object.getPrototypeOf(<poisoned global>) is null for every sentinel", () => {
    const report = sb.audit();
    expect(report.sentinels.length).toBeGreaterThan(0);
    for (const name of report.sentinels) {
      // Identifier-safe poison names only (audit lists bare global names).
      expect(
        sb.eval<boolean>(`Object.getPrototypeOf(${name}) === null`),
      ).toBe(true);
    }
  });

  // --- bootstrap temps are gone ---

  test("no __pocket_* bootstrap globals remain", () => {
    const leftovers = sb.eval<string[]>(
      `(function () {
        return Object.getOwnPropertyNames(globalThis).filter(function (k) {
          return k.indexOf("__pocket_") === 0;
        });
      })()`,
    );
    expect(leftovers).toEqual([]);
  });

  // --- Fact 3 contrast: sandbox AsyncFunction / GeneratorFunction still work ---

  test("Fact 3: sandbox AsyncFunction compiles and cannot see process", async () => {
    // AsyncFunction("return 1")() yields a Promise — await it.
    const one = sb.eval<Promise<number>>(
      'Object.getPrototypeOf(async function () {}).constructor("return 1")()',
    );
    await expect(one).resolves.toBe(1);
    const kind = sb.eval<Promise<string>>(
      'Object.getPrototypeOf(async function () {}).constructor("return typeof process")()',
    );
    await expect(kind).resolves.toBe("undefined");
  });

  test("Fact 3: sandbox GeneratorFunction compiles and cannot see process", () => {
    // GeneratorFunction("return 1")() yields a generator — take .next().value.
    expect(
      sb.eval<number>(
        'Object.getPrototypeOf(function* () {}).constructor("return 1")().next().value',
      ),
    ).toBe(1);
    expect(
      sb.eval<string>(
        'Object.getPrototypeOf(function* () {}).constructor("return typeof process")().next().value',
      ),
    ).toBe("undefined");
  });

  test("Fact 3: ui.createNode.constructor route stays blocked", () => {
    expectDeterminismViolation(
      sb,
      'ui.createNode.constructor("return typeof process")()',
    );
  });
});

// Host-side DeterminismViolation remains for harness-thrown errors (audit).
describe("host DeterminismViolation export", () => {
  test("host class has the expected name", () => {
    const e = new DeterminismViolation("test");
    expect(e.name).toBe("DeterminismViolation");
    expect(e).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// G. boundary marshalling
// ---------------------------------------------------------------------------

/**
 * Assert that `source` either throws, or returns a value for which
 * `e.constructor.constructor("return typeof process")` is not a host escape
 * (i.e. does not yield `"object"`). Used for the classic seven host→guest routes.
 */
function expectNoHostEscape(sb: Sandbox, source: string): void {
  const result = sb.eval<string | { escaped: false; via: string }>(
    `(function () {
      try {
        var v = (${source});
        try {
          var kind = v.constructor.constructor("return typeof process")();
          if (kind === "object") return "ESCAPED";
          return { escaped: false, via: "sandbox-ctor:" + kind };
        } catch (_e) {
          return { escaped: false, via: "ctor-threw" };
        }
      } catch (_e) {
        return { escaped: false, via: "call-threw" };
      }
    })()`,
  );
  expect(result).not.toBe("ESCAPED");
}

describe("G. boundary marshalling", () => {
  const sb = makeSandbox();

  // --- the seven escapes: throw or stay in sandbox realm ---

  test("escape 1: ui.getTree().constructor.constructor is not a host escape", () => {
    expectNoHostEscape(sb, "ui.getTree()");
  });

  test("escape 2: ui.getList().constructor.constructor is not a host escape", () => {
    expectNoHostEscape(sb, "ui.getList()");
  });

  test("escape 3: Object.getPrototypeOf(ui.getTree()).constructor.constructor", () => {
    const result = sb.eval<string | { escaped: false }>(
      `(function () {
        try {
          var proto = Object.getPrototypeOf(ui.getTree());
          var kind = proto.constructor.constructor("return typeof process")();
          if (kind === "object") return "ESCAPED";
          return { escaped: false };
        } catch (_e) {
          return { escaped: false };
        }
      })()`,
    );
    expect(result).not.toBe("ESCAPED");
  });

  test("escape 4: ui.later() (Promise) is rejected at the boundary", () => {
    const result = sb.eval<{ threw: boolean; message: string }>(
      `(function () {
        try {
          ui.later();
          return { threw: false, message: "" };
        } catch (e) {
          return { threw: true, message: String(e && e.message ? e.message : e) };
        }
      })()`,
    );
    expect(result.threw).toBe(true);
    expect(result.message).toContain("ui.later");
    expect(result.message).toContain("Promise");
  });

  test("escape 5: nested ui.getTree().k[0] is sandbox-realm", () => {
    expectNoHostEscape(sb, "ui.getTree().k[0]");
  });

  test("escape 6: thrown host error is rethrown as sandbox error", () => {
    const result = sb.eval<{
      name: string;
      message: string;
      ctorRouteThrew: boolean;
      processKind: string | null;
    }>(
      `(function () {
        try {
          ui.boom();
          return { name: "no-throw", message: "", ctorRouteThrew: false, processKind: null };
        } catch (e) {
          var ctorRouteThrew = false;
          var processKind = null;
          try {
            processKind = e.constructor.constructor("return typeof process")();
          } catch (_err) {
            ctorRouteThrew = true;
          }
          return {
            name: e.name,
            message: e.message,
            ctorRouteThrew: ctorRouteThrew,
            processKind: processKind,
          };
        }
      })()`,
    );
    expect(result.name).toBe("DeterminismViolation");
    expect(result.message).toContain("host boom");
    // Either constructor is sealed (throws) or compiles only in-sandbox.
    expect(result.processKind === "object").toBe(false);
    if (!result.ctorRouteThrew) {
      expect(result.processKind).toBe("undefined");
    }
  });

  test("escape 7: host→guest callback arguments are marshalled", () => {
    const result = sb.eval<{
      saw: { kind: string; n: number } | null;
      processKind: string | null;
      ctorRouteThrew: boolean;
      protoIsObject: boolean;
    }>(
      `(function () {
        var saw = null;
        var processKind = null;
        var ctorRouteThrew = false;
        var protoIsObject = false;
        ui.onEvent(function (p) {
          saw = { kind: p.kind, n: p.n };
          protoIsObject = Object.getPrototypeOf(p) === Object.prototype;
          try {
            processKind = p.constructor.constructor("return typeof process")();
          } catch (_e) {
            ctorRouteThrew = true;
          }
        });
        return {
          saw: saw,
          processKind: processKind,
          ctorRouteThrew: ctorRouteThrew,
          protoIsObject: protoIsObject,
        };
      })()`,
    );
    expect(result.saw).toEqual({ kind: "click", n: 7 });
    expect(result.protoIsObject).toBe(true);
    expect(result.processKind === "object").toBe(false);
  });

  // --- structural equality + sandbox prototype ---

  test("ui.getTree() is structurally equal and uses sandbox Object.prototype", () => {
    const result = sb.eval<{
      tree: unknown;
      protoIsObject: boolean;
      nestedProtoIsObject: boolean;
    }>(
      `(function () {
        var t = ui.getTree();
        return {
          tree: t,
          protoIsObject: Object.getPrototypeOf(t) === Object.prototype,
          nestedProtoIsObject: Object.getPrototypeOf(t.k[0]) === Object.prototype,
        };
      })()`,
    );
    expect(result.tree).toEqual({ a: 1, k: [{ n: 2 }, { n: 3 }], s: "ok" });
    expect(result.protoIsObject).toBe(true);
    expect(result.nestedProtoIsObject).toBe(true);
  });

  test("ui.getList() is structurally equal and uses sandbox Array.prototype", () => {
    const result = sb.eval<{
      list: unknown;
      protoIsArray: boolean;
    }>(
      `(function () {
        var L = ui.getList();
        return {
          list: L,
          protoIsArray: Object.getPrototypeOf(L) === Array.prototype,
        };
      })()`,
    );
    expect(result.list).toEqual([10, 20, { z: 30 }]);
    expect(result.protoIsArray).toBe(true);
  });

  // --- TypedArray rebuild ---

  test("ui.getBytes() yields a sandbox Uint8Array with the same bytes", () => {
    const result = sb.eval<{
      bytes: number[];
      isUint8: boolean;
      protoIsUint8: boolean;
      processKind: string | null;
    }>(
      `(function () {
        var b = ui.getBytes();
        var processKind = null;
        try {
          processKind = b.constructor.constructor("return typeof process")();
        } catch (_e) {
          processKind = "threw";
        }
        return {
          bytes: Array.prototype.slice.call(b),
          isUint8: b instanceof Uint8Array,
          protoIsUint8: Object.getPrototypeOf(b) === Uint8Array.prototype,
          processKind: processKind,
        };
      })()`,
    );
    expect(result.bytes).toEqual([1, 2, 3, 4, 5]);
    expect(result.isUint8).toBe(true);
    expect(result.protoIsUint8).toBe(true);
    expect(result.processKind === "object").toBe(false);
  });

  // --- host throw shape ---

  test("host throw → guest sees DeterminismViolation name and sealed constructor", () => {
    const result = sb.eval<{ name: string; message: string; ctorRouteThrew: boolean }>(
      `(function () {
        try {
          ui.boom();
          return { name: "no-throw", message: "", ctorRouteThrew: false };
        } catch (e) {
          var ctorRouteThrew = false;
          try {
            e.constructor.constructor("return typeof process")();
          } catch (_err) {
            ctorRouteThrew = true;
          }
          return { name: e.name, message: e.message, ctorRouteThrew: ctorRouteThrew };
        }
      })()`,
    );
    expect(result.name).toBe("DeterminismViolation");
    expect(result.message).toBe("host boom from ui.boom");
    expect(result.ctorRouteThrew).toBe(true);
  });

  // --- rejected non-marshallable returns (path + type in message) ---

  test("Promise return is rejected naming the slot path", () => {
    const msg = sb.eval<string>(
      `(function () {
        try { ui.getPromise(); return ""; }
        catch (e) { return e.message; }
      })()`,
    );
    expect(msg).toContain("ui.getPromise");
    expect(msg).toContain("Promise");
  });

  test("Map return is rejected naming the slot path", () => {
    const msg = sb.eval<string>(
      `(function () {
        try { ui.getMap(); return ""; }
        catch (e) { return e.message; }
      })()`,
    );
    expect(msg).toContain("ui.getMap");
    expect(msg).toContain("Map");
  });

  test("class instance return is rejected naming the slot path", () => {
    const msg = sb.eval<string>(
      `(function () {
        try { ui.getWidget(); return ""; }
        catch (e) { return e.message; }
      })()`,
    );
    expect(msg).toContain("ui.getWidget");
    // HostWidget or Object depending on toStringTag — must not silently pass.
    expect(msg).toMatch(/HostWidget|Object|returned a/);
  });

  test("function return is rejected naming the slot path", () => {
    const msg = sb.eval<string>(
      `(function () {
        try { ui.getFn(); return ""; }
        catch (e) { return e.message; }
      })()`,
    );
    expect(msg).toContain("ui.getFn");
    expect(msg).toContain("function");
  });

  // --- depth / node caps ---

  test("depth-cap rejection", () => {
    // Cap is 32; a chain deeper than that must fail.
    const msg = sb.eval<string>(
      `(function () {
        try { ui.getDeep(40); return ""; }
        catch (e) { return e.message; }
      })()`,
    );
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toMatch(/depth cap|ui\.getDeep/);
  });

  test("node-cap rejection", () => {
    // Cap is 10_000; a wide array past that must fail.
    const msg = sb.eval<string>(
      `(function () {
        try { ui.getWide(12000); return ""; }
        catch (e) { return e.message; }
      })()`,
    );
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toMatch(/node cap|ui\.getWide/);
  });

  test("depth under the cap still works", () => {
    const v = sb.eval<number>(
      `(function () {
        var n = ui.getDeep(8);
        var d = 0;
        while (n && n.c) { n = n.c; d++; }
        return n.v + d;
      })()`,
    );
    expect(v).toBe(1 + 8);
  });

  // --- generic sweep: every fixture slot method result is sandbox-realm ---

  test("generic sweep: every slot method result is sandbox-realm when object", () => {
    const slots = makeFixtureSlots();
    const sandbox = createSandbox({ slots });

    // Methods that are known to reject — call them expecting throw, not escape.
    const rejecting = new Set([
      "later",
      "boom",
      "getPromise",
      "getMap",
      "getWidget",
      "getFn",
    ]);

    for (const slotName of Object.keys(slots)) {
      const value = slots[slotName];
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) continue;
      if (value === null || (typeof value !== "object" && typeof value !== "function")) {
        continue;
      }

      for (const key of Object.keys(value as object)) {
        const member = (value as Record<string, unknown>)[key];
        if (typeof member !== "function") continue;

        if (rejecting.has(key) || key === "onEvent") {
          // onEvent returns undefined; rejecting methods throw or return void.
          if (key === "onEvent") {
            // Invoke with a no-op; assert no host escape via side channel already covered.
            expect(() =>
              sandbox.eval(`${slotName}.${key}(function () {})`),
            ).not.toThrow();
            continue;
          }
          if (key === "boom") {
            expect(() => sandbox.eval(`${slotName}.${key}()`)).toThrow();
            continue;
          }
          // Promise / Map / class / function — must throw DeterminismViolation-shaped.
          const threw = sandbox.eval<boolean>(
            `(function () {
              try { ${slotName}.${key}(); return false; }
              catch (e) { return e.name === "DeterminismViolation"; }
            })()`,
          );
          expect(threw).toBe(true);
          continue;
        }

        // Methods that need arguments.
        let call: string;
        if (key === "createNode") call = `${slotName}.createNode(2)`;
        else if (key === "setStyle") call = `${slotName}.setStyle(1, 2)`;
        else if (key === "getDeep") call = `${slotName}.getDeep(2)`;
        else if (key === "getWide") call = `${slotName}.getWide(3)`;
        else if (key === "log" || key === "warn") call = `${slotName}.${key}("x")`;
        else call = `${slotName}.${key}()`;

        const report = sandbox.eval<{
          kind: string;
          protoIsHost: boolean | null;
          processKind: string | null;
        }>(
          `(function () {
            var r = (${call});
            var kind = typeof r;
            if (r === null) kind = "null";
            if (kind !== "object" && kind !== "function") {
              return { kind: kind, protoIsHost: null, processKind: null };
            }
            var processKind = null;
            try {
              processKind = r.constructor.constructor("return typeof process")();
            } catch (_e) {
              processKind = "threw";
            }
            // Host Object.prototype is not the sandbox one — if the value were a
            // host plain object, its proto would NOT equal sandbox Object.prototype
            // and constructor.constructor would see process as "object".
            return {
              kind: kind,
              protoIsHost: processKind === "object",
              processKind: processKind,
            };
          })()`,
        );

        expect(report.protoIsHost).not.toBe(true);
        expect(report.processKind === "object").toBe(false);
      }
    }
  });
});
