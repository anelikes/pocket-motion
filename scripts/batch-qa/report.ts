#!/usr/bin/env bun
/**
 * Read a batch-QA run's `results.jsonl` and `run.json` and say what they hold:
 * verdicts, codes, what the generator predicted against what the pixels
 * showed, what deduplicates and under which key, and what each stage cost.
 *
 *   bun scripts/batch-qa/report.ts dist/batch-qa/run
 *
 * Writes `summary.json` beside the results and prints the same numbers.
 * Every number here is computed from those two files; nothing is re-run.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { LAST_FRAME, clean } from "./template.ts";

interface Result {
  id: string;
  category: string;
  copyOf?: string;
  verdict: "pass" | "fail" | "refused" | "error";
  stage?: string;
  field?: string;
  reason?: string;
  missing?: string[];
  error?: string;
  codes?: string[];
  findings?: Array<{ frame: number; code: string; node?: string; detail: string }>;
  assertions?: Array<{ node: string; predicate: string; ok: boolean; detail: string }>;
  ungated?: Record<string, number>;
  exhaustive?: { verdict: string; codes: string[]; findings: Result["findings"]; assertions: Result["assertions"] };
  fit?: { predicted: string[] } & Record<string, { px: number; lines: number; overflows: boolean }>;
  sourceKey?: string;
  identity?: { digest: string; components: Record<string, string> };
  frameDigest?: string;
  msPerFrame?: number;
  bundleBytes?: number;
  pakBytes?: number;
  videoBytes?: number;
  timings: Record<string, number>;
  selfCpuMs: Record<string, number>;
  selfRssPeakBytes?: number;
  process: { wallMs: number; cpuUserMs: number | null; cpuSystemMs: number | null; maxRssBytes: number | null };
  /** Which run wrote this line; absent on lines from a run stopped before it recorded one. */
  segment?: number;
}

