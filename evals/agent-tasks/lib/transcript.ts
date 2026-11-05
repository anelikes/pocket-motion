/**
 * What an agent did, read from its Claude Code transcript (one JSON object a
 * line: `assistant` messages carrying `tool_use`, `user` messages carrying the
 * matching `tool_result`). The agent's own FRICTION list is what it chose to
 * mention; this is what it ran, so the two can be compared: every command
 * that came back as an error, every pocket-motion CLI call and how it ended.
 */

import { readFileSync } from "node:fs";

export interface ToolError {
  readonly tool: string;
  /** The command or file the call was about, shortened. */
  readonly what: string;
  /** The first lines of what came back. */
  readonly result: string;
}

export interface TranscriptSummary {
  readonly wallSeconds: number;
  readonly toolCalls: number;
  readonly byTool: Record<string, number>;
  /** `src/cli/main.ts <command>` calls, by command. */
  readonly cliCalls: Record<string, number>;
  /** Of those, the ones whose call came back as an error, by command. */
  readonly cliErrors: Record<string, number>;
  readonly errors: readonly ToolError[];
  /**
   * Diagnostic lines out of pocket-motion CLI calls, whatever the call's own
   * status: an agent that pipes through `tail` turns every exit code into 0,
   * so a refusal shows up only as its text.
   */
  readonly diagnostics: readonly ToolError[];
  /**
   * The calls that read rather than ran: `Read`, and shell commands that
   * open files (`cat`, `sed -n`, `grep`, `head`, …) without running the CLI.
   */
  readonly readingCalls: number;
  /** Distinct files those calls named, by where they live: the documents,
   *  this repository's code and compositions, and the vendored engine — an
   *  agent reading the engine's source is reading what no document said. */
  readonly filesRead: { docs: string[]; repo: string[]; vendor: string[] };
  /** The agent's last message: the report the preamble asks for. */
  readonly finalReport: string;
}

interface Entry {
  type?: string;
  timestamp?: string;
  message?: { content?: unknown };
}

interface Block {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
  text?: string;
}

const text = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c: Block) => (typeof c === "string" ? c : (c.text ?? ""))).join("\n")
      : "";

/** A CLI line that reports something wrong: a coded diagnostic, an error, a
 *  refusal, a failing gate. */
const DIAGNOSTIC = /(\b[a-z]+\.[a-zA-Z]+: |\berror\b|\bError\b|refus|\bFAIL\b|ok":false|not ok|\bfailed\b)/;

/** A shell command that reads files rather than running anything. */
const READING = /^(cat|sed|head|tail|grep|rg|less|ls|find|wc|awk)\b/;

/** A Bash command with its `cd <checkout> &&` prefix taken off. */
const shorten = (cmd: string): string => cmd.replace(/^cd\s+\S+\s*&&\s*/, "").replace(/\s+/g, " ").slice(0, 200);

export function summarise(path: string): TranscriptSummary {
  const entries = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as Entry;
      } catch {
        return {} as Entry;
      }
    });
  const stamps = entries.map((e) => (e.timestamp ? Date.parse(e.timestamp) : NaN)).filter(Number.isFinite);
  const uses = new Map<string, Block>();
  const byTool: Record<string, number> = {};
  const cliCalls: Record<string, number> = {};
  const cliErrors: Record<string, number> = {};
  const errors: ToolError[] = [];
  const diagnostics: ToolError[] = [];
  let readingCalls = 0;
  const read = { docs: new Set<string>(), repo: new Set<string>(), vendor: new Set<string>() };
  const noteFile = (path: string) => {
    const rel = path.replace(/^.*?\/repo\//, "").replace(/^\.\//, "");
    if (rel.startsWith("vendor/")) read.vendor.add(rel);
    else if (/^[A-Z][A-Z_]*\.md$|^skills\/|^docs\//.test(rel)) read.docs.add(rel);
    else read.repo.add(rel);
  };
  let finalReport = "";
  const cliOf = (b: Block): string[] => {
    const cmd = b.name === "Bash" ? String(b.input?.command ?? "") : "";
    return [...cmd.matchAll(/src\/cli\/main\.ts\s+([a-z]+)/g)].map((m) => m[1]!);
  };
  for (const e of entries) {
    const blocks = Array.isArray(e.message?.content) ? (e.message!.content as Block[]) : [];
    if (e.type === "assistant") {
      const said = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
      if (said) finalReport = said;
      for (const b of blocks) {
        if (b.type !== "tool_use" || !b.id) continue;
        // A subagent hands its report back through a tool; that is the
        // harness's mechanics, not a step of the work.
        if (b.name === "SubagentHandback") {
          finalReport = String(b.input?.message ?? finalReport);
          continue;
        }
        uses.set(b.id, b);
        byTool[b.name ?? "?"] = (byTool[b.name ?? "?"] ?? 0) + 1;
        if (b.name === "Read") {
          readingCalls++;
          noteFile(String(b.input?.file_path ?? ""));
        } else if (b.name === "Bash" && cliOf(b).length === 0) {
          const cmd = shorten(String(b.input?.command ?? ""));
          if (READING.test(cmd)) {
            readingCalls++;
            for (const m of cmd.matchAll(/[\w./-]+\.(?:md|tsx?|rs|json)\b/g)) noteFile(m[0]);
          }
        }
        for (const c of cliOf(b)) cliCalls[c] = (cliCalls[c] ?? 0) + 1;
      }
    } else if (e.type === "user") {
      for (const b of blocks) {
        if (b.type !== "tool_result") continue;
        const use = b.tool_use_id ? uses.get(b.tool_use_id) : undefined;
        if (use && cliOf(use).length > 0) {
          const lines = text(b.content)
            .split("\n")
            .filter((l) => DIAGNOSTIC.test(l))
            .map((l) => l.replace(/^\S*\/repo\//, "").trim().slice(0, 300));
          if (lines.length)
            diagnostics.push({ tool: "Bash", what: shorten(String(use.input?.command ?? "")), result: lines.slice(0, 6).join(" ⏎ ") });
        }
        if (!b.is_error) continue;
        if (use) for (const c of cliOf(use)) cliErrors[c] = (cliErrors[c] ?? 0) + 1;
        const input = use?.input ?? {};
        const what = shorten(String(input.command ?? input.file_path ?? input.pattern ?? JSON.stringify(input)));
        const result = text(b.content).split("\n").filter((l) => l.trim()).slice(0, 6).join(" ⏎ ").slice(0, 500);
        errors.push({ tool: use?.name ?? "?", what, result });
      }
    }
  }
  return {
    wallSeconds: stamps.length ? Math.round((Math.max(...stamps) - Math.min(...stamps)) / 1000) : 0,
    toolCalls: Object.values(byTool).reduce((s, n) => s + n, 0),
    byTool,
    cliCalls,
    cliErrors,
    errors,
    diagnostics,
    readingCalls,
    filesRead: { docs: [...read.docs].sort(), repo: [...read.repo].sort(), vendor: [...read.vendor].sort() },
    finalReport,
  };
}
