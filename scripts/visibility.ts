#!/usr/bin/env bun
/**
 * The visibility ledger: sweep every composition and hold the counts.
 *
 * `visibility` fails on a node carrying a `debugName` in either of two states:
 * it paints and no sampled frame shows it, or a sampled frame shows it and a
 * later one has it covered. Both lines were drawn from a measurement — 26
 * nodes in the tree are never shown and 7 are buried after being shown, and of
 * those 33 exactly three are named, all of them fixtures — and until this
 * script existed the measurement was a sentence in a header comment. Nothing re-derived it, so `reel`'s odometer
 * changing shape or a `debugName` being deleted would have moved it silently.
 * That is the defect this repository has now recorded three times, one level
 * up: prose no gate reaches.
 *
 *   bun scripts/visibility.ts             # verify (exit 1 on any drift)
 *   bun scripts/visibility.ts --write     # re-record, after an intended change
 *   bun scripts/visibility.ts --only reel
 *
 * THREE THINGS ARE PINNED PER COMPOSITION, and each is a different claim.
 *
 * - `failures` — the named nodes in either failing state, BY NAME. Usually
 *   empty. `compositions/occluded` records `["buried"]` and
 *   `compositions/spanned` records `["spanning", "trailing"]`, because those
 *   fixtures ARE the defect (and, for `trailing`, the reading's known reach)
 *   and a run where either comes back clean means the gate stopped working. A
 *   guard whose own red case is not pinned is an assertion about a guard
 *   rather than a guard.
 * - `named` — how many nodes carry a `debugName`. This is the gate's REACH,
 *   and it is the number most likely to rot: deleting names is invisible to
 *   every other check in the tree and shrinks what `visibility` can ever fail
 *   on. `reel` records 0 of 631, which is the honest state and is meant to
 *   read as debt.
 * - `neverShown` and `buriedAfterShown` — every node in each state, named or
 *   not. The noise the `named` restriction exists to step around; if either
 *   moves, the reason the restriction was chosen has moved with it.
 *
 * WHAT IT COSTS. Each composition is built through the command the CLI itself
 * prints, and a composition with footage is ingested — the same raw-RGBA decode
 * `trace` needs, tens of GB across the tree, reused when already on disk. With
 * that decode already present, a full verify run over all 32 is 4m39s on an
 * M-series laptop, of which `reel` — the heaviest, 631 nodes over 24 frames —
 * is about 40 seconds. An order of magnitude under the digest ledger, which is
 * why this is a thing you run rather than a thing you mean to.
 *
 * Generators are NOT re-run here. `scripts/digests.ts` already refuses when a
 * generated composition's committed sources differ from what its generator
 * produces, and doing it twice would mean two places to keep honest.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_SAMPLES } from "../src/cli/commands/visibility.ts";
import { runBuild } from "../src/cli/build.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { discoverCompositions } from "../src/cli/discover.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const LEDGER = join(ROOT, "baselines/visibility.json");

/**
 * Compositions this cannot sweep, each with the fact that keeps it out.
 *
 * Membership is the default here and not, as in `scripts/digests.ts`, a thing
 * a composition earns. A digest pins a delivered picture and a fixture has no
 * picture to pin; a visibility sweep asks whether what is declared is on
 * screen, which every composition has an answer to — and the fixtures are
 * where the answer is most worth having, because that is where the red case
 * lives.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  "compositions/malicious":
    "The determinism rejection fixture: it does not boot. `hardenedBootWorld` raises " +
    "a DeterminismViolation by design, so there is no tree to sweep and a sweep " +
    "that passed would mean the refusal stopped working. `trace` is what pins it.",
  "compositions/missing-image":
    "The fixture for `images.missingFile`. It boots and sweeps clean — the " +
    "picture nobody can see is a 32×32 checkerboard the build baked in place " +
    "of a file that is not there, and a checkerboard is on screen like any " +
    "other image. This sweep answers a different question from the one the " +
    "fixture is red for; `lint` and `check` are what refuse it.",
};

interface Record_ {
  /** Named nodes no sampled frame shows, by name. */
  readonly failures: readonly string[];
  /** Named-or-text nodes swept. */
  readonly nodes: number;
  /** Of those, how many carry a `debugName` — the gate's reach. */
  readonly named: number;
  /** Every node that paints and is never shown, named or not. */
  readonly neverShown: number;
  /** Every node shown at some sampled frame and covered at a later one. */
  readonly buriedAfterShown: number;
}
interface Ledger {
  readonly samples: number;
  readonly compositions: Record<string, Record_>;
}

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const onlyAt = argv.indexOf("--only");
const ONLY = onlyAt >= 0 ? argv[onlyAt + 1] : undefined;

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function spawn(cmd: string[]): Promise<Ran> {
  const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

async function mustRun(cmd: string[], label: string): Promise<string> {
  const r = await spawn(cmd);
  if (r.code !== 0) {
    throw new Error(`${label} failed\n${cmd.join(" ")}\n${r.stdout}\n${r.stderr}`);
  }
  return r.stdout;
}

/**
 * Every composition is either swept or excused, and the excuse is written down.
 *
 * The discovery rule is `src/cli/discover.ts`, shared with the digest ledger
 * and preview's rail, so a composition added tomorrow cannot fall out of one
 * loop while staying in the other.
 */
async function assertCoverage(
  swept: readonly string[],
  found: readonly string[],
): Promise<void> {

  const listed = new Set(swept);
  const problems: string[] = [];
  for (const dir of found) {
    const inSweep = listed.has(dir);
    const inExempt = dir in EXEMPT;
    if (inSweep && inExempt) {
      problems.push(`${dir}: both swept and excused — decide which`);
    } else if (!inSweep && !inExempt) {
      problems.push(
        `${dir}: neither swept nor excused. It is swept by default; add it to ` +
          "EXEMPT with the fact that keeps it out.",
      );
    }
  }
  for (const dir of Object.keys(EXEMPT)) {
    if (!found.includes(dir)) {
      problems.push(`${dir}: excused but no such composition — renamed or removed?`);
    }
    if (EXEMPT[dir]!.trim().length === 0) {
      problems.push(`${dir}: excused with a blank reason`);
    }
  }
  if (problems.length > 0) {
    console.error(`\n${problems.length} composition(s) are not accounted for:\n`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
}

interface VisibilityJson {
  readonly failures: readonly string[];
  readonly nodes: readonly unknown[];
  readonly namedNodes: number;
  readonly neverShown: readonly string[];
  readonly buriedAfterShown: readonly string[];
  readonly impossible: readonly string[];
}

// One discovery rule, in src/cli/discover.ts: this sweep, the digest ledger
// and preview's rail all read the same list. Anchored on ROOT, like every
// other path here: asked from `process.cwd()` the sweep was a claim about
// wherever the script was invoked from rather than about this tree.
const found = (await discoverCompositions(ROOT)).dirs;
const all = found.filter((d) => !(d in EXEMPT));

await assertCoverage(all, found);

const results: Record<string, Record_> = {};
const failures: string[] = [];

for (const dir of all) {
  if (ONLY && !dir.includes(ONLY)) continue;

  const resolved = await resolveComposition({
    dir: join(ROOT, dir),
    flags: { json: false },
    requireBundle: false,
  });
  if (!resolved.ok) throw new Error(`${dir}: ${resolved.message}`);
  // Through `runBuild` — the one place a build is spawned, and what writes
  // `build.json` beside the artifacts the CLI is about to be pointed at.
  await runBuild(resolved.value);

  // Through the CLI, not the module: the exit code is half of what is being
  // checked, and an author reaching for this reaches for the command.
  const ran = await spawn(["bun", "src/cli/main.ts", "visibility", dir, "--json"]);
  if (ran.code !== 0 && ran.code !== 1) {
    throw new Error(`${dir} visibility exited ${ran.code}\n${ran.stdout}\n${ran.stderr}`);
  }
  const json = JSON.parse(ran.stdout) as VisibilityJson;

  // The exit code and the payload have to agree, or one of them is lying.
  const expectedCode = json.failures.length > 0 || json.impossible.length > 0 ? 1 : 0;
  if (ran.code !== expectedCode) {
    failures.push(
      `${dir}\n  exit ${ran.code} with ${json.failures.length} failure(s) — the code and the JSON disagree`,
    );
  }
  if (json.impossible.length > 0) {
    failures.push(
      `${dir}\n  ${json.impossible.length} node(s) changed a pixel while removing no draw-list word.\n` +
        "  The framebuffer is a function of that word stream — the host is broken.",
    );
  }

  results[dir] = {
    failures: [...json.failures].sort(),
    nodes: json.nodes.length,
    named: json.namedNodes,
    neverShown: json.neverShown.length,
    buriedAfterShown: json.buriedAfterShown.length,
  };
  console.log(
    `${dir.padEnd(32)} ${String(json.nodes.length).padStart(4)} node(s)  ` +
      `${String(json.namedNodes).padStart(4)} named  ` +
      `${String(json.neverShown.length).padStart(3)} never shown  ` +
      `${String(json.buriedAfterShown.length).padStart(3)} buried  ` +
      (json.failures.length > 0 ? `FAIL ${json.failures.join(", ")}` : "ok"),
  );
}

const totals = Object.values(results).reduce(
  (acc, r) => ({
    named: acc.named + r.named,
    neverShown: acc.neverShown + r.neverShown,
    buried: acc.buried + r.buriedAfterShown,
    failures: acc.failures + r.failures.length,
  }),
  { named: 0, neverShown: 0, buried: 0, failures: 0 },
);
console.log(
  `\n${totals.named} named node(s) swept · ${totals.neverShown} never shown · ` +
    `${totals.buried} buried after being shown · ${totals.failures} named, which is the gate`,
);

if (WRITE) {
  const merged: Record<string, Record_> = existsSync(LEDGER)
    ? { ...((JSON.parse(await Bun.file(LEDGER).text()) as Ledger).compositions ?? {}) }
    : {};
  Object.assign(merged, results);
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  await Bun.write(
    LEDGER,
    JSON.stringify({ samples: DEFAULT_SAMPLES, compositions: sorted }, null, 2) + "\n",
  );
  console.log(`wrote ${LEDGER}`);
  process.exit(0);
}

if (!existsSync(LEDGER)) {
  console.error(`\nno ledger at ${LEDGER} — create it with --write`);
  process.exit(1);
}
const ledger = JSON.parse(await Bun.file(LEDGER).text()) as Ledger;

// The counts only mean anything at the sample count they were taken at, so a
// changed default invalidates the file rather than quietly shifting it.
if (ledger.samples !== DEFAULT_SAMPLES) {
  failures.push(
    `the ledger was recorded at --samples ${ledger.samples} and the default is now ` +
      `${DEFAULT_SAMPLES}. Every count in it was taken on a different grid; re-record.`,
  );
}

for (const [dir, got] of Object.entries(results)) {
  const want = ledger.compositions[dir];
  if (!want) {
    failures.push(`${dir}: not in the ledger (add it with --write)`);
    continue;
  }
  const same = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  if (!same(want.failures, got.failures)) {
    failures.push(
      `${dir}\n  recorded failures [${want.failures.join(", ")}]\n` +
        `  got               [${got.failures.join(", ")}]` +
        (want.failures.length > 0 && got.failures.length === 0
          ? "\n  A recorded failure that came back clean means the gate stopped working," +
            "\n  not that the composition got better. Check the command before the film."
          : ""),
    );
  }
  for (const key of ["nodes", "named", "neverShown", "buriedAfterShown"] as const) {
    if (want[key] !== got[key]) {
      failures.push(`${dir}: ${key} recorded ${want[key]}, got ${got[key]}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`${f}\n`);
  console.error(
    "A change here is either a regression or an intended one. If it is intended,\n" +
      "re-record with `bun scripts/visibility.ts --write` in the same commit as the\n" +
      "change that moved it, so the diff shows both.",
  );
  process.exit(1);
}
console.log(`${Object.keys(results).length} composition(s) match the visibility ledger.`);
