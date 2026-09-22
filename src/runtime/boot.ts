/**
 * Hardened boot — our replacement for upstream's `hosts/sim/sim.ts` `bootWorld`.
 *
 * The logic is upstream's: build a wasm core, install the contract slots, eval the
 * guest bundle, take `globalThis.frame` back out. The difference is the injection
 * strategy. Upstream does
 *
 *     g.ui = wasm.ops;  g.__pak = arrayBuffer;  eval(src)
 *
 * in the host realm, which is exactly the escape our harness exists to close: a
 * host-realm object handed to the guest carries the host `Function` on its
 * prototype chain. Every slot here goes through `createSandbox` instead.
 *
 * See `src/harness/sandbox.ts` for the invariant.
 */

import { createSandbox, type AuditReport, type Sandbox } from "../harness/sandbox.ts";
import { parseAtlases } from "../text/atlas.ts";
import { fileURLToPath } from "node:url";

/**
 * Upstream checkout that supplies the wasm core and the built bundles.
 *
 * Defaults to the vendored tree, which is the only one carrying `patches/` —
 * `MAX_FONT_SLOTS` is 64 there and 24 upstream, and the wasm is rebuilt to
 * match. Pointing this at a plain checkout silently loads a core that cannot
 * bind the slots our compositions ask for. `POCKETJS_ROOT` overrides it for
 * deliberate comparison against unpatched upstream.
 */
export function pocketjsRoot(): string {
  return process.env.POCKETJS_ROOT ?? fileURLToPath(new URL("../../vendor/pocketjs", import.meta.url));
}

export interface BootOptions {
  /** Built guest bundle, e.g. `<root>/dist/hero-main.js`. */
  readonly bundlePath: string;
  /** Asset pak beside it. Optional — a composition with no assets has none. */
  readonly pakPath?: string;
  /** Logical viewport the composition lays out against. */
  readonly width: number;
  readonly height: number;
  /** Virtual frames per second; must divide 60 (upstream `VALID_HZ`). */
  readonly hz: number;
  /** Physical supersampling. Pair with a pak built at `--density=N` — the atlas
   *  must carry N× coverage or glyphs come out as N×N blocks (raster.rs
   *  duplicates coverage when the output is denser than the atlas). */
  readonly renderScale?: number;
  readonly rasterDensity?: number;
  /** Defaults to `<root>/hosts/web/pocketjs.wasm`. */
  readonly wasmPath?: string;
  /** A pak whose atlases were baked `--metrics-only` (1x1 empty cells) is
   *  refused unless this is set: it measures correctly and draws nothing,
   *  which is a blank frame with a clean realm and a stable digest. Only
   *  `src/text/measure.ts` passes it. */
  readonly allowMetricsOnly?: boolean;
  /** Wrap the ops object before it is handed to the guest (the mount-only oracle). */
  readonly wrapOps?: (ops: Record<string, unknown>) => Record<string, unknown>;
  /** The command that rebuilds this bundle, quoted back when the bundle's baked
   *  tick rate disagrees with the realm's. Omit where there is no composition
   *  behind the bundle (the measurement builds in `src/text/measure.ts`). */
  readonly buildCommand?: string;
}

export interface BootedWorld {
  /** One guest turn. Mount-only compositions do nothing here after mount. */
  readonly frame: (buttons: number) => void;
  /** One core tick: animations advance, layout if dirty. */
  readonly tick: () => void;
  /** Rasterise the current core state. Returns RGBA at physical size. */
  readonly render: () => Uint8Array;
  readonly ticksPerFrame: number;
  readonly physicalWidth: number;
  readonly physicalHeight: number;
  /** Structural self-check of the guest realm. */
  readonly audit: () => AuditReport;
  /**
   * Scheduled work the mounted guest still holds, by registry.
   *
   * The ops counter sees actions that REACH the core; this sees work that is
   * merely booked. The two answer different questions and a mount-only verdict
   * needs both: `after(10, …)` issues no op for 600 frames and then mutates the
   * world, so no finite ops observation can rule it out.
   *
   * `undefined` when the bundle predates the pending-work readers
   * (`patches/0003`) — an old bundle cannot be interrogated, which is not the
   * same as it being clean.
   */
  readonly pendingWork: () => PendingWork | undefined;
  /**
   * Component tree via the DevTools protocol — the same round trip upstream's
   * sim host performs: push a request, run one frame, read the reply. Used to
   * resolve `debugName` to node ids (e.g. footage tiles). ADVANCES THE WORLD by
   * one frame, so call it only during setup.
   */
  readonly getTree: () => unknown;
  /**
   * The HostOps object, host-side. The footage layer drives this directly —
   * per-frame texture swaps are the host's job, which is what keeps the guest
   * mount-only (src/footage/layer.ts).
   */
  readonly ops: Record<string, unknown>;
  /** wasm exports — checkpointing needs the linear memory. */
  readonly exports: { readonly memory: WebAssembly.Memory };
  readonly sandbox: Sandbox;
}

