/**
 * Static mount-only lint for PocketJS Motion compositions.
 *
 * v1 compositions must be mount-only: after mount, all motion comes from
 * baked keyframe timelines the core plays itself. Per-frame JS (onFrame,
 * after(), effects, fixed-viewport components) puts frame state in the JS
 * heap where a core checkpoint cannot see it — those patterns are rejected
 * here as a fail-fast check.
 *
 * This is one gate of three, and the conservative one. An import blacklist can
 * be walked around with a re-export or a helper, so it is paired with the ops
 * oracle in `oracle.ts` (what actually reached the core) and with
 * `BootedWorld.pendingWork()` (what the framework is still holding). `check`
 * fails on any of the three.
 *
 * Scoped per file: `lintSource` reads one source's text. Callers lint every
 * source in a composition — an entry that renders a component from another
 * module is the normal shape, so linting the entry alone inspects the one file
 * that cannot hold the violation.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LintFinding {
  readonly code: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Forbidden names by rule
// ---------------------------------------------------------------------------

/** Per-frame / input hooks — only forbidden when imported from @pocketjs/framework/* */
const FRAME_HOOK_NAMES = new Set([
  "onFrame",
  "onButtonPress",
  "createSpriteAnimation",
]);

/** Timers / clock reads — forbidden from any .../clock module */
const CLOCK_NAMES = new Set(["after", "virtualNow", "simulationHz"]);

/** Effect queues — forbidden from any .../effects module */
const EFFECT_NAMES = new Set(["runEffect", "installEffectDriver"]);

/** Fixed-viewport constants — forbidden from anywhere */
const SCREEN_NAMES = new Set(["SCREEN_W", "SCREEN_H"]);

/** Built-ins that hard-code 480×272 — forbidden from any .../components module */
const COMPONENT_NAMES = new Set([
  "Gallery",
  "DeepZoom",
  "OSK",
  "TextField",
  "VirtualList",
]);

/** Union of every name we care about (imports + bare identifiers). */
const ALL_FORBIDDEN_NAMES = new Set<string>([
  ...FRAME_HOOK_NAMES,
  ...CLOCK_NAMES,
  ...EFFECT_NAMES,
  ...SCREEN_NAMES,
  ...COMPONENT_NAMES,
]);

const CODE_FORBIDDEN_IMPORT = "mountOnly.forbiddenImport";
const CODE_BARE_IDENTIFIER = "mountOnly.bareIdentifier";

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