const q = (xs: readonly number[], p: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
};
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const dist = (xs: readonly number[]) => ({
  n: xs.length,
  mean: round(mean(xs)),
  p50: round(q(xs, 0.5)),
  p90: round(q(xs, 0.9)),
  max: round(q(xs, 1)),
});
const round = (x: number): number => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x);
const tally = <T extends string>(xs: readonly T[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
};
const family = (code: string): string => code.split(":")[0]!.split(".")[0]!;

export async function report(dir: string): Promise<Record<string, unknown>> {
  const results = (await Bun.file(join(dir, "results.jsonl")).text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Result);
  // Absent while a segment is still running, or when one was stopped.
  const run = existsSync(join(dir, "run.json"))
    ? ((await Bun.file(join(dir, "run.json")).json()) as Record<string, unknown>)
    : {};
  const rows = new Map(
    (await Bun.file(join(dir, "rows.jsonl")).text())
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { id: string; name: string; price: string; claim: string; disclaimer: string })
      .map((r) => [r.id, r]),
  );

  const rendered = results.filter((r) => r.verdict === "pass" || r.verdict === "fail");
  const failed = results.filter((r) => r.verdict === "fail");

  // --- verdicts ----------------------------------------------------------
  const verdicts = tally(results.map((r) => r.verdict));
  const byCategory: Record<string, Record<string, number>> = {};
  for (const r of results) {
    byCategory[r.category] ??= {};
    byCategory[r.category]![r.verdict] = (byCategory[r.category]![r.verdict] ?? 0) + 1;
  }
  const refusals = tally(
    results
      .filter((r) => r.verdict === "refused")
      .map((r) => `${r.stage}:${r.field ?? ""}:${(r.missing ?? []).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`).sort().join(" ")}`),
  );
  const refusedCodepoints = tally(
    results.filter((r) => r.verdict === "refused").flatMap((r) => [...new Set(r.missing ?? [])].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} ${c}`)),
  );

  // --- codes -------------------------------------------------------------
  const variantsPerFamily = tally(failed.flatMap((r) => [...new Set((r.codes ?? []).map(family))]));
  const variantsPerCode = tally(failed.flatMap((r) => r.codes ?? []));
  const failingAssertions = tally(
    rendered.flatMap((r) => (r.assertions ?? []).filter((a) => !a.ok).map((a) => `${a.node}.${a.predicate}`)),
  );
  const onlyBy: Record<string, number> = {};
  for (const r of failed) {
    const fams = [...new Set((r.codes ?? []).map(family))];
    if (fams.length === 1) onlyBy[fams[0]!] = (onlyBy[fams[0]!] ?? 0) + 1;
  }

  // --- the generator's own prediction against the pixels -------------------
  const predictedFail = (r: Result): boolean => (r.fit?.predicted ?? []).length > 0;
  const confusion = {
    predictedFail_pixelFail: rendered.filter((r) => predictedFail(r) && r.verdict === "fail").length,
    predictedFail_pixelPass: rendered.filter((r) => predictedFail(r) && r.verdict === "pass").length,
    predictedPass_pixelFail: rendered.filter((r) => !predictedFail(r) && r.verdict === "fail").length,
    predictedPass_pixelPass: rendered.filter((r) => !predictedFail(r) && r.verdict === "pass").length,
  };
  const pixelOnly = rendered
    .filter((r) => !predictedFail(r) && r.verdict === "fail")
    .map((r) => ({ id: r.id, category: r.category, codes: r.codes }));
  const predictedOnly = rendered
    .filter((r) => predictedFail(r) && r.verdict === "pass")
    .map((r) => ({ id: r.id, category: r.category, predicted: r.fit?.predicted }));

  // --- deduplication -----------------------------------------------------
  const groupBy = (key: (r: Result) => string | undefined, pool: readonly Result[]) => {
    const m = new Map<string, Result[]>();
    for (const r of pool) {
      const k = key(r);
      if (k === undefined) continue;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  };
  const rawKey = (r: Result): string | undefined => {
    const row = rows.get(r.id);
    return row ? JSON.stringify([row.name, row.price, row.claim, row.disclaimer]) : undefined;
  };
  const cleanKey = (r: Result): string | undefined => {
    const row = rows.get(r.id);
    return row ? JSON.stringify([row.name, row.price, row.claim, row.disclaimer].map(clean)) : undefined;
  };
  const byRaw = groupBy(rawKey, results);
  const byClean = groupBy(cleanKey, results);
  const bySource = groupBy((r) => r.sourceKey, rendered);
  const byIdentity = groupBy((r) => r.identity?.digest, rendered);
  const byFrames = groupBy((r) => r.frameDigest, rendered);
  const inconsistent = [...byIdentity.values()].filter(
    (g) => new Set(g.map((r) => r.frameDigest)).size > 1 || new Set(g.map((r) => `${r.verdict} ${(r.codes ?? []).join(",")}`)).size > 1,
  );
  const sourceVsIdentity = [...bySource.values()].filter((g) => new Set(g.map((r) => r.identity?.digest)).size > 1);
  const redundant = [...byIdentity.values()].flatMap((g) => g.slice(1));
  const cpuOf = (r: Result): number => (r.process.cpuUserMs ?? 0) + (r.process.cpuSystemMs ?? 0);
  const dedupe = {
    rows: results.length,
    distinctRawContent: byRaw.size,
    distinctAfterClean: byClean.size,
    renderedVariants: rendered.length,
    distinctSources: bySource.size,
    distinctIdentities: byIdentity.size,
    distinctFrameDigests: byFrames.size,
    identityGroupsWithMoreThanOneMember: [...byIdentity.values()].filter((g) => g.length > 1).length,
    identityGroupsWhoseFramesOrVerdictDisagree: inconsistent.length,
    sourceGroupsWithMoreThanOneIdentity: sourceVsIdentity.length,
    redundantVariants: redundant.length,
    redundantCpuSeconds: round(redundant.reduce((s, r) => s + cpuOf(r), 0) / 1000),
    redundantRenderAndQaCpuSeconds: round(
      redundant.reduce((s, r) => s + (r.selfCpuMs.render ?? r.selfCpuMs.renderEncode ?? 0) + (r.selfCpuMs.qa ?? 0), 0) / 1000,
    ),
    copiesByCategory: tally(
      results
        .filter((r) => r.copyOf !== undefined)
        .map((r) => {
          const src = results.find((s) => s.id === r.copyOf);
          if (!src) return `${r.category}: source not in run`;
          if (r.verdict === "refused" || src.verdict === "refused") return `${r.category}: refused`;
          return `${r.category}: ${r.identity?.digest === src.identity?.digest ? "same identity" : "different identity"}`;
        }),
    ),
    pathProbe: run.pathProbe,
  };

  // --- cost ----------------------------------------------------------------
  // Per segment: a run stopped on a loaded machine and finished on a quiet one
  // has two sets of costs, and pooling them would describe neither.
  const costOf = (pool: readonly Result[]) => {
    const rendered = pool.filter((r) => r.verdict === "pass" || r.verdict === "fail");
    const steps = ["fit", "stage", "build", "identity", "render", "renderEncode", "qa", "qaExhaustive", "evidence"];
    const wall: Record<string, unknown> = {};
    const cpu: Record<string, unknown> = {};
    for (const s of steps) {
      const w = pool.map((r) => r.timings?.[s]).filter((x): x is number => typeof x === "number");
      const c = pool.map((r) => r.selfCpuMs?.[s]).filter((x): x is number => typeof x === "number");
      if (w.length > 0) wall[s] = dist(w);
      if (c.length > 0) cpu[s] = dist(c);
    }
    // The process total includes the build and any measurer it spawned, and
    // the evidence snapshot and the exhaustive pass, which are not part of
    // producing or checking a variant and are subtracted.
    const processCpu = rendered.map((r) => cpuOf(r) - (r.selfCpuMs.evidence ?? 0) - (r.selfCpuMs.qaExhaustive ?? 0));
    // Children: the build, a per-call measurement build when a row falls
    // outside the cached charset, and ffmpeg for the variants that encode.
    const childCpu = rendered.map((r) => cpuOf(r) - (r.selfCpuMs.total ?? 0));
    const renderCpu = rendered.map((r) => r.selfCpuMs.render ?? r.selfCpuMs.renderEncode ?? 0);
    const qaCpu = rendered.map((r) => r.selfCpuMs.qa ?? 0);
    const ratio = rendered
      .filter((r) => (r.selfCpuMs.render ?? 0) > 0)
      .map((r) => (r.selfCpuMs.qa ?? 0) / r.selfCpuMs.render!);
    const produceCpu = rendered.map(
      (r, i) => (r.selfCpuMs.fit ?? 0) + (r.selfCpuMs.stage ?? 0) + childCpu[i]! + (r.selfCpuMs.build ?? 0) + (r.selfCpuMs.identity ?? 0) + renderCpu[i]!,
    );
    const encoded = rendered.filter((r) => r.selfCpuMs.renderEncode !== undefined);
    const plain = rendered.filter((r) => r.selfCpuMs.render !== undefined);
    return {
      variants: pool.length,
      rendered: rendered.length,
      wallMsPerStep: wall,
      selfCpuMsPerStep: cpu,
      processCpuMsPerRenderedVariant: dist(processCpu),
      processCpuMsPerRefusedVariant: dist(pool.filter((r) => r.verdict === "refused").map(cpuOf)),
      childProcessCpuMs: dist(childCpu),
      peakRssBytes: dist(rendered.map((r) => r.process.maxRssBytes ?? 0)),
      processWallMs: dist(rendered.map((r) => r.process.wallMs)),
      qaOverRenderCpu: dist(ratio),
      qaShareOfVariantCpu: round(mean(qaCpu) / mean(processCpu)),
      produceCpuMs: dist(produceCpu),
      msPerFrame: dist(rendered.map((r) => r.msPerFrame ?? 0)),
      pakBytes: dist(rendered.map((r) => r.pakBytes ?? 0)),
      bundleBytes: dist(rendered.map((r) => r.bundleBytes ?? 0)),
      videoBytes: dist(encoded.filter((r) => r.videoBytes).map((r) => r.videoBytes!)),
      // ffmpeg is a child, so the encode's cost is the child CPU of an encoded
      // variant over a plain one, plus the self CPU of the render loop.
      encodeOverheadCpuMs:
        encoded.length > 0 && plain.length > 0
          ? round(
              mean(encoded.map((r) => cpuOf(r) - (r.selfCpuMs.evidence ?? 0))) -
                mean(plain.map((r) => cpuOf(r) - (r.selfCpuMs.evidence ?? 0) - (r.selfCpuMs.qaExhaustive ?? 0))),
            )
          : null,
      encodedVariants: encoded.length,
      cpuSecondsPerVariantAllRows: round(mean(pool.map(cpuOf)) / 1000),
    };
  };
  const segments = [...new Set(results.map((r) => r.segment ?? 0))].sort((a, b) => a - b);
  const cost = Object.fromEntries(
    segments.map((seg) => [`segment${seg}`, costOf(results.filter((r) => (r.segment ?? 0) === seg))]),
  );

  // --- which failures a check without per-node re-rendering would catch -------
  // Tier 0 needs no render: an empty mandatory field (the claim is optional)
  // after the template's own whitespace cleaning, or a field the generator's
  // fit already said would not fit. Tier 1 is one layout frame at the hold —
  // the last frame, which verify's grid includes, so its findings are read
  // straight out of this run's. Everything that only the full sweep found is
  // what dropping it would ship.
  const emptyMandatory = (r: Result): string[] => {
    const row = rows.get(r.id);
    if (!row) return [];
    return (["name", "price", "disclaimer"] as const).filter((k) => clean(row[k]) === "");
  };
  const tier0 = (r: Result): boolean => emptyMandatory(r).length > 0 || predictedFail(r);
  const tier1 = (r: Result): boolean => (r.findings ?? []).some((f) => f.frame === LAST_FRAME);
  const tiers = {
    failing: failed.length,
    caughtByTier0: failed.filter(tier0).length,
    caughtByTier1: failed.filter(tier1).length,
    caughtByTier0or1: failed.filter((r) => tier0(r) || tier1(r)).length,
    // The schema half of tier 0 with tier 1, and without the fit's prediction:
    // neither can flag a variant the full sweep passes, so this is the cheap
    // check with no false alarms.
    caughtBySchemaOrTier1: failed.filter((r) => emptyMandatory(r).length > 0 || tier1(r)).length,
    onlyTheFullSweep: failed
      .filter((r) => !tier0(r) && !tier1(r))
      .map((r) => ({ id: r.id, category: r.category, codes: r.codes })),
    tier0FlagsAPassingVariant: rendered
      .filter((r) => r.verdict === "pass" && tier0(r))
      .map((r) => ({ id: r.id, category: r.category, empty: emptyMandatory(r), predicted: r.fit?.predicted })),
    emptyMandatoryRendered: rendered.filter((r) => emptyMandatory(r).length > 0).length,
    emptyMandatoryCaughtByPixels: rendered.filter((r) => emptyMandatory(r).length > 0 && r.verdict === "fail").length,
  };

  // --- words broken in the middle, which no gate reads ------------------------
  const broken = rendered.filter((r) =>
    ["name", "claim", "disclaimer"].some((k) => ((r.fit?.[k] as { brokenWords?: number } | undefined)?.brokenWords ?? 0) > 0),
  );
  const brokenWords = {
    measuredOn: rendered.filter((r) => (r.fit?.name as { brokenWords?: number } | undefined)?.brokenWords !== undefined).length,
    variants: broken.length,
    passing: broken.filter((r) => r.verdict === "pass").length,
    byCategory: tally(broken.map((r) => r.category)),
  };

  // --- evidence on disk -----------------------------------------------------
  const evidenceDir = join(dir, "evidence");
  const evidence = existsSync(evidenceDir)
    ? readdirSync(evidenceDir).map((id) => ({ id, files: readdirSync(join(evidenceDir, id)) }))
    : [];

  // --- sampled against every frame ---------------------------------------
  const both = rendered.filter((r) => r.exhaustive !== undefined);
  const sampling =
    both.length === 0
      ? null
      : {
          variants: both.length,
          verdictAgrees: both.filter((r) => r.exhaustive!.verdict === r.verdict).length,
          codeSetAgrees: both.filter((r) => JSON.stringify(r.exhaustive!.codes) === JSON.stringify(r.codes)).length,
          disagreements: both
            .filter((r) => JSON.stringify(r.exhaustive!.codes) !== JSON.stringify(r.codes))
            .map((r) => ({
              id: r.id,
              category: r.category,
              sampled: r.codes,
              everyFrame: r.exhaustive!.codes,
              onlyEveryFrame: r.exhaustive!.codes.filter((c) => !(r.codes ?? []).includes(c)),
              onlySampled: (r.codes ?? []).filter((c) => !r.exhaustive!.codes.includes(c)),
            })),
          exhaustiveQaCpuMs: dist(both.map((r) => r.selfCpuMs.qaExhaustive ?? 0)),
          sampledQaCpuMs: dist(both.map((r) => r.selfCpuMs.qa ?? 0)),
        };

  return {
    run,
    verdicts,
    byCategory,
    refusals,
    refusedCodepoints,
    variantsPerFamily,
    variantsFailingOnlyBy: onlyBy,
    variantsPerCode,
    failingAssertions,
    ungatedTotals: tally(rendered.flatMap((r) => Object.entries(r.ungated ?? {}).flatMap(([k, n]) => Array(n).fill(k)))),
    generatorVsPixels: { confusion, pixelOnly, predictedOnly },
    dedupe,
    cost,
    tiers,
    brokenWords,
    sampling,
    evidence,
  };
}

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? "dist/batch-qa/run");
  const summary = await report(dir);
  await Bun.write(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}
