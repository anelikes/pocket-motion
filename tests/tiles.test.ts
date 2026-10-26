/**
 * `footage.tileNamedByHand`, and the one way tiles are declared.
 *
 * The tile name `<nodePrefix>/tile:<col>:<row>` is a protocol between the
 * host and the guest, not an authoring vocabulary: three separate things have
 * to agree about it — the name `FootageLayer.create` looks up, the sidecar's
 * `grid`, and each tile's drawn `w-[Npx] h-[Npx]`, which IS the ingested
 * size. `tileNodes` and `footageTrack` derive all of it from one width and
 * height, so there is nothing to keep in step.
 *
 * Two claims are tested here and they are different:
 *
 * - the emitters produce the markup and the sidecar entry the three
 *   generators in this tree were producing by hand, byte for byte, which is
 *   why no digest moved when they switched;
 * - the lint reports a name it cannot attribute to `tileNodes`, excuses a
 *   generated file whose generator is clean, and does NOT excuse a generator
 *   that builds the name itself.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { footageTrack, tileNodes } from "../src/footage/declare.ts";
import { gridOf, placeTile, tileDebugName, tileNamePrefix } from "../src/footage/tiling.ts";
import {
  CODE_TILE_NAMED_BY_HAND,
  generatedBy,
  lintTileNames,
  tileNameOffsets,
} from "../src/lint/tiles.ts";
import { run as runLint } from "../src/cli/commands/lint.ts";
import { TEX_MAX_DIM } from "../src/manifest/sidecar.ts";
import { EXIT_OK } from "../src/cli/types.ts";
import { scratchDir } from "./scratch.ts";

const ROOT = resolve(import.meta.dir, "..");
const TMP = scratchDir("tiles");

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("the name is built in one place", () => {
  test("tileDebugName and tileNamePrefix agree with what the host looks up", () => {
    expect(tileDebugName("footage:clip", 1, 0)).toBe("footage:clip/tile:1:0");
    expect(tileNamePrefix("footage:clip")).toBe("footage:clip/tile:");
    expect(tileDebugName("footage:clip", 1, 0).startsWith(tileNamePrefix("footage:clip"))).toBe(
      true,
    );
  });
});

describe("tileNodes", () => {
  test("one node per cell, explicitly sized, in row-major order", () => {
    const lines = tileNodes({
      nodePrefix: "footage:clip",
      width: 640,
      height: 360,
      tile: TEX_MAX_DIM,
    }).split("\n");
    const [cols, rows] = gridOf(640, 360, TEX_MAX_DIM);
    expect(lines).toHaveLength(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = placeTile(640, 360, TEX_MAX_DIM, c, r);
        const line = lines[r * cols + c]!;
        expect(line).toContain(`debugName="${tileDebugName("footage:clip", c, r)}"`);
        // The drawn size is the ingested size and `pictureSizeFromTree` reads
        // it back out of the tree, so every tile carries it explicitly.
        expect(line).toContain(`w-[${t.w}px] h-[${t.h}px]`);
        expect(line).toContain(`left-[${t.x}px] top-[${t.y}px]`);
      }
    }
  });

  test("the class token order is fixed here, not left to each caller", () => {
    // The literal is what the compiler keys a style record on, so two
    // spellings of one rectangle are two records in the pak.
    expect(tileNodes({ nodePrefix: "f", width: 64, height: 64, tile: 512 })).toContain(
      'class="absolute left-[0px] top-[0px] w-[64px] h-[64px]"',
    );
  });

  test("indent and origin are the two things a caller varies", () => {
    expect(
      tileNodes({ nodePrefix: "f", width: 64, height: 64, tile: 512, indent: "    " }),
    ).toStartWith("    <Image");
    expect(
      tileNodes({ nodePrefix: "f", width: 64, height: 64, tile: 512, originX: 10, originY: 20 }),
    ).toContain("left-[10px] top-[20px]");
  });

  test("it reproduces what the two footage fixtures have committed", async () => {
    // The point of the emitters is that the generators stopped writing this
    // template out themselves. If the output had moved by a byte, both
    // fixtures' app.tsx would have been rewritten and their digests with it.
    for (const [dir, prefix, w, h, indent] of [
      ["footage-tracks", "footage:wide-open", 640, 360, "        "],
      ["sound-roles", "footage:clip", 640, 360, "        "],
    ] as const) {
      const committed = await Bun.file(join(ROOT, "compositions", dir, "app.tsx")).text();
      const emitted = tileNodes({ nodePrefix: prefix, width: w, height: h, tile: TEX_MAX_DIM, indent });
      for (const line of emitted.split("\n")) {
        expect(committed, `${dir}: ${line.trim()}`).toContain(line);
      }
    }
  });
});

describe("footageTrack", () => {
  test("grid is derived from the same size the tiles were, never passed in", () => {
    const track = footageTrack({
      id: "clip",
      src: "assets/synthetic/bars-16x9-24fps.mp4",
      nodePrefix: "footage:clip",
      tile: TEX_MAX_DIM,
      width: 640,
      height: 360,
      startFrame: 30,
      endFrame: 150,
      sourceFrame: 20,
    });
    expect(track.grid).toEqual(gridOf(640, 360, TEX_MAX_DIM));
    // Key order is what makes a generator's sidecar rewrite byte-identical.
    expect(Object.keys(track)).toEqual([
      "id",
      "src",
      "nodePrefix",
      "tile",
      "grid",
      "startFrame",
      "endFrame",
      "sourceFrame",
    ]);
  });

  test("sourceFrame and fit are omitted rather than defaulted", () => {
    const track = footageTrack({
      id: "plate",
      src: "clip.mp4",
      nodePrefix: "footage:plate",
      tile: 512,
      width: 1920,
      height: 1080,
      startFrame: 0,
      endFrame: 90,
    });
    expect("sourceFrame" in track).toBe(false);
    expect("fit" in track).toBe(false);
    expect(
      Object.keys(
        footageTrack({
          id: "p",
          src: "c.mp4",
          nodePrefix: "n",
          tile: 512,
          width: 64,
          height: 64,
          startFrame: 0,
          endFrame: 1,
          fit: "cover",
        }),
      ),
    ).toContain("fit");
  });

  test("it reproduces what the two footage fixtures have committed", async () => {
    const sidecar = (await Bun.file(
      join(ROOT, "compositions/sound-roles/pocket-motion.json"),
    ).json()) as { footage: unknown[] };
    expect(sidecar.footage[0]).toEqual(
      footageTrack({
        id: "clip",
        src: "assets/synthetic/bars-16x9-24fps.mp4",
        nodePrefix: "footage:clip",
        tile: TEX_MAX_DIM,
        width: 640,
        height: 360,
        startFrame: 30,
        endFrame: 150,
        sourceFrame: 20,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// The lint
// ---------------------------------------------------------------------------

describe("what the lint looks at", () => {
  const DECLARED = ["footage:a"];

  test("a tile name in a comment is prose", () => {
    expect(tileNameOffsets("// declare footage:a/tile:0:0 per cell\n", DECLARED)).toEqual([]);
    expect(tileNameOffsets('const n = "footage:a/tile:0:0";', DECLARED).length).toBe(1);
  });

  test("a template-built name is found in its text, which is the hand-rolled case", () => {
    expect(tileNameOffsets("const n = `${p}/tile:${c}:${r}`;", DECLARED).length).toBe(1);
  });

  test("a tile name for a prefix the sidecar does not declare binds nothing", () => {
    // `compositions/kenburns` and `compositions/shimmer` are exactly this:
    // `footage:kb/tile:…` and `footage:probe/tile:…` with no `footage` in the
    // sidecar, because a probe script pushes their textures. Telling shimmer
    // to call `tileNodes` would be wrong advice — it draws each tile at an
    // arbitrary `cell` to vary the minification ratio, which is the one thing
    // that emitter will not do.
    expect(tileNameOffsets('const n = "footage:kb/tile:0:0";', DECLARED)).toEqual([]);
    expect(tileNameOffsets('const n = "footage:kb/tile:0:0";', [])).toEqual([]);
  });

  test("the GENERATED header is read from the head of the file only", () => {
    expect(generatedBy("// GENERATED by compositions/x/gen.ts — do not edit.\n")).toBe(
      "compositions/x/gen.ts",
    );
    expect(generatedBy(`${"\n".repeat(20)}// GENERATED by compositions/x/gen.ts`)).toBeNull();
  });
});

describe("lintTileNames", () => {
  const handWritten = {
    file: "/c/app.tsx",
    name: "app.tsx",
    text: '<Image debugName="footage:a/tile:0:0" class="absolute w-[512px] h-[512px]" />',
  };

  test("a hand-written name is reported, and the message names tileNodes", () => {
    const [w] = lintTileNames([handWritten], ["footage:a"]);
    expect(w!.code).toBe(CODE_TILE_NAMED_BY_HAND);
    expect(w!.file).toBe("/c/app.tsx");
    expect(w!.message).toContain("tileNodes");
    expect(w!.message).toContain("footageTrack");
    // It says what it cannot see, because that is why it warns instead of
    // failing.
    expect(w!.message).toContain("does not run");
  });

  test("a generated file is excused when its generator holds no name of its own", () => {
    expect(
      lintTileNames(
        [
          {
            ...handWritten,
            text: `// GENERATED by compositions/a/gen.ts — do not edit.\n${handWritten.text}`,
          },
          {
            file: "/c/gen.ts",
            name: "gen.ts",
            text: 'import { tileNodes } from "../../src/footage/declare.ts";\n',
          },
        ],
        ["footage:a"],
      ),
    ).toEqual([]);
  });

  test("a generator that builds the name itself is NOT excused, and is the one reported", () => {
    // The excuse is a relationship between two files, so the finding lands on
    // the generator rather than on the output it wrote.
    const warnings = lintTileNames(
      [
        {
          ...handWritten,
          text: `// GENERATED by compositions/a/gen.ts — do not edit.\n${handWritten.text}`,
        },
        {
          file: "/c/gen.ts",
          name: "gen.ts",
          text: "const node = `<Image debugName=\"${p}/tile:${c}:${r}\" />`;\n",
        },
      ],
      ["footage:a"],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.file).toBe("/c/gen.ts");
    expect(warnings[0]!.message).toContain("builds a footage tile name itself");
  });

  test("a generated file whose generator is not in the directory is reported", () => {
    const warnings = lintTileNames(
      [
        {
          ...handWritten,
          text: `// GENERATED by scripts/elsewhere.ts — do not edit.\n${handWritten.text}`,
        },
      ],
      ["footage:a"],
    );
    expect(warnings).toHaveLength(1);
  });

  test("every composition in this tree is clean", async () => {
    // The claim the refactor rests on. `git ls-files` rather than a walk, so
    // build output cannot be mistaken for a source.
    const proc = Bun.spawn(["git", "ls-files", "--", "compositions/**/*.ts", "compositions/**/*.tsx"], {
      cwd: ROOT,
      stdout: "pipe",
    });
    const listed = (await new Response(proc.stdout).text()).split("\n").filter(Boolean);
    expect(listed.length).toBeGreaterThan(20);
    const byDir = new Map<string, { file: string; name: string; text: string }[]>();
    for (const rel of listed) {
      const dir = rel.slice(0, rel.lastIndexOf("/"));
      const entry = {
        file: join(ROOT, rel),
        name: rel.slice(rel.lastIndexOf("/") + 1),
        text: await Bun.file(join(ROOT, rel)).text(),
      };
      byDir.set(dir, [...(byDir.get(dir) ?? []), entry]);
    }
    const offenders: string[] = [];
    let declaring = 0;
    for (const [dir, files] of byDir) {
      const sidecarPath = join(ROOT, dir, "pocket-motion.json");
      let prefixes: string[] = [];
      try {
        const sidecar = (await Bun.file(sidecarPath).json()) as {
          footage?: { nodePrefix: string }[];
        };
        prefixes = (sidecar.footage ?? []).map((t) => t.nodePrefix);
      } catch {
        prefixes = [];
      }
      if (prefixes.length > 0) declaring++;
      for (const w of lintTileNames(files, prefixes)) {
        offenders.push(`${dir}: ${w.file}:${w.line}`);
      }
    }
    // The gate reaching nothing would pass silently. Two compositions here
    // declare footage in their committed sidecar — `footage-tracks` and
    // `sound-roles` — and both go through `tileNodes`.
    expect(declaring).toBeGreaterThanOrEqual(2);
    expect(offenders.join("\n") || "clean").toBe("clean");
  });
});

