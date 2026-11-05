/**
 * `pocket-motion mcp`: the API as Model Context Protocol tools, over
 * newline-delimited JSON-RPC 2.0 on stdin and stdout.
 *
 * EVERY TOOL IS AN API CALL. A tool's arguments are the options of the
 * `src/api.ts` function of the same name, with the composition directory as
 * `dir`, and its result is the object that function returns — which is the
 * object the CLI prints with `--json` (`tests/api.test.ts`). It comes back
 * twice, as `structuredContent` and as the text content, the same object
 * serialised, for a client that reads only text. Nothing here re-derives a
 * verdict or reshapes a section: a tool that did would be a third
 * implementation of the command, and `tests/mcp.test.ts` holds each result
 * equal to the API's.
 *
 * WHAT THIS LAYER ADDS, and it is four things, none of them about the picture:
 *
 * - The argument TYPES each tool's schema declares are checked here, because
 *   JSON has types an argv does not: `alpha: "false"` would reach the parser
 *   as `--alpha=false`. A key the schema does not name is refused too, so a
 *   misspelt option is an error rather than a silently absent flag. Every
 *   VALUE the CLI checks (fps dividing 60, a frame in range, a format against
 *   an extension) is still the CLI's to refuse, in its own words.
 * - `isError` is set exactly when the object carries an `error` string: the
 *   command could not produce its reading. `verify` with `ok: false` and
 *   `errors[]`, a failing `assert`, a red `doctor` are readings — what the
 *   caller asked for — and are not tool errors.
 * - Progress. `render` and `trace` report each finished frame through the
 *   API's `RunContext`; a call that carries a `progressToken` gets them as
 *   `notifications/progress`, at most one every `PROGRESS_INTERVAL_MS` plus
 *   the last frame. A call that has to wait its turn gets one at 0 saying so.
 * - Cancellation. `notifications/cancelled` fires the call's `AbortSignal`.
 *   `render` and `trace` stop at the next frame boundary and a cancelled
 *   render leaves no file it wrote (`src/cli/commands/render.ts`). Every other
 *   tool runs to the end. Either way no response is sent for a cancelled
 *   request, as the protocol asks. A client that closes stdin, or ends the
 *   server with SIGTERM or SIGINT — the protocol's next step when closing
 *   stdin does not end it — cancels everything still running, and the server
 *   exits once that has unwound. A second signal is not caught.
 *
 * ONE AT A TIME. Every tool but `doctor` rasterises a composition, and the
 * rasteriser is wasm on this process's one thread: two calls at once would
 * not run side by side, they would interleave frame by frame, each as slow as
 * both. So they take turns in arrival order (`Turns`), and the client sees a
 * second render wait rather than both crawl. `doctor` spawns and hashes and
 * boots nothing, so it never waits.
 *
 * STDOUT IS THE PROTOCOL. A `--spec` job imports the composition's
 * `gen.ts` into this process, and a generator is not this repository's code
 * to police: one line it prints would arrive at the client as a malformed
 * message. So while serving, the console methods that write stdout and
 * `process.stdout.write` itself go to stderr, and only `serveStdio`'s own
 * writer reaches fd 1.
 */

import { createInterface } from "node:readline";

import * as api from "../api.ts";
import type { FrameProgress, RunContext } from "../cli/types.ts";

/** Newest first; an `initialize` asking for another gets the first. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** The least time between two progress notifications for one call. */
export const PROGRESS_INTERVAL_MS = 250;

type Json = Record<string, unknown>;

interface Property {
  readonly type: "string" | "integer" | "boolean" | "array";
  readonly description: string;
  readonly enum?: readonly (string | number)[];
  readonly minimum?: number;
  readonly items?:
    | { readonly type: "integer"; readonly minimum: number }
    | { readonly type: "string" };
}

export interface Tool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, Property>>;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
  readonly annotations: Json;
  /** Boots a composition, so takes its turn with every other tool that does. */
  readonly rasterises: boolean;
  readonly call: (args: Json, control: RunContext) => Promise<unknown>;
}