/**
 * Mirrors `PendingWork` in the vendored framework (`framework/src/index.ts`,
 * added by `patches/0003`). Declared rather than imported: the framework module
 * lives inside the guest bundle, and the host only ever sees the plain numbers
 * that come back across the sandbox boundary.
 */
export interface PendingWork {
  /** App callbacks registered via onFrame/onButtonPress — run every frame. */
  readonly frameHooks: number;
  /** after() timers awaiting their deadline frame. */
  readonly timers: number;
  /** Effect commands awaiting a driver result. */
  readonly effectsPending: number;
  /** Driver results awaiting the next frame boundary. */
  readonly effectsQueued: number;
  /** Modules with async work outstanding. */
  readonly servicePumps: number;
}

/** Sum of every registry — zero means nothing is scheduled anywhere. */
export function totalPendingWork(w: PendingWork): number {
  return w.frameHooks + w.timers + w.effectsPending + w.effectsQueued + w.servicePumps;
}

const VALID_HZ = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60] as const;
/** Core ticks per second. The realm's rate, fixed: `ticksPerFrame` is
 *  `TICKS_PER_SECOND / hz`, and a bundle must be baked at this rate. */
export const TICKS_PER_SECOND = 60;

/**
 * Refuse a bundle whose baked tick rate is not the one this realm drives.
 *
 * `tools/build.ts --hz=N` compiles N into the bundle as a constant, and every
 * ms-to-frame conversion resolves against it — including the compiler's
 * keyframe baker, which stores a timeline's delay and its segment endpoints as
 * frame counts at that rate. This realm always steps the core at
 * `TICKS_PER_SECOND`, one segment frame per tick, so a bundle baked at another
 * rate plays every animation at `TICKS_PER_SECOND / baked` of its declared
 * speed — deterministically, and with nothing anywhere reporting it: the pak is
 * valid, the realm is clean, the digest is stable and reproducible on another
 * machine. The sidecar's `fps` invites the mistake, because `--hz=<fps>` is the
 * obvious thing to type next to `"fps": 30`.
 *
 * Upstream does check this, for native hosts (`assertNativeHostContract`
 * compares the baked constant against `ui.__tickHz`), but the web/wasm adapter
 * sets neither native marker and stays strict-injected, so that check never
 * runs here. `patches/0010-publish-baked-tick-rate.patch` publishes the
 * constant; without it the rate is not readable from outside the bundle at all,
 * which is why an absent marker is refused rather than read as 60 — "no rate
 * declared" and "the declared rate is right" would otherwise be the same
 * observation.
 */
export function assertBakedTickRate(
  raw: unknown,
  bundlePath: string,
  buildCommand?: string,
): void {
  if (raw === undefined) {
    throw new Error(
      `PocketJS Motion: ${bundlePath} does not publish __pocketTickHz, so the rate its ` +
        "keyframe timelines were baked at cannot be read. The bundle predates " +
        "patches/0010-publish-baked-tick-rate.patch. Re-vendor, then rebuild:\n" +
        "  bun scripts/vendor.ts" +
        (buildCommand ? `\n  ${buildCommand}` : ""),
    );
  }
  if (raw === TICKS_PER_SECOND) return;
  const speed =
    typeof raw === "number" && raw > 0
      ? ` Every animation would play at ${(TICKS_PER_SECOND / raw).toFixed(2)}x its declared speed.`
      : "";
  throw new Error(
    `PocketJS Motion: ${bundlePath} was baked at ${String(raw)} Hz; this realm ticks at ` +
      `${TICKS_PER_SECOND} Hz. A baked keyframe timeline is a frame count at the bake rate.${speed}` +
      `\nRebuild at the realm's rate (drop --hz, or pass --hz=${TICKS_PER_SECOND})` +
      (buildCommand ? `:\n  ${buildCommand}` : "."),
  );
}

