#!/usr/bin/env bun
/**
 * One row, one process: fit, stage, build, identity, render, check.
 *
 * A process per variant rather than a loop in one process, for two reasons
 * that are both measurements. The parent reads this process's rusage when it
 * exits, which on darwin and Linux includes the build it spawned and waited
 * for — so CPU time and peak RSS are per variant without sampling. And a
 * variant that throws or runs out of memory takes itself down, not the batch.
 *
 * The gates are the repository's own commands called in process — `verify`'s
 * `run()`, whose sections are each sub-command's JSON verbatim — not a sweep
 * written here. This file decides only which of their findings fail a
 * variant (`GATED`), and says so in the JSON.
 *
 *   bun scripts/batch-qa/variant.ts --rows <rows.jsonl> --id r0001 --charset <file> --out <dir>
 *       [--encode] [--evidence] [--exhaustive] [--layout-at 0,22,45,67,89] [--keep]
 *       [--stage-prefix bqa]
 *
 * Writes one JSON object to stdout and nothing else there.
 */

import { existsSync, mkdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { computeIdentity, sidecarCanonicalOf } from "../../src/render/identity.ts";
import { render as renderComposition } from "../../src/render/render.ts";
import { runBuild } from "../../src/cli/build.ts";
import { errMsg, resolveComposition, type ResolvedComposition } from "../../src/cli/resolve.ts";
import type { GlobalFlags } from "../../src/cli/types.ts";
import * as assertCmd from "../../src/cli/commands/assert.ts";
import * as snapshotCmd from "../../src/cli/commands/snapshot.ts";
import * as verifyCmd from "../../src/cli/commands/verify.ts";
import * as visibilityCmd from "../../src/cli/commands/visibility.ts";
import { openMeasurer } from "../../src/text/measure.ts";
import type { Row } from "./rows.ts";
import {
  DURATION_FRAMES,
  GlyphRefusal,
  LAST_FRAME,
  SIZES,
  clean,
  facePaths,
  fit,
  sourceKey,
  stagedFiles,
  type Fitted,
} from "./template.ts";

const ROOT = resolve(import.meta.dir, "../..");

/**
 * Layout codes that fail a variant. `text_not_painted` is not one of them: it
 * is every node at frame 0 of a card whose fields fade in, and whether the
 * disclaimer is on screen long enough is what the sidecar's assertions ask.
 */
export const GATED = new Set([
  "text_box_overflow",
  "clipped_text",
  "panel_out_of_canvas",
  "content_overlap",
  "escaped_container",
  "text_occluded",
]);

/** verify's sections whose own verdict fails a variant. */
const SECTIONS = ["lint", "realm", "keyframes", "visibility", "assertions"] as const;

interface Finding {
  readonly code: string;
  readonly name?: string;
  readonly detail: string;
  readonly allowedBy?: string;
}

interface LayoutJson {
  readonly ok: boolean;
  readonly frame: number;
  readonly findings?: readonly Finding[];
  readonly error?: string;
}

interface Verdict {
  readonly verdict: "pass" | "fail";
  /** Sorted, unique: gated layout codes as `code:node`, and failing sections. */
  readonly codes: readonly string[];
  /** Every active gated finding, with the frame it was read at. */
  readonly findings: readonly { frame: number; code: string; node?: string; detail: string }[];
  readonly assertions: readonly { node: string; predicate: string; ok: boolean; detail: string }[];
  /** Codes reported and deliberately not gated, with how often. */
  readonly ungated: Readonly<Record<string, number>>;
  readonly sectionErrors: readonly string[];
}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`variant: ${name} needs a value`);
  return v;
}

const ms = (t0: number): number => Math.round((Bun.nanoseconds() - t0) / 1e4) / 100;
const cpuMs = (u: NodeJS.CpuUsage): number => Math.round((u.user + u.system) / 100) / 10;

/**
 * Reduce verify's envelope to a verdict. `layoutOverride`, `visibilityOverride`
 * and `assertOverride` replace those sections — the exhaustive pass runs the
 * same commands over every frame and is judged by the same rule.
 */