const DIR: Property = {
  type: "string",
  description:
    "The composition directory, such as compositions/smoke. A relative path resolves against the server's working directory.",
};

const COMPOSITION_FLAGS: Readonly<Record<string, Property>> = {
  frames: {
    type: "integer",
    minimum: 1,
    description: "Override the duration in frames: how many frames are rendered, traced or observed.",
  },
  fps: { type: "integer", minimum: 1, description: "Override the frame rate; it must divide 60." },
  width: { type: "integer", minimum: 1, description: "Override the viewport width." },
  height: { type: "integer", minimum: 1, description: "Override the viewport height." },
  supersample: { type: "integer", enum: [1, 2, 4], description: "Override the supersample factor." },
  bundle: { type: "string", description: "A built guest bundle other than the composition's dist path." },
  pak: { type: "string", description: "A built asset pak other than the composition's dist path." },
};

const HASH: Property = {
  type: "string",
  enum: ["sha256", "fast"],
  description: "The per-frame hash. sha256 (the default) is the one the digest ledger records.",
};

const READ: Property = {
  type: "string",
  enum: ["exposure", "tick"],
  description:
    "Under a declared shutter: classify each node in the delivered exposure (the default), or in the frame's own tick at one raster a probe instead of `samples`. tick misses a node only the blur reveals; use it to iterate and the default for the verdict. Ignored without a shutter.",
};

const SAMPLES: Property = {
  type: "integer",
  minimum: 1,
  description:
    "How many evenly spaced frames, first and last included, to read. Default 24. Every verdict is about these frames and nothing between them; durationFrames is the exact case.",
};

function composition(
  extra: Readonly<Record<string, Property>>,
  required: readonly string[] = [],
): Tool["inputSchema"] {
  return {
    type: "object",
    properties: { dir: DIR, ...extra, ...COMPOSITION_FLAGS },
    required: ["dir", ...required],
    additionalProperties: false,
  };
}

/** `dir` is the positional; everything else is the API function's options. */
function split(args: Json): [string, Json] {
  const { dir, ...options } = args;
  return [dir as string, options];
}

const READS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/**
 * In the order a client lists them: the tools that read the picture first,
 * because they are what this server is for — `render` produces a file, and
 * any renderer does that.
 */
