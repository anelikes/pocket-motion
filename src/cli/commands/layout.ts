/**
 * `layout <composition-dir> --at <frame>`
 * Question: where did everything actually land, how big, and is it in the
 * picture?
 *
 * Text metrics are already answerable at build time — `openMeasurer` gives
 * exact advances and line heights, which is how a generator picks sizes and
 * break points. POSITIONS were not: flex is resolved inside the core, and
 * nothing asked it. Every author who has written a composition here without
 * this command worked around that the same way: pin explicit `w-[…]` boxes
 * and stack from a known origin, so the arithmetic stays the generator's
 * rather than depending on how the layout engine happens to size an
 * auto-width node. `compositions/fit`'s probe is built that way, for that
 * reason.
 *
 * So this is not a new capability, it is a capability that was already in the
 * box: the core keeps every node's layout rect, and the DevTools tree the
 * host already round-trips carries the ids. This joins the two.
 *
 * It reports where things ARE, not where they will be. That is deliberate.
 * A predictive API invites render-look-adjust, which is the slow loop and the
 * one a machine author is worst at; a reported rect turns an intention into
 * an assertion in `gen.ts`, checked at build time like every other claim
 * here. Dwell minimums and fit widths are already written that way.
 *
 * TWO THINGS TO KNOW ABOUT THE NUMBERS
 *
 * 1. The rect is the border-box world AABB, captured before the opacity cull
 *    (`draw.rs`), so a node that is faded out still reports its box. That is
 *    useful — you can ask where something will be while it is invisible — and
 *    it means a rect is NOT proof that anything is on screen.
 * 2. A `Text` node's rect is the box; the glyphs inside it are laid out by
 *    the run. Child `#text` nodes are absorbed into the parent's glyph run
 *    and have no rect of their own, which is why their text is reported
 *    against the parent.
 *
 * THE OTHER HALF OF (1)
 *
 * A node is in the picture if and only if hiding it at draw time changes a
 * pixel (`debug_hide`, `patches/0007`). That one test covers occluded,
 * opacity 0, off-screen, zero-size, and time-inactive — layout data cannot,
 * because rects are captured before the cull and later shots occupy the same
 * boxes as earlier ones. The printed "not in picture" line is only for
 * nodes the author named or that carry text. Unnamed scaffolding stays in the
 * JSON when `--all` is set. On by default: a report you must know to ask for
 * cannot catch what you do not know.
 *
 * WHAT "NOT IN PICTURE" IS NOT
 *
 * It is not a defect predicate, and this command must not fail on it.
 * Measured across the ledger compositions at five frames each plus the cut
 * and fade boundaries of a composition at film length: **46 of 114 sampled
 * frames hold at least one named-or-text node with a box and no pixel**, in
 * compositions that match the ledger. Three causes, all correct:
 *
 * - The node is outside its visibility window and the fade is animated on the
 *   node itself, so its own rect is captured before its own opacity cull. A
 *   multi-shot composition reports 8-9 such nodes at an ordinary frame.
 * - The frame is a cut boundary: the outgoing shot's tiles still carry boxes
 *   and the incoming shot already covers them.
 * - The node's window has not opened yet at frame 0.
 *
 * Whether an out-of-window node appears here at all depends on where the
 * author put the fade: on the node (rect reported, `inPicture` false) or on a
 * wrapping parent (opacity 0 culls the subtree, children come back rect -1
 * and are skipped entirely). Same intent, two tree levels, two reports.
 *
 * WHICH OF THE THREE, THOUGH
 *
 * The three causes above are now told apart, and not by reading opacity. The
 * same `debug_hide` is applied twice: once against the framebuffer, once
 * against `ui_draw_hash`, which hashes the draw list without rasterising. A
 * node that emitted geometry and contributes no pixel was painted over; a
 * node that emitted none was never going to be seen, because the walk returns
 * above it at `op <= 0.0`. `src/render/visibility.ts` is the predicate and
 * the table.
 *
 * A caption painted over by the next shot for most of its window, while
 * `lint`/`check`/`trace`/`diff` all stay green, is the covered case, and this
 * command now says so in that word at those frames
 * (`compositions/occluded`, `compositions/spanned`). What it still cannot do
 * is notice unless someone runs it on the right frame: `--at` is one frame.
 * `visibility` sweeps.
 */

