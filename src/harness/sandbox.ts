/**
 * Deterministic guest harness for PocketJS Motion.
 *
 * Guests run in Bun, not on a PSP QuickJS that simply lacks wall-clock /
 * randomness APIs. This module builds the missing protection with `node:vm`
 * plus explicit poisoning and contract-slot hardening.
 *
 * Do not "simplify" past the three facts below — each was verified experimentally
 * and removing any one re-opens a non-deterministic escape.
 */

import { createContext, runInContext, type Context } from "node:vm";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ContractSlots {
  [name: string]: unknown;
}

export interface SandboxOptions {
  /** Host-realm values the guest legitimately needs (ui, __pak, console, …). */
  slots: ContractSlots;
  /** Extra global names to allow through untouched. Default: none. */
  extraAllow?: readonly string[];
}

export interface AuditReport {
  allowed: string[];
  sentinels: string[];
  /**
   * Globals the GUEST defined after bootstrap — a real bundle installs `frame`,
   * `__pocketDevtools`, `__pocketResizeViewport`, … Safe by construction: they
   * were created by code running in this realm, so they are sandbox objects and
   * cannot carry the host realm. Reported for visibility, never a failure.
   * (Sentinels are non-writable and non-configurable, so a guest cannot swap one.)
   */
  guestDefined: string[];
  /**
   * MUST be empty. A name that existed at bootstrap and is neither allowlisted
   * nor a sentinel is an unguarded host-provided global — a hole.
   */
  unclassified: string[];
}

export interface Sandbox {
  /** Evaluate guest source inside the sandbox. */
  eval<T = unknown>(source: string): T;
  /** Read a global out of the sandbox (e.g. the installed `frame` function). */
  get<T = unknown>(name: string): T;
  /** Structural self-check — throws if any global is unclassified. */
  audit(): AuditReport;
}

// ---------------------------------------------------------------------------
// Error + brand
// ---------------------------------------------------------------------------

/**
 * Thrown when guest code touches a non-deterministic API.
 * Messages name the blocked path and point at the deterministic alternative.
 *
 * Host-side class for typing and for errors the *harness* itself throws
 * (e.g. `audit()` failure). Errors thrown *inside* the guest are a separate
 * in-sandbox class with the same `name` — match on `.name` across the boundary,
 * not `instanceof`.
 */
export class DeterminismViolation extends Error {
  override readonly name = "DeterminismViolation";

  constructor(message: string) {
    super(message);
  }
}

// Brand is Symbol.for("pocketjs-motion.determinism-sentinel") — shared across
// realms so audit() (in-sandbox) and host-side inspections agree.

// ---------------------------------------------------------------------------
// Allowlist — ordinary computation only; nothing that observes the environment.
// ---------------------------------------------------------------------------

const ALLOWLIST: readonly string[] = [
  "globalThis",
  "undefined",
  "NaN",
  "Infinity",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Symbol",
  "BigInt",
  "JSON",
  "Math",
  "Promise",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "RegExp",
  "Proxy",
  "Reflect",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
  "ArrayBuffer",
  "DataView",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURI",
  "encodeURIComponent",
  "decodeURI",
  "decodeURIComponent",
  "escape",
  "unescape",
  "structuredClone",
  "queueMicrotask",
];
// Note: `Function` is intentionally NOT allowlisted — the global is poisoned.
// Fact 3 still holds: the sandbox Function object remains reachable via the
// residual data-buffer channel (`__pak.constructor.constructor`) and any code
// it compiles runs in-sandbox against poisoned globals.

// ---------------------------------------------------------------------------
// Messages (plain strings only — safe to pass across the realm boundary)
// ---------------------------------------------------------------------------

const DEFAULT_ALT =
  "Use only deterministic, frame-indexed APIs provided by the motion host.";