export const TOOLS: readonly Tool[] = [
  {
    name: "verify",
    title: "Verify a composition",
    description:
      "The gate: lint, check, keyframes, visibility, layout at sampled frames and assert, in one object whose sections are those commands' own output verbatim. " +
      "ok is the verdict; errors names each section whose own verdict failed; warnings counts layout findings, which count towards ok only with strict. " +
      "visibility fails a named node that paints and is never shown, or is shown and then covered; assert fails a sidecar assertion the picture does not hold. " +
      "Needs a built composition.",
    inputSchema: composition({
      samples: { ...SAMPLES, description: "How many layout frames, evenly spaced. Default 5. Mutually exclusive with at." },
      at: {
        type: "array",
        items: { type: "integer", minimum: 0 },
        description: "Explicit layout frames instead of samples.",
      },
      strict: { type: "boolean", description: "Count active layout findings towards ok." },
      read: READ,
    }),
    annotations: READS,
    rasterises: true,
    call: (args) => {
      const [dir, options] = split(args);
      return api.verify(dir, options as api.VerifyOptions);
    },
  },
  {
    name: "assert",
    title: "Check what the composition is for",
    description:
      "Evaluates the sidecar's assertions[] against the picture. Each names a node's debugName and one predicate — inPicture [from,to], entersBy, exitsBy, insideBox, dwellFrames, before — " +
      "read from whether hiding that node changes a pixel at each sampled frame, not from where its box is. " +
      "Returns one verdict per assertion with the frames it was read at; failures lists the ones that do not hold. A name the tree does not carry fails rather than being skipped. " +
      "Needs a built composition.",
    inputSchema: composition({ samples: SAMPLES, read: READ }),
    annotations: READS,
    rasterises: true,
    call: (args) => {
      const [dir, options] = split(args);
      return api.assert(dir, options as api.AssertOptions);
    },
  },
  {
    name: "layout",
    title: "Lay out one frame",
    description:
      "At frame `at`: every named or text node's border-box rect, whether it is in the picture (hiding it changes a pixel — a rect alone is captured before the opacity cull and proves nothing), " +
      "whether a dark node is covered or invisible by declaration, and the finding codes text_not_painted, text_occluded, panel_out_of_canvas, escaped_container, content_overlap, text_box_overflow, clipped_text. " +
      "Findings are reported, never failed on; findingCounts holds the ones no layoutAllow excuses. Needs a built composition.",
    inputSchema: composition(
      {
        at: { type: "integer", minimum: 0, description: "The frame to lay out." },
        all: { type: "boolean", description: "Every node, unnamed scaffolding included." },
        read: READ,
      },
      ["at"],
    ),
    annotations: READS,
    rasterises: true,
    call: (args) => {
      const [dir, options] = split(args);
      return api.layout(dir, options as unknown as api.LayoutOptions);
    },
  },
  {
    name: "render",
    title: "Render the video",
    description:
      "Encodes the composition to out as mp4, webm, mov or a png-seq directory, or with spec renders a job: the composition's generator writes a staged copy from the job file, which is built, rendered and removed. " +
      "Returns outputPath, the frame digest trace reports, and trace's identity (none for a job). " +
      "With a progressToken it reports every frame; cancelled, it stops at the next frame and leaves no file it wrote — out keeps what it held before. " +
      "Needs a built composition unless spec is given.",
    inputSchema: composition({
      out: { type: "string", description: "The output file, or the directory for png-seq. Required unless outDir is." },
      spec: { type: "string", description: "A job spec file, or a directory of them, which takes outDir." },
      outDir: { type: "string", description: "Where one output per job goes, for a directory of specs." },
      format: {
        type: "string",
        enum: ["mp4", "webm", "mov", "png-seq"],
        description: "The container. Default: out's extension, else mp4.",
      },
      alpha: { type: "boolean", description: "Ask the codec for an alpha channel; refused for mp4." },
      hash: HASH,
      workers: {
        type: "integer",
        minimum: 1,
        description:
          "Render as this many segments in as many processes and join them; the digest is trace's either way. On one machine libx264 already uses the cores, so this buys little there.",
      },
      range: {
        type: "array",
        items: { type: "integer", minimum: 0 },
        description:
          "[first, last]: render only these frames, both included, as a segment for the concat tool — out plus out.segment.json, no digest and no sound. Refused with spec and with workers.",
      },
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    rasterises: true,
    call: (args, control) => {
      const [dir, options] = split(args);
      return api.render(dir, options as api.RenderOptions, control);
    },
  },
  {
    name: "concat",
    title: "Join segments into the film",
    description:
      "Joins segments render wrote with range — rendered here or on other machines, in any order — into one film at out, and muxes the composition's sound once over it. " +
      "Refused, with a code per reason, when they are not one film: different identity, a gap, an overlap, different encoding, a file changed since it was rendered, or bitstreams a stream copy cannot join. " +
      "The joined file is read back before it replaces out. Returns the digest trace reports for that identity. Needs the built composition the segments came from.",
    inputSchema: composition({
      segments: {
        type: "array",
        items: { type: "string" },
        description: "Each segment's out, or its .segment.json.",
      },
      out: { type: "string", description: "The joined film: a file, or a directory for png-seq segments." },
      hash: HASH,
    }, ["segments", "out"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    rasterises: true,
    call: (args, control) => {
      const { dir, segments, ...options } = args;
      return api.concat(dir as string, segments as string[], options as unknown as api.ConcatOptions, control);
    },
  },
  {
    name: "trace",
    title: "Hash every frame",
    description:
      "The per-frame hash sequence, its digest, and input identity — bundle, pak, sidecar, fonts, footage, render parameters and the toolchain that built them. " +
      "Two machines that agree on identity and disagree on digest have found an input nobody declared. " +
      "With a progressToken it reports every frame; cancelled, it stops at the next one. Needs a built composition.",
    inputSchema: composition({ hash: HASH }),
    annotations: READS,
    rasterises: true,
    call: (args, control) => {
      const [dir, options] = split(args);
      return api.trace(dir, options as api.CompositionFlags, control);
    },
  },
  {
    name: "doctor",
    title: "Check the installation",
    description:
      "Can this installation build and render at all: Bun against the one the ledger was recorded on, rustup and the wasm target, ffmpeg and ffprobe, the vendored tree at its pin, the fetched assets, free disk. " +
      "ok is the verdict, and every failing check carries the command that repairs it.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    annotations: READS,
    rasterises: false,
    call: () => api.doctor(),
  },
];

export const INSTRUCTIONS = [
  "pocket-motion renders a composition directory (compositions/<name>) to byte-identical frames with no browser, and reads the picture back without anyone looking at it.",
  "- verify is the gate. assert checks what the composition is FOR — the sidecar's assertions[] — against the picture. layout reads one frame: rects, what is in the picture, finding codes.",
  "- Each tool returns the object the same CLI command prints with --json. isError means the command could not produce its reading; ok: false without an error field is the reading.",
  "- Every tool but doctor needs the composition built first with the CLI's build command, and a missing build is refused with that command. render with spec builds its staged job itself.",
  "- Paths in results are redacted: $REPO is the checkout and $HOME the home directory. Relative paths in arguments resolve against the server's working directory.",
  "- Tools other than doctor run one at a time, in arrival order. render and trace report frame progress to a call with a progressToken and stop at the next frame when cancelled; concat stops between its steps; a cancelled render or concat leaves no file it wrote. Other tools run to the end.",
  "- When something fails for a reason outside the composition, call doctor: each failing check names the command that fixes it.",
].join("\n");

/**
 * What is wrong with `args` for `tool`, as sentences; empty when nothing is.
 * Types and names only — the schema's subset this server writes — never a
 * value the CLI checks.
 */
export function invalidArguments(tool: Tool, args: unknown): string[] {
  if (args === undefined) return invalidArguments(tool, {});
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return ["arguments must be an object"];
  }
  const given = args as Json;
  const { properties, required } = tool.inputSchema;
  const problems: string[] = [];
  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(properties, key)) {
      const known = Object.keys(properties);
      problems.push(
        `unknown argument ${JSON.stringify(key)}; ${tool.name} takes ` +
          (known.length > 0 ? known.join(", ") : "none"),
      );
    }
  }
  for (const key of required) {
    if (given[key] === undefined) problems.push(`${key} is required`);
  }
  for (const [key, value] of Object.entries(given)) {
    const property = properties[key];
    if (property === undefined || value === undefined) continue;
    const why = typeProblem(property, value);
    if (why !== null) problems.push(`${key} ${why}`);
  }
  return problems;
}

function typeProblem(property: Property, value: unknown): string | null {
  switch (property.type) {
    case "string":
      if (typeof value !== "string" || value.length === 0) return "must be a non-empty string";
      break;
    case "boolean":
      if (typeof value !== "boolean") return "must be true or false";
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) return "must be an integer";
      if (property.minimum !== undefined && value < property.minimum) {
        return `must be at least ${property.minimum}`;
      }
      break;
    case "array": {
      const items = property.items!;
      if (items.type === "string") {
        if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v.length > 0)) {
          return "must be a non-empty array of non-empty strings";
        }
        break;
      }
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        !value.every((v) => typeof v === "number" && Number.isInteger(v) && v >= items.minimum)
      ) {
        return `must be a non-empty array of integers of at least ${items.minimum}`;
      }
      break;
    }
  }
  if (property.enum !== undefined && !property.enum.includes(value as string | number)) {
    return `must be one of ${property.enum.map((e) => JSON.stringify(e)).join(", ")}`;
  }
  return null;
}

