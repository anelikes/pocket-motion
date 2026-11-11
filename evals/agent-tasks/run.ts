#!/usr/bin/env bun
/**
 * The agent-task suite's runner. README.md beside it is how to use it; this
 * is what each step does.
 *
 *   list                         the tasks
 *   prepare [task…] --run <label> [--root <dir>] [--ref <rev>]
 *                                one fresh checkout per task, its inputs and
 *                                the prompt an agent is given
 *   record <run-dir> --transcript <agent.jsonl>
 *                                what the agent did, read from its Claude Code
 *                                transcript: wall time, tool calls, every
 *                                call that came back an error, its report
 *                                (or --report <file> --wall-s N --tool-calls N
 *                                from another harness); --launch-load N is
 *                                the 1-minute load the agent started under
 *   check <run-dir>              the acceptance, written to check.json
 *   report <root> [--out <md>]   every run under <root> as one table
 *
 * A run directory is <root>/<label>/<task>/ and holds `repo/` (the checkout
 * the agent works in), `inputs/`, `PROMPT.md`, `meta.json`, and after the
 * other steps `agent.json`, `check.json` and `check/` (frames the check read).
 * The checkout carries no copy of this suite: an agent that can read the
 * acceptance is not being measured.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { CheckContext, probeVideo } from "./lib/check.ts";
import type { Criterion, Task } from "./lib/task.ts";
import { summarise } from "./lib/transcript.ts";

const HERE = import.meta.dir;
const SOURCE = resolve(HERE, "..", "..");
const TASKS_DIR = join(HERE, "tasks");
const DEFAULT_ROOT = join(tmpdir(), "pocket-motion-agent-evals");

interface Meta {
  task: string;
  id: string;
  run: string;
  ref: string;
  repo: string;
  inputs: string;
}

async function loadTask(name: string): Promise<Task> {
  return (await import(join(TASKS_DIR, name, "task.ts"))).default as Task;
}

function taskNames(): string[] {
  return readdirSync(TASKS_DIR)
    .filter((d) => existsSync(join(TASKS_DIR, d, "task.ts")))
    .sort();
}

function resolveNames(asked: readonly string[]): string[] {
  const all = taskNames();
  if (asked.length === 0) return all;
  return asked.map((a) => {
    const hit = all.find((t) => t === a || t.replace(/^\d+-/, "") === a || t.startsWith(`${a}-`));
    if (!hit) throw new Error(`no task ${JSON.stringify(a)}; tasks: ${all.join(", ")}`);
    return hit;
  });
}

function sh(cmd: string[], cwd?: string): string {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
}

/** A copy-on-write copy where the filesystem has one, a plain copy elsewhere. */
function cloneTree(from: string, to: string): void {
  const flag = process.platform === "darwin" ? "-Rc" : "-R";
  const r = Bun.spawnSync(["cp", flag, from, to], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) cpSync(from, to, { recursive: true });
}

function flags(argv: readonly string[]): { positional: string[]; opts: Map<string, string> } {
  const positional: string[] = [];
  const opts = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) opts.set(a.slice(2, eq), a.slice(eq + 1));
      else opts.set(a.slice(2), argv[++i] ?? "");
    } else positional.push(a);
  }
  return { positional, opts };
}

function prompt(task: Task, brief: string, repo: string, inputs: string): string {
  const preamble = readFileSync(join(HERE, "preamble.md"), "utf8");
  return preamble
    .replaceAll("{{REPO}}", repo)
    .replaceAll("{{INPUTS}}", inputs)
    .replaceAll("{{BRIEF}}", brief.trim())
    .replaceAll("{{DELIVER_EXTRA}}", task.deliverExtra ?? "")
    .replaceAll("{{ID}}", task.id)
    .replaceAll("{{EXT}}", task.ext);
}