import { existsSync } from "node:fs";
import {
  active,
  countByCode,
  findingsFor,
  unusedAllowances,
  type Box,
  type Finding,
  type FindingNode,
} from "../../render/findings.ts";
import {
  baseline,
  openProber,
  probe,
  rect,
  type ProbeWorld,
  type Visibility,
} from "../../render/visibility.ts";
import type { LayoutAllowance, SidecarShutter } from "../../manifest/sidecar.ts";
import { describeShutter, hardenedBootWorld } from "../../runtime/boot.ts";
import { UsageError, parseArgs, requirePositional } from "../args.ts";
import { openFootage } from "../footage.ts";
import { errMsg, resolveComposition } from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";

export interface LayoutOptions {
  readonly dir: string;
  readonly at: number;
  /** Include nodes that carry neither text nor a debugName. */
  readonly all: boolean;
  readonly flags: GlobalFlags;
}

/** One node of the DevTools tree (`framework/src/devtools.ts` serializeNode). */
interface TreeNode {
  readonly i: number;
  readonly t: string;
  readonly n?: string;
  readonly c?: string;
  readonly x?: string;
  readonly k?: readonly TreeNode[];
}

export interface LayoutNode {
  readonly id: number;
  readonly kind: string;
  readonly name?: string;
  readonly text?: string;
  readonly class?: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** True iff hiding this node at draw time changes a pixel of the frame. */
  readonly inPicture: boolean;
  /** True iff hiding this node removes at least one word from the draw list.
   *  Absent when the caller asked for rects and `inPicture` only. */
  readonly paints?: boolean;
  /** What the two together say. `covered` is the only defect among them.
   *  Absent for the same reason as `paints` — a field a caller did not measure
   *  is missing rather than guessed. */
  readonly visibility?: Visibility;
  /** Bounding box of the pixels this node contributes, in logical units.
   *  Measured for nodes carrying text when findings were asked for; `null`
   *  when the node contributes none. */
  readonly ink?: { x: number; y: number; w: number; h: number } | null;
  /** The codes this node is in, at this frame. Empty array rather than absent
   *  when findings were computed and there were none — a consumer branching on
   *  `findings.length` should not have to branch on the key first. */
  readonly findings?: readonly Finding[];
}

/**
 * A node the author named or that carries text, which has a box and paints
 * nothing. One definition, used for both the printed line and the JSON count,
 * so the two cannot drift.
 *
 * Read the header before building a check on this: it is a normal state for
 * any node outside its visibility window, not a defect.
 */
export function isNotInPicture(node: LayoutNode): boolean {
  return Boolean(node.name || node.text) && !node.inPicture;
}

/**
 * Flatten the tree, folding each node's direct `#text` children into it.
 *
 * Depth is kept so the printed form can show nesting: an author reading this
 * is usually asking "is this inside that", and indentation answers it without
 * a second lookup.
 */
export function flattenTree(
  root: TreeNode | undefined,
  keepAll: boolean,
): Array<{ node: TreeNode; text?: string; depth: number }> {
  const out: Array<{ node: TreeNode; text?: string; depth: number }> = [];
  const walk = (node: TreeNode | undefined, depth: number): void => {
    if (!node || typeof node.i !== "number") return;
    if (node.t === "#text") return; // folded into the parent below
    const text = (node.k ?? [])
      .filter((kid) => kid.t === "#text" && kid.x)
      .map((kid) => kid.x)
      .join("");
    if (keepAll || text.length > 0 || node.n) out.push({ node, text: text || undefined, depth });
    for (const kid of node.k ?? []) walk(kid, depth + 1);
  };
  walk(root, 0);
  return out;
}

/**
 * The packed rect's two halves.
 *
 * The core packs `x & 0xffff | y << 16` (`engine/core/src/lib.rs`
 * `debug_rect_xy`), so a coordinate is a 16-bit field and a NEGATIVE one comes
 * back as a large positive: a node 100 px off the left edge reads 65436.
 * `signed16` puts the sign back, which is what lets `panel_out_of_canvas` say
 * "past the left" rather than "past the right by 63616". Width and height
 * cannot be negative and stay unsigned.
 */
