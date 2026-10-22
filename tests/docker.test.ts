/**
 * The Dockerfile reproduces the claim CI checks, so its pins are CI's.
 *
 * The image and `.github/workflows/determinism.yml` are two descriptions of
 * one run — build every composition in the ledger on Linux/x86-64 and compare
 * against `baselines/digests.json` — written in two files. Each pin that can
 * move a digest is read out of both and required equal: the Bun the ledger
 * was recorded on, and the ffmpeg build whose decoder writes the frozen
 * footage artifacts. A pin bumped in one file and not the other would make the
 * image reproduce a different claim from the one the badge reports, and both
 * would stay green.
 *
 * Nothing here builds the image; that is minutes and a daemon. What it holds
 * is the text that decides what the image is. Red, measured: changing one hex
 * digit of the Dockerfile's FFMPEG_SHA256 fails "ffmpeg".
 */

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const dockerfile = await Bun.file(join(ROOT, "Dockerfile")).text();
const dockerignore = await Bun.file(join(ROOT, ".dockerignore")).text();
const workflow = await Bun.file(join(ROOT, ".github/workflows/determinism.yml")).text();
const ledger = (await Bun.file(join(ROOT, "baselines/digests.json")).json()) as { bun: string };

/** `ARG NAME=value` in the Dockerfile. */
function arg(name: string): string | undefined {
  return new RegExp(`^ARG ${name}=(\\S+)$`, "m").exec(dockerfile)?.[1];
}

/** `NAME: value` in the workflow's env blocks. */
function env(name: string): string | undefined {
  return new RegExp(`^\\s+${name}: (\\S+)$`, "m").exec(workflow)?.[1];
}

describe("the image is the workflow's run", () => {
  test("Bun: the image's tag is the workflow's and the ledger's", () => {
    const from = /^FROM --platform=linux\/amd64 oven\/bun:([\d.]+)@sha256:[0-9a-f]{64}$/m.exec(dockerfile);
    expect(from?.[1]).toBeDefined();
    const workflowBun = /bun-version: ([\d.]+)/.exec(workflow)?.[1];
    expect(from![1]).toBe(workflowBun!);
    expect(from![1]).toBe(ledger.bun);
  });

  test("ffmpeg: the same release asset, by the same sha256", () => {
    expect(arg("FFMPEG_URL")).toBeDefined();
    expect(arg("FFMPEG_URL")).toBe(env("FFMPEG_URL")!);
    expect(arg("FFMPEG_SHA256")).toMatch(/^[0-9a-f]{64}$/);
    expect(arg("FFMPEG_SHA256")).toBe(env("FFMPEG_SHA256")!);
    expect(dockerfile).toContain('sha256sum -c -');
  });

  test("x86-64, as the runner is, so a green run is the same cross-architecture reproduction", () => {
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(dockerfile).toMatch(/^FROM --platform=linux\/amd64 /m);
  });

  test("it runs the whole ledger, never a subset", () => {
    expect(/^CMD (.+)$/m.exec(dockerfile)?.[1]).toBe('["bun", "scripts/digests.ts"]');
  });

  test("the build context leaves out what is rebuilt, and keeps the clips that are inputs", () => {
    const lines = dockerignore.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    for (const rebuilt of ["vendor", "node_modules", "dist", ".git"]) expect(lines).toContain(rebuilt);
    // assets/synthetic/*.mp4 are tracked inputs to two footage digests.
    expect(lines.filter((l) => /synthetic|\*\.mp4|^assets$/.test(l))).toEqual([]);
  });
});