async function prepare(names: string[], label: string, root: string, ref: string): Promise<void> {
  const sha = sh(["git", "rev-parse", ref], SOURCE);
  const sourceSha = sh(["git", "rev-parse", "HEAD"], SOURCE);
  // vendor/ is built from patches/ by scripts/vendor.ts; a checkout at another
  // revision of either rebuilds it rather than borrowing this one's.
  const sameVendor =
    Bun.spawnSync(["git", "diff", "--quiet", sourceSha, sha, "--", "patches", "scripts/vendor.ts"], { cwd: SOURCE })
      .exitCode === 0;
  for (const name of names) {
    const task = await loadTask(name);
    const dir = join(root, label, name);
    if (existsSync(dir)) throw new Error(`${dir} exists; pick another --run label`);
    const repo = join(dir, "repo");
    const inputs = join(dir, "inputs");
    mkdirSync(inputs, { recursive: true });
    sh(["git", "clone", "--quiet", "--local", "--no-checkout", SOURCE, repo]);
    sh(["git", "checkout", "--quiet", "--detach", sha], repo);
    rmSync(join(repo, "evals", "agent-tasks"), { recursive: true, force: true });
    rmSync(join(repo, "docs", "agent-adoption-eval.md"), { force: true });
    for (const tree of ["node_modules", "assets"]) {
      if (tree === "assets") rmSync(join(repo, tree), { recursive: true, force: true });
      cloneTree(join(SOURCE, tree), join(repo, tree));
    }
    if (sameVendor) cloneTree(join(SOURCE, "vendor"), join(repo, "vendor"));
    else sh(["bun", "scripts/vendor.ts"], repo);
    await task.inputs(inputs);
    const brief = readFileSync(join(TASKS_DIR, name, "brief.md"), "utf8");
    writeFileSync(join(dir, "PROMPT.md"), prompt(task, brief, repo, inputs));
    const meta: Meta = { task: name, id: task.id, run: label, ref: sha, repo, inputs };
    writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    console.log(join(dir, "PROMPT.md"));
  }
}

/** What the agent's final report says, split into its three parts. */
function parseReport(text: string): { result: string; decisions: string[]; friction: string[] } {
  const result = /RESULT:\s*([a-z-]+)/i.exec(text)?.[1]?.toLowerCase() ?? "unknown";
  // A section is its bullets: a line starting `-` opens one, an indented
  // line continues it, and anything else after the first bullet ends it.
  // A heading is found by its first three and last two letters, so a
  // misspelt one ("FRIDCTION:", seen) still reads.
  const find = (head: string, from = 0) => {
    const m = new RegExp(`${head.slice(0, 3)}[A-Z]*${head.slice(-2)}:`).exec(text.slice(from));
    return m ? { at: from + m.index, len: m[0].length } : null;
  };
  const section = (head: string, next: string | null) => {
    const start = find(head);
    if (!start) return [];
    const end = next ? find(next, start.at) : null;
    const lines = text.slice(start.at + start.len, end ? end.at : undefined).split("\n");
    const out: string[] = [];
    for (const line of lines) {
      if (/^\s*[-*]\s/.test(line)) out.push(line.replace(/^\s*[-*]\s/, "").trim());
      else if (out.length && /^\s+\S/.test(line)) out[out.length - 1] += ` ${line.trim()}`;
      else if (out.length && line.trim() && !line.startsWith("```")) break;
      else if (!out.length && line.trim() && !line.startsWith("```")) out.push(line.trim());
    }
    return out.filter((l) => l.toLowerCase() !== "none");
  };
  return { result, decisions: section("DECISIONS", "FRICTION"), friction: section("FRICTION", null) };
}

function record(runDir: string, opts: Map<string, string>): void {
  const transcriptPath = opts.get("transcript");
  const transcript = transcriptPath ? summarise(transcriptPath) : undefined;
  const reportFile = opts.get("report");
  const report = reportFile ? readFileSync(reportFile, "utf8") : (transcript?.finalReport ?? "");
  const wall = opts.has("wall-s") ? Number(opts.get("wall-s")) : (transcript?.wallSeconds ?? NaN);
  const tools = opts.has("tool-calls") ? Number(opts.get("tool-calls")) : (transcript?.toolCalls ?? NaN);
  // The machine's 1-minute load when the agent was started: wall time is a
  // reading of the machine as much as of the agent, so it is kept beside it.
  const launchLoad = opts.has("launch-load") ? Number(opts.get("launch-load")) : undefined;
  const agent = { wallSeconds: wall, toolCalls: tools, launchLoad, ...parseReport(report), report, transcript };
  writeFileSync(join(runDir, "agent.json"), `${JSON.stringify(agent, null, 2)}\n`);
  console.log(
    `${basename(runDir)}: ${agent.result}, ${wall} s, ${tools} tool calls, ${agent.friction.length} friction lines` +
      (transcript ? `, ${transcript.errors.length} tool errors` : ""),
  );
}