export async function hardenedBootWorld(options: BootOptions): Promise<BootedWorld> {
  const { bundlePath, pakPath, width, height, hz } = options;
  const renderScale = options.renderScale ?? 1;
  const rasterDensity = options.rasterDensity ?? 1;

  if (!(VALID_HZ as readonly number[]).includes(hz)) {
    throw new Error(
      `PocketJS Motion: hz must divide 60 exactly (${VALID_HZ.join(",")}); got ${hz}`,
    );
  }

  const wasmPath = options.wasmPath ?? `${pocketjsRoot()}/hosts/web/pocketjs.wasm`;
  const { createWasmUi } = (await import(
    `${pocketjsRoot()}/hosts/web/wasm-ops.js`
  )) as { createWasmUi: (bytes: ArrayBuffer, opts: unknown) => Promise<WasmUi> };

  const wasmBytes = await Bun.file(wasmPath).arrayBuffer();
  const wasm = await createWasmUi(wasmBytes, { width, height, rasterDensity });

  const rawOps = wasm.ops as unknown as Record<string, unknown>;
  const ops = options.wrapOps ? options.wrapOps(rawOps) : rawOps;

  // Slots the upstream guest runtime reads out of globalThis before/while it
  // evaluates. `__pak` is a data buffer: `createSandbox` rebuilds it with
  // sandbox intrinsics rather than handing the host's ArrayBuffer across.
  const inbox: string[] = [];
  const outbox: string[] = [];
  const slots: Record<string, unknown> = {
    ui: ops,
    __simHz: hz,
    __pocketApp: bundleName(bundlePath),
    console: { log() {}, warn() {}, error() {} },
    __pocketDevtoolsTransport: {
      send: (line: string) => { outbox.push(line); },
      recv: () => (inbox.length > 0 ? inbox.shift()! : null),
    },
  };
  if (pakPath) {
    const pak = await Bun.file(pakPath).arrayBuffer();
    if (!options.allowMetricsOnly) {
      const thin = [...parseAtlases(new Uint8Array(pak)).values()].filter((a) => a.metricsOnly);
      if (thin.length > 0) {
        throw new Error(
          `PocketJS Motion: ${pakPath} carries ${thin.length} metrics-only font atlas(es) ` +
            `(slot ${thin.map((a) => a.slot).join(", ")}) — a pak baked with --metrics-only ` +
            "measures text and draws none of it. It is a measurement artifact " +
            "(src/text/measure.ts), not a composition build; rebuild without the flag.",
        );
      }
    }
    slots.__pak = pak;
  }

  const sandbox = createSandbox({ slots, extraAllow: ["frame"] });
  sandbox.eval(await Bun.file(bundlePath).text());

  const guestFrame = sandbox.get<((buttons: number) => void) | undefined>("frame");
  if (typeof guestFrame !== "function") {
    throw new Error(
      `PocketJS Motion: ${bundlePath} did not install globalThis.frame — ` +
        "the entry must call mount()/render()",
    );
  }

  assertBakedTickRate(sandbox.get<unknown>("__pocketTickHz"), bundlePath, options.buildCommand);

  const ticksPerFrame = TICKS_PER_SECOND / hz;

  return {
    frame: guestFrame,
    tick: wasm.tick,
    render: () => wasm.renderScaled(renderScale),
    ticksPerFrame: TICKS_PER_SECOND / hz,
    physicalWidth: width * renderScale,
    physicalHeight: height * renderScale,
    audit: () => sandbox.audit(),
    pendingWork: () => {
      const read = sandbox.get<(() => PendingWork) | undefined>("__pocketPendingWork");
      if (typeof read !== "function") return undefined;
      const w = read();
      // Copy the numbers out. The object itself is a guest-realm value and the
      // host has no business holding a reference to one.
      return {
        frameHooks: Number(w.frameHooks) || 0,
        timers: Number(w.timers) || 0,
        effectsPending: Number(w.effectsPending) || 0,
        effectsQueued: Number(w.effectsQueued) || 0,
        servicePumps: Number(w.servicePumps) || 0,
      };
    },
    getTree: () => {
      outbox.length = 0;
      inbox.push(JSON.stringify({ t: "getTree" }));
      guestFrame(0);
      for (let t = 0; t < ticksPerFrame; t++) wasm.tick();
      for (const line of outbox) {
        const msg = JSON.parse(line) as { t?: string; root?: unknown };
        if (msg.t === "tree") return msg.root ?? null;
      }
      return null;
    },
    ops,
    exports: wasm.exports,
    sandbox,
  };
}

interface WasmUi {
  readonly ops: unknown;
  readonly tick: () => void;
  readonly renderScaled: (scale: number) => Uint8Array;
  readonly exports: { readonly memory: WebAssembly.Memory };
}

function bundleName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.endsWith(".js") ? base.slice(0, -3) : base;
}