const lo = (v: number): number => v & 0xffff;
const hi = (v: number): number => (v >> 16) & 0xffff;
const signed16 = (v: number): number => (v & 0x8000 ? v - 0x10000 : v);

/** The world already sitting on frame `at`. Preview reuses this so a scrub
 *  does not boot a second core; `layout` still boots its own. */
export interface LayoutWorld extends ProbeWorld {
  readonly exports: object;
}

export interface InspectOptions {
  /** Include nodes that carry neither text nor a debugName. */
  readonly keepAll: boolean;
  /**
   * Also ask the draw list WHY a dark node is dark, filling `paints` and
   * `visibility`.
   *
   * NOT a performance knob, and it was very nearly documented as one. Turning
   * it on costs an extra `draw()` per node and no rasterisation, which on
   * `reel --at 300` is 1441 ms against 1453 ms with it off — 0.99x over 12
   * alternating runs, lost inside what rasterising 1920×1080 once per node
   * costs anyway. (The +19% a review measured on this branch was real and was
   * something else: sha256 where `inspectLayout` had already moved to `fast`.
   * Both comparisons are `fast` now.)
   *
   * What it is instead is scope. `preview`'s overlay does not read
   * `visibility`, and a field the caller did not ask for should not appear in
   * what it serves — someone reading one there would be reading a claim this
   * path has never made. `layout` and `visibility` ask; the overlay does not.
   */
  readonly classify: boolean;
  /**
   * Also compute `src/render/findings.ts` codes for this frame.
   *
   * Absent means the caller wanted rects and visibility — the overlay's case.
   * Present, it costs: rects for the ancestors of every kept node (so a
   * container has a box to be compared against) and one framebuffer compare
   * per node carrying text (the ink box, out of the render the probe already
   * did). It requires `classify`, because two of the codes ARE the
   * classification renamed.
   */
  readonly findings?: FindingScope;
}

export interface FindingScope {
  readonly viewport: Box;
  readonly allow: readonly LayoutAllowance[];
  /** Physical framebuffer width, and the density it was rendered at, so an
   *  ink box comes back in the units the rects are in. */
  readonly physicalWidth: number;
  readonly density: number;
}

/** The one field the container pass fills in after the records exist. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Parent links and document order for the whole tree, rects aside. */
interface TreeIndex {
  readonly order: readonly number[];
  readonly parentOf: ReadonlyMap<number, number | null>;
  readonly nodeOf: ReadonlyMap<number, TreeNode>;
}

function indexTree(root: TreeNode | undefined): TreeIndex {
  const order: number[] = [];
  const parentOf = new Map<number, number | null>();
  const nodeOf = new Map<number, TreeNode>();
  const walk = (node: TreeNode | undefined, parent: number | null): void => {
    if (!node || typeof node.i !== "number") return;
    if (node.t === "#text") return;
    order.push(node.i);
    parentOf.set(node.i, parent);
    nodeOf.set(node.i, node);
    for (const kid of node.k ?? []) walk(kid, node.i);
  };
  walk(root, null);
  return { order, parentOf, nodeOf };
}

/**
 * Rects, `inPicture`, and optionally why, for every kept node. The world must
 * already be on the target frame (footage presented). Clears the inspector and
 * hide latches before returning so the next `render()` is the film, not a
 * leftover overlay.
 *
 * BOTH COMPARISONS ARE CHEAP ON PURPOSE.
 *
 * The frame hash is `"fast"`. This is not an archival digest — `inPicture` is
 * a bool that never hits disk — and sha256 here was hashing the whole
 * framebuffer once per node (414 nodes × 8.3 MB at reel frame 600).
 *
 * `classify` adds `ui_draw_hash`, which hashes the draw list WITHOUT
 * rasterising, so the second question costs a walk rather than a walk plus a
 * raster. `src/render/visibility.ts` holds what the pair means.
 */
