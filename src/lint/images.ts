/**
 * A referenced still picture that is not on disk.
 *
 * `vendor/pocketjs/tools/build.ts` discovers images by looking at every string
 * literal the module walk collected and treating each one that matches
 * `/^[\w./-]+\.(?:png|svg)$/i` as an asset name. A name it cannot find is NOT
 * an error there: it bakes a 32×32 checkerboard, logs one line, and the build
 * succeeds. Everything downstream then succeeds too — the pak is valid, the
 * render runs, and the digest is stable and reproducible, which is the worst
 * shape a defect can take here. Every neighbouring absence is loud: a missing
 * footage source, a missing declared face and a window past the end of a clip
 * all stop the command.
 *
 * So this is the gate, on our side of the vendor line, and the discovery has
 * to be upstream's or it would be answering about a different set of files:
 *
 * - the same regex, over string LITERALS only. A path in a comment is not a
 *   declaration, and neither is one assembled at runtime — an interpolated
 *   template is never a class candidate upstream either.
 * - the same three places, in the same order: the composition's own directory,
 *   then the VENDORED tree's `assets/images/` and `assets/`. Those two are
 *   upstream's, not this repository's: `tools/build.ts` resolves them against
 *   its own root, so `"logo.png"` finds the demo logo shipped with the engine
 *   and `assets/` here is never consulted.
 * - the same module graph: the entry, then every relative import reachable
 *   from it. NOT the composition directory's other files, which is where
 *   `lint`'s mount-only pass looks — `compositions/lower-third/gen.ts` names
 *   `logo.png` and `logo.svg` as job template strings, and it is a program
 *   that WRITES the composition rather than one the build compiles. Flagging
 *   those would fail a composition that builds and renders correctly.
 *
 * What is not checked here: the dimensions (`encodeImageEntry` refuses a
 * non-power-of-two or one over 512 loudly already) and the `images.json` /
 * `sprites.json` manifests. A manifest key naming a file nothing references is
 * inert upstream — `compositions/copy` and `compositions/lower-third` both
 * carry one for the glow plates their generator writes only when a job asks
 * for them — so refusing it would fail two compositions that are correct.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { pocketjsRoot } from "../runtime/boot.ts";
import type { LintFinding } from "./mount-only.ts";

/** Upstream's asset-name test, character for character. */
export const IMAGE_NAME = /^[\w./-]+\.(?:png|svg)$/i;

export const CODE_IMAGE_MISSING = "images.missingFile";

interface StringLiteral {
  readonly value: string;
  readonly line: number;
  readonly column: number;
}

/**
 * Every complete string literal in a source, with its position.
 *
 * Single and double quotes, and backticks with nothing interpolated into them
 * — the three forms that are one whole string at compile time. An interpolated
 * template is skipped: upstream cannot see a class name in one either.
 */
export function stringLiterals(source: string): StringLiteral[] {
  const out: StringLiteral[] = [];
  let line = 1;
  let column = 1;
  let i = 0;
  const advance = (n = 1): void => {
    for (let k = 0; k < n && i < source.length; k++) {
      if (source[i] === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
      i++;
    }
  };

  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") advance();
      continue;
    }
    if (c === "/" && next === "*") {
      advance(2);
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) advance();
      advance(2);
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const startLine = line;
      const startColumn = column;
      advance();
      let value = "";
      let interpolated = false;
      let closed = false;
      while (i < source.length) {
        const ch = source[i]!;
        if (ch === "\\") {
          value += source[i + 1] ?? "";
          advance(2);
          continue;
        }
        if (ch === quote) {
          advance();
          closed = true;
          break;
        }
        if (quote !== "`" && ch === "\n") break; // unterminated; not a literal
        if (quote === "`" && ch === "$" && source[i + 1] === "{") {
          interpolated = true;
        }
        value += ch;
        advance();
      }
      if (closed && !interpolated) {
        out.push({ value, line: startLine, column: startColumn });
      }
      continue;
    }
    advance();
  }
  return out;
}

/** Relative import/export specifiers in a source, in source order. */
function relativeSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    const spec = m[2]!;
    if (spec.startsWith("./") || spec.startsWith("../")) out.push(spec);
  }
  return out;
}

/** The modules the build compiles for this composition: entry + relative imports. */
export async function compositionModules(entryPath: string): Promise<string[]> {
  const seen = new Set<string>();
  const order: string[] = [];
  const walk = async (file: string): Promise<void> => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    order.push(file);
    const source = await Bun.file(file).text();
    for (const spec of relativeSpecifiers(source)) {
      let resolved: string;
      try {
        resolved = Bun.resolveSync(spec, dirname(file));
      } catch {
        continue; // an import that does not resolve is the build's error, not this one's
      }
      if (/\.tsx?$/.test(resolved) && !resolved.endsWith(".d.ts")) await walk(resolved);
    }
  };
  await walk(entryPath);
  return order;
}

/**
 * The three places upstream looks, in order — the composition's directory,
 * then the vendored tree's `assets/images/` and `assets/`.
 */
export function imageCandidates(name: string, compositionDir: string): string[] {
  const upstream = pocketjsRoot();
  return [
    join(compositionDir, name),
    join(upstream, "assets/images", name),
    join(upstream, "assets", name),
  ];
}

/** Referenced images with no file behind them, as lint findings. */
export async function lintImages(options: {
  readonly entryPath: string;
  readonly compositionDir: string;
}): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  const reported = new Set<string>();
  for (const file of await compositionModules(options.entryPath)) {
    const source = await Bun.file(file).text();
    for (const literal of stringLiterals(source)) {
      if (!IMAGE_NAME.test(literal.value)) continue;
      if (reported.has(literal.value)) continue;
      const candidates = imageCandidates(literal.value, options.compositionDir);
      if (candidates.some((p) => existsSync(p))) continue;
      reported.add(literal.value);
      findings.push({
        code: CODE_IMAGE_MISSING,
        file,
        line: literal.line,
        column: literal.column,
        message:
          `image ${JSON.stringify(literal.value)} is referenced here and is on disk in none of ` +
          `${candidates.join(", ")} — the build would bake a 32×32 placeholder and succeed, ` +
          "so the loss would reach the delivery with a stable digest behind it",
      });
    }
  }
  return findings;
}