/** An API object as a tool result. */
export function toolResult(value: unknown): Json {
  const object = value as Json;
  return {
    content: [{ type: "text", text: JSON.stringify(object) }],
    structuredContent: object,
    isError: typeof object.error === "string",
  };
}

/** A FIFO turn: each `run` starts when every earlier one has settled. */
export class Turns {
  #tail: Promise<void> = Promise.resolve();
  #held = 0;

  /** Calls holding the turn or waiting for it. */
  get held(): number {
    return this.#held;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const before = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((done) => (release = done));
    this.#held++;
    try {
      await before;
      return await work();
    } finally {
      this.#held--;
      release();
    }
  }
}

/**
 * Frame progress as `notifications/progress`. The protocol wants `progress`
 * to grow with every notification, so for a directory of jobs it counts
 * frames across jobs and states no `total`, which no job knows in advance.
 */
function progressNotifier(
  send: (message: Json) => void,
  progressToken: string | number,
): (progress: FrameProgress) => void {
  let base = 0;
  let job: string | undefined;
  let jobFrames = 0;
  let sentAt = Number.NEGATIVE_INFINITY;
  return (p) => {
    if (p.job !== job) {
      base += jobFrames;
      job = p.job;
    }
    jobFrames = p.frames;
    const now = performance.now();
    if (p.done < p.frames && now - sentAt < PROGRESS_INTERVAL_MS) return;
    sentAt = now;
    send({
      method: "notifications/progress",
      params: {
        progressToken,
        progress: base + p.done,
        ...(p.job === undefined ? { total: p.frames } : {}),
        message: `${p.job === undefined ? "" : `${p.job}: `}frame ${p.done} of ${p.frames}`,
      },
    });
  };
}