describe("lint reports it as a warning, and still exits 0", () => {
  test("a composition with hand-written tiles", async () => {
    const dir = join(TMP, "byhand");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "pocket-motion.json"),
      JSON.stringify(
        {
          motion: 1,
          durationFrames: 30,
          fps: 30,
          // The track is what makes the tile names below load-bearing: without
          // a declared nodePrefix they bind nothing and the lint says nothing.
          footage: [
            {
              id: "a",
              src: "assets/synthetic/bars-16x9-24fps.mp4",
              nodePrefix: "footage:a",
              tile: 512,
              grid: [1, 1],
              startFrame: 0,
              endFrame: 30,
            },
          ],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(dir, "pocket.json"),
      JSON.stringify({
        pocket: 2,
        id: "dev.pocket-stack.motion-byhand",
        app: { entry: "main.tsx", framework: "solid", viewport: { fixed: { logical: [320, 180] } } },
      }),
    );
    writeFileSync(
      join(dir, "main.tsx"),
      [
        'import { mount } from "@pocketjs/framework";',
        'import { Image, View } from "@pocketjs/framework/components";',
        "",
        "mount(() => (",
        '  <View class="w-full h-full">',
        '    <Image debugName="footage:a/tile:0:0" class="absolute left-[0px] top-[0px] w-[160px] h-[90px]" />',
        "  </View>",
        "));",
        "",
      ].join("\n"),
    );

    const result = await runLint({ dir, flags: { json: false } });
    // A warning is a claim about the source text, not about the composition,
    // so it does not decide the verdict.
    expect(result.exitCode).toBe(EXIT_OK);
    const payload = result.json as { ok: boolean; warnings: { code: string }[] };
    expect(payload.ok).toBe(true);
    expect(payload.warnings).toHaveLength(1);
    expect(payload.warnings[0]!.code).toBe(CODE_TILE_NAMED_BY_HAND);
    // …and it is not hidden behind an "ok" line that says nothing about it.
    expect(result.stdoutLines!.join("\n")).toContain("1 warning(s)");
  });
});
