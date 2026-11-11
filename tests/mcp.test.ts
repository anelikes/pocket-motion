/**
 * `pocket-motion mcp`, driven over stdio as a client drives it.
 *
 * One server process per describe block, spawned as `bun src/cli/main.ts mcp`
 * and spoken to in newline-delimited JSON-RPC on its stdin. Every line it
 * writes to stdout must parse as one JSON-RPC message; a line that does not is
 * recorded and fails the case that was running, because a client would have
 * dropped the connection on it.
 *
 * Results are compared with the API called in THIS process on the same input,
 * so the claim is the one the server makes — a tool returns what its
 * `src/api.ts` function returns — and `tests/api.test.ts` carries it the rest
 * of the way to the CLI.
 *
 * RED, each one measured by making the edit, watching it fail, reverting:
 *
 * - the loop in `src/render/render.ts` never calling
 *   `signal.throwIfAborted()`: the cancelled render, the cancelled trace and
 *   the render whose client hung up all report frame 450 of 450. The png-seq
 *   case stays green — `takeBack` after the loop still removes the
 *   directory — so it is the guard for `takeBack`, not for the loop.
 * - `render`'s command encoding straight to `--out` instead of to
 *   `partialPathOf`: the earlier delivery comes back as the first bytes of an
 *   mp4 (`ftypisom…`), and the hung-up render's file is on disk.
 * - the png-seq branch of `takeBack` removed: the frame directory is left.
 * - the per-frame `setImmediate` in `render.ts` removed: the cancelled trace
 *   reports frame 450, and the cancelled png-seq render is not stopped within
 *   the case's two minutes. The two mp4 cases stay green — the encoder pipe's
 *   flush is I/O and gives stdin its turn — which is why the trace and png-seq
 *   cases are the guard.
 * - `Turns` bypassed (`tool.call` directly): the second render reports
 *   frame 1 before the first render has answered.
 * - either half of the redirect in `serveStdio` removed: the generator's
 *   `console.log` line, or its `process.stdout.write` line, arrives on stdout.
 *   Each half catches only its own — Bun's `console.log` does not go through
 *   `process.stdout.write`.
 * - the abort of everything still running once stdin closes removed: the
 *   hung-up render runs to frame 450.
 * - the SIGTERM handler in `serveStdio` removed: the signal kills the
 *   process mid-render, exit 143, with nothing unwound.
 * - `isError` set from `ok === false` rather than from an `error` field:
 *   `layout-codes`' failing `verify` comes back marked as a tool error.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import * as api from "../src/api.ts";
import { RUN_ID_ENV } from "../src/cli/emit.ts";

const ROOT = resolve(import.meta.dir, "..");
const CLI = join(ROOT, "src/cli/main.ts");
const SMOKE = "compositions/smoke";
const CODES = "compositions/layout-codes";
const RUN = "mcp-protocol";

const scratch = mkdtempSync(join(tmpdir(), "motion-mcp-"));
let previousRunId: string | undefined;
let previousCwd: string;

beforeAll(async () => {
  previousRunId = process.env[RUN_ID_ENV];
  process.env[RUN_ID_ENV] = RUN;
  // The server runs with the checkout as its cwd, so the API here does too.
  previousCwd = process.cwd();
  process.chdir(ROOT);
  for (const dir of [SMOKE, CODES]) {
    const built = await api.build(dir);
    if (built.ok !== true) throw new Error(`build ${dir}: ${JSON.stringify(built)}`);
  }
}, 240_000);

afterAll(() => {
  if (previousRunId === undefined) delete process.env[RUN_ID_ENV];
  else process.env[RUN_ID_ENV] = previousRunId;
  process.chdir(previousCwd);
  rmSync(scratch, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

/** A client: one server process, every message it wrote, and a way to wait for one. */
class Client {
  readonly proc;
  readonly received: Json[] = [];
  /** stdout lines that were not one JSON-RPC message. */
  readonly garbage: string[] = [];
  stderr = "";
  #nextId = 1;
  #waiters: Array<{ match: (m: Json) => boolean; resolve: (m: Json) => void }> = [];

