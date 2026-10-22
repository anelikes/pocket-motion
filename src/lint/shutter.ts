/**
 * A `shutter-hold` the source text shows cannot do anything.
 *
 * Under a declared shutter, `shutter-hold` keeps the timelines of the node
 * whose class literal carries it at the frame's tick in every sample
 * (`Ui::shutter_sample`, patches/0034). Two things follow from that rule and
 * both are easy to miss from the authoring side, because the picture is drawn
 * by the tree rather than by the literal:
 *
 *   - THE HOLD IS NOT INHERITED. A node is drawn under every ancestor's
 *     transform, so a caption inside a sliding group blurs with the group
 *     whatever it holds. The hold that keeps it sharp is the one on the group.
 *     `shutter.holdUnderAnimatedAncestor` is a held element inside an element
 *     whose class literal starts an animation and does not hold.
 *   - IT HOLDS THE NODE'S OWN TIMELINES. A literal with `shutter-hold` and no
 *     `animate-*` starts no timeline for the hold to keep; the timelines that
 *     move the picture are somewhere else. `shutter.holdsNothing` is that, and
 *     also every hold in a composition whose sidecar declares no shutter.
 *
 * ── WHAT IT LOOKS AT ─────────────────────────────────────────────────────────
 *
 * The composition directory's own `.ts` / `.tsx` files, the list `lint`
 * already reads, parsed with upstream's own parser (`@babel/parser` from the
 * vendored tree, the one its JSX transform runs on). A class literal is a value
 * the `class` attribute can take on some execution — a string, a backtick with
 * nothing interpolated, either arm of a ternary, the right of `&&`, both sides
 * of `||` and `??` — the same "whole value" rule `patches/0012` records.
 *
 * ── WHAT IT CANNOT SEE, and says so in the message ─────────────────────────
 *
 * Ancestry is LEXICAL and within one file: a held element rendered by a
 * component another file places inside a moving group is invisible to it. It
 * does not read the keyframes an `animate-*` token names, so an ancestor whose
 * animation only fades is warned about too — the message says the warning
 * applies if that animation moves the node. That is why these are warnings: a
 * claim about what the source text says, not about what the composition does.
 * `frame --at N` is what shows whether the caption is sharp.
 */

import { pocketjsRoot } from "../runtime/boot.ts";

export const CODE_HOLD_UNDER_ANIMATED_ANCESTOR = "shutter.holdUnderAnimatedAncestor";
export const CODE_HOLDS_NOTHING = "shutter.holdsNothing";

