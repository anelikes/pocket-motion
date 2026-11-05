/**
 * What a check reads: the checkout's own CLI, run as a separate process in
 * the checkout it was delivered in — never this repository's `src/`, which
 * may be a different revision — and the frames that CLI writes.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, type Rgba } from "./png.ts";
import type { Rect } from "./pixels.ts";

export interface CliResult {
  readonly code: number;
  // biome-ignore lint: the CLI's JSON is read by key
  readonly json: any;
  readonly stderr: string;
}

export interface LayoutNode extends Rect {
  readonly id: number;
  readonly kind: string;
  readonly name?: string;
  readonly text?: string;
  readonly class?: string;
  readonly inPicture: boolean;
  readonly visibility: string;
  readonly ink?: Rect;
  readonly findings: { code: string }[];
}

/** The environment a checkout's CLI runs in: this process's, minus anything
 *  that would point the child at a different tree. */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "POCKETJS_ROOT") env[k] = v;
  return env;
}

export class CheckContext {
  readonly rel: string;
  readonly abs: string;
  private readonly layouts = new Map<number, Promise<LayoutNode[]>>();
  private readonly frames = new Map<number, Promise<Rgba>>();

  constructor(
    /** The checkout the agent worked in. */
    readonly repo: string,
    readonly id: string,
    /** The inputs the agent was given. */
    readonly inputs: string,
    /** Where the check may write. */
    readonly scratch: string,
  ) {
    this.rel = `compositions/${id}`;
    this.abs = join(repo, this.rel);
    mkdirSync(scratch, { recursive: true });
  }

  async cli(args: readonly string[], timeoutMs = 600_000): Promise<CliResult> {
    const proc = Bun.spawn(["bun", "src/cli/main.ts", ...args], {
      cwd: this.repo,
      stdout: "pipe",
      stderr: "pipe",
      env: cleanEnv(),
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    clearTimeout(timer);
    let json: unknown = null;
    try {
      json = JSON.parse(out);
    } catch {
      json = null;
    }
    return { code, json, stderr: err };
  }

  sidecar(): Record<string, unknown> {
    return JSON.parse(readFileSync(join(this.abs, "pocket-motion.json"), "utf8"));
  }

  layout(frame: number): Promise<LayoutNode[]> {
    let p = this.layouts.get(frame);
    if (!p) {
      p = this.cli(["layout", this.rel, "--at", String(frame), "--json"]).then((r) => {
        if (!r.json?.nodes) throw new Error(`layout --at ${frame}: ${r.json?.error ?? r.stderr.slice(0, 300)}`);
        return r.json.nodes as LayoutNode[];
      });
      this.layouts.set(frame, p);
    }
    return p;
  }

  async node(frame: number, name: string): Promise<LayoutNode | undefined> {
    return (await this.layout(frame)).find((n) => n.name === name);
  }

  /** The canvas in logical px, as `layout` reports it. */
  async viewport(): Promise<[number, number]> {
    const r = await this.cli(["layout", this.rel, "--at", "0", "--json"]);
    const v = r.json?.viewport as [number, number] | undefined;
    if (!v) throw new Error(`layout --at 0: ${r.json?.error ?? r.stderr.slice(0, 300)}`);
    return v;
  }

  /**
   * Frame `at` at the canvas size. `frame` writes a supersampled film's
   * frames at the supersampled size; they are box-filtered down here, which
   * is what a delivery at the canvas size is made of.
   */
  frame(at: number): Promise<Rgba> {
    let p = this.frames.get(at);
    if (!p) {
      const out = join(this.scratch, `frame-${at}.png`);
      p = Promise.all([this.cli(["frame", this.rel, "--at", String(at), "--out", out]), this.viewport()]).then(
        ([r, [w]]) => {
          if (!existsSync(out)) throw new Error(`frame --at ${at}: ${r.stderr.slice(0, 300)}`);
          const img = decodePng(new Uint8Array(readFileSync(out)));
          return img.w > w && img.w % w === 0 ? boxDown(img, img.w / w) : img;
        },
      );
      this.frames.set(at, p);
    }
    return p;
  }

  /** The source PNG an input names, decoded. */
  input(name: string): Rgba {
    return decodePng(new Uint8Array(readFileSync(join(this.inputs, name))));
  }
}

/** An image reduced by an integer factor, each pixel the mean of its block. */
function boxDown(img: Rgba, k: number): Rgba {
  const w = img.w / k;
  const h = img.h / k;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += img.data[((y * k + dy) * img.w + x * k + dx) * 4 + c]!;
        data[(y * w + x) * 4 + c] = Math.round(s / (k * k));
      }
  return { w, h, data };
}

/** ffprobe's reading of a delivered file's first video stream. */
export async function probeVideo(path: string): Promise<{
  width: number;
  height: number;
  frames: number;
  codec: string;
  pixFmt: string;
  duration: number;
} | null> {
  if (!existsSync(path)) return null;
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_packets",
      "-show_entries",
      "stream=width,height,codec_name,pix_fmt,nb_read_packets:format=duration",
      "-of",
      "json",
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  try {
    const j = JSON.parse(text);
    const s = j.streams?.[0];
    if (!s) return null;
    return {
      width: s.width,
      height: s.height,
      frames: Number(s.nb_read_packets),
      codec: s.codec_name,
      pixFmt: s.pix_fmt,
      duration: Number(j.format?.duration),
    };
  } catch {
    return null;
  }
}
