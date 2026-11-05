/**
 * An `<Svg src>` whose file is not on disk, or that will not import.
 *
 * `<Svg src="./x.svg" parts={…} />` is expanded by the build into a tree of
 * Views and `<Path>`s (`patches/0053`, `framework/compiler/svg-tree.ts`). The
 * build refuses both cases itself — `file:line:col: <Svg>: …` and exit 1 —
 * so unlike a missing still picture (`images.ts`) nothing reaches a render.
 * This is the same refusal earlier: `lint` answers without building, and
 * `check` before it boots a bundle that predates the file's loss.
 *
 * The discovery is the build's: the vendored `svgSites` finds the JSX
 * elements named by a binding imported as `Svg` from the framework's
 * components, over the entry and the relative imports reachable from it
 * (`compositionModules`, the graph `images.ts` walks), and `src` resolves
 * against the module that wrote it, as an import does. A site whose `src`,
 * `width` or `height` is not a literal is not one this can read; the build
 * refuses it, located.
 *
 * What is not checked here: the `parts` map. A key naming no id is refused
 * by the build, which is the only reader of the map's expressions.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { pocketjsRoot } from "../runtime/boot.ts";
import { compositionModules } from "./images.ts";
import type { LintFinding } from "./mount-only.ts";

export const CODE_SVG_MISSING = "svg.missingFile";
export const CODE_SVG_UNSUPPORTED = "svg.unsupported";

interface SvgSite {
  readonly src: string;
  readonly line: number;
  readonly column: number;
  readonly width?: number;
  readonly height?: number;
}

interface SvgTreeModule {
  svgSites(source: string, filename: string): SvgSite[];
  importSvg(text: string, size?: { width?: number; height?: number }): unknown;
  SvgImportError: new (message: string) => Error;
}

async function svgTree(): Promise<SvgTreeModule> {
  return (await import(`${pocketjsRoot()}/framework/compiler/svg-tree.ts`)) as unknown as SvgTreeModule;
}

/** Every `<Svg src>` in one module, by the build's discovery. */
export async function svgSitesIn(file: string, source: string): Promise<SvgSite[]> {
  return (await svgTree()).svgSites(source, file);
}

/** `<Svg>` files that are missing or refused by the import, as lint findings. */
export async function lintSvgTrees(options: { readonly entryPath: string }): Promise<LintFinding[]> {
  const tree = await svgTree();
  const findings: LintFinding[] = [];
  for (const file of await compositionModules(options.entryPath)) {
    const source = await Bun.file(file).text();
    for (const site of tree.svgSites(source, file)) {
      const path = resolve(dirname(file), site.src);
      const at = { file, line: site.line, column: site.column };
      if (!existsSync(path)) {
        findings.push({
          ...at,
          code: CODE_SVG_MISSING,
          message:
            `<Svg src=${JSON.stringify(site.src)}> names ${path}, which is not on disk — ` +
            "the build expands the file into the picture's nodes and refuses without it",
        });
        continue;
      }
      try {
        tree.importSvg(await Bun.file(path).text(), {
          ...(site.width !== undefined ? { width: site.width } : {}),
          ...(site.height !== undefined ? { height: site.height } : {}),
        });
      } catch (e) {
        if (!(e instanceof tree.SvgImportError)) throw e;
        findings.push({ ...at, code: CODE_SVG_UNSUPPORTED, message: `<Svg src=${JSON.stringify(site.src)}>: ${e.message}` });
      }
    }
  }
  return findings;
}