const ALTERNATIVES: Record<string, string> = {
  Date: "Use the virtual clock instead — time is the frame index.",
  "Date.now": "Use the virtual clock instead — time is the frame index.",
  "Math.random":
    "Express randomness as seeded state; do not call Math.random.",
  performance: "Use the virtual clock instead — time is the frame index.",
  setTimeout: "Use the frame loop / after() instead of wall-clock timers.",
  setInterval: "Use the frame loop / after() instead of wall-clock timers.",
  clearTimeout: "Use the frame loop / after() instead of wall-clock timers.",
  clearInterval: "Use the frame loop / after() instead of wall-clock timers.",
  fetch: "Network I/O is forbidden in deterministic render; bake data at build time.",
  crypto: "Use seeded PRNG state instead of crypto entropy.",
  Intl: "Locale-dependent APIs are forbidden; use plain string/number ops.",
  eval: "Dynamic code evaluation is blocked for non-deterministic host escapes.",
  Function:
    "The Function global is blocked; compiled guest code must be static. " +
    "Sandbox Function remains reachable only via hardened data-buffer channels.",
  process: "Host process introspection is forbidden inside the guest.",
  Bun: "Host runtime introspection is forbidden inside the guest.",
  require: "Module loading is forbidden inside the guest.",
  WebAssembly: "WebAssembly is not available to motion compositions.",
  ShadowRealm: "ShadowRealm is not available to motion compositions.",
  WeakRef: "WeakRef observation order is non-deterministic; do not use it.",
  FinalizationRegistry:
    "FinalizationRegistry timing is non-deterministic; do not use it.",
  "Function.prototype.constructor":
    "Use the sandbox Function global if you must compile code; host-realm escapes are blocked.",
  "Number.prototype.toLocaleString":
    "Locale formatting is forbidden; use deterministic string conversion.",
  "Object.prototype.toLocaleString":
    "Locale formatting is forbidden; use deterministic string conversion.",
  "Array.prototype.toLocaleString":
    "Locale formatting is forbidden; use deterministic string conversion.",
  "String.prototype.localeCompare":
    "Locale comparison is forbidden; compare with plain operators or fixed code points.",
  "String.prototype.toLocaleLowerCase":
    "Locale case mapping is forbidden; use toLowerCase().",
  "String.prototype.toLocaleUpperCase":
    "Locale case mapping is forbidden; use toUpperCase().",
};

function formatMessage(path: string): string {
  const alt = ALTERNATIVES[path] ?? DEFAULT_ALT;
  return `PocketJS Motion: \`${path}\` is non-deterministic and is blocked.\n${alt}`;
}

/** Pre-build full messages for known paths; strings only cross the boundary. */
function buildKnownMessages(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of Object.keys(ALTERNATIVES)) {
    out[path] = formatMessage(path);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Data-buffer detection (Fact 2 — host→sandbox byte copy)
// ---------------------------------------------------------------------------

function isDataBuffer(value: unknown): value is ArrayBuffer | ArrayBufferView {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

/** Flatten a host ArrayBuffer / view to plain numbers (no host object crosses). */
function toByteArray(value: ArrayBuffer | ArrayBufferView): number[] {
  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value));
  }
  return Array.from(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  );
}

/** Marshal bounds — reject rather than recurse forever. */
const MARSHAL_MAX_DEPTH = 32;
const MARSHAL_MAX_NODES = 10_000;

// ---------------------------------------------------------------------------
// createSandbox
// ---------------------------------------------------------------------------

type SlotKind = "buffer" | "value";

interface SlotMeta {
  name: string;
  kind: SlotKind;
}

interface BootstrapContext extends Context {
  [key: string]: unknown;
}

