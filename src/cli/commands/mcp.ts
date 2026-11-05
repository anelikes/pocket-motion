/**
 * `mcp`
 * Question: none of its own — it serves the API's functions as Model Context
 * Protocol tools on stdin and stdout until stdin closes (`src/mcp/server.ts`).
 *
 * It takes no arguments and no flags. Every flag a tool can use is that
 * tool's argument, per call; one given here would apply to nothing. `--json`
 * in particular is refused: it would put one more object on the stdout the
 * protocol owns.
 */

import { join } from "node:path";
import { UsageError, parseArgs } from "../args.ts";
import { EXIT_OK, type CommandResult } from "../types.ts";

export async function runFromArgv(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseArgs(["mcp", ...argv]);
  const given = [...parsed.positionals, ...Object.keys(parsed.flags).map((f) => `--${f}`)];
  if (given.length > 0) {
    throw new UsageError(
      `mcp takes no arguments (got ${given.join(" ")}): every option is a tool argument, ` +
        "given per call, and stdout belongs to the protocol",
    );
  }
  // Loaded here rather than imported at the top: the server imports
  // `src/api.ts`, which imports the dispatcher that lists this command.
  const { serveStdio } = await import("../../mcp/server.ts");
  const pkg = (await Bun.file(join(import.meta.dir, "../../../package.json")).json()) as {
    version: string;
  };
  return { exitCode: EXIT_OK, keepAlive: serveStdio(pkg.version) };
}