export function inspectLayout(
  world: LayoutWorld,
  tree: unknown,
  options: InspectOptions,
): {
  nodes: LayoutNode[];
  notInPicture: number;
  covered: number;
  findings: Finding[];
  unusedAllow: readonly LayoutAllowance[];
} {
  const scope = options.findings;
  if (scope && !options.classify) {
    throw new Error(
      "inspectLayout: findings need `classify` — two of the codes ARE the " +
        "covered / declared-invisible classification under other names",
    );
  }
  const prober = openProber(world, { classify: options.classify });

  const base = baseline(prober, scope !== undefined);
  const index = indexTree(tree as TreeNode | undefined);
  const kept = flattenTree(tree as TreeNode | undefined, options.keepAll);

  // Which nodes need a rect. Without findings that is the kept set. With them
  // it also holds every ancestor of a kept node, because `escaped_container`
  // compares against a box and a parent nobody kept has none.
  const wanted = new Set<number>(kept.map((k) => k.node.i));
  if (scope) {
    for (const id of [...wanted]) {
      for (let up = index.parentOf.get(id) ?? null; up !== null; up = index.parentOf.get(up) ?? null) {
        wanted.add(up);
      }
    }
  }

  const boxes = new Map<number, Box>();
  for (const id of index.order) {
    if (!wanted.has(id)) continue;
    const { xy, wh } = rect(prober, id);
    if (xy === -1) continue; // not a painted node (or culled by display:none)
    boxes.set(id, { x: signed16(lo(xy)), y: signed16(hi(xy)), w: lo(wh), h: hi(wh) });
  }

  const nodes: LayoutNode[] = [];
  for (const { node, text } of kept) {
    const box = boxes.get(node.i);
    if (box === undefined) continue;

    // Ink is measured for nodes carrying text and nothing else: the two codes
    // that read it are both about a glyph run against its box.
    const wantInk = scope !== undefined && Boolean(text);
    const seen = probe(
      prober,
      node.i,
      base,
      wantInk ? { width: scope!.physicalWidth, density: scope!.density } : undefined,
    );
    nodes.push({
      id: node.i,
      kind: node.t,
      ...(node.n ? { name: node.n } : {}),
      ...(text ? { text } : {}),
      ...(node.c ? { class: node.c } : {}),
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      inPicture: seen.inPicture,
      ...(seen.visibility === undefined
        ? {}
        : { paints: seen.paints, visibility: seen.visibility }),
      ...(seen.ink === undefined ? {} : { ink: seen.ink }),
    });
  }
  baseline(prober); // leave every latch clear

  let findings: Finding[] = [];
  let unusedAllow: readonly LayoutAllowance[] = [];
  if (scope) {
    // One record per node that HAS a box — the kept ones plus their ancestors.
    // A parent culled to rect -1 is not a container: nothing was laid out for
    // it to hold anything inside, so the chain skips it and the next box up
    // becomes the container. An ancestor nobody kept carries neither a name
    // nor text, so it is never itself reported; it is here to be compared
    // against and to be walked past by the ancestor test.
    const records = new Map<number, Mutable<FindingNode>>();
    const measured = new Map(nodes.map((n) => [n.id, n]));
    for (const [id, box] of boxes) {
      const n = measured.get(id);
      const raw = index.nodeOf.get(id);
      records.set(id, {
        id,
        ...(raw?.n ? { name: raw.n } : {}),
        ...(n?.text ? { text: n.text } : {}),
        box,
        inPicture: n?.inPicture ?? false,
        ...(n?.visibility ? { visibility: n.visibility } : {}),
        ...(n === undefined || n.ink === undefined ? {} : { ink: n.ink }),
        container: null,
      });
    }
    for (const [id, record] of records) {
      for (let up = index.parentOf.get(id) ?? null; up !== null; up = index.parentOf.get(up) ?? null) {
        const container = records.get(up);
        if (container) {
          record.container = container;
          break;
        }
      }
    }
    findings = findingsFor({
      nodes: [...records.values()],
      viewport: scope.viewport,
      allow: scope.allow,
    });
    unusedAllow = unusedAllowances(findings, scope.allow);
    const byNode = new Map<number, Finding[]>();
    for (const f of findings) {
      const list = byNode.get(f.id) ?? [];
      list.push(f);
      byNode.set(f.id, list);
    }
    for (let i = 0; i < nodes.length; i++) {
      nodes[i] = { ...nodes[i]!, findings: byNode.get(nodes[i]!.id) ?? [] };
    }
  }

  return {
    nodes,
    notInPicture: nodes.filter(isNotInPicture).length,
    covered: nodes.filter((n) => n.visibility === "covered").length,
    findings,
    unusedAllow,
  };
}