export function createSandbox(options: SandboxOptions): Sandbox {
  const { slots, extraAllow = [] } = options;
  const slotNames = Object.keys(slots);
  const allowSet = new Set<string>([
    ...ALLOWLIST,
    ...slotNames,
    ...extraAllow,
  ]);

  // -------------------------------------------------------------------------
  // Fact 1 — `vm.createContext({})` does NOT give an empty global.
  // It exposes ~68 intrinsics (Date, Function, eval, Intl, WeakRef,
  // WebAssembly, ShadowRealm, …) and they all work. vm isolates you from the
  // *host's* intrinsics; it does not remove them. Explicit poison is required.
  // -------------------------------------------------------------------------
  const context: BootstrapContext = createContext({}) as BootstrapContext;

  // Plain data only across the boundary — never host functions. The sentinel
  // factory and DeterminismViolation class are defined inside the context so
  // every Proxy, target, and thrown error is a sandbox-realm object.
  const slotMeta: SlotMeta[] = [];
  for (const name of slotNames) {
    const value = slots[name];
    if (isDataBuffer(value)) {
      // Pass plain numbers only — never a host ArrayBuffer / TypedArray.
      context[`__pocket_slot_${name}`] = toByteArray(value);
      slotMeta.push({ name, kind: "buffer" });
    } else {
      context[`__pocket_slot_${name}`] = value;
      slotMeta.push({ name, kind: "value" });
    }
  }
  context.__pocket_slotMeta = slotMeta;
  context.__pocket_allow = [...allowSet];
  context.__pocket_messages = buildKnownMessages();
  context.__pocket_defaultAlt = DEFAULT_ALT;
  context.__pocket_marshalMaxDepth = MARSHAL_MAX_DEPTH;
  context.__pocket_marshalMaxNodes = MARSHAL_MAX_NODES;

  // Entire bootstrap is an IIFE so helper function declarations do not become
  // non-configurable own properties of globalThis (which would then resist poison).
  runInContext(
    `
    (function () {
      "use strict";
      var slotMeta = globalThis.__pocket_slotMeta;
      var allow = new Set(globalThis.__pocket_allow);
      var messages = globalThis.__pocket_messages;
      var defaultAlt = globalThis.__pocket_defaultAlt;
      var MARSHAL_MAX_DEPTH = globalThis.__pocket_marshalMaxDepth;
      var MARSHAL_MAX_NODES = globalThis.__pocket_marshalMaxNodes;
      var brand = Symbol.for("pocketjs-motion.determinism-sentinel");

      function messageFor(path) {
        if (Object.prototype.hasOwnProperty.call(messages, path)) {
          return messages[path];
        }
        return "PocketJS Motion: \`" + path + "\` is non-deterministic and is blocked.\\n" + defaultAlt;
      }

      // Guest-visible error class — built with sandbox Error so e.constructor
      // is in-realm. name matches the host export for cross-boundary asserts.
      function DeterminismViolation(message) {
        var err = new Error(message);
        err.name = "DeterminismViolation";
        Object.setPrototypeOf(err, DeterminismViolation.prototype);
        return err;
      }
      DeterminismViolation.prototype = Object.create(Error.prototype);
      DeterminismViolation.prototype.constructor = DeterminismViolation;
      DeterminismViolation.prototype.name = "DeterminismViolation";

      /**
       * Proxy-over-function sentinel: get / apply / construct all throw.
       * Brand is readable so audit() can classify without invoking the traps.
       * Defence-in-depth: getPrototypeOf returns null; other meta traps throw
       * so a future host-object regression cannot reopen the prototype route.
       */
      function makeSentinel(path) {
        var message = messageFor(path);
        function throwViolation() {
          throw new DeterminismViolation(message);
        }
        var target = function DeterminismSentinel() {
          throwViolation();
        };
        return new Proxy(target, {
          get: function (_t, prop) {
            if (prop === brand) return true;
            if (prop === "name") return "DeterminismSentinel";
            if (prop === "length") return 0;
            throwViolation();
          },
          apply: function () {
            throwViolation();
          },
          construct: function () {
            throwViolation();
          },
          getPrototypeOf: function () {
            return null;
          },
          setPrototypeOf: function () {
            throwViolation();
          },
          defineProperty: function () {
            throwViolation();
          },
          getOwnPropertyDescriptor: function () {
            throwViolation();
          },
          has: function () {
            throwViolation();
          },
          ownKeys: function () {
            throwViolation();
          },
          deleteProperty: function () {
            throwViolation();
          },
        });
      }

      // Close e.constructor.constructor on guest-thrown errors.
      Object.defineProperty(DeterminismViolation, "constructor", {
        value: makeSentinel("DeterminismViolation.constructor"),
        writable: false,
        configurable: false,
        enumerable: false,
      });

      // Seal constructor on any sandbox Error we rethrow for host faults.
      function sealErrorConstructor(err, path) {
        Object.defineProperty(err, "constructor", {
          value: makeSentinel(path + ".constructor"),
          writable: false,
          configurable: false,
          enumerable: false,
        });
        return err;
      }

      // ---------------------------------------------------------------------
      // Fact 2 — No host-realm object may be reachable from guest code — ever,
      // by any route. The boundary is not the injection moment. It is every
      // value crossing in either direction, at any time.
      //
      // Poisoning globals is defeated by injected host objects:
      //   ui.createNode.constructor("return Date.now()")()  → real timestamp
      // because hostFn.constructor is the *host* Function, which compiles in
      // the host realm. Affects every contract slot (ui, __pak, console, …).
      // The harness's own sentinels and errors are subject to the same rule as
      // contract slots — they must be built with sandbox intrinsics, never
      // injected as host-realm Proxy/Error objects.
      //
      // Invariant enforcement:
      //   - Host → guest (returns, thrown errors, callback args): marshal.
      //     Primitives pass; buffers / plain JSON-shaped data deep-rebuild
      //     with sandbox intrinsics; everything else is rejected.
      //   - Guest → host (slot method arguments): leave alone (op layer owns
      //     validation). Guest functions are bridged so host→guest callback
      //     arguments still pass through marshal.
      //   - Each host function is reachable only from a sandbox wrapper's
      //     closure; the guest only ever sees the wrapper.
      // ---------------------------------------------------------------------

      function typeName(value) {
        if (value === null) return "null";
        var t = typeof value;
        if (t !== "object" && t !== "function") return t;
        if (Array.isArray(value)) return "Array";
        var tag = Object.prototype.toString.call(value);
        return tag.slice(8, -1);
      }

      function rejectCross(path, type) {
        throw new DeterminismViolation(
          "PocketJS Motion: \`" + path + "\` returned a " + type +
            " across the sandbox boundary.\\n" +
            "Only numbers, strings, booleans, buffers and plain JSON-shaped data may cross."
        );
      }

      /** True for ArrayBuffer or any TypedArray / DataView (cross-realm safe). */
      function isBufferLike(value) {
        if (value === null || typeof value !== "object") return false;
        if (ArrayBuffer.isView(value)) return true;
        return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
      }

      /**
       * Rebuild an ArrayBuffer / TypedArray / DataView with sandbox intrinsics.
       * Bytes are copied — never hand a host buffer across.
       * Also used for __pak injection (from a plain number array).
       */
      function rebuildBuffer(value) {
        // Plain number[] from host bootstrap (injection path).
        if (Array.isArray(value)) {
          return new Uint8Array(value).buffer;
        }
        var i, len, src, bytes;
        if (ArrayBuffer.isView(value)) {
          len = value.byteLength;
          bytes = new Uint8Array(len);
          src = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          for (i = 0; i < len; i++) bytes[i] = src[i];
          var tag = Object.prototype.toString.call(value);
          if (tag === "[object DataView]") return new DataView(bytes.buffer);
          if (tag === "[object Uint8Array]") return bytes;
          if (tag === "[object Uint8ClampedArray]") return new Uint8ClampedArray(bytes.buffer);
          if (tag === "[object Int8Array]") return new Int8Array(bytes.buffer);
          if (tag === "[object Uint16Array]") return new Uint16Array(bytes.buffer);
          if (tag === "[object Int16Array]") return new Int16Array(bytes.buffer);
          if (tag === "[object Uint32Array]") return new Uint32Array(bytes.buffer);
          if (tag === "[object Int32Array]") return new Int32Array(bytes.buffer);
          if (tag === "[object Float32Array]") return new Float32Array(bytes.buffer);
          if (tag === "[object Float64Array]") return new Float64Array(bytes.buffer);
          if (tag === "[object BigInt64Array]") return new BigInt64Array(bytes.buffer);
          if (tag === "[object BigUint64Array]") return new BigUint64Array(bytes.buffer);
          // Unknown view: return a sandbox Uint8Array with the same bytes.
          return bytes;
        }
        // ArrayBuffer (cross-realm instanceof is unreliable).
        len = value.byteLength;
        bytes = new Uint8Array(len);
        src = new Uint8Array(value);
        for (i = 0; i < len; i++) bytes[i] = src[i];
        return bytes.buffer;
      }

      /**
       * Plain object from any realm: [[Prototype]] is null, or is that realm's
       * Object.prototype (whose own [[Prototype]] is null). Class instances,
       * Promise, Map, Error, etc. have a deeper prototype chain and are rejected.
       */
      function isPlainObject(value) {
        if (value === null || typeof value !== "object") return false;
        if (Array.isArray(value)) return false;
        var proto = Object.getPrototypeOf(value);
        if (proto === null) return true;
        return Object.getPrototypeOf(proto) === null;
      }

      /**
       * Host → guest marshal. Every value that crosses this way is either a
       * realm-free primitive or a deep rebuild with sandbox intrinsics.
       */
      function marshal(value, path, depth, state) {
        if (depth === undefined) depth = 0;
        if (state === undefined) state = { nodes: 0, seen: new WeakSet() };

        // Count every visited value (including leaves) so wide payloads hit the cap.
        state.nodes += 1;
        if (state.nodes > MARSHAL_MAX_NODES) {
          rejectCross(path, "value exceeding node cap (" + MARSHAL_MAX_NODES + ")");
        }
        if (depth > MARSHAL_MAX_DEPTH) {
          rejectCross(path, "value exceeding depth cap (" + MARSHAL_MAX_DEPTH + ")");
        }

        if (value === null || value === undefined) return value;
        var t = typeof value;
        if (t === "number" || t === "string" || t === "boolean" || t === "bigint") {
          return value;
        }
        if (t === "symbol") rejectCross(path, "symbol");
        if (t === "function") rejectCross(path, "function");

        if (isBufferLike(value)) {
          return rebuildBuffer(value);
        }

        if (state.seen.has(value)) {
          rejectCross(path, "cyclic object");
        }

        if (Array.isArray(value)) {
          state.seen.add(value);
          var arr = new Array(value.length);
          for (var ai = 0; ai < value.length; ai++) {
            arr[ai] = marshal(value[ai], path + "[" + ai + "]", depth + 1, state);
          }
          return arr;
        }

        if (!isPlainObject(value)) {
          rejectCross(path, typeName(value));
        }

        state.seen.add(value);
        var out = {};
        var keys = Object.keys(value);
        for (var ki = 0; ki < keys.length; ki++) {
          var k = keys[ki];
          out[k] = marshal(value[k], path + "." + k, depth + 1, state);
        }
        return out;
      }

      /** Re-throw a host fault as a sandbox Error — never the host Error object. */
      function rethrowHostError(e) {
        var name = "Error";
        var message = String(e);
        if (e != null && (typeof e === "object" || typeof e === "function")) {
          try {
            if (typeof e.name === "string") name = e.name;
            if (typeof e.message === "string") message = e.message;
          } catch (_read) { /* ignore */ }
        }
        var err = new Error(message);
        err.name = name;
        // Prefer DeterminismViolation prototype when the host used that name,
        // so guest-side instanceof / .name checks stay consistent.
        if (name === "DeterminismViolation") {
          Object.setPrototypeOf(err, DeterminismViolation.prototype);
        }
        sealErrorConstructor(err, "Error");
        throw err;
      }

      /**
       * When the host later invokes a guest callback, arguments are host→guest
       * and must be marshalled. The bridge is a sandbox function; the host
       * only ever holds this bridge, never raw guest state beyond what it needs.
       */
      function bridgeGuestCallback(guestFn, path) {
        return function bridgedCallback() {
          var args = new Array(arguments.length);
          for (var i = 0; i < arguments.length; i++) {
            args[i] = marshal(arguments[i], path + " argument[" + i + "]");
          }
          return guestFn.apply(undefined, args);
        };
      }

      /**
       * Sandbox-realm wrapper around a host function. The host fn lives only in
       * this closure. Return values, throws, and (via bridges) callback args
       * all pass through marshal / rethrowHostError.
       */
      function wrapHostFn(hostFn, path) {
        function wrapped() {
          var args = new Array(arguments.length);
          for (var i = 0; i < arguments.length; i++) {
            var a = arguments[i];
            // Guest→host: leave values alone, but bridge functions so that
            // host→guest callback arguments are marshalled on the way back.
            if (typeof a === "function") {
              args[i] = bridgeGuestCallback(a, path);
            } else {
              args[i] = a;
            }
          }
          try {
            var result = hostFn.apply(undefined, args);
            return marshal(result, path);
          } catch (e) {
            rethrowHostError(e);
          }
        }
        Object.defineProperty(wrapped, "constructor", {
          value: makeSentinel(path + ".constructor"),
          writable: false,
          configurable: false,
          enumerable: false,
        });
        Object.setPrototypeOf(wrapped, null);
        return wrapped;
      }

      /**
       * Harden a contract-slot value in place (or replace functions with wrappers).
       * Host functions become sandbox wrappers; nested objects get null prototype
       * + sentinel constructor so residual host identity cannot re-open Function.
       */
      function harden(value, path) {
        if (value === null || (typeof value !== "object" && typeof value !== "function")) {
          return value;
        }
        if (typeof value === "function") {
          return wrapHostFn(value, path);
        }
        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          value[key] = harden(value[key], path + "." + key);
        }
        Object.defineProperty(value, "constructor", {
          value: makeSentinel(path + ".constructor"),
          writable: false,
          configurable: false,
          enumerable: false,
        });
        Object.setPrototypeOf(value, null);
        return value;
      }

      // Step 3: inject slots, then harden (or rebuild buffers).
      for (var s = 0; s < slotMeta.length; s++) {
        var meta = slotMeta[s];
        var raw = globalThis["__pocket_slot_" + meta.name];
        if (meta.kind === "buffer") {
          // Rebuild with sandbox intrinsics so .constructor chain stays in-realm.
          globalThis[meta.name] = rebuildBuffer(raw);
        } else {
          globalThis[meta.name] = harden(raw, meta.name);
        }
      }

      // Fact 3 — capture sandbox Function *and its prototype* before the global
      // binding is poisoned. Code SandboxFunction compiles runs in this realm and
      // sees poisoned globals. The global Function name is not allowlisted.
      // Residual access: __pak.constructor.constructor -> pinned own props below.
      var SandboxFunction = Function;
      var FunctionProto = Function.prototype;

      // Step 4: poison every global not in the allowlist (includes Function, Date, …).
      var names = Object.getOwnPropertyNames(globalThis);
      for (var n = 0; n < names.length; n++) {
        var gname = names[n];
        if (allow.has(gname)) continue;
        if (gname.indexOf("__pocket_") === 0) continue;
        try {
          Object.defineProperty(globalThis, gname, {
            value: makeSentinel(gname),
            writable: true,
            configurable: true,
            enumerable: false,
          });
        } catch (_e) {
          // Non-configurable globals should only be allowlisted (NaN, Infinity, …).
        }
      }

      // Residual sandbox-Function channel (data-buffer path) — own props, not prototype.
      Object.defineProperty(ArrayBuffer, "constructor", {
        value: SandboxFunction,
        writable: false,
        configurable: false,
        enumerable: false,
      });
      Object.defineProperty(SandboxFunction, "constructor", {
        value: SandboxFunction,
        writable: false,
        configurable: false,
        enumerable: false,
      });

      // Use the captured prototype — global Function is already a sentinel here.
      Object.defineProperty(FunctionProto, "constructor", {
        value: makeSentinel("Function.prototype.constructor"),
        writable: true,
        configurable: true,
        enumerable: false,
      });

      // Step 5: poison non-global members (Math is allowlisted; only random dies).
      Object.defineProperty(Math, "random", {
        value: makeSentinel("Math.random"),
        writable: true,
        configurable: true,
        enumerable: false,
      });

      var localePoisons = [
        [Number.prototype, "toLocaleString", "Number.prototype.toLocaleString"],
        [Object.prototype, "toLocaleString", "Object.prototype.toLocaleString"],
        [Array.prototype, "toLocaleString", "Array.prototype.toLocaleString"],
        [String.prototype, "localeCompare", "String.prototype.localeCompare"],
        [String.prototype, "toLocaleLowerCase", "String.prototype.toLocaleLowerCase"],
        [String.prototype, "toLocaleUpperCase", "String.prototype.toLocaleUpperCase"],
      ];
      for (var p = 0; p < localePoisons.length; p++) {
        var entry = localePoisons[p];
        Object.defineProperty(entry[0], entry[1], {
          value: makeSentinel(entry[2]),
          writable: true,
          configurable: true,
          enumerable: false,
        });
      }

      // Drop bootstrap temps.
      var leftovers = Object.getOwnPropertyNames(globalThis);
      for (var d = 0; d < leftovers.length; d++) {
        var k = leftovers[d];
        if (k.indexOf("__pocket_") === 0) {
          try { delete globalThis[k]; } catch (_e) { /* ignore */ }
        }
      }
    })();
    `,
    context,
  );

  // Host-side cleanup of any bootstrap keys that survived on the context object.
  for (const key of Object.keys(context)) {
    if (key.startsWith("__pocket_")) {
      delete context[key];
    }
  }

  // Baseline: the globals that exist the moment bootstrap ends. Names appearing
  // after this were defined by guest code and are classified separately.
  const baseline = new Set(
    runInContext("Object.getOwnPropertyNames(globalThis)", context) as string[],
  );

  return {
    eval<T = unknown>(source: string): T {
      return runInContext(source, context) as T;
    },

    get<T = unknown>(name: string): T {
      return context[name] as T;
    },

    audit(): AuditReport {
      // Classify every own global. Future Bun/Node upgrades that introduce a new
      // global land in `unclassified` and fail the suite instead of silently
      // becoming an unguarded input.
      const allowListJson = JSON.stringify([...allowSet]);
      const baselineJson = JSON.stringify([...baseline]);
      const report = runInContext(
        `
        (function () {
          var brand = Symbol.for("pocketjs-motion.determinism-sentinel");
          var allow = new Set(${allowListJson});
          var baseline = new Set(${baselineJson});
          var allowed = [];
          var sentinels = [];
          var guestDefined = [];
          var unclassified = [];
          var names = Object.getOwnPropertyNames(globalThis);
          for (var i = 0; i < names.length; i++) {
            var name = names[i];
            if (allow.has(name)) {
              allowed.push(name);
              continue;
            }
            var isSent = false;
            try {
              var v = globalThis[name];
              isSent =
                v != null &&
                (typeof v === "object" || typeof v === "function") &&
                v[brand] === true;
            } catch (_e) {
              isSent = true;
            }
            if (isSent) sentinels.push(name);
            else if (!baseline.has(name)) guestDefined.push(name);
            else unclassified.push(name);
          }
          return {
            allowed: allowed,
            sentinels: sentinels,
            guestDefined: guestDefined,
            unclassified: unclassified,
          };
        })()
        `,
        context,
      ) as AuditReport;

      if (report.unclassified.length > 0) {
        throw new DeterminismViolation(
          `Sandbox audit failed: unclassified globals: ${report.unclassified.join(", ")}`,
        );
      }
      return report;
    },
  };
}