function indexToLineCol(
  source: string,
  index: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

// ---------------------------------------------------------------------------
// Region classification: code vs comment vs string
// ---------------------------------------------------------------------------

export type RegionKind = "code" | "comment" | "string";

/**
 * Classify every character. Template `${...}` interpolations are `code`.
 * Length equals `source.length`. Used so import/id scans never look inside
 * comments or string literals.
 *
 * Exported because `src/lint/tiles.ts` needs the same distinction for the
 * opposite reason: it looks ONLY inside string and template literals, and a
 * second scanner would disagree with this one about template interpolation
 * and nested quotes the first time either was touched.
 */
export function classifyRegions(source: string): RegionKind[] {
  const n = source.length;
  const kind: RegionKind[] = new Array(n);
  // Default to code; overwrite as we scan
  for (let i = 0; i < n; i++) kind[i] = "code";

  let i = 0;
  while (i < n) {
    const c = source[i]!;
    const next = i + 1 < n ? source[i + 1]! : "";

    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") {
        kind[i] = "comment";
        i++;
      }
      continue;
    }

    if (c === "/" && next === "*") {
      kind[i] = "comment";
      kind[i + 1] = "comment";
      i += 2;
      while (i < n) {
        kind[i] = "comment";
        if (source[i] === "*" && i + 1 < n && source[i + 1] === "/") {
          kind[i + 1] = "comment";
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    if (c === "'" || c === '"') {
      const q = c;
      kind[i] = "string";
      i++;
      while (i < n) {
        kind[i] = "string";
        if (source[i] === "\\") {
          if (i + 1 < n) {
            kind[i + 1] = "string";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (source[i] === q) {
          i++;
          break;
        }
        if (source[i] === "\n") break;
        i++;
      }
      continue;
    }

    if (c === "`") {
      i = scanTemplate(source, kind, i);
      continue;
    }

    i++;
  }

  return kind;
}

/** Scan template starting at backtick index `at`. Returns index after closing tick. */
function scanTemplate(
  source: string,
  kind: RegionKind[],
  at: number,
): number {
  const n = source.length;
  let i = at;
  kind[i] = "string";
  i++;
  while (i < n) {
    if (source[i] === "\\") {
      kind[i] = "string";
      if (i + 1 < n) kind[i + 1] = "string";
      i += 2;
      continue;
    }
    if (source[i] === "`") {
      kind[i] = "string";
      return i + 1;
    }
    if (source[i] === "$" && i + 1 < n && source[i + 1] === "{") {
      kind[i] = "string";
      kind[i + 1] = "string";
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        const ch = source[i]!;
        const nx = i + 1 < n ? source[i + 1]! : "";

        if (ch === "/" && nx === "/") {
          while (i < n && source[i] !== "\n") {
            kind[i] = "comment";
            i++;
          }
          continue;
        }
        if (ch === "/" && nx === "*") {
          kind[i] = "comment";
          kind[i + 1] = "comment";
          i += 2;
          while (i < n) {
            kind[i] = "comment";
            if (source[i] === "*" && i + 1 < n && source[i + 1] === "/") {
              kind[i + 1] = "comment";
              i += 2;
              break;
            }
            i++;
          }
          continue;
        }
        if (ch === "'" || ch === '"') {
          const q = ch;
          kind[i] = "string";
          i++;
          while (i < n) {
            kind[i] = "string";
            if (source[i] === "\\") {
              if (i + 1 < n) kind[i + 1] = "string";
              i += 2;
              continue;
            }
            if (source[i] === q) {
              i++;
              break;
            }
            if (source[i] === "\n") break;
            i++;
          }
          continue;
        }
        if (ch === "`") {
          i = scanTemplate(source, kind, i);
          continue;
        }
        if (ch === "{") {
          // stay code
          depth++;
          i++;
          continue;
        }
        if (ch === "}") {
          depth--;
          if (depth === 0) {
            kind[i] = "string"; // closing of ${
            i++;
            break;
          }
          i++;
          continue;
        }
        // code inside interpolation — kind[i] already "code"
        i++;
      }
      continue;
    }
    kind[i] = "string";
    i++;
  }
  return i;
}

/** Build a string equal in length to `source` where non-code is spaces (newlines kept). */
function maskNonCode(source: string, kind: RegionKind[]): string {
  const out = source.split("");
  for (let i = 0; i < out.length; i++) {
    if (kind[i] !== "code" && out[i] !== "\n" && out[i] !== "\r") {
      out[i] = " ";
    }
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// Module specifier matching
// ---------------------------------------------------------------------------

function stripExt(spec: string): string {
  return spec.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");
}

function isPocketFramework(spec: string): boolean {
  return (
    spec === "@pocketjs/framework" || spec.startsWith("@pocketjs/framework/")
  );
}

function moduleEndsWith(spec: string, segment: string): boolean {
  const base = stripExt(spec);
  return base === segment || base.endsWith("/" + segment);
}

function importViolation(name: string, spec: string): string | null {
  if (FRAME_HOOK_NAMES.has(name) && isPocketFramework(spec)) {
    return `importing '${name}' from '${spec}' is forbidden (per-frame JS; mount-only compositions use baked keyframe timelines)`;
  }
  if (CLOCK_NAMES.has(name) && moduleEndsWith(spec, "clock")) {
    return `importing '${name}' from '${spec}' is forbidden (timers / virtual clock; mount-only compositions issue no post-mount clock work)`;
  }
  if (EFFECT_NAMES.has(name) && moduleEndsWith(spec, "effects")) {
    return `importing '${name}' from '${spec}' is forbidden (effect queues put frame state in the JS heap)`;
  }
  if (SCREEN_NAMES.has(name)) {
    return `importing '${name}' from '${spec}' is forbidden (fixed-viewport constant; use hostViewport(ops) with a dynamic viewport)`;
  }
  if (COMPONENT_NAMES.has(name) && moduleEndsWith(spec, "components")) {
    return `importing '${name}' from '${spec}' is forbidden (built-in hard-codes 480×272 geometry)`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Import / export-from parsing
// ---------------------------------------------------------------------------

interface ImportedBinding {
  readonly importedName: string;
  readonly localName: string;
  readonly nameIndex: number;
  readonly spec: string;
}

/** Parse one named-import element: `a`, `a as b`, `type a`, `type a as b`. */
function parseSpecElement(
  raw: string,
): { imported: string; local: string } | null {
  let s = raw.trim();
  if (!s || s.startsWith("*")) return null;
  if (/^type\s+/.test(s)) s = s.replace(/^type\s+/, "").trim();
  const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(s);
  if (asMatch) return { imported: asMatch[1]!, local: asMatch[2]! };
  const idMatch = /^([A-Za-z_$][\w$]*)$/.exec(s);
  if (idMatch) return { imported: idMatch[1]!, local: idMatch[1]! };
  return null;
}

/**
 * Find `import` / `export ... from` statements that begin in code regions.
 * Uses the original source so module specifier strings stay readable; skips
 * matches whose `import`/`export` keyword sits inside a comment or string.
 */
function collectImports(
  source: string,
  kind: RegionKind[],
): {
  bindings: ImportedBinding[];
  statementRanges: Array<[number, number]>;
} {
  const bindings: ImportedBinding[] = [];
  const statementRanges: Array<[number, number]> = [];

  // Match import/export-from. Non-greedy clause; specifier in quotes.
  const re =
    /\b(?:import|export)(?:\s+type)?\s+([\s\S]*?)\bfrom\s*(['"])([^'"]*)\2/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const fullStart = m.index;
    // Keyword must sit in code (not a comment or string that happens to
    // contain "import"). Rewind before continuing: the clause is `[\s\S]*?`, so
    // a match anchored on a commented-out keyword runs across the newline and
    // swallows the NEXT real statement up to its `from "…"`. Leaving lastIndex
    // past it drops that import's bindings entirely, and the violation degrades
    // to a bare-identifier finding whose message ("not imported here") is the
    // opposite of true. Resuming one character in re-finds the real keyword.
    if (kind[fullStart] !== "code") {
      re.lastIndex = fullStart + 1;
      continue;
    }

    const fullEnd = fullStart + m[0].length;
    statementRanges.push([fullStart, fullEnd]);

    const clause = m[1] ?? "";
    const clauseStart = fullStart + m[0].indexOf(clause);
    const spec = m[3] ?? "";

    // Named bindings inside `{ ... }`
    const braceOpen = clause.indexOf("{");
    if (braceOpen >= 0) {
      const braceClose = clause.indexOf("}", braceOpen);
      if (braceClose >= 0) {
        const inside = clause.slice(braceOpen + 1, braceClose);
        // Absolute index of the char after `{`
        const insideStart = clauseStart + braceOpen + 1;
        let cursor = 0;
        for (const part of inside.split(",")) {
          const trimmed = part.trim();
          const partBeginInInside = cursor + (part.length - part.trimStart().length);
          cursor += part.length + 1; // +1 for comma
          if (!trimmed) continue;
          const parsed = parseSpecElement(trimmed);
          if (!parsed) continue;
          // Imported name offset within the trimmed element
          // For `type Foo` / `Foo as Bar`, the imported token is parsed.imported
          const nameOffsetInTrimmed = (() => {
            // Prefer first identifier matching imported name after optional `type `
            const typeStripped = trimmed.replace(/^type\s+/, "");
            const idx = typeStripped.indexOf(parsed.imported);
            const typePrefixLen = trimmed.length - typeStripped.length;
            return idx >= 0 ? typePrefixLen + idx : trimmed.indexOf(parsed.imported);
          })();
          const nameIndex = insideStart + partBeginInInside + nameOffsetInTrimmed;
          bindings.push({
            importedName: parsed.imported,
            localName: parsed.local,
            nameIndex,
            spec,
          });
        }
      }

      // Default before brace: `Foo, { ... }`
      const before = clause.slice(0, braceOpen).replace(/,\s*$/, "").trim();
      if (before && !before.startsWith("*")) {
        const d = parseSpecElement(before);
        if (d) {
          const di = clauseStart + clause.indexOf(d.imported);
          bindings.push({
            importedName: d.imported,
            localName: d.local,
            nameIndex: di,
            spec,
          });
        }
      }
      continue;
    }

    // Namespace only — no named bindings
    if (/\*\s+as\s+/.test(clause)) continue;

    // Default-only: `import Foo from "..."`
    const def = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)\s*$/.exec(clause);
    if (def) {
      const name = def[1]!;
      bindings.push({
        importedName: name,
        localName: name,
        nameIndex: clauseStart + clause.indexOf(name),
        spec,
      });
    }
  }

  return { bindings, statementRanges };
}

// ---------------------------------------------------------------------------
// Bare identifier scan
// ---------------------------------------------------------------------------

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

function findBareIdentifiers(
  codeOnly: string,
  skipRanges: Array<[number, number]>,
  importedLocals: ReadonlySet<string>,
): Array<{ name: string; index: number }> {
  const hits: Array<{ name: string; index: number }> = [];
  const len = codeOnly.length;

  const inSkip = (idx: number): boolean => {
    for (const [a, b] of skipRanges) {
      if (idx >= a && idx < b) return true;
    }
    return false;
  };

  let i = 0;
  while (i < len) {
    if (!isIdentStart(codeOnly[i]!)) {
      i++;
      continue;
    }
    const start = i;
    i++;
    while (i < len && isIdentPart(codeOnly[i]!)) i++;
    const name = codeOnly.slice(start, i);

    if (!ALL_FORBIDDEN_NAMES.has(name)) continue;
    if (inSkip(start)) continue;
    if (importedLocals.has(name)) continue;

    // Skip property access: `.name` (optional chaining `?.name` ends with `.`)
    let j = start - 1;
    while (j >= 0 && (codeOnly[j] === " " || codeOnly[j] === "\t")) j--;
    if (j >= 0 && codeOnly[j] === ".") continue;

    hits.push({ name, index: start });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan one source file's text for mount-only violations.
 * `file` is used only for reporting (not read from disk).
 */
export function lintSource(
  source: string,
  file: string,
): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  const kind = classifyRegions(source);
  const { bindings, statementRanges } = collectImports(source, kind);

  const importedForbiddenLocals = new Set<string>();

  for (const b of bindings) {
    if (!ALL_FORBIDDEN_NAMES.has(b.importedName)) continue;
    const message = importViolation(b.importedName, b.spec);
    if (message) {
      const { line, column } = indexToLineCol(source, b.nameIndex);
      findings.push({
        code: CODE_FORBIDDEN_IMPORT,
        file,
        line,
        column,
        message,
      });
      importedForbiddenLocals.add(b.localName);
    } else {
      // Name is tracked but this module path is allowed for it (e.g. onFrame
      // from a relative re-export). Suppress bare-identifier on the local
      // binding; the runtime oracle covers the re-export hole.
      importedForbiddenLocals.add(b.localName);
    }
  }

  const codeOnly = maskNonCode(source, kind);
  const bareHits = findBareIdentifiers(
    codeOnly,
    statementRanges,
    importedForbiddenLocals,
  );

  for (const hit of bareHits) {
    const { line, column } = indexToLineCol(source, hit.index);
    findings.push({
      code: CODE_BARE_IDENTIFIER,
      file,
      line,
      column,
      message: `bare identifier '${hit.name}' — not imported here; may be a re-export of a mount-only-forbidden API (triage: confirm source or rewrite)`,
    });
  }

  findings.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.column !== b.column) return a.column - b.column;
    return a.code.localeCompare(b.code);
  });

  return findings;
}