  constructor() {
    this.proc = Bun.spawn(["bun", CLI, "mcp"], {
      cwd: ROOT,
      env: { ...process.env, [RUN_ID_ENV]: RUN },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    void this.#read();
    void new Response(this.proc.stderr).text().then((t) => (this.stderr = t));
  }

  async #read(): Promise<void> {
    const decoder = new TextDecoder();
    let buffered = "";
    for await (const chunk of this.proc.stdout) {
      buffered += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        let message: Json;
        try {
          message = JSON.parse(line) as Json;
          if (message.jsonrpc !== "2.0") throw new Error("not JSON-RPC 2.0");
        } catch {
          this.garbage.push(line);
          continue;
        }
        this.received.push(message);
        this.#waiters = this.#waiters.filter((w) => {
          if (!w.match(message)) return true;
          w.resolve(message);
          return false;
        });
      }
    }
  }

  send(message: Json): void {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    this.proc.stdin.flush();
  }

  /** The first message, already received or still to come, that matches. */
  next(match: (m: Json) => boolean, timeoutMs = 120_000): Promise<Json> {
    const seen = this.received.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no matching message in ${timeoutMs} ms; stderr:\n${this.stderr}`)),
        timeoutMs,
      );
      this.#waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  /** Sends a request and returns its id; `response(id)` waits for the answer. */
  request(method: string, params: Json = {}): number {
    const id = this.#nextId++;
    this.send({ id, method, params });
    return id;
  }

  response(id: number, timeoutMs?: number): Promise<Json> {
    return this.next((m) => m.id === id && m.method === undefined, timeoutMs);
  }

  async call(name: string, args: Json, progressToken?: string): Promise<Json> {
    const id = this.request("tools/call", {
      name,
      arguments: args,
      ...(progressToken ? { _meta: { progressToken } } : {}),
    });
    const message = await this.response(id);
    if (message.error) throw new Error(`${name}: ${JSON.stringify(message.error)}`);
    return message.result as Json;
  }

  progress(token: string): Json[] {
    return this.received
      .filter((m) => m.method === "notifications/progress" && (m.params as Json).progressToken === token)
      .map((m) => m.params as Json);
  }

  async initialize(): Promise<Json> {
    const id = this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "tests/mcp.test.ts", version: "0" },
    });
    const result = (await this.response(id)).result as Json;
    this.send({ method: "notifications/initialized" });
    return result;
  }

  async close(): Promise<number> {
    this.proc.stdin.end();
    return this.proc.exited;
  }
}

/** The structured result, after checking the text content says the same thing. */
function structured(result: Json): Json {
  const content = result.content as Array<{ type: string; text: string }>;
  expect(content).toHaveLength(1);
  expect(content[0]!.type).toBe("text");
  expect(JSON.parse(content[0]!.text)).toEqual(result.structuredContent);
  return result.structuredContent as Json;
}

const timing = ["elapsedMs", "msPerFrame"];
const withoutTiming = (o: Json): Json =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !timing.includes(k)));

/** ffmpeg processes the server has spawned and not reaped. */
function ffmpegChildren(pid: number): string {
  const p = Bun.spawnSync(["pgrep", "-P", String(pid), "ffmpeg"]);
  return p.stdout.toString().trim();
}

describe("mcp — the protocol", () => {
  let client: Client;
  beforeAll(() => {
    client = new Client();
  });
  afterAll(async () => {
    expect(await client.close()).toBe(0);
  });

  test("initialize names the server and echoes a version it speaks", async () => {
    const result = await client.initialize();
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(result.serverInfo).toEqual({ name: "pocket-motion", title: "Pocket Motion", version: pkg.version });
    expect(typeof result.instructions).toBe("string");
  });

  test("tools/list: the seven tools, the picture-reading ones first, each with a closed schema", async () => {
    const result = (await client.response(client.request("tools/list"))).result as Json;
    const tools = result.tools as Array<{ name: string; inputSchema: Json; annotations: Json }>;
    expect(tools.map((t) => t.name)).toEqual(["verify", "assert", "layout", "render", "concat", "trace", "doctor"]);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      if (tool.name !== "doctor") expect(tool.inputSchema.required).toContain("dir");
    }
    expect((tools.find((t) => t.name === "layout")!.inputSchema.required as string[])).toEqual(["dir", "at"]);
    expect((tools.find((t) => t.name === "concat")!.inputSchema.required as string[])).toEqual(["dir", "segments", "out"]);
    expect(tools.find((t) => t.name === "render")!.annotations.readOnlyHint).toBe(false);
  });

  test("ping answers; an unknown method is -32601; an unknown tool is -32602", async () => {
    expect((await client.response(client.request("ping"))).result).toEqual({});
    expect(((await client.response(client.request("resources/list"))).error as Json).code).toBe(-32601);
    const id = client.request("tools/call", { name: "build", arguments: { dir: SMOKE } });
    expect(((await client.response(id)).error as Json).code).toBe(-32602);
  });

  test("doctor is api.doctor(), with only the free-space figure normalised", async () => {
    const free = (o: unknown) => JSON.parse(JSON.stringify(o).replace(/\d+(?:\.\d+)? GiB free/g, "N GiB free"));
    const result = await client.call("doctor", {});
    expect(result.isError).toBe(false);
    expect(free(structured(result))).toEqual(free(await api.doctor()));
  }, 120_000);

  test("render reports every frame it finished and returns api.render's object", async () => {
    const out = join(scratch, "smoke.mp4");
    const result = await client.call("render", { dir: SMOKE, frames: 30, out }, "render-30");
    expect(result.isError).toBe(false);
    const fromServer = structured(result);
    expect(fromServer.ok).toBe(true);
    expect(fromServer.runId).toBe(RUN);

    const progress = client.progress("render-30");
    expect(progress.length).toBeGreaterThan(0);
    const values = progress.map((p) => p.progress as number);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
    expect(progress.at(-1)).toEqual({
      progressToken: "render-30",
      progress: 30,
      total: 30,
      message: "frame 30 of 30",
    });

    const fromApi = (await api.render(SMOKE, { frames: 30, out })) as Json;
    expect(withoutTiming(fromServer)).toEqual(withoutTiming(fromApi));
  }, 120_000);

  test("verify, assert and layout return the API's objects", async () => {
    const verified = await client.call("verify", { dir: CODES, samples: 2 });
    const verdict = structured(verified);
    expect(verdict).toEqual((await api.verify(CODES, { samples: 2 })) as never);
    // `buried` is this fixture's recorded visibility failure. A verdict of
    // no is the reading that was asked for, not a tool that failed.
    expect(verdict).toMatchObject({ ok: false, errors: ["visibility"] });
    expect(verified.isError).toBe(false);

    const asserted = await client.call("assert", { dir: CODES });
    const assertion = structured(asserted);
    expect(assertion).toEqual((await api.assert(CODES)) as never);
    expect((assertion.assertions as unknown[]).length).toBeGreaterThan(0);

    const laid = await client.call("layout", { dir: CODES, at: 10 });
    expect(structured(laid)).toEqual((await api.layout(CODES, { at: 10 })) as never);
  }, 300_000);

  test("a command's own refusal is the API's refusal, marked isError", async () => {
    const result = await client.call("trace", { dir: "compositions/no-such-composition" });
    expect(result.isError).toBe(true);
    const refusal = structured(result);
    expect(refusal.exitCode).toBe(2);
    expect(refusal).toEqual((await api.trace("compositions/no-such-composition")) as never);
  }, 60_000);

  test("concat: a segment that is not there is the API's usage error", async () => {
    const args = { segments: ["no-such-segment.mp4"], out: "joined.mp4" };
    const result = await client.call("concat", { dir: SMOKE, ...args });
    expect(result.isError).toBe(true);
    const refusal = structured(result);
    expect(refusal.exitCode).toBe(2);
    expect(refusal.error).toContain("no segment manifest");
    expect(refusal).toEqual((await api.concat(SMOKE, args.segments, { out: args.out })) as never);
    expect(existsSync(join(ROOT, "joined.mp4"))).toBe(false);
  }, 60_000);

  test("arguments the schema does not allow are refused before any command runs", async () => {
    const unknown = structured(await client.call("render", { dir: SMOKE, out: "x.mp4", fsp: 30 }));
    expect(unknown).toMatchObject({ ok: false, exitCode: 2 });
    expect(unknown.error).toContain('unknown argument "fsp"');

    const typed = await client.call("render", { dir: SMOKE, out: "x.mp4", alpha: "false" });
    expect(typed.isError).toBe(true);
    expect(structured(typed).error).toContain("alpha must be true or false");

    const missing = structured(await client.call("layout", { dir: SMOKE }));
    expect(missing.error).toContain("at is required");

    const segments = structured(await client.call("concat", { dir: SMOKE, segments: [3], out: "x.mp4" }));
    expect(segments.error).toContain("segments must be a non-empty array of non-empty strings");
    expect(existsSync(join(ROOT, "x.mp4"))).toBe(false);
  });

  // Red with `glyphRefusal` removed from `render`: the job stages, builds
  // and renders the tofu, and the result is a delivery.
  test("render refuses a job whose faces lack a character, naming it, before anything is staged", async () => {
    const spec = JSON.parse(readFileSync(join(ROOT, "compositions/lower-third/spec.default.json"), "utf8")) as {
      copy: { name: string };
    };
    spec.copy.name = "Mumbai ₹ 1,299";
    const job = join(scratch, "rupee.json");
    writeFileSync(job, JSON.stringify(spec));
    const out = join(scratch, "rupee.mp4");
    const result = await client.call("render", { dir: "compositions/lower-third", spec: job, out });
    expect(result.isError).toBe(true);
    const body = structured(result);
    expect(body.ok).toBe(false);
    expect(body.missingGlyphs).toEqual([
      { field: "/copy/name", char: "₹", codePoint: "U+20B9", face: "regular", file: "assets/fonts/NotoSansSC-Regular.otf" },
      { field: "/copy/name", char: "₹", codePoint: "U+20B9", face: "bold", file: "assets/fonts/NotoSansSC-Bold.otf" },
    ]);
    expect(existsSync(out)).toBe(false);
  });

  test("every line on stdout was one JSON-RPC message", () => {
    expect(client.garbage).toEqual([]);
  });
});

describe("mcp — long calls", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client();
    await client.initialize();
  });
  afterAll(async () => {
    expect(await client.close()).toBe(0);
  });

  test("a cancelled render stops at the next frame, keeps the earlier delivery and leaves nothing of its own", async () => {
    const dir = join(scratch, "cancel");
    mkdirSync(dir);
    const out = join(dir, "smoke.mp4");
    writeFileSync(out, "an earlier delivery");

    const id = client.request("tools/call", {
      name: "render",
      arguments: { dir: SMOKE, out },
      _meta: { progressToken: "doomed" },
    });
    await client.next((m) => m.method === "notifications/progress" && (m.params as Json).progressToken === "doomed");
    client.send({ method: "notifications/cancelled", params: { requestId: id, reason: "the test changed its mind" } });

    // Renders take turns, so this one's answer means the cancelled one has
    // unwound: ffmpeg killed, the partial removed.
    const after = await client.call("render", { dir: SMOKE, frames: 2, out: join(scratch, "after.mp4") });
    expect(structured(after).ok).toBe(true);

    expect(client.received.some((m) => m.id === id)).toBe(false);
    const reached = Math.max(...client.progress("doomed").map((p) => p.progress as number));
    expect(reached).toBeLessThan(450);
    expect(readFileSync(out, "utf8")).toBe("an earlier delivery");
    expect(readdirSync(dir)).toEqual(["smoke.mp4"]);
    expect(ffmpegChildren(client.proc.pid)).toBe("");
  }, 120_000);

  test("a cancelled png-seq render removes the frames it wrote and the directory it made", async () => {
    const out = join(scratch, "frames");
    const id = client.request("tools/call", {
      name: "render",
      arguments: { dir: SMOKE, out, format: "png-seq" },
      _meta: { progressToken: "stills" },
    });
    await client.next((m) => m.method === "notifications/progress" && (m.params as Json).progressToken === "stills");
    client.send({ method: "notifications/cancelled", params: { requestId: id } });
    await client.call("render", { dir: SMOKE, frames: 2, out: join(scratch, "after-stills.mp4") });

    expect(client.received.some((m) => m.id === id)).toBe(false);
    expect(existsSync(out)).toBe(false);
  }, 120_000);

  test("a cancelled trace stops at the next frame", async () => {
    const id = client.request("tools/call", {
      name: "trace",
      arguments: { dir: SMOKE },
      _meta: { progressToken: "hashing" },
    });
    await client.next((m) => m.method === "notifications/progress" && (m.params as Json).progressToken === "hashing");
    client.send({ method: "notifications/cancelled", params: { requestId: id } });
    await client.call("trace", { dir: SMOKE, frames: 2 });

    expect(client.received.some((m) => m.id === id)).toBe(false);
    const reached = Math.max(...client.progress("hashing").map((p) => p.progress as number));
    expect(reached).toBeLessThan(450);
  }, 120_000);

  test("renders take turns: the second waits, says so, and starts after the first answers", async () => {
    const first = client.request("tools/call", {
      name: "render",
      arguments: { dir: SMOKE, frames: 60, out: join(scratch, "first.mp4") },
      _meta: { progressToken: "first" },
    });
    const second = client.request("tools/call", {
      name: "render",
      arguments: { dir: SMOKE, frames: 10, out: join(scratch, "second.mp4") },
      _meta: { progressToken: "second" },
    });
    await client.response(second);

    const order = client.received.map((m) =>
      m.id === first ? "first answered" : (m.params as Json | undefined)?.progressToken === "second"
        ? `second at ${(m.params as Json).progress}`
        : null,
    ).filter((x) => x !== null);
    expect(order[0]).toBe("second at 0");
    expect((client.progress("second")[0]!.message as string)).toContain("waiting for 1 earlier call");
    expect(order[1]).toBe("first answered");
  }, 120_000);

  test("every line on stdout was one JSON-RPC message", () => {
    expect(client.garbage).toEqual([]);
  });
});

describe("mcp — the process", () => {
  test("a generator's stdout goes to stderr, never into the protocol", async () => {
    const dir = join(scratch, "talkative");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "gen.ts"),
      [
        "export async function stageJob(): Promise<never> {",
        '  console.log("a generator talking on stdout");',
        '  process.stdout.write("and writing to it\\n");',
        '  throw new Error("this fixture stages nothing");',
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(join(dir, "job.json"), "{}\n");

    const client = new Client();
    await client.initialize();
    const result = await client.call("render", {
      dir,
      spec: join(dir, "job.json"),
      out: join(scratch, "talkative.mp4"),
    });
    expect(result.isError).toBe(true);
    expect(structured(result).error).toBe("this fixture stages nothing");
    expect(await client.close()).toBe(0);
    expect(client.garbage).toEqual([]);
    expect(client.stderr).toContain("a generator talking on stdout");
    expect(client.stderr).toContain("and writing to it");
  }, 60_000);

  test("closing stdin cancels a running render, and the server exits once it has taken its output back", async () => {
    const out = join(scratch, "orphan.mp4");
    const client = new Client();
    await client.initialize();
    client.request("tools/call", {
      name: "render",
      arguments: { dir: SMOKE, out },
      _meta: { progressToken: "orphan" },
    });
    await client.next((m) => m.method === "notifications/progress" && (m.params as Json).progressToken === "orphan");
    expect(await client.close()).toBe(0);

    const reached = Math.max(...client.progress("orphan").map((p) => p.progress as number));
    expect(reached).toBeLessThan(450);
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(scratch).filter((n) => n.includes(".partial-"))).toEqual([]);
    expect(client.garbage).toEqual([]);
  }, 120_000);

  test("SIGTERM unwinds as a hang-up does: the render takes its output back before the exit", async () => {
    const out = join(scratch, "terminated.mp4");
    const client = new Client();
    await client.initialize();
    client.request("tools/call", {
      name: "render",
      arguments: { dir: SMOKE, out },
      _meta: { progressToken: "terminated" },
    });
    await client.next((m) => m.method === "notifications/progress" && (m.params as Json).progressToken === "terminated");
    client.proc.kill("SIGTERM");
    expect(await client.proc.exited).toBe(0);

    expect(existsSync(out)).toBe(false);
    expect(readdirSync(scratch).filter((n) => n.startsWith(".terminated.partial-"))).toEqual([]);
    expect(client.garbage).toEqual([]);
  }, 120_000);

  test("mcp refuses arguments: every option is a tool's, per call", async () => {
    const p = Bun.spawn(["bun", CLI, "mcp", "--json"], { cwd: ROOT, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    expect(code).toBe(2);
    expect(JSON.parse(stdout).error).toContain("mcp takes no arguments");
  });
});
