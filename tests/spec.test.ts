/**
 * Job spec parser, copy generator, and `render --spec`.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  COLUMN,
  copyStackHeight,
  copyStageSources,
  fit,
  generate,
  parseGenArgv,
  source,
  type Fitted,
} from "../compositions/copy/gen.ts";
import { CANCEL_BUTTON } from "../src/image/glow.ts";
import { parseArgs, refuseJobPatches } from "../src/cli/args.ts";
import { runFromArgv as renderFromArgv } from "../src/cli/commands/render.ts";
import { helpText, main } from "../src/cli/main.ts";
import { EXIT_FAIL, EXIT_OK, EXIT_USAGE } from "../src/cli/types.ts";
import {
  SPEC_ROOT_KEYS,
  parseSpec,
  type CopySpec,
} from "../src/manifest/spec.ts";
import type { Diagnostic } from "../src/manifest/sidecar.ts";

const ROOT = resolve(import.meta.dir, "..");

function findDiag(diags: readonly Diagnostic[], code: string): Diagnostic | undefined {
  return diags.find((d) => d.code === code);
}

function expectReject(input: unknown, code: string, path: string): Diagnostic {
  const result = parseSpec(input, { root: ROOT });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  const d = findDiag(result.diagnostics, code);
  expect(d).toBeDefined();
  expect(d!.path).toBe(path);
  return d!;
}

const sample = {
  spec: 1 as const,
  template: "copy",
  viewport: [1920, 1080],
  fps: 30,
  durationFrames: 1,
  supersample: 1,
  fonts: {
    regular: "assets/fonts/NotoSansSC-Regular.otf",
    bold: "assets/fonts/NotoSansSC-Bold.otf",
  },
  copy: {
    eyebrow: "EYEBROW",
    headline: "HEADLINE",
    body: "BODY",
  },
  palette: {
    ground: "#020617",
    ink: "#f8fafc",
    muted: "#cbd5e1",
    accent: "#22d3ee",
    rule: "#06b6d4",
  },
};

describe("parseSpec — valid", () => {
  test("the committed sample is accepted", async () => {
    const raw = await Bun.file(resolve(ROOT, "compositions/copy/spec.default.json")).json();
    const result = parseSpec(raw, { root: ROOT });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.template).toBe("copy");
    if (result.value.template !== "copy") throw new Error("unreachable");
    const v: CopySpec = result.value;
    expect(v.spec).toBe(1);
    expect(v.copy.headline).toContain("不要浏览器");
    expect(v.palette.ground).toBe("#020617");
  });

  test("a constructed sample materialises defaults for omitted fps/duration/supersample/viewport", () => {
    const rest = {
      spec: sample.spec,
      template: sample.template,
      fonts: sample.fonts,
      copy: sample.copy,
      palette: sample.palette,
    };
    const result = parseSpec(rest, { root: ROOT });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.fps).toBe(30);
    expect(result.value.durationFrames).toBe(1);
    expect(result.value.supersample).toBe(1);
    expect(result.value.viewport).toEqual([1920, 1080]);
  });
});

describe("parseSpec — refusals", () => {
  test("an extra root key is refused and the message lists the allowed keys", () => {
    const d = expectReject({ ...sample, theme: true }, "spec.unknownKey", "/theme");
    expect(d.message).toContain("allowed keys are");
    for (const key of SPEC_ROOT_KEYS) {
      expect(d.message).toContain(key);
    }
  });

  test("a template other than copy is refused", () => {
    const d = expectReject({ ...sample, template: "reel" }, "spec.template.mismatch", "/template");
    expect(d.message).toContain("copy");
    expect(d.message).toContain("lower-third");
    expect(d.message).toContain("reel");
  });

  test("a mistyped template does not call copy and palette unknown keys", () => {
    const result = parseSpec({ ...sample, template: "lower_third" }, { root: ROOT });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(findDiag(result.diagnostics, "spec.template.mismatch")).toBeDefined();
    expect(result.diagnostics.filter((d) => d.code === "spec.unknownKey")).toEqual([]);
  });

  test("a declared font path that is not on disk is refused", () => {
    const d = expectReject(
      {
        ...sample,
        fonts: { regular: "assets/fonts/no-such-face.otf", bold: sample.fonts.bold },
      },
      "spec.fonts.missingFile",
      "/fonts/regular",
    );
    expect(d.message).toContain("no-such-face.otf");
  });

  test("an absolute font path is refused", () => {
    expectReject(
      { ...sample, fonts: { regular: "/etc/passwd", bold: sample.fonts.bold } },
      "spec.fonts.regular.absolute",
      "/fonts/regular",
    );
  });

  test("a font path with .. is refused", () => {
    expectReject(
      { ...sample, fonts: { regular: "../secrets.ttf", bold: sample.fonts.bold } },
      "spec.fonts.regular.traversal",
      "/fonts/regular",
    );
  });

  test("spec version other than 1 is refused", () => {
    expectReject({ ...sample, spec: 2 }, "spec.version.invalid", "/spec");
  });

  test("a string fps is refused", () => {
    expectReject({ ...sample, fps: "30" }, "spec.fps.invalid", "/fps");
  });

  test("durationFrames of 0 is refused", () => {
    expectReject({ ...sample, durationFrames: 0 }, "spec.durationFrames.invalid", "/durationFrames");
  });

  test("a palette hex that would close a class string is refused", () => {
    const d = expectReject(
      {
        ...sample,
        palette: { ...sample.palette, ground: "#000] opacity-0 w-[1px" },
      },
      "spec.palette.hex",
      "/palette/ground",
    );
    expect(d.message).toContain("#RRGGBB");
  });

  test("glow: true is accepted; anything else at /glow is refused", () => {
    const on = parseSpec({ ...sample, glow: true }, { root: ROOT });
    expect(on.ok).toBe(true);
    if (!on.ok) throw new Error("unreachable");
    expect(on.value.template).toBe("copy");
    if (on.value.template !== "copy") throw new Error("unreachable");
    expect(on.value.glow).toBe(true);
    const off = parseSpec({ ...sample, glow: false }, { root: ROOT });
    expect(off.ok).toBe(true);
    if (!off.ok) throw new Error("unreachable");
    if (off.value.template !== "copy") throw new Error("unreachable");
    expect(off.value.glow).toBeUndefined();
    const d = expectReject({ ...sample, glow: 1 }, "spec.glow.invalid", "/glow");
    expect(d.message).toMatch(/true or false/);
    expect(d.message).not.toMatch(/if present/);
  });

  test("a 3-digit hex is refused — the class interpolates the string unquoted", () => {
    expectReject(
      { ...sample, palette: { ...sample.palette, ground: "#000" } },
      "spec.palette.hex",
      "/palette/ground",
    );
  });

  test("an empty copy string is refused", () => {
    expectReject(
      { ...sample, copy: { ...sample.copy, headline: "" } },
      "spec.copy.missing",
      "/copy/headline",
    );
  });
});

function parsedSample(overrides: { eyebrow?: string; headline?: string; body?: string } = {}): CopySpec {
  const result = parseSpec(
    {
      ...sample,
      copy: {
        ...sample.copy,
        eyebrow: overrides.eyebrow ?? sample.copy.eyebrow,
        headline: overrides.headline ?? sample.copy.headline,
        body: overrides.body ?? sample.copy.body,
      },
    },
    { root: ROOT },
  );
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));
  if (result.value.template !== "copy") throw new Error(`expected copy, got ${result.value.template}`);
  return result.value;
}

function fittedFor(spec: CopySpec, headlineText: string, bodyText: string): Fitted {
  return {
    eyebrow: spec.copy.eyebrow,
    headline: { text: headlineText, px: 76, lines: 2 },
    body: { text: bodyText, lines: 3 },
    lineHeight: { eyebrow: 40, headline: 90, body: 48 },
  };
}

describe("copy generator source", () => {
  test("copy is a JSON-stringified text node, never a class string", () => {
    const specA = parsedSample({ headline: "ALPHA-HEAD", body: "ALPHA-BODY" });
    const specB = parsedSample({ headline: "BETA-HEAD", body: "BETA-BODY" });
    const srcA = source(fittedFor(specA, "ALPHA-HEAD\nline", "ALPHA-BODY"), specA);
    const srcB = source(fittedFor(specB, "BETA-HEAD\nline", "BETA-BODY"), specB);

    expect(srcA).toContain(JSON.stringify("ALPHA-HEAD\nline"));
    expect(srcA).toContain(JSON.stringify("ALPHA-BODY"));
    expect(srcB).toContain(JSON.stringify("BETA-HEAD\nline"));
    expect(srcB).toContain(JSON.stringify("BETA-BODY"));
    expect(srcA).not.toContain(JSON.stringify("BETA-HEAD\nline"));

    const classes = [...srcA.matchAll(/class="([^"]*)"/g)].map((m) => m[1]!).join(" ");
    expect(classes).not.toContain("ALPHA-HEAD");
    expect(classes).not.toContain("ALPHA-BODY");
    expect(classes).toContain(`bg-[${specA.palette.ground}]`);
    expect(classes).toContain(`text-[${specA.palette.ink}]`);
  });

  test("a headline that cannot fit still fails the generator", async () => {
    const spec = parsedSample({
      headline: "字".repeat(200),
    });
    await expect(fit(spec)).rejects.toThrow(/headline does not fit/);
  }, 120_000);

  test("a long eyebrow wraps to the column instead of running off the frame", async () => {
    const short = await fit(parsedSample({ eyebrow: "字".repeat(8) }));
    const long = await fit(parsedSample({ eyebrow: "字".repeat(80) }));
    expect(short.eyebrow).not.toContain("\n");
    expect(long.eyebrow).toContain("\n");
    expect(short.eyebrow).not.toBe(long.eyebrow);
  }, 120_000);
});

describe("--spec on the CLI", () => {
  test("is a value flag, not rejected as unknown", () => {
    const parsed = parseArgs([
      "render",
      "compositions/copy",
      "--spec",
      "job.json",
      "--out",
      "out.mp4",
    ]);
    expect(parsed.flags.spec).toBe("job.json");
    expect(parsed.flags.out).toBe("out.mp4");
  });

  test("a bare --spec without a value is usage, not a silent boolean", () => {
    expect(() => parseArgs(["render", "compositions/copy", "--spec"])).toThrow(
      /flag --spec requires a value/,
    );
  });

  test("help names --spec", () => {
    expect(helpText()).toContain("--spec <file>");
    expect(helpText()).toContain("--spec <dir>");
  });

  test("trace --spec is a usage error, not a silent ignore", () => {
    expect(() => parseArgs(["trace", "compositions/copy", "--spec", "job.json"])).toThrow(
      /--spec is only accepted by render or preview/,
    );
  });

  test("frame --spec is a usage error, not a silent ignore", () => {
    expect(() =>
      parseArgs(["frame", "compositions/copy", "--at", "0", "--spec", "job.json", "--out", "f.png"]),
    ).toThrow(/--spec is only accepted by render or preview/);
  });

  test("trace --port is a usage error", () => {
    expect(() => parseArgs(["trace", "compositions/copy", "--port", "99"])).toThrow(
      /--port is only accepted by preview/,
    );
  });

  test("render --verify is a usage error", () => {
    expect(() =>
      parseArgs(["render", "compositions/copy", "--verify", "mix.wav", "--out", "out.mp4"]),
    ).toThrow(/--verify is only accepted by sound/);
  });

  test("trace --spec exits 2 rather than returning the sample digest", async () => {
    const code = await main(["trace", "compositions/copy", "--spec", "job.json", "--json"]);
    expect(code).toBe(EXIT_USAGE);
  });

  test("preview --spec is accepted", () => {
    const parsed = parseArgs(["preview", "compositions/copy", "--spec", "job.json", "--no-open"]);
    expect(parsed.flags.spec).toBe("job.json");
  });

  test("--bundle/--pak with --spec is usage, not a silent redirect of the build", () => {
    const parsed = parseArgs([
      "render",
      "compositions/copy",
      "--spec",
      "job.json",
      "--out",
      "out.mp4",
      "--bundle",
      "dist/compositions/smoke/main.js",
      "--pak",
      "dist/compositions/smoke/main.pak",
    ]);
    expect(() => refuseJobPatches(parsed.global, true)).toThrow(
      /--bundle\/--pak cannot be used with --spec/,
    );
    const pakOnly = parseArgs([
      "preview",
      "compositions/lower-third",
      "--spec",
      "job.json",
      "--pak",
      "dist/compositions/smoke/main.pak",
    ]);
    expect(() => refuseJobPatches(pakOnly.global, true)).toThrow(
      /--bundle\/--pak cannot be used with --spec/,
    );
    const clean = parseArgs(["render", "compositions/copy", "--spec", "job.json", "--out", "out.mp4"]);
    expect(() => refuseJobPatches(clean.global, true)).not.toThrow();
    const noSpec = parseArgs(["render", "compositions/smoke", "--bundle", "dist/compositions/smoke/main.js"]);
    expect(() => refuseJobPatches(noSpec.global, false)).not.toThrow();
  });

  test("trace --out is a usage error, not a silent ignore", () => {
    expect(() => parseArgs(["trace", "compositions/copy", "--out", "/tmp/nope.json"])).toThrow(
      /--out is only accepted by frame, render or snapshot/,
    );
  });

  test("trace --at is a usage error, not a silent ignore", () => {
    expect(() => parseArgs(["trace", "compositions/copy", "--at", "5"])).toThrow(
      /--at is only accepted by frame, layout, snapshot or verify/,
    );
  });

  test("frame still accepts --out and --at", () => {
    const parsed = parseArgs(["frame", "compositions/copy", "--at", "0", "--out", "f.png"]);
    expect(parsed.flags.at).toBe("0");
    expect(parsed.flags.out).toBe("f.png");
  });

  test("layout still accepts --at", () => {
    const parsed = parseArgs(["layout", "compositions/copy", "--at", "0"]);
    expect(parsed.flags.at).toBe("0");
  });

  test("trace --out exits 2 rather than ignoring the flag", async () => {
    const code = await main(["trace", "compositions/copy", "--out", "/tmp/nope.json", "--json"]);
    expect(code).toBe(EXIT_USAGE);
  });
});

describe("copy gen.ts CLI", () => {
  test("no args regenerates the sample", () => {
    const parsed = parseGenArgv([]);
    expect(parsed.specPath).toBe(DEFAULT_SPEC);
    expect(parsed.outDir).toBe(COPY_DIR);
  });

  test("--spec without --out-dir is refused so it cannot write the sample", () => {
    expect(() => parseGenArgv(["--spec", "job.json"])).toThrow(/--out-dir|render --spec/);
  });

  test("a positional spec is refused", () => {
    expect(() => parseGenArgv(["job.json"])).toThrow(/render compositions\/copy --spec/);
  });

  test("--spec with --out-dir writes elsewhere", () => {
    const parsed = parseGenArgv(["--spec", "job.json", "--out-dir", "/tmp/copy-job"]);
    expect(parsed.specPath).toBe("job.json");
    expect(parsed.outDir).toBe(resolve("/tmp/copy-job"));
  });

  test("the CLI entry refuses --spec without --out-dir and does not write the sample", async () => {
    const before = await sampleSnapshot();
    const proc = Bun.spawn(["bun", "compositions/copy/gen.ts", "--spec", DEFAULT_SPEC], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--out-dir|render --spec/);
    await expectSampleUnchanged(before);
  });
});

describe("stageJob sources", () => {
  test("copies pocket.config.ts and leaves gen.ts and generated sources behind", async () => {
    await withScratch(async (scratch) => {
      const from = join(scratch, "from");
      const to = join(scratch, "to");
      mkdirSync(from, { recursive: true });
      mkdirSync(to, { recursive: true });
      for (const [name, body] of [
        ["main.tsx", "main"],
        ["pocket.json", "{}"],
        ["pocket.config.ts", "export {}"],
        ["gen.ts", "gen"],
        ["app.tsx", "app"],
        ["pocket-motion.json", "{}"],
        ["spec.default.json", "{}"],
      ] as const) {
        await Bun.write(join(from, name), body);
      }
      const copied = await copyStageSources(from, to);
      expect(copied).toEqual(["main.tsx", "pocket.config.ts", "pocket.json"]);
      expect(await Bun.file(join(to, "pocket.config.ts")).text()).toBe("export {}");
      expect(await Bun.file(join(to, "gen.ts")).exists()).toBe(false);
      expect(await Bun.file(join(to, "app.tsx")).exists()).toBe(false);
    });
  });
});

const COPY_DIR = join(ROOT, "compositions/copy");
const DEFAULT_SPEC = join(COPY_DIR, "spec.default.json");
const APP = join(COPY_DIR, "app.tsx");
const SIDECAR = join(COPY_DIR, "pocket-motion.json");

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pocketjs-motion-spec-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function sampleSnapshot(): Promise<{ app: string; sidecar: string }> {
  return { app: await Bun.file(APP).text(), sidecar: await Bun.file(SIDECAR).text() };
}

async function expectSampleUnchanged(before: { app: string; sidecar: string }): Promise<void> {
  expect(await Bun.file(APP).text()).toBe(before.app);
  expect(await Bun.file(SIDECAR).text()).toBe(before.sidecar);
}

async function spawnRender(args: string[]): Promise<{ code: number; json: unknown; stderr: string }> {
  const proc = Bun.spawn(["bun", "src/cli/main.ts", "render", ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const jsonLine = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .at(-1);
  let json: unknown;
  try {
    json = JSON.parse(jsonLine ?? stdout);
  } catch {
    json = { parseError: stdout };
  }
  return { code, json, stderr };
}

describe("render --spec", () => {
  test("glow: true writes a plate next to app.tsx and does not dirty the sample", async () => {
    const before = await sampleSnapshot();
    await withScratch(async (scratch) => {
      const base = (await Bun.file(DEFAULT_SPEC).json()) as Record<string, unknown>;
      const path = join(scratch, "glow.json");
      await Bun.write(path, JSON.stringify({ ...base, glow: true }) + "\n");
      const spec = await generate(path, scratch);
      const stackH = copyStackHeight(await fit(spec));
      const spread = CANCEL_BUTTON.spread;
      const app = await Bun.file(join(scratch, "app.tsx")).text();
      expect(app).toContain('src="glow.png"');
      expect(app).toContain('src="glow-cap.png"');
      expect(app).toContain("rotate-180");
      expect(app).toMatch(new RegExp(`debugName="glow" class="[^"]*w-\\[${COLUMN}px\\]`));
      expect(app).toMatch(new RegExp(`debugName="glow" class="[^"]*h-\\[${stackH}px\\]`));
      expect(app).toMatch(new RegExp(`debugName="glow-top" class="[^"]*top-\\[-${spread}px\\]`));
      expect(app).toMatch(new RegExp(`debugName="glow-top" class="[^"]*h-\\[${spread}px\\]`));
      expect(app).toMatch(new RegExp(`debugName="glow-bot" class="[^"]*top-\\[${stackH}px\\]`));
      expect(app).not.toMatch(/debugName="glow" class="[^"]*w-\[512px\]/);
      expect(app).not.toMatch(/debugName="glow" class="[^"]*h-\[512px\]/);
      expect(await Bun.file(join(scratch, "glow.png")).exists()).toBe(true);
      expect(await Bun.file(join(scratch, "glow-cap.png")).exists()).toBe(true);
    });
    await expectSampleUnchanged(before);
  }, 180_000);

  test("glow: true a stack taller than 512 keeps the falloff outside the text", async () => {
    const before = await sampleSnapshot();
    await withScratch(async (scratch) => {
      const base = (await Bun.file(DEFAULT_SPEC).json()) as Record<string, unknown>;
      const copy = { ...(base.copy as object), body: "字".repeat(400) };
      const path = join(scratch, "tall.json");
      await Bun.write(path, JSON.stringify({ ...base, copy, glow: true }) + "\n");
      const spec = await generate(path, scratch);
      const stackH = copyStackHeight(await fit(spec));
      expect(stackH).toBeGreaterThan(512);
      const app = await Bun.file(join(scratch, "app.tsx")).text();
      expect(app).toMatch(new RegExp(`debugName="glow" class="[^"]*h-\\[${stackH}px\\]`));
      expect(app).toMatch(new RegExp(`debugName="glow-top" class="[^"]*h-\\[${CANCEL_BUTTON.spread}px\\]`));
      expect(app).toMatch(new RegExp(`debugName="glow-bot" class="[^"]*top-\\[${stackH}px\\]`));
      expect(app).not.toMatch(/debugName="glow" class="[^"]*h-\[512px\]/);
    });
    await expectSampleUnchanged(before);
  }, 180_000);

  test("two specs that differ only in copy produce two digests, without dirtying the sample", async () => {
    const before = await sampleSnapshot();
    await withScratch(async (scratch) => {
      const base = (await Bun.file(DEFAULT_SPEC).json()) as Record<string, unknown>;
      const specA = { ...base, copy: { ...(base.copy as object), headline: "第一份标题卡", body: "第一份正文，用来证明规格会进画面。" } };
      const specB = { ...base, copy: { ...(base.copy as object), headline: "第二份标题卡", body: "第二份正文，用来证明规格会进画面。" } };
      const pathA = join(scratch, "copy-a.json");
      const pathB = join(scratch, "copy-b.json");
      await Bun.write(pathA, JSON.stringify(specA, null, 2) + "\n");
      await Bun.write(pathB, JSON.stringify(specB, null, 2) + "\n");

      const a = await renderFromArgv([
        COPY_DIR,
        "--spec",
        pathA,
        "--out",
        join(scratch, "copy-a.mp4"),
        "--json",
      ]);
      expect(a.exitCode).toBe(EXIT_OK);
      const digestA = (a.json as { digest: string }).digest;

      const b = await renderFromArgv([
        COPY_DIR,
        "--spec",
        pathB,
        "--out",
        join(scratch, "copy-b.mp4"),
        "--json",
      ]);
      expect(b.exitCode).toBe(EXIT_OK);
      const digestB = (b.json as { digest: string }).digest;

      expect(digestA).toMatch(/^[0-9a-f]{64}$/);
      expect(digestB).toMatch(/^[0-9a-f]{64}$/);
      expect(digestA).not.toBe(digestB);
    });
    await expectSampleUnchanged(before);
  }, 180_000);

  test("a job does not write the sample", async () => {
    const before = await sampleSnapshot();
    await withScratch(async (scratch) => {
      const result = await renderFromArgv([
        COPY_DIR,
        "--spec",
        DEFAULT_SPEC,
        "--out",
        join(scratch, "default-bundle.mp4"),
        "--json",
      ]);
      expect(result.exitCode).toBe(EXIT_OK);
      expect((result.json as { digest: string }).digest).toMatch(/^[0-9a-f]{64}$/);
    });
    await expectSampleUnchanged(before);
  }, 180_000);

  test("a generate failure does not write the sample", async () => {
    const before = await sampleSnapshot();
    await withScratch(async (scratch) => {
      const base = (await Bun.file(DEFAULT_SPEC).json()) as Record<string, unknown>;
      const path = join(scratch, "too-long.json");
      await Bun.write(
        path,
        JSON.stringify({
          ...base,
          copy: { ...(base.copy as object), headline: "字".repeat(200) },
        }) + "\n",
      );
      const result = await renderFromArgv([
        COPY_DIR,
        "--spec",
        path,
        "--out",
        join(scratch, "too-long.mp4"),
        "--json",
      ]);
      expect(result.exitCode).toBe(EXIT_FAIL);
      expect((result.json as { error: string }).error).toMatch(/headline does not fit/);
    });
    await expectSampleUnchanged(before);
  }, 180_000);

  test("a composition without gen.ts is usage, not a silent ignore", async () => {
    const code = await main([
      "render",
      "compositions/smoke",
      "--spec",
      DEFAULT_SPEC,
      "--out",
      "out.mp4",
      "--json",
    ]);
    expect(code).toBe(EXIT_USAGE);
  });

  test("a generator that does not export stageJob is usage", async () => {
    await withScratch(async (scratch) => {
      await Bun.write(join(scratch, "gen.ts"), "export async function generate() {}\n");
      const code = await main([
        "render",
        scratch,
        "--spec",
        DEFAULT_SPEC,
        "--out",
        join(scratch, "out.mp4"),
        "--json",
      ]);
      expect(code).toBe(EXIT_USAGE);
    });
  });

  test("--bundle with --spec is refused so a job cannot overwrite another composition", async () => {
    await withScratch(async (scratch) => {
      const victimDir = join(scratch, "smoke dist");
      mkdirSync(victimDir, { recursive: true });
      const victimJs = join(victimDir, "main.js");
      const victimPak = join(victimDir, "main.pak");
      await Bun.write(victimJs, "SENTINEL");
      await Bun.write(victimPak, "SENTINEL");
      await expect(
        renderFromArgv([
          COPY_DIR,
          "--spec",
          DEFAULT_SPEC,
          "--out",
          join(scratch, "hijack.mp4"),
          "--bundle",
          victimJs,
          "--pak",
          victimPak,
        ]),
      ).rejects.toThrow(/--bundle\/--pak cannot be used with --spec/);
      expect(await Bun.file(victimJs).text()).toBe("SENTINEL");
      expect(await Bun.file(victimPak).text()).toBe("SENTINEL");
    });
  });

  test("two jobs can measure at the same time", async () => {
    const before = await sampleSnapshot();
    await withScratch(async (scratch) => {
      const base = (await Bun.file(DEFAULT_SPEC).json()) as Record<string, unknown>;
      const pathA = join(scratch, "a.json");
      const pathB = join(scratch, "b.json");
      await Bun.write(
        pathA,
        JSON.stringify({ ...base, copy: { ...(base.copy as object), headline: "并发甲" } }) + "\n",
      );
      await Bun.write(
        pathB,
        JSON.stringify({ ...base, copy: { ...(base.copy as object), headline: "并发乙" } }) + "\n",
      );
      const argv = (spec: string, out: string) => [
        COPY_DIR,
        "--spec",
        spec,
        "--out",
        join(scratch, out),
        "--json",
      ];
      // Two processes — `openMeasurer` serialises within one, so Promise.all
      // of `renderFromArgv` would not catch a shared measure dir.
      const [a, b] = await Promise.all([
        spawnRender(argv(pathA, "a.mp4")),
        spawnRender(argv(pathB, "b.mp4")),
      ]);
      if (a.code !== EXIT_OK) {
        throw new Error(`job A failed (${a.code}): ${a.stderr}\n${JSON.stringify(a.json)}`);
      }
      if (b.code !== EXIT_OK) {
        throw new Error(`job B failed (${b.code}): ${b.stderr}\n${JSON.stringify(b.json)}`);
      }
      expect(a.code).toBe(EXIT_OK);
      expect(b.code).toBe(EXIT_OK);
      const digestA = (a.json as { digest: string }).digest;
      const digestB = (b.json as { digest: string }).digest;
      expect(digestA).toMatch(/^[0-9a-f]{64}$/);
      expect(digestB).toMatch(/^[0-9a-f]{64}$/);
      expect(digestA).not.toBe(digestB);
    });
    await expectSampleUnchanged(before);
  }, 180_000);
});


// A job's `assertions[]` live in a tree `render --spec` stages and removes, so
// the job's own render is the one place they can be read, and it reads them
// unless told `--no-assert`. No shipped template lets a job
// write a false one — the captions template derives every window from its own
// layout — so this stages `compositions/short-sections` under a sidecar the
// job supplies, through a `stageJob` written here.
describe("render --spec checks the job's own assertions", () => {
  const stager = `
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
const ROOT = ${JSON.stringify(ROOT)};
const FIXTURE = join(ROOT, "compositions", "short-sections");
export async function stageJob(specPath: string) {
  await mkdir(join(ROOT, "dist"), { recursive: true });
  const dir = await mkdtemp(join(ROOT, "dist", "assert-job-"));
  for (const name of ["main.tsx", "pocket.config.ts", "pocket.json"]) {
    await cp(join(FIXTURE, name), join(dir, name));
  }
  const job = JSON.parse(await readFile(specPath, "utf8"));
  const sidecar = JSON.parse(await readFile(join(FIXTURE, "pocket-motion.json"), "utf8"));
  await writeFile(join(dir, "pocket-motion.json"), JSON.stringify({ ...sidecar, assertions: job.assertions }));
  await writeFile(specPath + ".staged", dir);
  return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
}
`;
  // title-r3 is up from frame 111; asserting it from 108 is the broken one.
  const broken = [
    { node: "num-r3", inPicture: [108, 116] },
    { node: "title-r3", inPicture: [108, 116] },
  ];
  const holds = [
    { node: "num-r3", inPicture: [108, 116] },
    { node: "title-r3", inPicture: [111, 116] },
  ];

  async function job(
    scratch: string,
    assertions: unknown,
    extra: readonly string[],
  ): Promise<{ exitCode: number; json: Record<string, unknown>; out: string }> {
    await Bun.write(join(scratch, "gen.ts"), stager);
    const spec = join(scratch, "job.json");
    await Bun.write(spec, JSON.stringify({ assertions }));
    const out = join(scratch, "job.mp4");
    const r = await renderFromArgv([scratch, "--spec", spec, "--out", out, "--json", ...extra]);
    return { exitCode: r.exitCode, json: r.json as Record<string, unknown>, out };
  }

  test("a job whose assertion the picture does not bear out is refused before it renders", async () => {
    await withScratch(async (scratch) => {
      const r = await job(scratch, broken, []);
      expect(r.exitCode).toBe(EXIT_FAIL);
      expect(r.json.ok).toBe(false);
      expect(r.json.error).toBe("the job's assertions do not hold: title-r3 inPicture");
      // `assert`'s own object, carried verbatim: the failing frames are named.
      const verdict = r.json.assertions as {
        ok: boolean;
        failures: string[];
        assertions: Array<{ node: string; ok: boolean; detail: string }>;
      };
      expect(verdict.ok).toBe(false);
      expect(verdict.failures).toEqual(["title-r3 inPicture"]);
      expect(verdict.assertions[1]!.detail).toContain("not shown at 108");
      // Refused before the encode, and the staged tree is gone.
      expect(await Bun.file(r.out).exists()).toBe(false);
      const staged = await Bun.file(join(scratch, "job.json.staged")).text();
      expect(await Bun.file(join(staged, "pocket-motion.json")).exists()).toBe(false);
    });
  }, 300_000);

  test("--no-assert renders the same job: the refusal is the check's", async () => {
    await withScratch(async (scratch) => {
      const r = await job(scratch, broken, ["--no-assert"]);
      expect(r.exitCode).toBe(EXIT_OK);
      expect(r.json.assertions).toBeUndefined();
      expect(await Bun.file(r.out).exists()).toBe(true);
    });
  }, 300_000);

  test("a job whose assertions hold renders, and carries the verdict", async () => {
    await withScratch(async (scratch) => {
      const r = await job(scratch, holds, []);
      expect(r.exitCode).toBe(EXIT_OK);
      const verdict = r.json.assertions as { ok: boolean; failures: string[]; frames: number[] };
      expect(verdict.ok).toBe(true);
      expect(verdict.failures).toEqual([]);
      // Rank 3 holds no frame of the even grid; the windows' own ends are read.
      expect(verdict.frames).toContain(111);
      expect(await Bun.file(r.out).exists()).toBe(true);
    });
  }, 300_000);

  test("--no-assert without --spec is usage: a composition's render checks none", async () => {
    await expect(
      renderFromArgv(["compositions/smoke", "--out", "out.mp4", "--no-assert"]),
    ).rejects.toThrow(/--no-assert skips a job's own assertions and needs --spec/);
    expect(() => parseArgs(["trace", "compositions/smoke", "--no-assert"])).toThrow();
    expect(helpText()).toContain("--no-assert");
  });

  test("a job whose sidecar declares no assertions renders, and says so", async () => {
    await withScratch(async (scratch) => {
      const r = await job(scratch, [], []);
      expect(r.exitCode).toBe(EXIT_OK);
      const verdict = r.json.assertions as { ok: boolean; note?: string };
      expect(verdict.ok).toBe(true);
      expect(verdict.note).toBe("the sidecar declares no assertions");
    });
  }, 300_000);
});