export interface Transport {
  /** One JSON-RPC message a line; ends when the client goes away. */
  readonly lines: AsyncIterable<string>;
  /** Writes one line; resolves once it has been handed to the OS. */
  readonly write: (line: string) => Promise<void>;
  /** A diagnostic for a person, never for the client. */
  readonly log: (line: string) => void;
}

/** Serve until the client closes its end, then cancel what is left and return once it has unwound. */
export async function serve(transport: Transport, version: string): Promise<void> {
  const running = new Map<string | number, AbortController>();
  const pending = new Set<Promise<void>>();
  const turns = new Turns();
  let lastWrite: Promise<void> = Promise.resolve();

  const send = (message: Json): void => {
    lastWrite = transport
      .write(JSON.stringify({ jsonrpc: "2.0", ...message }))
      .catch((e: unknown) => transport.log(`pocket-motion mcp: write failed: ${String(e)}`));
  };

  const handle = async (message: Json): Promise<void> => {
    const { id, method } = message;
    const params = (message.params ?? {}) as Json;
    if (typeof method !== "string") {
      // A response to a request: this server sends none. Anything else is malformed.
      if (id === undefined || "result" in message || "error" in message) return;
      send({ id, error: { code: -32600, message: "Invalid Request: no method" } });
      return;
    }
    if (id === undefined || id === null) {
      if (method === "notifications/cancelled") {
        const target = params.requestId as string | number;
        running.get(target)?.abort(
          new Error(typeof params.reason === "string" ? params.reason : "the client cancelled the request"),
        );
      }
      return;
    }
    const requestId = id as string | number;
    const reply = (result: Json): void => send({ id: requestId, result });
    const fail = (code: number, text: string): void => send({ id: requestId, error: { code, message: text } });

    switch (method) {
      case "initialize": {
        const requested = params.protocolVersion;
        reply({
          protocolVersion: PROTOCOL_VERSIONS.find((v) => v === requested) ?? PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "pocket-motion", title: "Pocket Motion", version },
          instructions: INSTRUCTIONS,
        });
        return;
      }
      case "ping":
        reply({});
        return;
      case "tools/list":
        reply({
          tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations,
          })),
        });
        return;
      case "tools/call":
        break;
      default:
        fail(-32601, `Method not found: ${method}`);
        return;
    }

    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) {
      fail(-32602, `Unknown tool: ${String(params.name)}; this server has ${TOOLS.map((t) => t.name).join(", ")}`);
      return;
    }
    const controller = new AbortController();
    running.set(requestId, controller);
    try {
      const args = (params.arguments ?? {}) as Json;
      const problems = invalidArguments(tool, params.arguments);
      let value: unknown;
      if (problems.length > 0) {
        // The shape of the CLI's own usage error, so a caller branches on it
        // the same way: the invocation was wrong, exit code 2.
        value = { ok: false, error: `${tool.name}: ${problems.join("; ")}`, exitCode: 2 };
      } else {
        const progressToken = (params._meta as Json | undefined)?.progressToken;
        const notify =
          typeof progressToken === "string" || typeof progressToken === "number"
            ? progressNotifier(send, progressToken)
            : undefined;
        const control: RunContext = {
          signal: controller.signal,
          ...(notify ? { onProgress: notify } : {}),
        };
        if (!tool.rasterises) {
          value = await tool.call(args, control);
        } else {
          if (turns.held > 0 && notify) {
            send({
              method: "notifications/progress",
              params: {
                progressToken,
                progress: 0,
                message: `waiting for ${turns.held} earlier call(s) to finish rasterising`,
              },
            });
          }
          value = await turns.run(() =>
            controller.signal.aborted ? Promise.resolve(null) : tool.call(args, control),
          );
        }
      }
      if (!controller.signal.aborted) reply(toolResult(value));
    } catch (e) {
      // The API resolves with a refusal rather than throwing, so this is a
      // defect in this server or below it, and is reported as one.
      if (!controller.signal.aborted) {
        fail(-32603, `pocket-motion mcp: ${tool.name} threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      running.delete(requestId);
    }
  };

  for await (const line of transport.lines) {
    if (line.trim() === "") continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      send({ id: null, error: { code: -32600, message: "Invalid Request: one JSON-RPC object a line" } });
      continue;
    }
    const task = handle(message as Json).catch((e: unknown) =>
      transport.log(`pocket-motion mcp: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`),
    );
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }

  // The client is gone: stop what is running so a render takes back its
  // partial output, and wait for that before the process may exit.
  for (const controller of running.values()) controller.abort(new Error("the client disconnected"));
  await Promise.all(pending);
  await lastWrite;
}

/** `serve` on this process's stdin and stdout, with stdout kept for the protocol. */
export async function serveStdio(version: string): Promise<void> {
  const stdout = process.stdout.write.bind(process.stdout);
  const consoleMethods = ["log", "info", "debug", "dir", "table"] as const;
  const saved = consoleMethods.map((name) => console[name]);
  const savedWrite = process.stdout.write;
  for (const name of consoleMethods) {
    console[name] = (...args: unknown[]) => console.error(...args);
  }
  process.stdout.write = ((...args: Parameters<typeof process.stderr.write>) =>
    process.stderr.write(...args)) as typeof process.stdout.write;
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const hangUp = (): void => lines.close();
  process.once("SIGTERM", hangUp);
  process.once("SIGINT", hangUp);
  try {
    await serve(
      {
        lines,
        write: (line) =>
          new Promise<void>((done, fail) => {
            stdout(`${line}\n`, (err) => (err ? fail(err) : done()));
          }),
        log: (line) => {
          process.stderr.write(`${line}\n`);
        },
      },
      version,
    );
  } finally {
    process.off("SIGTERM", hangUp);
    process.off("SIGINT", hangUp);
    consoleMethods.forEach((name, i) => {
      console[name] = saved[i] as never;
    });
    process.stdout.write = savedWrite;
  }
}
