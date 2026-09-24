/**
 * lower-third spec parser, generator, batch --spec, and render --spec.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  COLUMN,
  generate,
  fit,
  loadSpec,
  nameStackHeight,
  sidecarSource,
  source,
  type Fitted,
} from "../compositions/lower-third/gen.ts";
import { CANCEL_BUTTON } from "../src/image/glow.ts";
import { parseArgs } from "../src/cli/args.ts";
import { runFromArgv as previewFromArgv } from "../src/cli/commands/preview.ts";
import { runFromArgv as renderFromArgv } from "../src/cli/commands/render.ts";
import { EXIT_FAIL, EXIT_OK } from "../src/cli/types.ts";
import { parseSpec, type LowerThirdSpec } from "../src/manifest/spec.ts";
import type { Diagnostic } from "../src/manifest/sidecar.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIR = join(ROOT, "compositions/lower-third");
const DEFAULT_SPEC = join(DIR, "spec.default.json");
const APP = join(DIR, "app.tsx");
const SIDECAR = join(DIR, "pocket-motion.json");
const FOOTAGE = "assets/synthetic/bars-9x16-30fps.mp4";

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
  template: "lower-third" as const,
  viewport: [1920, 1080],
  fps: 30,
  durationFrames: 1,
  supersample: 1,
  fonts: {
    regular: "assets/fonts/NotoSansSC-Regular.otf",
    bold: "assets/fonts/NotoSansSC-Bold.otf",
  },
  copy: { name: "NAME", title: "TITLE" },
  palette: {
    ground: "#020617",
    ink: "#f8fafc",
    muted: "#cbd5e1",
    accent: "#22d3ee",
    bar: "#06b6d4",
  },
};

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pocketjs-motion-plate-"));
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

function asPlate(input: unknown): LowerThirdSpec {
  const result = parseSpec(input, { root: ROOT });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));
  if (result.value.template !== "lower-third") throw new Error("expected lower-third");
  return result.value;
}

describe("parseSpec — lower-third", () => {
  test("the committed sample is accepted", async () => {
    const raw = await Bun.file(DEFAULT_SPEC).json();
    const result = parseSpec(raw, { root: ROOT });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.template).toBe("lower-third");
    if (result.value.template !== "lower-third") throw new Error("unreachable");
    expect(result.value.copy.name).toBe("林知远");
  });

  test("feeding copy JSON through loadSpec is refused", async () => {
    await expect(loadSpec(join(ROOT, "compositions/copy/spec.default.json"))).rejects.toThrow(
      /this generator is "lower-third"/,
    );
  });

  test("an extra copy key is refused", () => {
    expectReject(
      { ...sample, copy: { ...sample.copy, kicker: "x" } },
      "spec.copy.unknownKey",
      "/copy/kicker",
    );
  });

  test("empty name is refused", () => {
    expectReject({ ...sample, copy: { ...sample.copy, name: "" } }, "spec.copy.missing", "/copy/name");
  });

  test("glow: true is accepted", () => {
    const spec = asPlate({ ...sample, glow: true });
    expect(spec.glow).toBe(true);
  });

  test("a missing logo file is refused", () => {
    expectReject({ ...sample, logo: "assets/no-such-logo.png" }, "spec.logo.missingFile", "/logo");
  });

  test("a 3-digit palette hex is refused", () => {
    expectReject(
      { ...sample, palette: { ...sample.palette, bar: "#0ff" } },
      "spec.palette.hex",
      "/palette/bar",
    );
  });

  test("footage src must exist", () => {
    expectReject(
      { ...sample, footage: { src: "assets/synthetic/nope.mp4", fit: "cover" } },
      "spec.footage.missingFile",
      "/footage/src",
    );
  });

  test("a declared footage clip is accepted", () => {
    const spec = asPlate({ ...sample, footage: { src: FOOTAGE, fit: "cover" } });
    expect(spec.footage?.src).toBe(FOOTAGE);
    expect(spec.footage?.fit).toBe("cover");
  });

  test("an svg logo whose logical size is not pow2 is accepted (patches/0020)", async () => {
    const rel = "dist/spec-logo-100.svg";
    mkdirSync(join(ROOT, "dist"), { recursive: true });
    await Bun.write(
      join(ROOT, rel),
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#0f0"/></svg>\n`,
    );
    try {
      expect(asPlate({ ...sample, logo: rel }).logo).toBe(rel);
    } finally {
      await rm(join(ROOT, rel), { force: true });
    }
  });

  test("an svg logo is refused when supersample would bake it past IMG_MAX_DIM", async () => {
    const rel = "dist/spec-logo-600.svg";
    mkdirSync(join(ROOT, "dist"), { recursive: true });
    await Bun.write(
      join(ROOT, rel),
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="100"><rect width="600" height="100" fill="#0f0"/></svg>\n`,
    );
    try {
      expect(asPlate({ ...sample, supersample: 2, logo: rel }).logo).toBe(rel);
      expectReject({ ...sample, supersample: 4, logo: rel }, "spec.logo.dims", "/logo");
    } finally {
      await rm(join(ROOT, rel), { force: true });
    }
  });

  test("a legal svg logo is accepted at density 1", () => {
    const spec = asPlate({ ...sample, logo: "compositions/probe/mark.svg" });
    expect(spec.logo).toBe("compositions/probe/mark.svg");
  });

  test("a logo path that is a directory is a diagnostic, not a thrown EISDIR", async () => {
    mkdirSync(join(ROOT, "dist"), { recursive: true });
    const rel = "dist/spec-logo-dir.png";
    mkdirSync(join(ROOT, rel), { recursive: true });
    try {
      expectReject({ ...sample, logo: rel }, "spec.logo.missingFile", "/logo");
    } finally {
      await rm(join(ROOT, rel), { recursive: true, force: true });
    }
  });
});

describe("lower-third generator source", () => {
  test("name is a JSON-stringified text node, never a class string", () => {
    const spec = asPlate(sample);
    const fitted: Fitted = {
      name: { text: "ALPHA\nline", px: 48, lines: 2 },
      title: { text: "ROLE", lines: 1 },
      lineHeight: { name: 56, title: 40 },
    };
    const src = source(fitted, spec);
    expect(src).toContain(JSON.stringify("ALPHA\nline"));
    const classes = [...src.matchAll(/class="([^"]*)"/g)].map((m) => m[1]!).join(" ");
    expect(classes).not.toContain("ALPHA");
    expect(classes).toContain(`bg-[${spec.palette.ground}]`);
    expect(classes).toContain(`bg-[${spec.palette.bar}]`);
    expect(classes).toContain(`bg-[${spec.palette.accent}]`);
  });

  test("a name that cannot fit still fails the generator", async () => {
    const spec = asPlate({ ...sample, copy: { name: "字".repeat(200), title: "TITLE" } });
    await expect(fit(spec)).rejects.toThrow(/name does not fit/);
  }, 120_000);

  test("an svg logo uses its own width and height, not 128×128", async () => {
    await withScratch(async (scratch) => {
      const specPath = join(scratch, "job.json");
      await Bun.write(
        specPath,
        JSON.stringify({ ...sample, logo: "compositions/probe/mark.svg" }) + "\n",
      );
      await generate(specPath, scratch);
      const src = await Bun.file(join(scratch, "app.tsx")).text();
      expect(src).toContain('src="logo.svg"');
      expect(src).toContain('debugName="logo"');
      expect(src).toContain("w-[256px]");
      expect(src).toContain("h-[128px]");
      expect(src).not.toContain("w-[128px] h-[128px]");
    });
  }, 60_000);

  test("footage writes tile nodes and a sidecar track", () => {
    const spec = asPlate({ ...sample, footage: { src: FOOTAGE, fit: "cover" } });
    const fitted: Fitted = {
      name: { text: "N", px: 56, lines: 1 },
      title: { text: "T", lines: 1 },
      lineHeight: { name: 56, title: 40 },
    };
    const src = source(fitted, spec);
    expect(src).toContain("footage:plate/tile:");
    expect(src).toContain("Image");
    const side = JSON.parse(sidecarSource(spec)) as { footage: Array<{ id: string; grid: number[] }> };
    expect(side.footage).toHaveLength(1);
    expect(side.footage[0]!.id).toBe("plate");
    expect(side.footage[0]!.grid[0]).toBeGreaterThan(0);
  });
});

describe("render --spec lower-third", () => {
  test("glow: true writes a plate next to app.tsx and does not dirty the sample", async () => {
    const before = await sampleSnapshot();
    await withScratch(async (scratch) => {
      const path = join(scratch, "glow.json");
      await Bun.write(path, JSON.stringify({ ...sample, glow: true }) + "\n");
      const spec = await generate(path, scratch);
      const stackH = nameStackHeight(await fit(spec));
      const spread = CANCEL_BUTTON.spread;
      const app = await Bun.file(join(scratch, "app.tsx")).text();
      expect(app).toContain('src="glow.png"');
      expect(app).toContain('src="glow-cap.png"');
      expect(app).toContain("rotate-180");
      expect(app).toMatch(new RegExp(`debugName="glow" class="[^"]*w-\\[${COLUMN}px\\]`));
      expect(app).toMatch(new RegExp(`debugName="glow" class="[^"]*h-\\[${stackH}px\\]`));
      expect(app).toMatch(new RegExp(`debugName="glow-top" class="[^"]*top-\\[-${spread}px\\]`));
      expect(app).toMatch(new RegExp(`debugName="glow-bot" class="[^"]*top-\\[${stackH}px\\]`));
      expect(app).not.toMatch(/debugName="glow" class="[^"]*w-\[512px\]/);
      expect(app).not.toMatch(/debugName="glow" class="[^"]*h-\[512px\]/);
      expect(await Bun.file(join(scratch, "glow.png")).exists()).toBe(true);
      expect(await Bun.file(join(scratch, "glow-cap.png")).exists()).toBe(true);
    });
    await expectSampleUnchanged(before);
  }, 180_000);

  test("two names produce two digests, without dirtying the sample", async () => {
    const before = await sampleSnapshot();
    await withScratch(async (scratch) => {
      const pathA = join(scratch, "a.json");
      const pathB = join(scratch, "b.json");
      await Bun.write(pathA, JSON.stringify({ ...sample, copy: { name: "第一位", title: "职务甲" } }) + "\n");
      await Bun.write(pathB, JSON.stringify({ ...sample, copy: { name: "第二位", title: "职务乙" } }) + "\n");
      const a = await renderFromArgv([
        DIR,
        "--spec",
        pathA,
        "--out",
        join(scratch, "a.mp4"),
        "--json",
      ]);
      expect(a.exitCode).toBe(EXIT_OK);
      const b = await renderFromArgv([
        DIR,
        "--spec",
        pathB,
        "--out",
        join(scratch, "b.mp4"),
        "--json",
      ]);
      expect(b.exitCode).toBe(EXIT_OK);
      expect((a.json as { digest: string }).digest).not.toBe((b.json as { digest: string }).digest);
    });
    await expectSampleUnchanged(before);
  }, 180_000);

  test("a missing logo does not write the sample", async () => {
    const before = await sampleSnapshot();
    await withScratch(async (scratch) => {
      const path = join(scratch, "logo.json");
      await Bun.write(path, JSON.stringify({ ...sample, logo: "assets/no-such-logo.png" }) + "\n");
      const result = await renderFromArgv([DIR, "--spec", path, "--out", join(scratch, "x.mp4"), "--json"]);
      expect(result.exitCode).toBe(EXIT_FAIL);
      expect((result.json as { error: string }).error).toMatch(/logo is not on disk|invalid spec/);
    });
    await expectSampleUnchanged(before);
  }, 60_000);

  test("a directory of jobs writes one mp4 per spec", async () => {
    const before = await sampleSnapshot();
    await withScratch(async (scratch) => {
      const jobs = join(scratch, "jobs");
      const out = join(scratch, "out");
      mkdirSync(jobs, { recursive: true });
      await Bun.write(join(jobs, "a.json"), JSON.stringify({ ...sample, copy: { name: "甲", title: "A" } }) + "\n");
      await Bun.write(join(jobs, "b.json"), JSON.stringify({ ...sample, copy: { name: "乙", title: "B" } }) + "\n");
      const result = await renderFromArgv([DIR, "--spec", jobs, "--out-dir", out, "--json"]);
      expect(result.exitCode).toBe(EXIT_OK);
      const json = result.json as { jobs: Array<{ spec: string; digest: string }> };
      expect(json.jobs).toHaveLength(2);
      expect(json.jobs[0]!.digest).not.toBe(json.jobs[1]!.digest);
      expect(await Bun.file(join(out, "a.mp4")).exists()).toBe(true);
      expect(await Bun.file(join(out, "b.mp4")).exists()).toBe(true);
    });
    await expectSampleUnchanged(before);
  }, 180_000);

  test("a directory of jobs parses every spec before writing any mp4", async () => {
    await withScratch(async (scratch) => {
      const jobs = join(scratch, "jobs");
      const out = join(scratch, "out");
      mkdirSync(jobs, { recursive: true });
      mkdirSync(out, { recursive: true });
      await Bun.write(join(jobs, "a.json"), JSON.stringify({ ...sample, copy: { name: "甲", title: "A" } }) + "\n");
      await Bun.write(
        join(jobs, "b.json"),
        JSON.stringify({ ...sample, palette: { ...sample.palette, bar: "#000] x" } }) + "\n",
      );
      await Bun.write(join(jobs, "c.json"), JSON.stringify({ ...sample, copy: { name: "丙", title: "C" } }) + "\n");
      const result = await renderFromArgv([DIR, "--spec", jobs, "--out-dir", out, "--json"]);
      expect(result.exitCode).toBe(EXIT_FAIL);
      const json = result.json as { failed: Array<{ spec: string }>; done: unknown[]; pending: string[] };
      expect(json.failed.some((f) => f.spec === "b.json")).toBe(true);
      expect(json.done).toEqual([]);
      expect(json.pending).toEqual(["a.json", "b.json", "c.json"]);
      expect(await Bun.file(join(out, "a.mp4")).exists()).toBe(false);
    });
  });

  test("a directory of jobs refuses a spec for another template before writing any mp4", async () => {
    await withScratch(async (scratch) => {
      const jobs = join(scratch, "jobs");
      const out = join(scratch, "out");
      mkdirSync(jobs, { recursive: true });
      mkdirSync(out, { recursive: true });
      const copyDefault = (await Bun.file(join(ROOT, "compositions/copy/spec.default.json")).json()) as object;
      await Bun.write(join(jobs, "a.json"), JSON.stringify(sample) + "\n");
      await Bun.write(join(jobs, "b.json"), JSON.stringify(copyDefault) + "\n");
      await Bun.write(join(jobs, "c.json"), JSON.stringify({ ...sample, copy: { name: "丙", title: "C" } }) + "\n");
      const result = await renderFromArgv([DIR, "--spec", jobs, "--out-dir", out, "--json"]);
      expect(result.exitCode).toBe(EXIT_FAIL);
      const json = result.json as { failed: Array<{ spec: string; error: string }>; done: unknown[] };
      expect(json.done).toEqual([]);
      expect(json.failed.some((f) => f.spec === "b.json" && /this generator is "lower-third"/.test(f.error))).toBe(
        true,
      );
      expect(await Bun.file(join(out, "a.mp4")).exists()).toBe(false);
    });
  });

  test("--frames cannot patch a job spec", async () => {
    await withScratch(async (scratch) => {
      const path = join(scratch, "job.json");
      await Bun.write(path, JSON.stringify(sample) + "\n");
      await expect(
        renderFromArgv([DIR, "--spec", path, "--out", join(scratch, "x.mp4"), "--frames", "5"]),
      ).rejects.toThrow(/--frames cannot override a job spec/);
    });
  });

  test("--bundle/--pak cannot land a job in another composition's tree", async () => {
    await withScratch(async (scratch) => {
      const path = join(scratch, "job.json");
      await Bun.write(path, JSON.stringify(sample) + "\n");
      const jobs = join(scratch, "jobs");
      mkdirSync(jobs, { recursive: true });
      await Bun.write(join(jobs, "a.json"), JSON.stringify(sample) + "\n");
      await expect(
        renderFromArgv([
          DIR,
          "--spec",
          path,
          "--out",
          join(scratch, "hijack.mp4"),
          "--bundle",
          join(ROOT, "dist/compositions/smoke/main.js"),
          "--pak",
          join(ROOT, "dist/compositions/smoke/main.pak"),
        ]),
      ).rejects.toThrow(/--bundle\/--pak cannot be used with --spec/);
      await expect(
        renderFromArgv([
          DIR,
          "--spec",
          jobs,
          "--out-dir",
          join(scratch, "out"),
          "--bundle",
          join(ROOT, "dist/compositions/smoke/main.js"),
        ]),
      ).rejects.toThrow(/--bundle\/--pak cannot be used with --spec/);
    });
  });

  test("--spec directory without --out-dir is usage", async () => {
    await withScratch(async (scratch) => {
      mkdirSync(join(scratch, "jobs"), { recursive: true });
      await Bun.write(join(scratch, "jobs", "a.json"), JSON.stringify(sample) + "\n");
      await expect(renderFromArgv([DIR, "--spec", join(scratch, "jobs"), "--json"])).rejects.toThrow(
        /--out-dir/,
      );
    });
  });
});

describe("preview --spec", () => {
  test("is accepted on preview and refused on trace", () => {
    const p = parseArgs(["preview", DIR, "--spec", "job.json", "--no-open"]);
    expect(p.flags.spec).toBe("job.json");
    expect(() => parseArgs(["trace", DIR, "--spec", "job.json"])).toThrow(/render or preview/);
  });

  test("--supersample cannot patch a job spec", async () => {
    await withScratch(async (scratch) => {
      const path = join(scratch, "job.json");
      await Bun.write(path, JSON.stringify(sample) + "\n");
      await expect(previewFromArgv([DIR, "--spec", path, "--supersample", "4", "--no-open"])).rejects.toThrow(
        /--supersample cannot override a job spec/,
      );
    });
  });

  test("--bundle with --spec is refused", async () => {
    await withScratch(async (scratch) => {
      const path = join(scratch, "job.json");
      await Bun.write(path, JSON.stringify(sample) + "\n");
      await expect(
        previewFromArgv([
          DIR,
          "--spec",
          path,
          "--no-open",
          "--bundle",
          join(ROOT, "dist/compositions/smoke/main.js"),
        ]),
      ).rejects.toThrow(/--bundle\/--pak cannot be used with --spec/);
    });
  });

  test("a directory is usage, not a Bun ENOENT", async () => {
    await withScratch(async (scratch) => {
      mkdirSync(join(scratch, "jobs"), { recursive: true });
      await expect(
        previewFromArgv([DIR, "--spec", join(scratch, "jobs"), "--no-open"]),
      ).rejects.toThrow(/one JSON file/);
    });
  });
});