/**
 * What a declared shutter changes about a reading, in the words every
 * inspecting command prints. Nothing when there is none.
 */
export function shutterLines(shutter: SidecarShutter | null): string[] {
  if (!shutter) return [];
  return [
    `Shutter ${describeShutter(shutter)}: in-picture and covered are read from the`,
    "exposure, every sample re-rendered with the node hidden; rects and ink",
    "boxes are the frame's own tick, the centre of the exposure.",
  ];
}

export async function run(options: LayoutOptions): Promise<CommandResult> {
  const resolved = await resolveComposition({
    dir: options.dir,
    flags: options.flags,
    requireBundle: true,
  });
  if (!resolved.ok) {
    if (resolved.kind === "usage") throw new UsageError(resolved.message);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: "invalid pocket-motion.json", diagnostics: resolved.diagnostics },
      stderrLines: (resolved.diagnostics ?? []).map(
        (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
      ),
    };
  }
  const c = resolved.value;
  if (!Number.isInteger(options.at) || options.at < 0 || options.at >= c.durationFrames) {
    throw new UsageError(`--at ${options.at} is out of range [0, ${c.durationFrames})`);
  }

  let footage: Awaited<ReturnType<typeof openFootage>> = null;
  try {
    const world = await hardenedBootWorld({
      bundlePath: c.bundlePath,
      pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
      width: c.width,
      height: c.height,
      hz: c.fps,
      renderScale: c.supersample,
      shutter: c.shutter,
      buildCommand: c.buildCommand,
    });

    // `getTree` is a round trip through the guest — it pushes a request, runs
    // ONE frame turn and reads the reply — so it consumes the mount frame and
    // leaves the world at frame 0. Advancing `at` more turns lands on frame
    // `at`; the first version of this command ran `at + 1` of them from here
    // and reported the next frame's layout as this one's.
    const tree = world.getTree() as TreeNode | undefined;
    // The argument is a BUTTON BITMASK, not a frame index (`boot.ts`:
    // `frame: (buttons: number) => void`). The first version passed the loop
    // counter, which held a different fistful of buttons down on every frame.
    // A composition that reads input is not this repository's case, but a
    // wrong number that happens not to matter is still a wrong number.
    for (let f = 1; f <= options.at; f++) {
      world.frame(0);
      for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
    }

    // Footage is bound after getTree, on this same world. getTree has already
    // consumed the mount frame and left us at frame 0; we then advanced `at`
    // turns. present(at) swaps the live tiles onto that state. (The
    // scratchTree rule in footage.ts is for WasmFrameSource.seekFrame, which
    // this command does not use.)
    footage =
      c.sidecar.footage.length > 0 ? await openFootage(c, world, tree) : null;
    footage?.present(options.at);

    const {
      nodes,
      notInPicture: missingFromPicture,
      covered,
      findings,
      unusedAllow,
    } = inspectLayout(world, tree, {
      keepAll: options.all,
      classify: true,
      findings: {
        viewport: { x: 0, y: 0, w: c.width, h: c.height },
        allow: c.sidecar.layoutAllow,
        physicalWidth: world.physicalWidth,
        density: c.supersample,
      },
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const printable: string[] = [];
    for (const { node, depth } of flattenTree(tree, options.all)) {
      const entry = byId.get(node.i);
      if (!entry) continue;
      const dark = isNotInPicture(entry);
      const label = entry.name ?? entry.text ?? entry.kind;
      const px = /text-\[(\d+)px\]/.exec(node.c ?? "")?.[1];
      const codes = active(entry.findings ?? []).map((f) => f.code);
      printable.push(
        `${" ".repeat(depth)}${label.slice(0, 28).padEnd(28 - depth)} ` +
          `${String(entry.x).padStart(5)},${String(entry.y).padEnd(5)} ` +
          `${String(entry.w).padStart(5)}x${String(entry.h).padEnd(5)}` +
          (px ? `  ${px}px` : "") +
          (dark ? `  laid out, not in picture — ${entry.visibility}` : "") +
          (codes.length > 0 ? `  ${[...new Set(codes)].join(" ")}` : ""),
      );
    }

    return {
      exitCode: EXIT_OK,
      json: {
        ok: true,
        frame: options.at,
        viewport: [c.width, c.height],
        // The same count the header line prints. It was computed and then
        // dropped, so a `--json` consumer had to walk `nodes` and re-derive
        // the one number the command had already worked out — and nothing
        // that reads this command programmatically could see the verdict at
        // all. NOT a failure: a node outside its visibility window reports a
        // box and no pixel, which is correct, and 46 of 114 sampled frames
        // across the 21 ledger compositions are in that state. `covered`
        // below is the subset of them that is.
        notInPicture: missingFromPicture,
        // Of those, the ones something painted over. NOT the same number and
        // not the same claim: `notInPicture` counts declared-invisible nodes
        // too, and only this one is a defect. `visibility` sweeps it over a
        // whole film; this is one frame.
        covered,
        // Every code this frame is in, whether or not the sidecar excuses it —
        // a suppressed reading that vanished would be a reading nobody could
        // audit. `allowedBy` carries the sentence that excused one.
        findings,
        // Only the ones nothing excuses, by code. This is what `verify
        // --strict` counts.
        findingCounts: countByCode(findings),
        // `layoutAllow` entries that excused nothing HERE. One frame is not
        // evidence that an allowance is dead, which is why this is reported and
        // not failed on.
        unusedAllow,
        // Present when the sidecar declares one. `inPicture` and `paints`
        // then read the exposure; rects and ink read the frame's own tick
        // (`src/render/visibility.ts`, "UNDER A SHUTTER").
        ...(c.shutter ? { shutter: c.shutter } : {}),
        nodes,
      },
      stdoutLines: [
        `layout at frame ${options.at} — ${nodes.length} node(s), viewport ${c.width}×${c.height}` +
          (missingFromPicture > 0
            ? ` — ${missingFromPicture} named/text node(s) have a box and contribute nothing` +
              (covered > 0 ? `, ${covered} of them covered` : "")
            : ""),
        ...printable,
        "",
        ...findingLines(findings, unusedAllow),
        "Rects are border-box world AABBs, captured before the opacity cull:",
        "a faded-out node still reports its box.",
        "A node is in the picture only if hiding it changes a pixel; it is",
        "covered when it emitted geometry and none of that survived.",
        "Findings are reported, never failed on: `verify --strict` is what",
        "turns one into an exit code, and `layoutAllow` is what turns one off.",
        ...shutterLines(c.shutter),
      ],
    };
  } catch (e) {
    const message = errMsg(e);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: message },
      stderrLines: [message],
      stdoutLines: [`layout failed — ${message}`],
    };
  } finally {
    await footage?.close();
  }
}