export interface ShutterWarning {
  readonly code: typeof CODE_HOLD_UNDER_ANIMATED_ANCESTOR | typeof CODE_HOLDS_NOTHING;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

const HOLD = "shutter-hold";

interface AstNode {
  readonly type: string;
  readonly loc?: { readonly start: { readonly line: number; readonly column: number } };
  readonly [key: string]: unknown;
}

/** One possible value of an element's `class`, and where it was written. */
interface ClassLiteral {
  readonly tokens: readonly string[];
  readonly line: number;
  readonly column: number;
}

interface ElementClass {
  readonly literals: readonly ClassLiteral[];
  readonly line: number;
}

const isAnimation = (token: string): boolean =>
  token.startsWith("animate-") && !token.startsWith("animate-loop-");

const animates = (e: ElementClass): boolean =>
  e.literals.some((l) => l.tokens.some(isAnimation));
const holds = (e: ElementClass): boolean => e.literals.some((l) => l.tokens.includes(HOLD));

function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function literal(text: string, at: AstNode): ClassLiteral {
  return {
    tokens: text.split(/\s+/).filter((t) => t.length > 0),
    line: at.loc?.start.line ?? 0,
    column: (at.loc?.start.column ?? 0) + 1,
  };
}

/** Every literal `expr` can evaluate to as a whole: the 0012 rule. */
function wholeValues(expr: AstNode | undefined | null): ClassLiteral[] {
  if (!expr) return [];
  switch (expr.type) {
    case "StringLiteral":
      return [literal(expr.value as string, expr)];
    case "TemplateLiteral": {
      const quasis = expr.quasis as AstNode[];
      if ((expr.expressions as unknown[]).length > 0 || quasis.length !== 1) return [];
      const cooked = (quasis[0]!.value as { cooked?: string }).cooked;
      return cooked === undefined ? [] : [literal(cooked, expr)];
    }
    case "JSXExpressionContainer":
      return wholeValues(expr.expression as AstNode);
    case "ConditionalExpression":
      return [...wholeValues(expr.consequent as AstNode), ...wholeValues(expr.alternate as AstNode)];
    case "LogicalExpression":
      // A non-empty string is truthy, so the left of `&&` is never the value.
      return expr.operator === "&&"
        ? wholeValues(expr.right as AstNode)
        : [...wholeValues(expr.left as AstNode), ...wholeValues(expr.right as AstNode)];
    case "ParenthesizedExpression":
    case "TSAsExpression":
      return wholeValues(expr.expression as AstNode);
    default:
      return [];
  }
}

function classOf(element: AstNode): ElementClass {
  const opening = element.openingElement as AstNode;
  const literals: ClassLiteral[] = [];
  for (const attr of (opening.attributes as AstNode[]) ?? []) {
    if (attr.type !== "JSXAttribute") continue;
    const name = attr.name as AstNode;
    if (name.type !== "JSXIdentifier" || (name.name !== "class" && name.name !== "className")) continue;
    literals.push(...wholeValues(attr.value as AstNode));
  }
  return { literals, line: element.loc?.start.line ?? 0 };
}

/**
 * Warnings for one source file. `declared` is whether the sidecar declares a
 * shutter at all. Files that never mention `shutter-hold` are not parsed.
 */
export async function lintShutterSource(
  text: string,
  file: string,
  declared: boolean,
): Promise<ShutterWarning[]> {
  if (!text.includes(HOLD)) return [];
  const { parse } = (await import(
    `${pocketjsRoot()}/node_modules/@babel/parser/lib/index.js`
  )) as { parse: (code: string, options: unknown) => { program: AstNode } };
  let program: AstNode;
  try {
    program = parse(text, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: true,
    }).program;
  } catch {
    return []; // the build reports a file it cannot parse
  }

  const out: ShutterWarning[] = [];
  const visit = (node: unknown, ancestors: readonly ElementClass[]): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, ancestors);
      return;
    }
    if (!isNode(node)) return;
    if (node.type === "JSXElement") {
      const own = classOf(node);
      check(own, ancestors);
      visit(node.openingElement, ancestors);
      visit(node.children, [...ancestors, own]);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "extra") continue;
      if (typeof value === "object" && value !== null) visit(value, ancestors);
    }
  };

  const check = (own: ElementClass, ancestors: readonly ElementClass[]): void => {
    for (const lit of own.literals) {
      if (!lit.tokens.includes(HOLD)) continue;
      if (!declared) {
        out.push({
          code: CODE_HOLDS_NOTHING,
          file,
          line: lit.line,
          column: lit.column,
          message:
            "`shutter-hold` here holds nothing: this composition's sidecar declares no `shutter`, " +
            "so every frame is its own tick already",
        });
        continue;
      }
      if (!lit.tokens.some(isAnimation)) {
        out.push({
          code: CODE_HOLDS_NOTHING,
          file,
          line: lit.line,
          column: lit.column,
          message:
            "`shutter-hold` holds the node's OWN timelines and this class literal starts none " +
            "(no `animate-*`); a timeline on a child is the child's to hold, one on an ancestor the ancestor's",
        });
      }
      const mover = [...ancestors].reverse().find((a) => animates(a) && !holds(a));
      if (mover) {
        out.push({
          code: CODE_HOLD_UNDER_ANIMATED_ANCESTOR,
          file,
          line: lit.line,
          column: lit.column,
          message:
            `\`shutter-hold\` is not inherited, and this element sits inside the one at line ${mover.line}, ` +
            "whose class starts an animation and does not hold: if that animation moves it, this node " +
            "blurs with it in every sample. Hold the moving element. (Read from the source text, within " +
            "this file: lint does not read the keyframes an `animate-*` names, nor ancestry across components.)",
        });
      }
    }
  };

  visit(program, []);
  return out;
}

/** Every file `lint` reads, in order. */
export async function lintShutterHolds(
  texts: readonly { readonly file: string; readonly text: string }[],
  declared: boolean,
): Promise<ShutterWarning[]> {
  const out: ShutterWarning[] = [];
  for (const { file, text } of texts) out.push(...(await lintShutterSource(text, file, declared)));
  return out;
}
