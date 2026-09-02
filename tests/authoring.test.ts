/**
 * The author-facing documents, executed.
 *
 * `AGENTS.md` names this hole in its own words: the ledger forces a
 * composition to be measured or excused, and nothing forces a sentence in
 * `AUTHORING.md` to still be true. Three defects in a row were that shape, all
 * in this file — a capability described after it had already shipped, and a
 * build command whose `--outdir` named a directory nothing used, which sent
 * two readers to the wrong place before anyone noticed.
 *
 * So every ```bash fence is parsed and every command in it that CAN be run is
 * run, in document order, and its exit code is checked. A `# exit N` marker at
 * the end of a line asserts that code; the default is 0.
 *
 * WHAT IS IN SCOPE, and why the boundary is drawn here rather than "run
 * everything": `RUNNABLE` below is the CLI, the catalogue, and upstream's
 * builder — the three prefixes whose flags and paths are this repository's own
 * and go stale when it changes. `OUT_OF_SCOPE` is the short list of prefixes
 * that either mutate the checkout (`bun install`, `bun run vendor`,
 * `bun scripts/assets.ts`, a composition's `gen.ts`) or take minutes and have
 * a gate of their own (the two ledgers, which CI runs). A `bun` line matching
 * NEITHER list fails this test rather than being skipped: the point is that a
 * command cannot enter the document without someone deciding whether it is
 * checked.
 *
 * A runnable line that cannot be executed as written — it needs a job spec the
 * reader writes, or holds a port — must say so in a `# not run: <reason>`
 * comment. Skipping is a decision recorded in the document, not a silence
 * here.
 *
 * WHERE IT RUNS: a scratch tree of symlinks to this repository, with its own
 * real `dist/`, so the fences build and render into a directory of their own
 * and the checkout's artifacts do not move under a `bun test` that is running
 * beside a ledger. Fences run in ORDER and share that tree, which is what lets
 * the build fence supply the bundle the command fence then reads.
 *
 * TWO DOCUMENTS, ONE RULE. `skills/pocket-motion/SKILL.md` is what an agent
 * that has never seen this repository reads, so a command in it that stopped
 * working is the same defect one level worse — the reader has nothing else to
 * check it against. It is parsed, classified and executed exactly as
 * `AUTHORING.md` is, in its own scratch tree, and a failure names the file.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

/** Every document whose `bash` fences are executed, and where each one runs. */
const DOCS: ReadonlyArray<{ rel: string; scratch: string; minCommands: number }> = [
  { rel: "AUTHORING.md", scratch: "/tmp/pocketjs-motion-authoring-test", minCommands: 15 },
  { rel: "skills/pocket-motion/SKILL.md", scratch: "/tmp/pocketjs-motion-skill-test", minCommands: 4 },
];

/** Prefixes this gate executes. */
const RUNNABLE = [
  "bun src/cli/main.ts",
  "bun scripts/catalog.ts",
  "bun vendor/pocketjs/tools/build.ts",
] as const;

/** Prefixes deliberately not executed, each with the reason. */
const OUT_OF_SCOPE: ReadonlyArray<{ prefix: string; why: string }> = [
  { prefix: "bun install", why: "mutates node_modules in the checkout" },
  { prefix: "bun run vendor", why: "re-clones vendor/ and rebuilds the wasm core; minutes" },
  { prefix: "bun scripts/assets.ts", why: "fetches pinned assets over the network" },
  { prefix: "bun scripts/digests.ts", why: "the ledger; minutes, and CI runs it" },
  { prefix: "bun scripts/visibility.ts", why: "the other ledger; same" },
  { prefix: "bun compositions/", why: "a generator rewrites a composition's own sources" },
];

interface DocCommand {
  /** 1-based index of the fence in the document. */
  readonly fence: number;
  /** 1-based line number in AUTHORING.md. */
  readonly line: number;
  readonly text: string;
  /** Reason from a `# not run: …` marker, when there is one. */
  readonly notRun: string | null;
  /** Exit code a `# exit N` marker asserts. */
  readonly expectedExit: number;
}

/** Every `bun …` line inside a ```bash fence, with where it came from. */
export function bashCommands(markdown: string): DocCommand[] {
  const lines = markdown.split("\n");
  const out: DocCommand[] = [];
  let fence = 0;
  let inBash = false;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      if (inFence) {
        inFence = false;
        inBash = false;
      } else {
        inFence = true;
        inBash = line.slice(3).trim() === "bash";
        if (inBash) fence++;
      }
      continue;
    }
    if (!inBash) continue;
    const text = line.trim();
    if (!text.startsWith("bun ")) continue;
    const notRun = /#\s*not run:\s*(.+)$/.exec(text);
    const exit = /#\s*exit\s+(\d+)\b/.exec(text);
    out.push({
      fence,
      line: i + 1,
      text,
      notRun: notRun ? notRun[1]!.trim() : null,
      expectedExit: exit ? Number(exit[1]) : 0,
    });
  }
  return out;
}