/** The findings block of the human report: one line per finding, then the
 *  allowances that excused something and the ones that excused nothing. */
export function findingLines(
  findings: readonly Finding[],
  unusedAllow: readonly LayoutAllowance[],
): string[] {
  const live = active(findings);
  const excused = findings.filter((f) => f.allowedBy !== undefined);
  const lines: string[] = [];
  if (live.length > 0) {
    lines.push(`${live.length} finding(s):`);
    for (const f of live) {
      lines.push(`  ${f.code.padEnd(20)} ${f.name ?? `#${f.id}`} — ${f.detail}`);
    }
    lines.push("");
  }
  if (excused.length > 0) {
    lines.push(`${excused.length} finding(s) excused by layoutAllow:`);
    for (const f of excused) {
      lines.push(`  ${f.code.padEnd(20)} ${f.name ?? `#${f.id}`} — ${f.allowedBy}`);
    }
    lines.push("");
  }
  if (unusedAllow.length > 0) {
    lines.push(
      `${unusedAllow.length} layoutAllow entr(y/ies) excused nothing at this frame:`,
      ...unusedAllow.map((a) => `  ${a.node} ${a.allow}`),
      "",
    );
  }
  return lines;
}

export async function runFromArgv(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseArgs(["layout", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  const at = parsed.flags.at;
  if (at === undefined) throw new UsageError("layout needs --at <frame>");
  return run({
    dir,
    at: Number(at),
    all: parsed.flags.all === true,
    flags: parsed.global,
  });
}
