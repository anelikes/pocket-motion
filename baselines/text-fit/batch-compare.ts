#!/usr/bin/env bun
/**
 * The batch-QA card fitted by its generator against the same card fitted by
 * layout, row for row.
 *
 *   bun scripts/batch-qa.ts --out dist/batch-qa/run-gen
 *   bun scripts/batch-qa.ts --out dist/batch-qa/run-eng --fit engine
 *   bun baselines/text-fit/batch-compare.ts dist/batch-qa/run-gen dist/batch-qa/run-eng
 *
 * Both runs read the same 1,000 rows (`scripts/batch-qa/rows.ts`, seed
 * 20261023) and are judged by the same rule (`judge`, variant.ts), which
 * gates six layout codes and every assertion and does not gate
 * `text_truncated`. So a row's two verdicts differ only in where its fit was
 * decided, and `text_truncated` is counted beside the verdict rather than in
 * it. Writes `baselines/text-fit/runs/batch-compare.json` and prints the
 * tables `baselines/text-fit.md` quotes.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Result {
  readonly id: string;
  readonly category: string;
  readonly verdict: "pass" | "fail" | "refused" | "error";
  readonly codes?: readonly string[];
  readonly truncated?: readonly string[];
  readonly engineFit?: Record<string, { px?: number; fitted?: boolean; dropped?: number; split?: number }>;
  readonly fit?: { predicted?: readonly string[]; [field: string]: unknown };
  readonly pakBytes?: number;
  readonly process?: { cpuUserMs?: number; cpuSystemMs?: number; maxRssBytes?: number };
  readonly selfCpuMs?: Record<string, number>;
  readonly timings?: Record<string, number>;
  readonly stage?: string;
}

const [genDir, engDir] = process.argv.slice(2);
if (!genDir || !engDir) throw new Error("usage: batch-compare.ts <generator run> <engine run>");

const read = (dir: string): Map<string, Result> => {
  const out = new Map<string, Result>();
  for (const line of readFileSync(join(dir, "results.jsonl"), "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line) as Result;
    out.set(r.id, r);
  }
  return out;
};
const gen = read(genDir);
const eng = read(engDir);
if (gen.size !== eng.size) throw new Error(`the runs hold ${gen.size} and ${eng.size} rows`);

const OVERFLOW = /^(escaped_container|content_overlap|text_box_overflow|clipped_text):/;
const escaped = (r: Result): boolean => (r.codes ?? []).some((c) => c.startsWith("escaped_container:"));
const overflowCodes = (r: Result): string[] => (r.codes ?? []).filter((c) => OVERFLOW.test(c));
const assertCodes = (r: Result): string[] => (r.codes ?? []).filter((c) => c.startsWith("assert:"));

const verdicts = (m: Map<string, Result>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of m.values()) out[r.verdict] = (out[r.verdict] ?? 0) + 1;
  return out;
};

// The rows the generator's card failed with a box out of its container.
const pushed = [...gen.values()].filter(escaped);
const outcome = { gone: 0, goneTruncated: 0, stillOverflow: 0, otherFailure: 0, notRendered: 0 };
const stillRows: string[] = [];
const truncatedNodes: Record<string, number> = {};
for (const g of pushed) {
  const e = eng.get(g.id)!;
  if (e.verdict === "refused" || e.verdict === "error") {
    outcome.notRendered++;
    continue;
  }
  if (overflowCodes(e).length > 0) {
    outcome.stillOverflow++;
    stillRows.push(`${g.id} ${g.category}: ${overflowCodes(e).join(" ")}`);
    continue;
  }
  if (e.verdict === "fail") {
    outcome.otherFailure++;
    continue;
  }
  if ((e.truncated ?? []).length > 0) {
    outcome.goneTruncated++;
    for (const n of e.truncated!) truncatedNodes[n] = (truncatedNodes[n] ?? 0) + 1;
  } else outcome.gone++;
}

// Every row whose verdict moved, either way.
const moved: Array<{ id: string; category: string; gen: string; eng: string; genCodes: string[]; engCodes: string[]; truncated: string[] }> = [];
for (const g of gen.values()) {
  const e = eng.get(g.id)!;
  const gc = [...(g.codes ?? [])];
  const ec = [...(e.codes ?? [])];
  if (g.verdict !== e.verdict || JSON.stringify(gc) !== JSON.stringify(ec)) {
    moved.push({ id: g.id, category: g.category, gen: g.verdict, eng: e.verdict, genCodes: gc, engCodes: ec, truncated: [...(e.truncated ?? [])] });
  }
}
const newlyFailing = moved.filter((m) => m.gen === "pass" && m.eng === "fail");

// text_truncated over the whole engine run, by node and by category.
const truncByNode: Record<string, number> = {};
const truncByCategory: Record<string, number> = {};
let truncRows = 0;
for (const e of eng.values()) {
  if ((e.truncated ?? []).length === 0) continue;
  truncRows++;
  truncByCategory[e.category] = (truncByCategory[e.category] ?? 0) + 1;
  for (const n of e.truncated!) truncByNode[n] = (truncByNode[n] ?? 0) + 1;
}

// Words cut between letters: the generator's own count, and the core's.
let genBroken = 0;
let engSplit = 0;
for (const g of gen.values()) {
  if (g.verdict !== "pass" && g.verdict !== "fail") continue;
  const f = g.fit as Record<string, { brokenWords?: number }> | undefined;
  if (f && ["name", "claim", "disclaimer"].some((k) => (f[k]?.brokenWords ?? 0) > 0)) genBroken++;
}
for (const e of eng.values()) {
  if (e.verdict !== "pass" && e.verdict !== "fail") continue;
  if (Object.values(e.engineFit ?? {}).some((f) => (f.split ?? 0) > 0)) engSplit++;
}

// What it costs: pak bytes and the build's CPU, per rendered variant.
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s[Math.floor(s.length / 2)]!;
};
const rendered = (m: Map<string, Result>): Result[] => [...m.values()].filter((r) => r.verdict === "pass" || r.verdict === "fail");
const cost = (m: Map<string, Result>) => ({
  pakBytesMedian: median(rendered(m).map((r) => r.pakBytes ?? NaN)),
  buildWallMsMedian: median(rendered(m).map((r) => r.timings?.build ?? NaN)),
  fitWallMsMedian: median([...m.values()].map((r) => r.timings?.fit ?? NaN).filter(Number.isFinite)),
  variantCpuMsMedian: median(
    rendered(m)
      .map((r) => (r.process?.cpuUserMs ?? NaN) + (r.process?.cpuSystemMs ?? NaN))
      .filter(Number.isFinite),
  ),
  peakRssBytesMedian: median(rendered(m).map((r) => r.process?.maxRssBytes ?? NaN).filter(Number.isFinite)),
});

const report = {
  rows: gen.size,
  verdicts: { generator: verdicts(gen), engine: verdicts(eng) },
  pushedOutOfContainer: { generator: pushed.length, ...outcome },
  stillOverflowRows: stillRows,
  truncatedNodesAmongPushed: truncatedNodes,
  engineTruncated: { rows: truncRows, byNode: truncByNode, byCategory: truncByCategory },
  wordsCutBetweenLetters: { generatorRows: genBroken, engineRows: engSplit },
  newlyFailing,
  moved: moved.length,
  cost: { generator: cost(gen), engine: cost(eng) },
};
writeFileSync(join(import.meta.dir, "runs", "batch-compare.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
