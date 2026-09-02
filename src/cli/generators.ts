/**
 * Running a composition's generator — the one invocation, in one place.
 *
 * A `gen.ts` beside a `main.tsx` writes that composition: its `app.tsx`, and
 * sometimes bytes as well. `compositions/glow` and `compositions/glow-column`
 * bake their glow plates to PNG, and `.gitignore` ignores `*.png`, so on a
 * fresh checkout those files do not exist until the generator has run. The
 * digest ledger has always run them first; nothing else did, and CI run
 * 33606149934 is what that cost — `bun test` runs before
 * `bun scripts/digests.ts`, so the image lint (`src/lint/images.ts`) correctly
 * reported `glow-column`'s two plates absent on a machine where no generator
 * had run, while every developer's tree had them from the last ledger run.
 *
 * The invocation is `bun <dir>/gen.ts` from the repository root, and it is
 * here rather than copied into each caller so that a change to it reaches the
 * ledger and the tests together.
 *
 * Two generators write from ARGUMENTS instead — a spec file, a grid — and
 * decline when they are given none. That is a property of those generators,
 * not a failure, and it costs a written reason in `PARAMETERISED` below rather
 * than a silently swallowed exit code: `runGenerator` insists that a listed
 * generator really does decline and that an unlisted one really does run, so
 * the table is held to the tree rather than to memory.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export class GeneratorError extends Error {}

/**
 * Generators that write a composition from arguments, with the usage line each
 * prints when run without them.
 *
 * Both are driven by a probe that supplies the arguments per run, and both are
 * excused from the digest ledger for the same reason (`scripts/digests.ts`,
 * `EXEMPT`): there is no fixed composition for either to reproduce.
 */
export const PARAMETERISED: Readonly<Record<string, string>> = {
  "compositions/fit":
    "usage: gen.ts <spec.json> — `scripts/fit-probe.ts` writes the spec per run",
  "compositions/shimmer":
    "usage: gen.ts <cols> <rows> <cell> — `scripts/shimmer-probe.ts` supplies the grid",
};

/** Absolute path of `dir`'s generator, or null when it has none. */
export function generatorPath(root: string, dir: string): string | null {
  const gen = join(root, dir, "gen.ts");
  return existsSync(gen) ? gen : null;
}

export interface GeneratorRun {
  /** Composition directory, relative to the repository root. */
  readonly dir: string;
  /** False when the generator declined for want of arguments. */
  readonly ran: boolean;
}

/**
 * Run one composition's generator.
 *
 * Returns `ran: false` for a generator in `PARAMETERISED` that declined the
 * way its entry says it does. Every other non-zero exit throws with the
 * generator's own output, because a generator that cannot write its
 * composition leaves whatever is on disk standing in for what it would have
 * written.
 */
export async function runGenerator(root: string, dir: string): Promise<GeneratorRun> {
  const gen = generatorPath(root, dir);
  if (gen === null) throw new GeneratorError(`${dir}: no gen.ts`);

  const proc = Bun.spawn(["bun", gen], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const listed = dir in PARAMETERISED;
  // Exit 2 and a usage line is how both of them decline. Anything else from a
  // listed generator means the entry has gone stale, which is worth as much
  // noise as a failure: the caller would otherwise skip a generator that is
  // perfectly able to run.
  const declined = code === 2 && /(^|\n)usage:/.test(err);

  if (declined && listed) return { dir, ran: false };
  if (declined) {
    throw new GeneratorError(
      `${dir}: its generator writes from arguments and was given none —\n  ${err.trim()}\n` +
        "Add it to PARAMETERISED in src/cli/generators.ts with the reason nothing " +
        "can run it bare, or give this caller the arguments.",
    );
  }
  if (code !== 0) {
    throw new GeneratorError(`${dir}: gen.ts exited ${code}\n${out}\n${err}`);
  }
  if (listed) {
    throw new GeneratorError(
      `${dir}: PARAMETERISED says its generator needs arguments (${PARAMETERISED[dir]}), ` +
        "but it ran with none. Remove the entry.",
    );
  }
  return { dir, ran: true };
}

/**
 * Run the generator of every directory in `dirs` that has one, in order.
 *
 * Directories without a `gen.ts` are skipped and absent from the result, so
 * the result is what ran rather than what was asked for.
 */
export async function runGenerators(
  root: string,
  dirs: readonly string[],
): Promise<GeneratorRun[]> {
  const runs: GeneratorRun[] = [];
  for (const dir of dirs) {
    if (generatorPath(root, dir) === null) continue;
    runs.push(await runGenerator(root, dir));
  }
  return runs;
}