/** Which of the vocabulary's features the delivery reaches for. */
function features(dir: string): string[] {
  const text = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => /\.(tsx?|json|svg)$/.test(f) && !f.includes("node_modules"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  const probes: [string, RegExp][] = [
    ["gen.ts", /^/],
    ["<Svg>", /<Svg\b/],
    ["<Path>", /<Path\b/],
    ["<Image>", /<Image\b/],
    ["trimEnd", /trimEnd|trim-end/],
    ["morph", /\bmorph\b/],
    ["stroke-dash", /stroke-dash/],
    ["motionPath", /motionPath/],
    ["shutter", /"shutter"/],
    ["overflow-mask", /overflow-mask/],
    ["measure/fit", /text\/(measure|fit)/],
    ["footage", /"footage"/],
    ["mix-blend", /mix-blend/],
  ];
  const out = probes.filter(([name, re]) => (name === "gen.ts" ? existsSync(join(dir, "gen.ts")) : re.test(text)));
  return out.map(([n]) => n);
}

async function check(runDir: string): Promise<{ pass: boolean; criteria: Criterion[] }> {
  const meta = JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")) as Meta;
  const task = await loadTask(meta.task);
  const scratch = join(runDir, "check");
  rmSync(scratch, { recursive: true, force: true });
  const ctx = new CheckContext(meta.repo, task.id, meta.inputs, scratch);
  const criteria: Criterion[] = [];
  const add = (c: Criterion) => {
    criteria.push(c);
    console.log(`${c.pass ? "PASS" : "FAIL"} ${c.id}: ${c.detail}`);
  };
  const started = performance.now();
  const sidecarPath = join(ctx.abs, "pocket-motion.json");
  const jobPath = join(ctx.abs, "job.json");
  const video = join(meta.repo, "out", `${task.id}.${task.ext}`);
  const expectFrames = (n: number) =>
    typeof task.canvas.frames === "number" ? n === task.canvas.frames : n >= task.canvas.frames.atLeast;

  if (!existsSync(sidecarPath) && existsSync(jobPath)) {
    await checkJob(ctx, task, jobPath, add);
  } else if (!existsSync(sidecarPath)) {
    add({ id: "delivered", pass: false, detail: `no ${ctx.rel}/pocket-motion.json` });
  } else {
    add({ id: "delivered", pass: true, detail: ctx.rel });
    const build = await ctx.cli(["build", ctx.rel, "--json"]);
    add({
      id: "builds",
      pass: build.code === 0,
      detail: build.code === 0 ? "build exits 0" : `build exits ${build.code}: ${lastLines(build.stderr)}`,
    });
    if (build.code === 0) {
      const sidecar = ctx.sidecar() as { fps?: number; durationFrames?: number };
      const viewport = (await ctx.cli(["layout", ctx.rel, "--at", "0", "--json"])).json?.viewport as number[] | undefined;
      const fps = sidecar.fps ?? 30;
      const frames = sidecar.durationFrames ?? 0;
      add({
        id: "canvas",
        pass:
          viewport?.[0] === task.canvas.w && viewport?.[1] === task.canvas.h && fps === task.canvas.fps && expectFrames(frames),
        detail: `${viewport?.join("×")} at ${fps} fps, ${frames} frames (asked ${task.canvas.w}×${task.canvas.h} at ${task.canvas.fps}, ${JSON.stringify(task.canvas.frames)})`,
      });
      const verify = await ctx.cli(["verify", ctx.rel, "--json"]);
      add({
        id: "verify",
        pass: verify.json?.ok === true,
        detail: verify.json?.ok === true ? "verify ok" : `verify not ok: ${summariseVerify(verify.json, verify.stderr)}`,
      });
      const original = readFileSync(sidecarPath, "utf8");
      const required = await task.assertions(ctx);
      try {
        writeFileSync(sidecarPath, `${JSON.stringify({ ...JSON.parse(original), assertions: required }, null, 2)}\n`);
        const asserted = await ctx.cli(["assert", ctx.rel, "--json"]);
        const failures = ((asserted.json?.assertions ?? []) as { node: string; predicate: string; ok: boolean; detail: string }[]).filter(
          (a) => !a.ok,
        );
        add({
          id: "assertions",
          pass: asserted.json?.ok === true,
          detail:
            asserted.json?.ok === true
              ? `all ${required.length} required assertions hold`
              : asserted.json
                ? `${failures.length} of ${required.length} fail: ${failures
                    .slice(0, 6)
                    .map((f) => `${f.node} ${f.predicate}: ${f.detail}`)
                    .join(" | ")}`
                : `assert did not run: ${lastLines(asserted.stderr)}`,
        });
      } finally {
        writeFileSync(sidecarPath, original);
      }
      for (const c of await task.observe(ctx).catch((e: Error) => [{ id: "observe", pass: false, detail: e.message }]))
        add(c);
    }
  }
  const probe = await probeVideo(video);
  const sidecarFrames = existsSync(sidecarPath) ? ((ctx.sidecar() as { durationFrames?: number }).durationFrames ?? 0) : 0;
  add({
    id: "video",
    pass:
      probe !== null &&
      probe.width === task.canvas.w &&
      probe.height === task.canvas.h &&
      (sidecarFrames === 0 ? expectFrames(probe.frames) : probe.frames === sidecarFrames) &&
      (task.ext !== "mov" || /a/.test(probe.pixFmt.replace(/^yuv/, ""))),
    detail: probe
      ? `${relative(meta.repo, video)}: ${probe.codec} ${probe.pixFmt} ${probe.width}×${probe.height}, ${probe.frames} frames`
      : `no ${relative(meta.repo, video)}`,
  });
  const pass = criteria.every((c) => c.pass);
  const result = {
    task: meta.task,
    run: meta.run,
    pass,
    passed: criteria.filter((c) => c.pass).length,
    total: criteria.length,
    criteria,
    features: existsSync(ctx.abs) ? features(ctx.abs) : [],
    unchecked: task.unchecked ?? [],
    checkSeconds: Math.round((performance.now() - started) / 1000),
  };
  writeFileSync(join(runDir, "check.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`${meta.task} ${meta.run}: ${pass ? "PASS" : "FAIL"} (${result.passed}/${result.total})`);
  return { pass, criteria };
}

/** A captions job: rendered here from its spec, held to its own word assertions. */
async function checkJob(ctx: CheckContext, task: Task, jobPath: string, add: (c: Criterion) => void): Promise<void> {
  const readme = join(ctx.abs, "README.md");
  const command = existsSync(readme) ? readFileSync(readme, "utf8") : "";
  const dir = /render\s+(\S+)\s+--spec/.exec(command)?.[1];
  add({
    id: "delivered",
    pass: dir !== undefined,
    detail: dir ? `job ${relative(ctx.repo, jobPath)} rendered with ${dir}` : "job.json with no README.md naming its render command",
  });
  if (!dir) return;
  const job = JSON.parse(readFileSync(jobPath, "utf8")) as { viewport?: number[]; fps?: number };
  add({
    id: "canvas",
    pass: job.viewport?.[0] === task.canvas.w && job.viewport?.[1] === task.canvas.h && (job.fps ?? 30) === task.canvas.fps,
    detail: `job viewport ${job.viewport?.join("×")} at ${job.fps} fps`,
  });
  const out = join(ctx.scratch, `job.${task.ext}`);
  const r = await ctx.cli(["render", dir, "--spec", jobPath, "--out", out, "--format", task.ext, "--alpha", "--json"]);
  const a = r.json?.assertions;
  const want = (await task.assertions(ctx)).length;
  add({ id: "builds", pass: r.code === 0, detail: r.code === 0 ? "render --spec exits 0" : `render --spec exits ${r.code}: ${lastLines(r.stderr)}` });
  add({
    id: "assertions",
    pass: a?.ok === true && (a.assertions?.length ?? 0) >= want,
    detail: a ? `job's own assertions: ok ${a.ok}, ${a.assertions?.length ?? 0} (transcript has ${want} words)` : "no assertions in the job's --json",
  });
}

function lastLines(s: string, n = 3): string {
  return s.trim().split("\n").slice(-n).join(" ⏎ ").slice(0, 400);
}

function summariseVerify(json: { errors?: unknown[]; sections?: Record<string, { ok?: boolean }> } | null, stderr: string): string {
  if (!json) return lastLines(stderr);
  const red = Object.entries(json as Record<string, { ok?: boolean }>)
    .filter(([, v]) => v && typeof v === "object" && "ok" in v && v.ok === false)
    .map(([k]) => k);
  const errors = Array.isArray(json.errors) ? json.errors.slice(0, 4).map((e) => (typeof e === "string" ? e : JSON.stringify(e))) : [];
  return `${red.join(", ") || "?"}${errors.length ? ` — ${errors.join(" | ").slice(0, 300)}` : ""}`;
}

function report(root: string, outFile?: string): void {
  const rows: string[] = [];
  const runs: { task: string; run: string; check?: { pass: boolean; passed: number; total: number; criteria: Criterion[] }; agent?: { wallSeconds: number; toolCalls: number; launchLoad?: number; result: string } }[] = [];
  for (const label of readdirSync(root).sort()) {
    const labelDir = join(root, label);
    if (!existsSync(labelDir) || !readdirSync(labelDir).length) continue;
    for (const task of readdirSync(labelDir).sort()) {
      const d = join(labelDir, task);
      if (!existsSync(join(d, "meta.json"))) continue;
      const read = (f: string) => (existsSync(join(d, f)) ? JSON.parse(readFileSync(join(d, f), "utf8")) : undefined);
      runs.push({ task, run: label, check: read("check.json"), agent: read("agent.json") });
    }
  }
  rows.push("| task | run | accepted | criteria | failed | agent said | wall | load at launch | tool calls |");
  rows.push("|---|---|---|---|---|---|---:|---:|---:|");
  for (const r of runs) {
    const failed = r.check?.criteria.filter((c) => !c.pass).map((c) => c.id).join(", ") ?? "";
    rows.push(
      `| ${r.task} | ${r.run} | ${r.check ? (r.check.pass ? "yes" : "no") : "—"} | ${r.check ? `${r.check.passed}/${r.check.total}` : "—"} | ${failed} | ${r.agent?.result ?? "—"} | ${r.agent ? `${Math.round(r.agent.wallSeconds / 60)} min` : "—"} | ${r.agent?.launchLoad ?? "—"} | ${r.agent?.toolCalls ?? "—"} |`,
    );
  }
  const checked = runs.filter((r) => r.check);
  const accepted = checked.filter((r) => r.check!.pass).length;
  rows.push("", `${accepted} of ${checked.length} runs accepted.`, "");
  // Per task, over every run: the rate, and the medians of what each run cost.
  const med = (xs: number[]) => {
    const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
    return s.length === 0 ? NaN : s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  };
  rows.push("| task | accepted | median wall | median tool calls |", "|---|---|---:|---:|");
  for (const task of [...new Set(checked.map((r) => r.task))]) {
    const of = checked.filter((r) => r.task === task);
    const wall = med(of.map((r) => r.agent?.wallSeconds ?? NaN));
    const tools = med(of.map((r) => r.agent?.toolCalls ?? NaN));
    rows.push(
      `| ${task} | ${of.filter((r) => r.check!.pass).length}/${of.length} | ${Number.isFinite(wall) ? `${Math.round(wall / 60)} min` : "—"} | ${Number.isFinite(tools) ? tools : "—"} |`,
    );
  }
  const text = `${rows.join("\n")}\n`;
  if (outFile) writeFileSync(outFile, text);
  process.stdout.write(text);
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const { positional, opts } = flags(rest);
  const root = resolve(opts.get("root") ?? DEFAULT_ROOT);
  switch (cmd) {
    case "list":
      for (const name of taskNames()) console.log(`${name}  →  compositions/${(await loadTask(name)).id}`);
      return;
    case "prepare": {
      const label = opts.get("run");
      if (!label) throw new Error("prepare needs --run <label>");
      await prepare(resolveNames(positional), label, root, opts.get("ref") ?? "HEAD");
      return;
    }
    case "record": {
      const [dir] = positional;
      if (!dir || !(opts.has("transcript") || opts.has("report")))
        throw new Error("record <run-dir> --transcript <agent.jsonl> | --report <file> [--wall-s N --tool-calls N]");
      record(resolve(dir), opts);
      return;
    }
    case "check": {
      if (positional.length === 0) throw new Error("check <run-dir>…");
      let failed = 0;
      for (const dir of positional) if (!(await check(resolve(dir))).pass) failed++;
      process.exitCode = failed ? 1 : 0;
      return;
    }
    case "report":
      report(positional[0] ? resolve(positional[0]) : root, opts.get("out"));
      return;
    default:
      console.error(readFileSync(join(HERE, "README.md"), "utf8").split("\n## ")[0]);
      console.error("usage: bun evals/agent-tasks/run.ts list | prepare | record | check | report");
      process.exitCode = 2;
  }
}

await main(process.argv.slice(2)).catch((e: Error) => {
  console.error(`run.ts: ${e.message}`);
  process.exitCode = 2;
});

