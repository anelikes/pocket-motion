/**
 * The gates over the generated capability catalog.
 *
 * Each failure names the offending item. A gate that was never seen red is
 * an assertion about a gate, not a gate — G1–G4 are proven by introducing
 * a regression, G5 was already red before the allowed-key messages were
 * rebuilt from the key sets, and G8 was red on the containment carve-out
 * before `findingsFor` had one (a background containing a caption reported
 * `content_overlap` against every named thing drawn on it). The captions halves
 * of G2, G5 and G9 were each run red before they were kept: a layout key added
 * with no row, every unknown-key message made to drop its first key, and a
 * code renamed in `src/captions/spec.ts` with its row left behind — which G9
 * reports three ways, as an emitted code with no row, a row whose code is
 * never emitted, and a probe refused under the new name.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { SURFACE } from "../src/catalog/surface.ts";
import { active, findingsFor, type FindingNode } from "../src/render/findings.ts";
import {
  ASSERTION_KEYS,
  BED_DUCK_KEYS,
  ENVELOPE_POINT_KEYS,
  FONT_FACE_KEYS,
  IMG_MAX_DIM,
  FONT_KEYS,
  FONT_WEIGHT_KEYS,
  FOOTAGE_KEYS,
  LAYOUT_ALLOW_KEYS,
  ROOT_KEYS,
  SOUND_BED_KEYS,
  SOUND_CUE_KEYS,
  SOUND_DIALOGUE_KEYS,
  SHUTTER_KEYS,
  SOUND_ELEMENT_KEYS,
  SOUND_KEYS,
  SOUND_NARRATION_KEYS,
  SOUND_SRC_ROLES,
  TEX_MAX_DIM,
  VALID_FPS,
  parseSidecar,
} from "../src/manifest/sidecar.ts";
import { CATALOG_PATH, firstDifferingHunk, renderCatalog } from "../scripts/catalog.ts";
import { WORD_KEYS } from "../src/captions/ingest.ts";
import {
  CAPTIONS_BODY_KEYS,
  CAPTIONS_ENVELOPE_RULES,
  CAPTIONS_LAYOUT_KEYS,
  CAPTIONS_TRANSCRIPT_KEYS,
  captionsStyleKeys,
} from "../src/captions/spec.ts";
import { STYLE_NAMES } from "../src/captions/styles.ts";
import { SPEC_CAPTIONS_ROOT_KEYS, parseSpec } from "../src/manifest/spec.ts";

const ROOT = resolve(import.meta.dir, "..");
const SIDECAR_PATH = join(ROOT, "src/manifest/sidecar.ts");

/** G8 links containers after every record exists, so that one field is set
 *  rather than passed in. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const PATH_ISSUE_SUFFIXES = ["empty", "absolute", "traversal"] as const;
const PATH_ISSUE_PREFIX = "sidecar.footage.src";

function sourceFile(source: string): string {
  const match = /^(.*?):(\d+)(?:-(\d+))?$/.exec(source);
  if (match === null) {
    throw new Error(`row source ${JSON.stringify(source)} has no line number`);
  }
  return match[1]!;
}

/**
 * Diagnostic codes the sidecar source actually emits.
 *
 * A naive scan of `"sidecar.*"` string literals finds 44 unique values
 * today. One of them — `"sidecar.footage.src"` — is `pathIssue`'s default
 * prefix, not a diagnostic: the codes it produces are
 * `sidecar.footage.src.{empty,absolute,traversal}`, concatenated in
 * `pathIssue` and therefore invisible as quoted literals. The same three
 * suffixes are concatenated onto `sidecar.fonts.${key}` for each member of
 * `FONT_KEYS`. Those constructed codes are included here; the prefix is not.
 */
/**
 * The prefix expression at every `pathIssue` call site, exactly as written in
 * the source. A call site whose prefix is not listed here produces a family of
 * codes this file does not know how to reconstruct, and they stay invisible to
 * G1 for as long as they have no catalogue rows — a gate claiming more than it
 * examined. Adding a family means adding it here and reconstructing it below.
 */
const KNOWN_PATH_ISSUE_PREFIXES = new Set([
  "", // the default parameter, `sidecar.footage.src`
  "`sidecar.fonts.${key}`",
  "`sidecar.fonts.faces.${key}`",
  "`sidecar.sound.${role}.src`",
]);

