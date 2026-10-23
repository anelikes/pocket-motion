#!/usr/bin/env bun
/**
 * The batch-QA prototype: one template, many rows, every variant rendered and
 * checked, and what that costs. `docs/batch-qa-prototype.md` is the report
 * this produced and the reason it exists.
 *
 *   bun scripts/batch-qa.ts --out dist/batch-qa/run [--n 1000] [--seed 20261023] [--jobs 4]
 *       [--encode-every 50] [--evidence 3] [--exhaustive-every 0] [--only r0001,r0002]
 *       [--layout-at 0,22,45,67,89] [--path-probe 3] [--resume] [--max-load 20] [--min-jobs 2]
 *
 * `--resume` keeps every finished variant in `<out>/results.jsonl` and runs
 * the rest, after checking that `<out>/rows.jsonl` is byte-for-byte the rows
 * the generator writes for this `--n` and `--seed`. Each run is a SEGMENT:
 * its number is on every line it writes and its wall time, load and disk are
 * one entry of `run.json`'s `segments`, because a run interrupted on a loaded
 * machine and finished on a quiet one has two sets of costs and one set of
 * verdicts. A line with no `segment` came from a run that was stopped before
 * it could record one.
 *
 * The machine this runs on is shared. When the one-minute load average stays
 * above `--max-load` for 30 s, or swap in use grows by more than 1 GiB over
 * the segment, the number of variants in flight drops to `--min-jobs` for the
 * rest of the segment, and `run.json` records when and why.
 *
 * Each row runs in its own process (`scripts/batch-qa/variant.ts`), `--jobs`
 * at a time, and that process's rusage — which includes the build it waits
 * for — is the per-variant CPU time and peak RSS. Every staged tree is
 * deleted after its variant unless the variant was picked for evidence, so
 * the disk the run holds at once is `--jobs` staged trees, the sampled
 * videos and the evidence PNGs; the high-water mark is sampled every two
 * seconds by `du` over exactly those directories and the measurement cache.
 *
 * Nothing here is a gate. It writes `results.jsonl` (one line per variant, as
 * each finishes), `run.json` (how the run was made and what it cost) and
 * leaves the analysis to `scripts/batch-qa/report.ts`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statfsSync } from "node:fs";
import { appendFile, rm, writeFile } from "node:fs/promises";
import { cpus, loadavg } from "node:os";
import { join, relative, resolve } from "node:path";

import { openMeasurer } from "../src/text/measure.ts";
import { DEFAULT_N, DEFAULT_SEED, generateRows, type Row } from "./batch-qa/rows.ts";
import { SIZES, clean, facePaths } from "./batch-qa/template.ts";

const ROOT = resolve(import.meta.dir, "..");
const VARIANT = join(import.meta.dir, "batch-qa", "variant.ts");

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`batch-qa: ${name} needs a value`);
  return v;
}

/** Every character the rows carry outside printable ASCII, which is always baked. */
export function charsetOf(rows: readonly Row[]): string {
  const set = new Set<string>();
  for (const r of rows) {
    for (const f of [r.name, r.price, r.claim, r.disclaimer]) {
      for (const c of clean(f)) {
        const cp = c.codePointAt(0)!;
        if (cp < 32 || cp > 126) set.add(c);
      }
    }
  }
  return [...set].sort().join("");
}