export function judge(
  envelope: Record<string, unknown>,
  overrides: { visibility?: unknown; assertions?: unknown } = {},
): Verdict {
  const codes = new Set<string>();
  const findings: Array<{ frame: number; code: string; node?: string; detail: string }> = [];
  const ungated: Record<string, number> = {};
  const sectionErrors: string[] = [];

  const section = (name: (typeof SECTIONS)[number]): unknown =>
    name === "visibility" && overrides.visibility !== undefined
      ? overrides.visibility
      : name === "assertions" && overrides.assertions !== undefined
        ? overrides.assertions
        : envelope[name];
  for (const name of SECTIONS) {
    const json = section(name) as { ok?: boolean; error?: string; failures?: unknown[] } | undefined;
    if (json?.ok !== true) {
      sectionErrors.push(name);
      if (name === "visibility") {
        for (const f of json?.failures ?? []) codes.add(`visibility:${String(f)}`);
      } else if (name !== "assertions") {
        codes.add(`${name}${json?.error ? `:${json.error.split("\n")[0]}` : ""}`);
      }
    }
  }

  for (const layout of (envelope.layout ?? []) as LayoutJson[]) {
    if (layout?.ok !== true) {
      codes.add(`layout:${layout?.error?.split("\n")[0] ?? "failed"}`);
      continue;
    }
    for (const f of layout.findings ?? []) {
      if (f.allowedBy !== undefined) continue;
      if (!GATED.has(f.code)) {
        ungated[f.code] = (ungated[f.code] ?? 0) + 1;
        continue;
      }
      codes.add(`${f.code}:${f.name ?? "?"}`);
      findings.push({ frame: layout.frame, code: f.code, ...(f.name ? { node: f.name } : {}), detail: f.detail });
    }
  }

  const a = section("assertions") as
    | { assertions?: Array<{ node: string; predicate: string; ok: boolean; detail: string }> }
    | undefined;
  const assertions = (a?.assertions ?? []).map((v) => ({
    node: v.node,
    predicate: v.predicate,
    ok: v.ok,
    detail: v.detail,
  }));
  for (const v of assertions) if (!v.ok) codes.add(`assert:${v.node}.${v.predicate}`);

  return {
    verdict: codes.size === 0 ? "pass" : "fail",
    codes: [...codes].sort(),
    findings,
    assertions,
    ungated,
    sectionErrors,
  };
}