/** The third argument of each `pathIssue(...)` call, as source text. */
function pathIssuePrefixExpressions(text: string): string[] {
  const out: string[] = [];
  const call = /(?<!function )pathIssue\(/g;
  for (let m = call.exec(text); m !== null; m = call.exec(text)) {
    const args: string[] = [];
    let current = "";
    let depth = 1;
    let quote: string | null = null;
    for (let i = m.index + m[0].length; i < text.length && depth > 0; i++) {
      const ch = text[i]!;
      if (quote !== null) {
        if (ch === quote && text[i - 1] !== "\\") quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        if (--depth === 0) break;
      } else if (ch === "," && depth === 1) {
        args.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    args.push(current.trim());
    out.push(args[2] ?? "");
  }
  return out;
}

function extractSourceCodes(text: string): Set<string> {
  const codes = new Set<string>();
  for (const match of text.matchAll(/"sidecar\.[^"]+"/g)) {
    codes.add(match[0]!.slice(1, -1));
  }

  for (const suffix of PATH_ISSUE_SUFFIXES) {
    if (!text.includes(`\${prefix}.${suffix}`)) {
      throw new Error(
        `pathIssue no longer concatenates \`\${prefix}.${suffix}\`; G1 cannot reconstruct those codes`,
      );
    }
  }

  // A new call site adds a code family that no quoted literal reveals. Fail
  // here rather than let G1 pass over codes it never looked for.
  const unknown = pathIssuePrefixExpressions(text).filter(
    (prefix) => !KNOWN_PATH_ISSUE_PREFIXES.has(prefix),
  );
  if (unknown.length > 0) {
    throw new Error(
      `pathIssue is called with prefixes G1 cannot reconstruct: ${unknown
        .map((p) => (p === "" ? "(default)" : p))
        .join(", ")}. Teach extractSourceCodes the new family, then catalogue its codes.`,
    );
  }

  if (codes.has(PATH_ISSUE_PREFIX)) {
    codes.delete(PATH_ISSUE_PREFIX);
    for (const suffix of PATH_ISSUE_SUFFIXES) {
      codes.add(`${PATH_ISSUE_PREFIX}.${suffix}`);
    }
  }

  if (text.includes("sidecar.fonts.${key}")) {
    for (const key of FONT_WEIGHT_KEYS) {
      for (const suffix of PATH_ISSUE_SUFFIXES) {
        codes.add(`sidecar.fonts.${key}.${suffix}`);
      }
    }
  }

  if (text.includes("sidecar.fonts.faces.${key}")) {
    for (const key of FONT_WEIGHT_KEYS) {
      for (const suffix of PATH_ISSUE_SUFFIXES) {
        codes.add(`sidecar.fonts.faces.${key}.${suffix}`);
      }
    }
  }

  if (text.includes("sidecar.sound.${role}.src")) {
    for (const role of SOUND_SRC_ROLES) {
      for (const suffix of PATH_ISSUE_SUFFIXES) {
        codes.add(`sidecar.sound.${role}.src.${suffix}`);
      }
    }
  }

  return codes;
}

function cataloguedCodes(): Map<string, string> {
  const owned = new Map<string, string>();
  const dupes: string[] = [];
  for (const row of SURFACE) {
    for (const code of row.diagnostics) {
      const prev = owned.get(code);
      if (prev !== undefined) {
        dupes.push(`${code} owned by both ${prev} and ${row.id}`);
      } else {
        owned.set(code, row.id);
      }
    }
  }
  if (dupes.length > 0) {
    throw new Error(`diagnostic owned by more than one row: ${dupes.join("; ")}`);
  }
  return owned;
}

/** Every key a `captions` row may describe, dotted as an author types it. */
function captionsKeys(): Set<string> {
  return new Set<string>([
    ...CAPTIONS_BODY_KEYS,
    ...CAPTIONS_ENVELOPE_RULES,
    ...[...CAPTIONS_TRANSCRIPT_KEYS].map((k) => `transcript.${k}`),
    ...STYLE_NAMES.flatMap((name) => [...captionsStyleKeys(name)].map((k) => `style.${k}`)),
    ...[...CAPTIONS_LAYOUT_KEYS].map((k) => `layout.${k}`),
  ]);
}

/** The files a `captions` spec diagnostic can come from. */
const CAPTIONS_SOURCES = ["src/captions/spec.ts", "src/captions/ingest.ts"] as const;

/**
 * Every `spec.*` code the captions parser emits, read off its source.
 *
 * Codes are written out as literals there on purpose — `parseLayout` passes
 * each one by name rather than building it from the key — so a string scan
 * finds them all. The one family that is built is `pathIssue`'s, from the
 * prefix `spec.transcript.src`; it is reconstructed here, and the scan fails
 * if that call stops being the one this knows how to read.
 */
function captionsSourceCodes(): Set<string> {
  const codes = new Set<string>();
  for (const rel of CAPTIONS_SOURCES) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const match of text.matchAll(/"(spec\.[A-Za-z.]+)"/g)) codes.add(match[1]!);
  }
  const spec = readFileSync(join(ROOT, CAPTIONS_SOURCES[0]), "utf8");
  if (!spec.includes('pathIssue(t.src, "src", "spec.transcript.src")')) {
    throw new Error("src/captions/spec.ts no longer calls pathIssue with the prefix G9 reconstructs");
  }
  codes.delete("spec.transcript.src");
  for (const suffix of PATH_ISSUE_SUFFIXES) codes.add(`spec.transcript.src.${suffix}`);
  return codes;
}

describe("catalog gates", () => {
  test("G1 — no un-catalogued diagnostic", () => {
    const source = readFileSync(SIDECAR_PATH, "utf8");
    const inSource = extractSourceCodes(source);
    const owned = cataloguedCodes();
    // The sidecar's codes, which is what this file scans. The captions job
    // spec owns `spec.*` codes and G9 holds those to their own source.
    const inCatalog = new Set([...owned.keys()].filter((code) => code.startsWith("sidecar.")));

    const missing = [...inSource].filter((code) => !inCatalog.has(code)).sort();
    const extra = [...inCatalog].filter((code) => !inSource.has(code)).sort();

    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(
        `in src/manifest/sidecar.ts but in no catalog row: ${missing.join(", ")}`,
      );
    }
    if (extra.length > 0) {
      parts.push(
        `in a catalog row but not in src/manifest/sidecar.ts: ${extra
          .map((code) => `${code} (row ${owned.get(code)})`)
          .join(", ")}`,
      );
    }
    expect(parts, parts.join("\n") || "G1 clean").toEqual([]);
  });

  test("G2 — no un-catalogued key", () => {
    const rowsByGroup = {
      sidecar: SURFACE.filter((row) => row.group === "sidecar"),
      footage: SURFACE.filter((row) => row.group === "footage"),
      fonts: SURFACE.filter((row) => row.group === "fonts"),
      sound: SURFACE.filter((row) => row.group === "sound"),
      shutter: SURFACE.filter((row) => row.group === "shutter"),
    };
    const sets = {
      sidecar: ROOT_KEYS,
      footage: FOOTAGE_KEYS,
      fonts: FONT_KEYS,
      sound: SOUND_KEYS,
      shutter: SHUTTER_KEYS,
    } as const;

    const parts: string[] = [];
    for (const group of ["sidecar", "footage", "fonts", "sound", "shutter"] as const) {
      const setName =
        group === "sidecar"
          ? "ROOT_KEYS"
          : group === "footage"
            ? "FOOTAGE_KEYS"
            : group === "fonts"
              ? "FONT_KEYS"
              : group === "sound"
                ? "SOUND_KEYS"
                : "SHUTTER_KEYS";
      const declared = sets[group];
      const rows = rowsByGroup[group];
      const rowKeys = new Set(rows.map((row) => row.key));
      // Sound also has keys below its root that earn a row of their own: one
      // every element of every role accepts (`<element>.envelope`), and a
      // bed key with its own vocabulary (`bed.ducks`). Each is checked
      // against the set it lives in, and every element key must have a row.
      const below =
        group === "sound"
          ? new Set([
              ...[...SOUND_ELEMENT_KEYS].map((k) => `<element>.${k}`),
              ...[...SOUND_BED_KEYS].filter((k) => !SOUND_ELEMENT_KEYS.has(k)).map((k) => `bed.${k}`),
            ])
          : new Set<string>();

      for (const key of declared) {
        if (!rowKeys.has(key)) {
          parts.push(`${setName} member ${JSON.stringify(key)} is in no ${group} row`);
        }
      }
      if (group === "sound") {
        for (const key of SOUND_ELEMENT_KEYS) {
          if (!rowKeys.has(`<element>.${key}`)) {
            parts.push(`SOUND_ELEMENT_KEYS member ${JSON.stringify(key)} is in no sound row`);
          }
        }
      }
      for (const row of rows) {
        if (!declared.has(row.key) && !below.has(row.key)) {
          parts.push(
            `${group} row ${row.id} key ${JSON.stringify(row.key)} is not in ${setName}` +
              (group === "sound" ? ", SOUND_ELEMENT_KEYS or SOUND_BED_KEYS" : ""),
          );
        }
      }
    }
    // The captions job spec: every key of every set has a row, and every row
    // names a key that exists. A style's keys are its own, so the set is the
    // union over the five.
    const declared = captionsKeys();
    const rows = SURFACE.filter((row) => row.group === "captions");
    const rowKeys = new Set(rows.map((row) => row.key));
    for (const key of declared) {
      if (!rowKeys.has(key)) parts.push(`captions key ${JSON.stringify(key)} is in no captions row`);
    }
    for (const row of rows) {
      if (!declared.has(row.key)) {
        parts.push(`captions row ${row.id} key ${JSON.stringify(row.key)} is in no captions key set`);
      }
    }
    expect(parts, parts.join("\n") || "G2 clean").toEqual([]);
  });

  test("G3 — every probe fires", () => {
    const parts: string[] = [];
    for (const row of SURFACE) {
      if (row.verification !== "probed") continue;

      // `probed` means a violation was constructed and refused. A row with no
      // refusal in it has claimed that without doing it — and G3 used to pass
      // such a row silently, because its only loop was over `row.diagnostics`
      // and a row with none has nothing to iterate.
      const refusals =
        row.probes.length +
        (row.bakeProbes ?? []).filter((probe) => !("bakes" in probe.outcome)).length +
        // A collector probe that must record NOTHING is a refusal in the same
        // sense: an input was constructed and the pass declined to vouch for it.
        (row.collectProbes ?? []).filter((probe) => probe.records.length === 0).length +
        // A finding probe that must produce a code is one too: a geometry was
        // constructed and the predicate named it. A probe expecting NOTHING is
        // the accepted side of a boundary and cannot earn `probed` alone, the
        // same rule `bakes: true` gets.
        (row.findingProbes ?? []).filter((probe) => probe.expect.length > 0).length +
        // A job spec refused by `parseSpec` (G9 executes them).
        (row.specProbes ?? []).length;
      if (refusals === 0) {
        parts.push(`${row.id} claims probed with no refusal to execute`);
      }

      const probed = new Set([...row.probes, ...(row.specProbes ?? [])].map((probe) => probe.code));
      for (const code of row.diagnostics) {
        if (!probed.has(code)) {
          parts.push(`${row.id} diagnostic ${code} has no probe`);
        }
      }

      for (const probe of row.probes) {
        const result = parseSidecar(probe.input);
        if (result.ok) {
          parts.push(
            `${row.id} probe ${probe.code}: parseSidecar accepted the input`,
          );
          continue;
        }
        const codes = result.diagnostics.map((d) => d.code);
        if (!codes.includes(probe.code)) {
          parts.push(
            `${row.id} probe ${probe.code}: parseSidecar did not emit that code (got ${codes.join(", ") || "(none)"})`,
          );
        }
      }
    }
    expect(parts, parts.join("\n") || "G3 clean").toEqual([]);
  });

  test("G6 — every bake probe does what its row says", async () => {
    const compilerDir = join(ROOT, "vendor/pocketjs/framework/compiler");
    if (!existsSync(join(compilerDir, "animation.ts"))) {
      throw new Error(
        `vendor pocketjs missing at ${compilerDir} — run bun scripts/vendor.ts`,
      );
    }
    // Imported through a computed specifier so `tsc` does not follow it:
    // `vendor/` does not typecheck under this repository's settings, which is
    // the same reason the mirror test below reads its sources as text.
    const { compileClasses } = (await import(`${compilerDir}/tailwind.ts`)) as {
      compileClasses(
        literals: Iterable<string>,
        options?: { fromClassAttribute?: ReadonlySet<string> },
      ): {
        records: Array<{ animation?: unknown; base?: Array<{ prop: number; value: number }> }>;
        ids: Record<string, number>;
      };
    };
    const { PROP } = (await import(`${ROOT}/vendor/pocketjs/contracts/spec/spec.ts`)) as {
      PROP: Record<string, number>;
    };
    const { registerAnimationTheme } = (await import(`${compilerDir}/animation.ts`)) as {
      registerAnimationTheme(theme: unknown): void;
    };

    /** What a probe uses unless it names its own. */
    const DEFAULT_KEYFRAMES = { appear: { from: { opacity: "0" }, to: { opacity: "1" } } };

    const parts: string[] = [];
    for (const row of SURFACE) {
      for (const probe of row.bakeProbes ?? []) {
        const where = `${row.id} / ${probe.what}`;
        // registerAnimationTheme resets the bake table, so probes cannot see
        // each other's timelines — an id from a previous probe would make a
        // dropped literal look like a baked one.
        registerAnimationTheme({
          keyframes: probe.keyframes ?? DEFAULT_KEYFRAMES,
          animation: probe.animation ?? {},
        });

        let thrown: string | null = null;
        let record: { animation?: unknown; base?: Array<{ prop: number; value: number }> } | undefined;
        try {
          const compiled = compileClasses(
            probe.literals,
            probe.fromClassAttribute === true
              ? { fromClassAttribute: new Set(probe.literals) }
              : {},
          );
          const id = compiled.ids[probe.literals[0]!];
          record = id === undefined ? undefined : compiled.records[id];
        } catch (e) {
          thrown = e instanceof Error ? e.message : String(e);
        }

        if ("refuses" in probe.outcome) {
          if (thrown === null) {
            parts.push(`${where}: expected a refusal, the compiler accepted it`);
          } else if (!thrown.includes(probe.outcome.refuses)) {
            parts.push(
              `${where}: refused with a different message\n  want substring: ${probe.outcome.refuses}\n  got: ${thrown}`,
            );
          }
          continue;
        }

        if (thrown !== null) {
          parts.push(`${where}: expected no throw, got: ${thrown}`);
          continue;
        }

        if ("dropsLiteral" in probe.outcome) {
          if (record !== undefined) {
            parts.push(`${where}: expected the literal to be dropped, it compiled to a record`);
          }
          continue;
        }

        if (record === undefined) {
          parts.push(`${where}: expected a style record, the literal was dropped`);
          continue;
        }
        if ("declares" in probe.outcome) {
          const { prop, value } = probe.outcome.declares;
          const id = PROP[prop];
          if (id === undefined) {
            parts.push(`${where}: the spec has no prop named ${prop}`);
            continue;
          }
          const got = (record.base ?? []).find((e) => e.prop === id)?.value;
          if (got !== value) {
            parts.push(`${where}: expected ${prop} = ${value} in the record's base props, got ${got}`);
          }
          continue;
        }
        if (record.animation === undefined) {
          parts.push(`${where}: compiled to a record carrying no animation`);
        }
      }
    }
    expect(parts, parts.join("\n") || "G6 clean").toEqual([]);
  });

  /**
   * G6 calls `compileClasses`, so it holds what the compiler refuses and the
   * message it throws, not what a build shows an author. Row
   * `class.unparsed-token` also says the build names each refused literal at
   * its file, line and column, which is `tools/build.ts`'s half of
   * patches/0041 and is held here, on a build of a two-node module. Red with
   * that half reverse-applied: the build still exits 1, on an uncaught
   * `UncompiledClassError` whose stack names `tailwind.ts` and no line of
   * `main.tsx`.
   */
  test("G6b — the build names a refused class= literal at its file, line and column", () => {
    const vendor = join(ROOT, "vendor/pocketjs");
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-class-refusal-")));
    try {
      writeFileSync(
        join(dir, "main.tsx"),
        [
          'import { mount } from "@pocketjs/framework";',
          'import { View } from "@pocketjs/framework/components";',
          "mount(() => (",
          '  <View class="w-full h-full">',
          '    <View class="absolute left-[1e-14px] w-[100px] rotate--18" />',
          "  </View>",
          "));",
          "",
        ].join("\n"),
      );
      const run = Bun.spawnSync(
        ["bun", "tools/build.ts", join(dir, "main.tsx"), "--no-config", `--project-root=${dir}`, `--outdir=${join(dir, "out")}`],
        { cwd: vendor, stdout: "pipe", stderr: "pipe" },
      );
      const err = run.stderr.toString();
      expect(run.exitCode).toBe(1);
      expect(err).toContain(
        'error: main.tsx:5:17: class "absolute left-[1e-14px] w-[100px] rotate--18" does not compile: unknown utilities left-[1e-14px], rotate--18',
      );
      expect(err).toContain("`left-[1e-14px]`: a number in exponent notation is not read — `left-[0.00000000000001px]` compiles.");
      expect(err).toContain("`rotate--18`: `rotate-N` takes N >= 0 degrees with no brackets or unit, and 342 is the same angle as -18 — `rotate-342` compiles.");
      expect(existsSync(join(dir, "out", "main.js"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  /**
   * G6 hands `fromClassAttribute` to the parser directly, so it says what the
   * parser does with the evidence and nothing about where the evidence comes
   * from. Collecting it is the fragile half: the collector is offered EVERY
   * string literal in a module, and the one thing separating a class from a
   * sentence is having been written where only a class can go.
   *
   * "Written where only a class can go" means the whole value of the
   * attribute, not any literal reachable under it. An operand of `+` is a
   * fragment — `"animate-lid-"` is never the class the node gets — and
   * recording one would refuse a half-token the author did not write, on a
   * construct upstream compiles. The row says a concatenation still drops
   * silently; this is what holds it to that.
   */
  test("G7 — every collector probe records exactly what its row says", async () => {
    const compilerDir = join(ROOT, "vendor/pocketjs/framework/compiler");
    const { transformFile } = (await import(`${compilerDir}/jsx-plugin.ts`)) as {
      transformFile(
        path: string,
        src: string,
        framework: string,
      ): Promise<{ classAttrStrings: string[] }>;
    };

    const parts: string[] = [];
    for (const row of SURFACE) {
      for (const [i, probe] of (row.collectProbes ?? []).entries()) {
        const where = `${row.id} / ${probe.what}`;
        // The transform cache is keyed on (compiler sources, path, source), so
        // a distinct path per probe is not needed for correctness — it is here
        // so a failure names the probe rather than a shared scratch file.
        const result = await transformFile(
          `/catalog-g7/${row.id}-${i}.tsx`,
          probe.source,
          "solid",
        );
        const got = [...result.classAttrStrings].sort();
        const want = [...probe.records].sort();
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          parts.push(
            `${where}\n  want: ${JSON.stringify(want)}\n  got:  ${JSON.stringify(got)}`,
          );
        }
      }
    }
    expect(parts, parts.join("\n") || "G7 clean").toEqual([]);
  });

  /**
   * The finding codes are the one part of the catalogue nobody declares: they
   * are computed from a rendered frame rather than typed into a sidecar, so
   * neither G3's `parseSidecar` nor G6's compiler can say anything about them.
   * This hands `findingsFor` the geometry the row states and holds it to the
   * codes the row claims, EXACTLY — an extra code is a predicate firing where
   * nobody said it would, which is the failure mode that matters here.
   *
   * The geometries are copied out of `layout --json compositions/layout-codes
   * --at 0`. `tests/cli.test.ts` is what keeps them equal to what that command
   * actually prints; this keeps them equal to what the predicate does with them.
   */
  test("G8 — every finding probe produces exactly the codes its row states", () => {
    const parts: string[] = [];
    for (const row of SURFACE) {
      for (const probe of row.findingProbes ?? []) {
        const where = `${row.id} / ${probe.what}`;
        const byId = new Map<number, Mutable<FindingNode>>();
        for (const n of probe.nodes) {
          byId.set(n.id, {
            id: n.id,
            ...(n.name ? { name: n.name } : {}),
            ...(n.text ? { text: n.text } : {}),
            box: { x: n.box[0], y: n.box[1], w: n.box[2], h: n.box[3] },
            inPicture: n.inPicture,
            ...(n.visibility ? { visibility: n.visibility } : {}),
            ...(n.ink === undefined
              ? {}
              : { ink: n.ink === null ? null : { x: n.ink[0], y: n.ink[1], w: n.ink[2], h: n.ink[3] } }),
            container: null,
          });
        }
        for (const n of probe.nodes) {
          if (n.container !== undefined) {
            byId.get(n.id)!.container = byId.get(n.container) ?? null;
          }
        }
        const findings = findingsFor({
          nodes: [...byId.values()],
          viewport: { x: 0, y: 0, w: probe.viewport[0], h: probe.viewport[1] },
          allow: probe.allow ?? [],
        });
        const got = active(findings)
          .map((f) => `${f.code}:${f.name ?? `#${f.id}`}`)
          .sort();
        const want = [...probe.expect].sort();
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          parts.push(
            `${where}\n  want: ${JSON.stringify(want)}\n  got:  ${JSON.stringify(got)}`,
          );
        }
      }
    }
    expect(parts, parts.join("\n") || "G8 clean").toEqual([]);
  });

  test("G4 — the document is current", () => {
    const generated = renderCatalog();
    if (!existsSync(CATALOG_PATH)) {
      throw new Error("CAPABILITIES.md is missing; run `bun scripts/catalog.ts --write`");
    }
    const disk = readFileSync(CATALOG_PATH, "utf8");
    if (disk !== generated) {
      throw new Error(
        `CAPABILITIES.md is not current. First differing region:\n${firstDifferingHunk(disk, generated)}`,
      );
    }
  });

  test("G5 — the allowed-key messages agree with the key sets", () => {
    const cases = [
      {
        label: "root",
        input: { motion: 1, durationFrames: 10, fps: 30, nope: 1 },
        keys: ROOT_KEYS,
        code: "sidecar.unknownKey",
      },
      {
        label: "fonts",
        input: {
          motion: 1,
          durationFrames: 10,
          fps: 30,
          fonts: { regular: "a.ttf", bold: "b.ttf", italic: "c.ttf" },
        },
        keys: FONT_KEYS,
        code: "sidecar.fonts.unknownKey",
      },
      {
        label: "fonts.faces[name]",
        input: {
          motion: 1,
          durationFrames: 10,
          fps: 30,
          fonts: { regular: "a.ttf", bold: "b.ttf", faces: { display: { regular: "c.ttf", bold: "d.ttf", italic: "e.ttf" } } },
        },
        keys: FONT_FACE_KEYS,
        code: "sidecar.fonts.faces.unknownKey",
      },
      {
        label: "footage[0]",
        input: {
          motion: 1,
          durationFrames: 10,
          fps: 30,
          footage: [
            {
              id: "a-roll",
              src: "clip.mp4",
              nodePrefix: "n",
              tile: 512,
              grid: [2, 2],
              nope: 1,
            },
          ],
        },
        keys: FOOTAGE_KEYS,
        code: "sidecar.footage.unknownKey",
      },
      {
        label: "sound",
        input: { motion: 1, durationFrames: 10, fps: 30, sound: { nope: 1 } },
        keys: SOUND_KEYS,
        code: "sidecar.sound.unknownKey",
      },
      {
        label: "shutter",
        input: { motion: 1, durationFrames: 10, fps: 30, shutter: { angle: 180, samples: 8, nope: 1 } },
        keys: SHUTTER_KEYS,
        code: "sidecar.shutter.unknownKey",
      },
      {
        label: "assertions[0]",
        input: {
          motion: 1,
          durationFrames: 10,
          fps: 30,
          assertions: [{ node: "caption", entersBy: 3, nope: 1 }],
        },
        keys: ASSERTION_KEYS,
        code: "sidecar.assertions.unknownKey",
      },
      {
        label: "layoutAllow[0]",
        input: {
          motion: 1,
          durationFrames: 10,
          fps: 30,
          layoutAllow: [
            { node: "caption", allow: "overlap", reason: "on purpose", nope: 1 },
          ],
        },
        keys: LAYOUT_ALLOW_KEYS,
        code: "sidecar.layoutAllow.unknownKey",
      },
      {
        label: "sound.bed",
        input: {
          motion: 1,
          durationFrames: 10,
          fps: 30,
          sound: { bed: { src: "a.mp3", nope: 1 } },
        },
        keys: SOUND_BED_KEYS,
        code: "sidecar.sound.bed.unknownKey",
      },
      {
        label: "sound.narration[0]",
        input: {
          motion: 1,
          durationFrames: 10,
          fps: 30,
          sound: {
            narration: [{ id: "vo-1", src: "a.wav", startFrame: 0, nope: 1 }],
          },
        },
        keys: SOUND_NARRATION_KEYS,
        code: "sidecar.sound.narration.unknownKey",
      },
      {
        label: "sound.dialogue[0]",
        input: {
          motion: 1,
          durationFrames: 10,
          fps: 30,
          footage: [
            {
              id: "a-roll",
              src: "clip.mp4",
              nodePrefix: "n",
              tile: 512,
              grid: [2, 2],
            },
          ],
          sound: {
            dialogue: [
              {
                id: "dl-1",
                src: "a.wav",
                track: "a-roll",
                sourceFrame: 0,
                nope: 1,
              },
            ],
          },
        },
        keys: SOUND_DIALOGUE_KEYS,
        code: "sidecar.sound.dialogue.unknownKey",
      },
      {
        label: "sound.cues[0]",
        input: {
          motion: 1,
          durationFrames: 10,
          fps: 30,
          sound: {
            cues: [{ id: "hit-1", src: "a.mp3", atFrame: 0, nope: 1 }],
          },
        },
        keys: SOUND_CUE_KEYS,
        code: "sidecar.sound.cues.unknownKey",
      },
      {
        label: "sound.*.envelope[0]",
        input: {
          motion: 1,
          durationFrames: 10,
          fps: 30,
          sound: {
            cues: [
              {
                id: "hit-1",
                src: "a.mp3",
                atFrame: 0,
                envelope: [{ frame: 0, gain: 1, nope: 1 }, { frame: 1, gain: 1 }],
              },
            ],
          },
        },
        keys: ENVELOPE_POINT_KEYS,
        code: "sidecar.sound.envelope.unknownKey",
      },
      {
        label: "sound.bed.ducks[0]",
        input: {
          motion: 1,
          durationFrames: 10,
          fps: 30,
          sound: { bed: { src: "a.mp3", ducks: [{ startFrame: 0, endFrame: 5, duck: 0.5, nope: 1 }] } },
        },
        keys: BED_DUCK_KEYS,
        code: "sidecar.sound.bed.ducks.unknownKey",
      },
    ] as const;

    const parts: string[] = [];
    for (const c of cases) {
      const result = parseSidecar(c.input);
      if (result.ok) {
        parts.push(`${c.label}: parseSidecar accepted an unknown key`);
        continue;
      }
      const diag = result.diagnostics.find((d) => d.code === c.code);
      if (diag === undefined) {
        parts.push(
          `${c.label}: no ${c.code} diagnostic (got ${result.diagnostics.map((d) => d.code).join(", ")})`,
        );
        continue;
      }
      const marker = "allowed keys are ";
      const idx = diag.message.indexOf(marker);
      if (idx === -1) {
        parts.push(`${c.label}: message ${JSON.stringify(diag.message)} has no "${marker}"`);
        continue;
      }
      const listed = diag.message.slice(idx + marker.length);
      const expected = [...c.keys].join(", ");
      if (listed !== expected) {
        const setName: Record<(typeof cases)[number]["label"], string> = {
          root: "ROOT_KEYS",
          fonts: "FONT_KEYS",
          "fonts.faces[name]": "FONT_FACE_KEYS",
          "footage[0]": "FOOTAGE_KEYS",
          sound: "SOUND_KEYS",
          shutter: "SHUTTER_KEYS",
          "layoutAllow[0]": "LAYOUT_ALLOW_KEYS",
          "assertions[0]": "ASSERTION_KEYS",
          "sound.bed": "SOUND_BED_KEYS",
          "sound.narration[0]": "SOUND_NARRATION_KEYS",
          "sound.dialogue[0]": "SOUND_DIALOGUE_KEYS",
          "sound.cues[0]": "SOUND_CUE_KEYS",
          "sound.*.envelope[0]": "ENVELOPE_POINT_KEYS",
          "sound.bed.ducks[0]": "BED_DUCK_KEYS",
        };
        parts.push(
          `${c.label}: message lists ${JSON.stringify(listed)}; ${setName[c.label]} is ${JSON.stringify(expected)}`,
        );
      }
    }

    // The captions job spec, through `parseSpec`. One case per style, because
    // a style's key set is its own and its message must list that set.
    const job = (overrides: Record<string, unknown>): Record<string, unknown> => ({
      spec: 1,
      template: "captions",
      fonts: { regular: "assets/fonts/HarmonyOS_Sans_Regular.ttf", bold: "assets/fonts/HarmonyOS_Sans_Bold.ttf" },
      transcript: { words: [{ text: "Hello", start: 0, end: 0.5 }], language: "en" },
      style: { name: "highlight" },
      ...overrides,
    });
    const specCases: Array<{ label: string; input: unknown; keys: ReadonlySet<string>; code: string }> = [
      { label: "captions root", input: job({ nope: 1 }), keys: SPEC_CAPTIONS_ROOT_KEYS, code: "spec.unknownKey" },
      {
        label: "captions transcript",
        input: job({ transcript: { words: [], language: "en", nope: 1 } }),
        keys: CAPTIONS_TRANSCRIPT_KEYS,
        code: "spec.transcript.unknownKey",
      },
      {
        label: "captions transcript.words[0]",
        input: job({ transcript: { words: [{ text: "a", start: 0, end: 1, nope: 1 }], language: "en" } }),
        keys: WORD_KEYS,
        code: "spec.transcript.unknownKey",
      },
      { label: "captions layout", input: job({ layout: { nope: 1 } }), keys: CAPTIONS_LAYOUT_KEYS, code: "spec.layout.unknownKey" },
      ...STYLE_NAMES.map((name) => ({
        label: `captions style ${name}`,
        input: job({ style: { name, nope: 1 } }),
        keys: captionsStyleKeys(name),
        code: "spec.style.unknownKey",
      })),
    ];
    for (const c of specCases) {
      const result = parseSpec(c.input, { root: ROOT });
      if (result.ok) {
        parts.push(`${c.label}: parseSpec accepted an unknown key`);
        continue;
      }
      const diag = result.diagnostics.find((d) => d.code === c.code);
      const marker = "allowed keys are ";
      const at = diag?.message.indexOf(marker) ?? -1;
      if (diag === undefined || at === -1) {
        parts.push(`${c.label}: no ${c.code} diagnostic listing the allowed keys`);
        continue;
      }
      const listed = diag.message.slice(at + marker.length);
      if (listed !== [...c.keys].join(", ")) {
        parts.push(`${c.label}: message lists ${JSON.stringify(listed)}; the key set is ${JSON.stringify([...c.keys].join(", "))}`);
      }
    }
    expect(parts, parts.join("\n") || "G5 clean").toEqual([]);
  });

  test("G9 — every captions spec diagnostic is catalogued, and every spec probe is refused with its code", () => {
    const parts: string[] = [];
    const emitted = captionsSourceCodes();
    const rows = SURFACE.filter((row) => row.group === "captions");
    const owned = new Map<string, string>();
    for (const row of rows) for (const code of row.diagnostics) owned.set(code, row.id);

    for (const code of [...emitted].sort()) {
      if (!owned.has(code)) parts.push(`in ${CAPTIONS_SOURCES.join(" / ")} but in no captions row: ${code}`);
    }
    for (const [code, id] of owned) {
      if (!emitted.has(code)) parts.push(`row ${id} owns ${code}, which ${CAPTIONS_SOURCES.join(" / ")} never emits`);
    }
    for (const row of rows) {
      if ((row.specProbes ?? []).length === 0) parts.push(`${row.id} has no spec probe`);
      for (const probe of row.specProbes ?? []) {
        const result = parseSpec(probe.input, { root: ROOT });
        if (result.ok) {
          parts.push(`${row.id} probe ${probe.code}: parseSpec accepted the input`);
          continue;
        }
        const codes = result.diagnostics.map((d) => d.code);
        if (!codes.includes(probe.code)) {
          parts.push(`${row.id} probe ${probe.code}: parseSpec did not emit that code (got ${codes.join(", ")})`);
        }
      }
    }
    expect(parts, parts.join("\n") || "G9 clean").toEqual([]);
  });

  test("mirrored constants still equal upstream's", () => {
    // The catalog publishes 1..512 and the fps list as facts about the
    // renderer, but reads both from `sidecar.ts`, which only mirrors upstream.
    // The pinned literal for `assets.image.dims` is the identifier
    // `TEX_MAX_DIM`, not its value — so an upstream bump would leave every
    // other gate green while the catalog stated a number the build does not
    // enforce. Compare the mirrors to the definitions they name.
    //
    // Read as text rather than imported: `vendor/` does not typecheck under
    // this repository's settings, so an import would pull it into `tsc`. A
    // definition that no longer matches its pattern fails here rather than
    // silently passing.
    function upstreamDefinition(rel: string, pattern: RegExp): string {
      const text = readFileSync(join(ROOT, rel), "utf8");
      const match = pattern.exec(text);
      if (match === null) {
        throw new Error(`${rel} no longer defines ${pattern.source}; the mirror cannot be checked`);
      }
      return match[1]!.replace(/\s/g, "");
    }

    const parts: string[] = [];
    const specDim = upstreamDefinition(
      "vendor/pocketjs/contracts/spec/spec.ts",
      /export const TEX_MAX_DIM = (\d+);/,
    );
    if (String(TEX_MAX_DIM) !== specDim) {
      parts.push(`sidecar.ts TEX_MAX_DIM is ${TEX_MAX_DIM}; contracts/spec/spec.ts is ${specDim}`);
    }
    const imgDim = upstreamDefinition(
      "vendor/pocketjs/contracts/spec/spec.ts",
      /export const IMG_MAX_DIM = (\d+);/,
    );
    if (String(IMG_MAX_DIM) !== imgDim) {
      parts.push(`sidecar.ts IMG_MAX_DIM is ${IMG_MAX_DIM}; contracts/spec/spec.ts is ${imgDim}`);
    }

    // Upstream stopped writing the list out at e0b37e2: `VALID_HZ` is now
    // `divisorsOf(TICKS_PER_SECOND)`, and the tick rate is baked per bundle by
    // `tools/build.ts --hz=`. Motion never passes that flag, so the rate is the
    // source default — scrape it, derive the list the same way upstream does,
    // and compare. The FORM is asserted first: if `VALID_HZ` stops being the
    // divisors of the tick rate this fails, rather than checking a list the
    // runtime no longer computes.
    const clockRel = "vendor/pocketjs/framework/src/clock.ts";
    const clockText = readFileSync(join(ROOT, clockRel), "utf8");
    if (!/VALID_HZ: readonly number\[\] = divisorsOf\(TICKS_PER_SECOND\);/.test(clockText)) {
      parts.push(`${clockRel} no longer derives VALID_HZ from TICKS_PER_SECOND; the mirror cannot be checked`);
    } else {
      const tickHz = Number(upstreamDefinition(clockRel, /\? __POCKET_TICK_HZ__ : (\d+)/));
      const divisors: number[] = [];
      for (let d = 1; d <= tickHz; d++) if (tickHz % d === 0) divisors.push(d);
      const mirrored = [...VALID_FPS].join(",");
      if (mirrored !== divisors.join(",")) {
        parts.push(
          `sidecar.ts VALID_FPS is ${mirrored}; divisors of ${clockRel}'s ${tickHz} are ${divisors.join(",")}`,
        );
      }
      // boot.ts carries the rate itself, so the derivation above has a second
      // mirror behind it. The pin bump is what made this load-bearing.
      const bootHz = upstreamDefinition("src/runtime/boot.ts", /const TICKS_PER_SECOND = (\d+);/);
      if (bootHz !== String(tickHz)) {
        parts.push(`boot.ts TICKS_PER_SECOND is ${bootHz}; ${clockRel} bakes ${tickHz}`);
      }
    }
    expect(parts, parts.join("\n") || "mirrors clean").toEqual([]);
  });

  test("pinned literals occur in the named source file", () => {
    const parts: string[] = [];
    for (const row of SURFACE) {
      if (row.verification !== "pinned") continue;
      const rel = sourceFile(row.source);
      const abs = join(ROOT, rel);
      if (!existsSync(abs)) {
        parts.push(`${row.id}: source file ${rel} does not exist`);
        continue;
      }
      const text = readFileSync(abs, "utf8");
      for (const pin of row.pinned) {
        if (!text.includes(pin)) {
          parts.push(`${row.id}: pinned ${JSON.stringify(pin)} not found in ${rel}`);
        }
      }
    }
    expect(parts, parts.join("\n") || "pinned clean").toEqual([]);
  });
});