async function duBytes(paths: readonly string[]): Promise<number> {
  const present = paths.filter((p) => existsSync(p));
  if (present.length === 0) return 0;
  const p = Bun.spawn(["du", "-sk", ...present], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(p.stdout).text();
  await p.exited;
  return text
    .split("\n")
    .filter(Boolean)
    .reduce((sum, line) => sum + Number(line.split("\t")[0]) * 1024, 0);
}

/** Swap in use, in MiB, from `sysctl vm.swapusage` (darwin); null elsewhere. */
function swapUsedMiB(): number | null {
  try {
    const p = Bun.spawnSync(["sysctl", "-n", "vm.swapusage"]);
    const m = /used = ([\d.]+)M/.exec(p.stdout.toString());
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const out = resolve(arg(argv, "--out") ?? join(ROOT, "dist", "batch-qa", "run"));
  const n = Number(arg(argv, "--n") ?? DEFAULT_N);
  const seed = Number(arg(argv, "--seed") ?? DEFAULT_SEED);
  const jobs = Number(arg(argv, "--jobs") ?? 4);
  const resume = argv.includes("--resume");
  const maxLoad = Number(arg(argv, "--max-load") ?? 20);
  const minJobs = Number(arg(argv, "--min-jobs") ?? 2);
  const encodeEvery = Number(arg(argv, "--encode-every") ?? 50);
  const evidencePerCode = Number(arg(argv, "--evidence") ?? 3);
  const exhaustiveEvery = Number(arg(argv, "--exhaustive-every") ?? 0);
  const only = arg(argv, "--only")?.split(",");
  const layoutAt = arg(argv, "--layout-at");
  const pathProbe = Number(arg(argv, "--path-probe") ?? 0);
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error("batch-qa: --jobs must be a positive integer");
  if (!out.startsWith(join(ROOT, "dist") + "/")) {
    throw new Error(`batch-qa: --out must be under ${join(ROOT, "dist")} (it is deleted and rewritten)`);
  }

  const rows = generateRows(n, seed);
  const rowsText = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const rowsPath = join(out, "rows.jsonl");
  const resultsPath = join(out, "results.jsonl");
  const runPath = join(out, "run.json");
  const finished = new Set<string>();
  let segment = 1;
  let earlier: Array<Record<string, unknown>> = [];
  if (resume && existsSync(resultsPath)) {
    if (readFileSync(rowsPath, "utf8") !== rowsText) {
      throw new Error(`batch-qa: ${rowsPath} is not what --n ${n} --seed ${seed} generates; refusing to resume onto it`);
    }
    for (const line of readFileSync(resultsPath, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(line) as { id: string; verdict: string; segment?: number };
      // An error is the runner's failure, not a verdict about the variant.
      if (r.verdict !== "error") finished.add(r.id);
      segment = Math.max(segment, (r.segment ?? 0) + 1);
    }
    if (existsSync(runPath)) earlier = ((await Bun.file(runPath).json()) as { segments?: typeof earlier }).segments ?? [];
  } else {
    await rm(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    await writeFile(rowsPath, rowsText);
    await writeFile(resultsPath, "");
  }
  const charset = charsetOf(rows);
  const charsetPath = join(out, "charset.txt");
  await writeFile(charsetPath, charset);
  const selected = (only ? rows.filter((r) => only.includes(r.id)) : rows).filter((r) => !finished.has(r.id));
  console.log(
    `batch-qa: segment ${segment} — ${selected.length} to run` +
      (finished.size > 0 ? `, ${finished.size} kept from earlier segments` : ""),
  );

  // One metrics-only bake of the whole data set's charset, before any worker
  // asks for it, so N workers do not each miss and build the same cache.
  const t0 = Bun.nanoseconds();
  const cpu0 = process.cpuUsage();
  const m = await openMeasurer({ face: facePaths(ROOT), sizes: SIZES, texts: [], cache: { charset } });
  await m.close();
  const measureCache = {
    wallMs: Math.round((Bun.nanoseconds() - t0) / 1e6),
    selfCpuMs: Math.round((process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1000),
    charsetSize: [...charset].length,
  };

  // Disk: the directories this run writes and nothing else, so another
  // session's writes on a shared volume do not land in the number.
  const watched = (): string[] => [
    out,
    join(ROOT, "dist", ".measure"),
    ...readdirSync(join(ROOT, "dist"))
      .filter((d) => d.startsWith("bqa-") && !d.endsWith(".lock"))
      .map((d) => join(ROOT, "dist", d)),
  ];
  const disk = { highWaterBytes: 0, samples: 0, freeAtStartBytes: 0, freeMinBytes: Infinity };
  const fs0 = statfsSync(ROOT);
  disk.freeAtStartBytes = fs0.bavail * fs0.bsize;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const bytes = await duBytes(watched());
      disk.highWaterBytes = Math.max(disk.highWaterBytes, bytes);
      const fs = statfsSync(ROOT);
      disk.freeMinBytes = Math.min(disk.freeMinBytes, fs.bavail * fs.bsize);
      disk.samples++;
      await Bun.sleep(2000);
    }
  })();

  const evidenceTaken = new Map<string, number>();
  const load = { start: loadavg(), max: loadavg()[0]! };
  const swapAtStart = swapUsedMiB();
  let allowed = jobs;
  let hot = 0;
  const throttled: Array<Record<string, unknown>> = [];
  const t00 = Bun.nanoseconds();
  const loadTimer = setInterval(() => {
    const now = loadavg()[0]!;
    load.max = Math.max(load.max, now);
    const swap = swapUsedMiB();
    hot = now > maxLoad ? hot + 1 : 0;
    const swapGrew = swap !== null && swapAtStart !== null && swap - swapAtStart > 1024;
    if (allowed > minJobs && (hot >= 6 || swapGrew)) {
      allowed = minJobs;
      throttled.push({
        atMs: Math.round((Bun.nanoseconds() - t00) / 1e6),
        load: now,
        swapUsedMiB: swap,
        swapAtStartMiB: swapAtStart,
        why: swapGrew ? "swap grew by more than 1 GiB" : `load above ${maxLoad} for 30 s`,
        jobs: minJobs,
      });
      console.log(`batch-qa: dropping to ${minJobs} job(s) — ${throttled.at(-1)!.why}`);
    }
  }, 5000);

  const started = Bun.nanoseconds();
  let next = 0;
  let done = 0;
  const counts: Record<string, number> = {};

  const runOne = async (row: Row, index: number): Promise<void> => {
    const encode = encodeEvery > 0 && index % encodeEvery === 0;
    const exhaustive = exhaustiveEvery > 0 && index % exhaustiveEvery === 0;
    const flags = [
      ...(encode ? ["--encode"] : []),
      ...(exhaustive ? ["--exhaustive"] : []),
      ...(layoutAt ? ["--layout-at", layoutAt] : []),
      // Evidence is decided after the fact for most codes, but a variant only
      // knows its verdict at the end; ask for it on every variant and keep
      // the files only for the first few of each code.
      ...(evidencePerCode > 0 ? ["--evidence"] : []),
    ];
    const w0 = Bun.nanoseconds();
    const proc = Bun.spawn(
      ["bun", VARIANT, "--rows", rowsPath, "--id", row.id, "--charset", charsetPath, "--out", out, ...flags],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    const wallMs = Math.round((Bun.nanoseconds() - w0) / 1e6);
    const ru = proc.resourceUsage();
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
    } catch {
      result = { id: row.id, category: row.category, verdict: "error", error: `no JSON on stdout (exit ${exitCode})` };
    }
    if (result.verdict === "error") result = { id: row.id, category: row.category, ...result, stderr: stderr.slice(-2000) };

    // Keep evidence for the first few variants per distinct code; delete the rest.
    const ev = result.evidence as string[] | undefined;
    if (ev && ev.length > 0) {
      const codes = (result.codes as string[] | undefined) ?? [];
      const family = codes.map((c) => c.split(":")[0]!).sort().join("+") || "none";
      const taken = evidenceTaken.get(family) ?? 0;
      if (taken < evidencePerCode) {
        evidenceTaken.set(family, taken + 1);
        result.evidence = ev.map((p) => relative(out, p));
      } else {
        await rm(join(out, "evidence", row.id), { recursive: true, force: true });
        delete result.evidence;
      }
    }

    const line = {
      ...result,
      segment,
      process: {
        wallMs,
        exitCode,
        cpuUserMs: ru ? Number(ru.cpuTime.user) / 1000 : null,
        cpuSystemMs: ru ? Number(ru.cpuTime.system) / 1000 : null,
        maxRssBytes: ru ? ru.maxRSS : null,
      },
    };
    await appendFile(resultsPath, JSON.stringify(line) + "\n");
    const v = String(result.verdict);
    counts[v] = (counts[v] ?? 0) + 1;
    done++;
    if (done % 25 === 0 || done === selected.length) {
      const min = (Bun.nanoseconds() - started) / 6e10;
      console.log(
        `batch-qa: ${done}/${selected.length} in ${min.toFixed(1)} min — ` +
          Object.entries(counts)
            .map(([k, c]) => `${k} ${c}`)
            .join(", ") +
          ` — load ${loadavg()[0]!.toFixed(1)}`,
      );
    }
  };

  const worker = async (k: number): Promise<void> => {
    while (next < selected.length) {
      if (k >= allowed) {
        await Bun.sleep(1000);
        continue;
      }
      const i = next++;
      await runOne(selected[i]!, rows.indexOf(selected[i]!));
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, selected.length) }, (_, k) => worker(k)));
  const wallMs = Math.round((Bun.nanoseconds() - started) / 1e6);

  // Identity is a function of the staging path as well as the sources; this
  // builds a few already-run rows again under a second prefix to say how.
  const probes: unknown[] = [];
  if (pathProbe > 0) {
    const results = (await Bun.file(resultsPath).text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const picks = results.filter((r) => r.verdict === "pass").slice(0, pathProbe);
    for (const r of picks) {
      const proc = Bun.spawn(
        ["bun", VARIANT, "--rows", rowsPath, "--id", r.id, "--charset", charsetPath, "--out", join(out, "probe"), "--stage-prefix", "bqa-alt"],
        { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
      );
      const alt = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1)!);
      await proc.exited;
      const a = r.identity.components as Record<string, string>;
      const b = alt.identity.components as Record<string, string>;
      probes.push({
        id: r.id,
        stagedAt: [r.stagedAt, alt.stagedAt],
        identityEqual: r.identity.digest === alt.identity.digest,
        frameDigestEqual: r.frameDigest === alt.frameDigest,
        componentsThatDiffer: Object.keys(a).filter((k) => a[k] !== b[k]),
      });
    }
  }

  sampling = false;
  clearInterval(loadTimer);
  await sampler;

  const thisSegment = {
    segment,
    selected: selected.length,
    keptFromEarlier: finished.size,
    jobs,
    throttled,
    wallMs,
    variantsPerMinute: Math.round((selected.length / (wallMs / 60000)) * 10) / 10,
    measureCache,
    disk: { ...disk, freeMinBytes: Number.isFinite(disk.freeMinBytes) ? disk.freeMinBytes : null },
    load: { start: load.start, max: load.max, end: loadavg() },
    swapUsedMiB: { start: swapAtStart, end: swapUsedMiB() },
    counts,
    ...(probes.length > 0 ? { pathProbe: probes } : {}),
  };
  const run = {
    rows: rowsPath,
    n,
    seed,
    cores: cpus().length,
    encodeEvery,
    exhaustiveEvery,
    layoutAt: layoutAt ?? "verify default",
    bun: Bun.version,
    segments: [...earlier, thisSegment],
    pathProbe: [...earlier.flatMap((e) => (e.pathProbe as unknown[] | undefined) ?? []), ...probes],
  };
  await writeFile(runPath, JSON.stringify(run, null, 2) + "\n");
  console.log(
    `batch-qa: ${selected.length} variant(s) in ${(wallMs / 60000).toFixed(1)} min with ${jobs} job(s) — ` +
      `${thisSegment.variantsPerMinute}/min; disk high-water ${(disk.highWaterBytes / 1048576).toFixed(0)} MiB`,
  );
  console.log(`batch-qa: results ${relative(ROOT, resultsPath)}; analyse with bun scripts/batch-qa/report.ts ${relative(ROOT, out)}`);
}

if (import.meta.main) await main();