async function lock(path: string): Promise<() => Promise<void>> {
  // mkdir is atomic: two variants whose sources are byte-equal stage into one
  // directory, and the second waits for the first rather than building over it.
  for (let i = 0; ; i++) {
    try {
      mkdirSync(path);
      return () => rm(path, { recursive: true, force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (i > 6000) throw new Error(`variant: ${path} held for 10 minutes`);
      await Bun.sleep(100);
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const rowsPath = arg(argv, "--rows");
  const id = arg(argv, "--id");
  const charsetPath = arg(argv, "--charset");
  const out = arg(argv, "--out");
  if (!rowsPath || !id || !charsetPath || !out) {
    throw new Error("variant: --rows, --id, --charset and --out are required");
  }
  const encode = argv.includes("--encode");
  const evidence = argv.includes("--evidence");
  const exhaustive = argv.includes("--exhaustive");
  const keep = argv.includes("--keep");
  const prefix = arg(argv, "--stage-prefix") ?? "bqa";
  const layoutAt = (arg(argv, "--layout-at") ?? "")
    .split(",")
    .filter((s) => s.length > 0)
    .map(Number);

  const tStart = Bun.nanoseconds();
  const cpuStart = process.cpuUsage();
  const timings: Record<string, number> = {};
  const cpu: Record<string, number> = {};
  const step = async <T>(name: string, f: () => Promise<T> | T): Promise<T> => {
    const t0 = Bun.nanoseconds();
    const c0 = process.cpuUsage();
    try {
      return await f();
    } finally {
      timings[name] = ms(t0);
      cpu[name] = cpuMs(process.cpuUsage(c0));
    }
  };
  let rssPeak = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
  }, 25);

  const rows = (await Bun.file(rowsPath).text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`variant: no row ${id} in ${rowsPath}`);
  const charset = await Bun.file(charsetPath).text();
  const base = { id: row.id, category: row.category, ...(row.copyOf ? { copyOf: row.copyOf } : {}) };
  const emit = (o: Record<string, unknown>): void => {
    clearInterval(sampler);
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    process.stdout.write(
      JSON.stringify({
        ...base,
        ...o,
        timings: { ...timings, total: ms(tStart) },
        selfCpuMs: { ...cpu, total: cpuMs(process.cpuUsage(cpuStart)) },
        selfRssPeakBytes: rssPeak,
      }) + "\n",
    );
  };

  // 1. Fit. A codepoint the face does not carry is a refusal here, before any
  //    build: the measurer would otherwise measure the tofu cell.
  let fitted: Fitted;
  try {
    fitted = await step("fit", async () => {
      const fields = [row.name, row.price, row.claim, row.disclaimer].map(clean);
      const m = await openMeasurer({ face: facePaths(ROOT), sizes: SIZES, texts: fields, cache: { charset } });
      try {
        return fit(row, m);
      } finally {
        await m.close();
      }
    });
  } catch (e) {
    if (e instanceof GlyphRefusal) {
      emit({ verdict: "refused", stage: "fit", field: e.field, reason: e.message, missing: e.missing });
      return;
    }
    throw e;
  }

  // 2. Stage under a directory named by the sources, so equal sources build
  //    at one path and an identity can be compared across rows at all.
  const files = stagedFiles(fitted);
  const key = sourceKey(files);
  const dir = join(ROOT, "dist", `${prefix}-${key.slice(0, 16)}`);
  const release = await lock(`${dir}.lock`);
  try {
    await step("stage", async () => {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
    });

    const flags: GlobalFlags = {
      json: true,
      bundle: join(dir, "dist", "main.js"),
      pak: join(dir, "dist", "main.pak"),
    };
    const resolveIt = async (requireBundle: boolean): Promise<ResolvedComposition> => {
      const r = await resolveComposition({ dir, flags, requireBundle });
      if (!r.ok) throw new Error(`variant: ${r.message}${r.diagnostics ? `\n${JSON.stringify(r.diagnostics)}` : ""}`);
      return r.value;
    };

    // 3. Build. A build failure is a verdict about the variant, not a crash.
    try {
      await step("build", async () => runBuild(await resolveIt(false)));
    } catch (e) {
      emit({ verdict: "refused", stage: "build", reason: errMsg(e).split("\n").slice(0, 6).join("\n"), sourceKey: key, fit: summary(fitted) });
      return;
    }
    const c = await resolveIt(true);
    const sizes = {
      bundleBytes: Bun.file(c.bundlePath).size,
      pakBytes: existsSync(c.pakPath) ? Bun.file(c.pakPath).size : 0,
    };

    // 4. Identity, exactly as `trace` computes it.
    const identity = await step("identity", () =>
      computeIdentity({
        bundlePath: c.bundlePath,
        pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
        sidecarCanonical: sidecarCanonicalOf(c.sidecar),
        fontPaths: c.fontPaths ? [c.fontPaths.regular, c.fontPaths.bold] : undefined,
        faceFontPaths: c.fontPaths?.faces,
        width: c.width,
        height: c.height,
        fps: c.fps,
        durationFrames: c.durationFrames,
        renderScale: c.supersample,
        rasterDensity: 1,
        buildRecord: c.buildRecord!,
      }),
    );

    // 5. Render every frame and hash it; encode only when asked.
    const videoPath = encode ? join(out, "video", `${row.id}.mp4`) : undefined;
    if (videoPath) mkdirSync(join(out, "video"), { recursive: true });
    const rendered = await step(encode ? "renderEncode" : "render", () =>
      renderComposition({
        compositionId: c.compositionId,
        bundlePath: c.bundlePath,
        pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
        width: c.width,
        height: c.height,
        hz: c.fps,
        durationFrames: c.durationFrames,
        renderScale: c.supersample,
        shutter: c.shutter,
        buildCommand: c.buildCommand,
        ...(videoPath ? { outputPath: videoPath, format: "mp4" as const } : {}),
      }),
    );

    // 6. Every gate, through `verify`. Layout frames are named, never inherited.
    const at = layoutAt.length > 0 ? layoutAt : undefined;
    const envelope = await step("qa", async () =>
      (await verifyCmd.run({ dir, ...(at ? { at } : {}), strict: false, flags })).json as Record<string, unknown>,
    );
    const verdict = judge(envelope);

    // 7. Optionally the same gates at every frame, for the sampling decision.
    let exhaustiveVerdict: Verdict | undefined;
    if (exhaustive) {
      exhaustiveVerdict = await step("qaExhaustive", async () => {
        const every = Array.from({ length: DURATION_FRAMES }, (_, i) => i);
        const env = (await verifyCmd.run({ dir, at: every, strict: false, flags })).json as Record<string, unknown>;
        const visibility = (await visibilityCmd.run({ dir, all: false, samples: DURATION_FRAMES, flags })).json;
        const assertions = (await assertCmd.run({ dir, samples: DURATION_FRAMES, flags })).json;
        return judge(env, { visibility, assertions });
      });
    }

    // 8. Evidence: the LAST frame a gated finding was read at, annotated.
    //    Not the first: a box exists before its node fades in, so a
    //    box-based code is read at frame 0, where the picture is empty.
    let evidencePaths: string[] | undefined;
    if (evidence && verdict.verdict === "fail") {
      const frame = Math.max(-1, ...verdict.findings.map((f) => f.frame));
      const dest = join(out, "evidence", row.id);
      const snap = await step("evidence", async () =>
        (await snapshotCmd.run({ dir, out: dest, at: [frame < 0 ? LAST_FRAME : frame], annotate: true, flags }))
          .json as { files?: Array<Record<string, unknown>> },
      );
      evidencePaths = (snap.files ?? []).flatMap((f) =>
        Object.values(f).filter((v): v is string => typeof v === "string" && v.endsWith(".png")),
      );
    }

    emit({
      verdict: verdict.verdict,
      codes: verdict.codes,
      findings: verdict.findings,
      assertions: verdict.assertions,
      ungated: verdict.ungated,
      layoutFrames: envelope.layoutFrames,
      ...(exhaustiveVerdict
        ? {
            exhaustive: {
              verdict: exhaustiveVerdict.verdict,
              codes: exhaustiveVerdict.codes,
              findings: exhaustiveVerdict.findings,
              assertions: exhaustiveVerdict.assertions,
            },
          }
        : {}),
      fit: summary(fitted),
      sourceKey: key,
      stagedAt: `dist/${prefix}-${key.slice(0, 16)}`,
      identity,
      frameDigest: rendered.digest,
      msPerFrame: rendered.msPerFrame,
      ...sizes,
      ...(videoPath ? { video: videoPath, videoBytes: Bun.file(videoPath).size } : {}),
      ...(evidencePaths ? { evidence: evidencePaths } : {}),
    });
  } finally {
    if (!keep) await rm(dir, { recursive: true, force: true });
    await release();
  }
}

function summary(f: Fitted): Record<string, unknown> {
  const one = (x: Fitted["name"]) => ({ px: x.px, lines: x.lines, overflows: x.overflows, brokenWords: x.brokenWords });
  return {
    name: one(f.name),
    claim: one(f.claim),
    price: one(f.price),
    disclaimer: one(f.disclaimer),
    predicted: f.predicted,
  };
}

if (import.meta.main) {
  try {
    await main();
  } catch (e) {
    process.stdout.write(JSON.stringify({ verdict: "error", error: errMsg(e) }) + "\n");
    process.exitCode = 1;
  }
}