/** The command without its trailing `# …` comment, as argv. */
export function argvOf(text: string): string[] {
  const hash = text.indexOf("#");
  const bare = (hash >= 0 ? text.slice(0, hash) : text).trim();
  return bare.split(/\s+/).filter(Boolean);
}

function classify(text: string): "runnable" | "out-of-scope" | "unknown" {
  if (RUNNABLE.some((p) => text.startsWith(p))) return "runnable";
  if (OUT_OF_SCOPE.some((e) => text.startsWith(e.prefix))) return "out-of-scope";
  return "unknown";
}

/**
 * A tree of symlinks to this repository with a real `dist/` of its own.
 *
 * Symlinks rather than copies because `vendor/` and `node_modules/` are
 * gigabytes; a real `dist/` because that is the one directory these commands
 * write, and `resolveComposition` derives it from the composition's path, so
 * pointing the commands at this tree is enough to keep them out of the
 * checkout's own artifacts.
 *
 * One per document: the fences of one document share a tree, so a build fence
 * can supply the bundle a later command fence reads, and two documents cannot
 * supply each other's — a command that only works because the OTHER document
 * built something is a command that does not work.
 */
function makeScratch(scratch: string): void {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  for (const entry of readdirSync(ROOT)) {
    if (entry === "dist" || entry === ".git") continue;
    symlinkSync(join(ROOT, entry), join(scratch, entry));
  }
  mkdirSync(join(scratch, "dist"), { recursive: true });
}

beforeAll(() => {
  for (const doc of DOCS) makeScratch(doc.scratch);
});

afterAll(() => {
  for (const doc of DOCS) rmSync(doc.scratch, { recursive: true, force: true });
});

for (const doc of DOCS) {
  const commands = bashCommands(readFileSync(join(ROOT, doc.rel), "utf8"));

  describe(`${doc.rel} commands`, () => {
    test("the document still has fences, and this gate reaches them", () => {
      expect(commands.length).toBeGreaterThan(doc.minCommands);
      expect(commands.some((c) => c.text.startsWith("bun src/cli/main.ts build"))).toBe(true);
      expect(commands.some((c) => c.text.startsWith("bun src/cli/main.ts render"))).toBe(true);
    });

    test("every `bun` line is either run, or out of scope, or says why not", () => {
      const parts: string[] = [];
      for (const command of commands) {
        const kind = classify(command.text);
        if (kind === "unknown") {
          parts.push(
            `${doc.rel}:${command.line}: ${command.text}\n` +
              "    is neither a command this gate runs nor one of the prefixes it deliberately " +
              "does not. Add it to RUNNABLE, or to OUT_OF_SCOPE with the reason.",
          );
          continue;
        }
        if (kind !== "runnable") continue;
        // A placeholder cannot be executed, so it has to be declared.
        const placeholder = /[<>…]/.test(argvOf(command.text).join(" "));
        if (placeholder && command.notRun === null) {
          parts.push(
            `${doc.rel}:${command.line}: ${command.text}\n` +
              "    carries a placeholder, so this gate cannot run it. Name a real composition, " +
              "or add `# not run: <reason>`.",
          );
        }
      }
      expect(parts, parts.join("\n") || "clean").toEqual([]);
    });

    test(
      "every runnable command in the document exits as documented",
      async () => {
        const ran: string[] = [];
        const failures: string[] = [];
        for (const command of commands) {
          if (classify(command.text) !== "runnable") continue;
          if (command.notRun !== null) continue;
          const argv = argvOf(command.text);
          const proc = Bun.spawn(argv, {
            cwd: doc.scratch,
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env },
          });
          const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ]);
          ran.push(command.text);
          if (code !== command.expectedExit) {
            failures.push(
              `${doc.rel}:${command.line} (fence ${command.fence})\n` +
                `  ${command.text}\n` +
                `  expected exit ${command.expectedExit}, got ${code}\n` +
                `${stdout.trim()}\n${stderr.trim()}`.trimEnd(),
            );
          }
        }
        // The gate reaching nothing would pass silently, which is the shape it
        // exists to catch one level up.
        expect(ran.length, `${doc.rel}: commands run: ${ran.length}`).toBeGreaterThan(2);
        expect(
          failures.join("\n\n") || "every documented command exited as documented",
        ).toBe("every documented command exited as documented");
      },
      300_000,
    );

    test("the build fence really built into this document's scratch tree", () => {
      // If it had not, every command after it would have been reading the
      // repository's own artifacts and this gate would be testing the
      // checkout's state rather than the document.
      expect(existsSync(join(doc.scratch, "dist/compositions/smoke/main.js"))).toBe(true);
      expect(existsSync(join(doc.scratch, "dist/compositions/smoke/build.json"))).toBe(true);
    });
  });
}
