/**
 * Job spec for a parameterized composition.
 *
 * A spec is the data a generator reads once, at build time. It is not passed
 * into the guest. Unknown keys are errors; missing fields take parser defaults
 * only — a job is a complete object, not a patch on another job.
 *
 * `template` names which generator may consume it. Feeding a `copy` spec to
 * `lower-third` is a refusal, not a silent drop of extra fields.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

import {
  DURATION_FRAMES_MAX,
  DURATION_FRAMES_MIN,
  FONT_WEIGHT_KEYS,
  FOOTAGE_FIT_VALUES,
  SUPERSAMPLE_VALUES,
  IMG_MAX_DIM,
  VALID_FPS,
  type Diagnostic,
  type FootageFit,
  type SidecarFonts,
} from "./sidecar.ts";
import { pathIssue } from "./paths.ts";
import {
  CAPTIONS_BODY_KEYS,
  SPEC_TEMPLATE_CAPTIONS,
  parseCaptionsBody,
  type CaptionsBody,
} from "../captions/spec.ts";

/**
 * A job spec names the default pair only. Named faces are a sidecar
 * declaration (`fonts.faces`), written by the generator that reads the spec,
 * so the spec's own key set stays the two weights.
 */
const SPEC_FONT_KEYS = new Set<string>(FONT_WEIGHT_KEYS);

export const SPEC_TEMPLATE_COPY = "copy";
export const SPEC_TEMPLATE_LOWER_THIRD = "lower-third";

export { SPEC_TEMPLATE_CAPTIONS };

export const SPEC_TEMPLATES = [SPEC_TEMPLATE_COPY, SPEC_TEMPLATE_LOWER_THIRD, SPEC_TEMPLATE_CAPTIONS] as const;
export type SpecTemplate = (typeof SPEC_TEMPLATES)[number];

export const SPEC_ENVELOPE_KEYS = new Set([
  "spec",
  "template",
  "viewport",
  "fps",
  "durationFrames",
  "supersample",
  "fonts",
]);

/** Allowed root keys for `template: "copy"`. Tests pin this set in the unknown-key message. */
export const SPEC_ROOT_KEYS = new Set([...SPEC_ENVELOPE_KEYS, "copy", "palette", "glow"]);

export const SPEC_LOWER_THIRD_ROOT_KEYS = new Set([
  ...SPEC_ENVELOPE_KEYS,
  "copy",
  "palette",
  "logo",
  "footage",
  "glow",
]);

/** Allowed root keys for `template: "captions"` (`src/captions/spec.ts` owns what is inside them). */
export const SPEC_CAPTIONS_ROOT_KEYS = new Set([...SPEC_ENVELOPE_KEYS, ...CAPTIONS_BODY_KEYS]);

export const SPEC_COPY_KEYS = new Set(["eyebrow", "headline", "body"]);
export const SPEC_PALETTE_KEYS = new Set(["ground", "ink", "muted", "accent", "rule"]);

export const SPEC_LOWER_THIRD_COPY_KEYS = new Set(["name", "title"]);
export const SPEC_LOWER_THIRD_PALETTE_KEYS = new Set(["ground", "ink", "muted", "accent", "bar"]);
export const SPEC_LOWER_THIRD_FOOTAGE_KEYS = new Set(["src", "fit"]);

const HEX = /^#[0-9A-Fa-f]{6}$/;

export interface CopyBlock {
  readonly eyebrow: string;
  readonly headline: string;
  readonly body: string;
}

export interface CopyPalette {
  readonly ground: string;
  readonly ink: string;
  readonly muted: string;
  readonly accent: string;
  readonly rule: string;
}

export interface SpecEnvelope {
  readonly spec: 1;
  readonly viewport: readonly [number, number];
  readonly fps: number;
  readonly durationFrames: number;
  readonly supersample: 1 | 2 | 4;
  readonly fonts: SidecarFonts;
}

/** A spec the `copy` generator accepts. */
export interface CopySpec extends SpecEnvelope {
  readonly template: typeof SPEC_TEMPLATE_COPY;
  readonly copy: CopyBlock;
  readonly palette: CopyPalette;
  /** Build-time vertical veil behind the copy column. Absent or omitted is off. */
  readonly glow?: true;
}

export interface LowerThirdCopy {
  readonly name: string;
  readonly title: string;
}

export interface LowerThirdPalette {
  readonly ground: string;
  readonly ink: string;
  readonly muted: string;
  readonly accent: string;
  readonly bar: string;
}

export interface LowerThirdFootage {
  readonly src: string;
  readonly fit?: FootageFit;
}

/** A spec the `lower-third` generator accepts. */
export interface LowerThirdSpec extends SpecEnvelope {
  readonly template: typeof SPEC_TEMPLATE_LOWER_THIRD;
  readonly copy: LowerThirdCopy;
  readonly palette: LowerThirdPalette;
  readonly logo?: string;
  readonly footage?: LowerThirdFootage;
  /** Build-time vertical veil behind the name column. Absent or omitted is off. */
  readonly glow?: true;
}

/**
 * A spec the `captions` generator accepts. `durationFrames` is the spec's
 * own when it wrote one, and otherwise the transcript's length plus the last
 * page's hold — materialised here, so the generator and the sidecar it writes
 * read one number.
 */
export interface CaptionsSpec extends SpecEnvelope, CaptionsBody {
  readonly template: typeof SPEC_TEMPLATE_CAPTIONS;
  /** Burned in: one clip drawn under the captions at the full viewport. */
  readonly footage?: LowerThirdFootage;
}

export type JobSpec = CopySpec | LowerThirdSpec | CaptionsSpec;

export type SpecParseResult =
  | { readonly ok: true; readonly value: JobSpec }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export interface ParseSpecOptions {
  /** Repository root; font paths in the spec are relative to this. */
  readonly root: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function diag(code: string, path: string, message: string): Diagnostic {
  return { code, path, message };
}

function parseHex(value: unknown, path: string, diagnostics: Diagnostic[]): string | undefined {
  if (typeof value !== "string" || !HEX.test(value)) {
    diagnostics.push(
      diag(
        "spec.palette.hex",
        path,
        `palette colour must be \`#RRGGBB\`; got ${JSON.stringify(value)}`,
      ),
    );
    return undefined;
  }
  return value.toLowerCase();
}

function parseCopyString(
  value: unknown,
  key: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(
      diag(
        "spec.copy.missing",
        `/copy/${key}`,
        `\`copy.${key}\` is required and must be a non-empty string`,
      ),
    );
    return undefined;
  }
  return value;
}

function svgAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]!] = m[2] ?? m[3] ?? "";
  return out;
}

/** Logical size `bakeSvg` reads from `<svg width height>`. */
export function svgLogicalSize(svg: string): { w: number; h: number } | null {
  const svgTag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgTag) return null;
  const root = svgAttrs(svgTag);
  const rawW = root.width;
  const rawH = root.height;
  if (rawW === undefined || rawH === undefined) return null;
  const w = Math.round(Number(rawW.replace(/px$/, "")));
  const h = Math.round(Number(rawH.replace(/px$/, "")));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

function pngSize(buf: Uint8Array): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const type = String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!);
  if (type !== "IHDR") return null;
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

/** Intrinsic layout size of a logo file. PNG from IHDR; SVG from the root width/height. */
export function logoLogicalSize(abs: string): { w: number; h: number; kind: "png" | "svg" } | null {
  const ext = extname(abs).toLowerCase();
  try {
    if (ext === ".svg") {
      const size = svgLogicalSize(readFileSync(abs, "utf8"));
      return size ? { ...size, kind: "svg" } : null;
    }
    if (ext === ".png") {
      const size = pngSize(new Uint8Array(readFileSync(abs)));
      return size ? { ...size, kind: "png" } : null;
    }
  } catch {
    return null;
  }
  return null;
}

function logoBakedSize(
  logical: { w: number; h: number },
  kind: "png" | "svg",
  density: number,
): { w: number; h: number } {
  if (kind === "png") return logical;
  return { w: logical.w * density, h: logical.h * density };
}

function parseTemplate(input: Record<string, unknown>, diagnostics: Diagnostic[]): SpecTemplate | undefined {
  if (!("template" in input)) {
    diagnostics.push(
      diag(
        "spec.template.required",
        "/template",
        `\`template\` is required and must be one of ${SPEC_TEMPLATES.map((t) => JSON.stringify(t)).join(", ")}`,
      ),
    );
    return undefined;
  }
  if (!(SPEC_TEMPLATES as readonly string[]).includes(input.template as string)) {
    diagnostics.push(
      diag(
        "spec.template.mismatch",
        "/template",
        `template must be ${SPEC_TEMPLATES.map((t) => JSON.stringify(t)).join(" or ")}; got ${JSON.stringify(input.template)}`,
      ),
    );
    return undefined;
  }
  return input.template as SpecTemplate;
}

function parseEnvelope(
  input: Record<string, unknown>,
  options: ParseSpecOptions,
  diagnostics: Diagnostic[],
  template: SpecTemplate | undefined,
): Omit<SpecEnvelope, "spec"> & { specOk: boolean } {
  let specOk = true;
  if (!("spec" in input)) {
    diagnostics.push(diag("spec.version.required", "/spec", "`spec` is required and must be exactly 1"));
    specOk = false;
  } else if (input.spec !== 1) {
    diagnostics.push(
      diag(
        "spec.version.invalid",
        "/spec",
        `\`spec\` must be exactly 1; got ${JSON.stringify(input.spec)}`,
      ),
    );
    specOk = false;
  }

  let viewport: [number, number] = [1920, 1080];
  if ("viewport" in input) {
    const v = input.viewport;
    if (
      !Array.isArray(v) ||
      v.length !== 2 ||
      !Number.isInteger(v[0]) ||
      !Number.isInteger(v[1]) ||
      (v[0] as number) < 1 ||
      (v[1] as number) < 1
    ) {
      diagnostics.push(
        diag(
          "spec.viewport.invalid",
          "/viewport",
          `\`viewport\` must be [width, height] of positive integers; got ${JSON.stringify(v)}`,
        ),
      );
    } else if (template !== SPEC_TEMPLATE_CAPTIONS && (v[0] !== 1920 || v[1] !== 1080)) {
      const named = template ?? "this template";
      diagnostics.push(
        diag(
          "spec.viewport.unsupported",
          "/viewport",
          `template ${JSON.stringify(named)} is laid out for 1920×1080; got ${v[0]}×${v[1]}`,
        ),
      );
    } else {
      viewport = [v[0] as number, v[1] as number];
    }
  }

  let fps = 30;
  if ("fps" in input) {
    if (!(VALID_FPS as readonly number[]).includes(input.fps as number)) {
      diagnostics.push(
        diag(
          "spec.fps.invalid",
          "/fps",
          `\`fps\` must divide 60 (${VALID_FPS.join(",")}); got ${JSON.stringify(input.fps)}`,
        ),
      );
    } else {
      fps = input.fps as number;
    }
  }

  let durationFrames = 1;
  if ("durationFrames" in input) {
    const n = input.durationFrames;
    if (typeof n !== "number" || !Number.isInteger(n) || n < DURATION_FRAMES_MIN || n > DURATION_FRAMES_MAX) {
      diagnostics.push(
        diag(
          "spec.durationFrames.invalid",
          "/durationFrames",
          `\`durationFrames\` must be an integer ${DURATION_FRAMES_MIN}…${DURATION_FRAMES_MAX}; got ${JSON.stringify(n)}`,
        ),
      );
    } else {
      durationFrames = n;
    }
  }

  let supersample: 1 | 2 | 4 = 1;
  if ("supersample" in input) {
    if (!(SUPERSAMPLE_VALUES as readonly number[]).includes(input.supersample as number)) {
      diagnostics.push(
        diag(
          "spec.supersample.invalid",
          "/supersample",
          `\`supersample\` must be one of 1, 2, 4; got ${JSON.stringify(input.supersample)}`,
        ),
      );
    } else {
      supersample = input.supersample as 1 | 2 | 4;
    }
  }

  let fonts: SidecarFonts | undefined;
  if (!("fonts" in input)) {
    diagnostics.push(
      diag(
        "spec.fonts.required",
        "/fonts",
        "`fonts` is required and must name `regular` and `bold` repo-relative paths",
      ),
    );
  } else if (!isPlainObject(input.fonts)) {
    diagnostics.push(
      diag(
        "spec.fonts.notObject",
        "/fonts",
        `\`fonts\` must be an object with \`regular\` and \`bold\`; got ${describeType(input.fonts)}`,
      ),
    );
  } else {
    const obj = input.fonts;
    for (const key of Object.keys(obj)) {
      if (!SPEC_FONT_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "spec.fonts.unknownKey",
            `/fonts/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...SPEC_FONT_KEYS].join(", ")}`,
          ),
        );
      }
    }
    const parts: Record<string, string> = {};
    for (const key of SPEC_FONT_KEYS) {
      const value = obj[key];
      if (typeof value !== "string") {
        diagnostics.push(
          diag(
            "spec.fonts.missing",
            `/fonts/${key}`,
            `\`fonts.${key}\` is required and must be a relative path`,
          ),
        );
        continue;
      }
      const issue = pathIssue(value, key, `spec.fonts.${key}`);
      if (issue) {
        diagnostics.push(diag(issue.code, `/fonts/${key}`, issue.message));
        continue;
      }
      const abs = resolve(options.root, value);
      if (!existsSync(abs)) {
        diagnostics.push(
          diag(
            "spec.fonts.missingFile",
            `/fonts/${key}`,
            `the ${key} face is not on disk: ${abs}`,
          ),
        );
        continue;
      }
      parts[key] = value;
    }
    if (parts.regular && parts.bold) {
      fonts = { regular: parts.regular, bold: parts.bold };
    }
  }

  return {
    specOk,
    viewport,
    fps,
    durationFrames,
    supersample,
    fonts: fonts ?? { regular: "", bold: "" },
  };
}

function parseCopyBody(
  input: Record<string, unknown>,
  diagnostics: Diagnostic[],
): { copy?: CopyBlock; palette?: CopyPalette } {
  let copy: CopyBlock | undefined;
  if (!("copy" in input)) {
    diagnostics.push(diag("spec.copy.required", "/copy", "`copy` is required"));
  } else if (!isPlainObject(input.copy)) {
    diagnostics.push(
      diag("spec.copy.notObject", "/copy", `\`copy\` must be an object; got ${describeType(input.copy)}`),
    );
  } else {
    const obj = input.copy;
    for (const key of Object.keys(obj)) {
      if (!SPEC_COPY_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "spec.copy.unknownKey",
            `/copy/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...SPEC_COPY_KEYS].join(", ")}`,
          ),
        );
      }
    }
    const eyebrow = parseCopyString(obj.eyebrow, "eyebrow", diagnostics);
    const headline = parseCopyString(obj.headline, "headline", diagnostics);
    const body = parseCopyString(obj.body, "body", diagnostics);
    if (eyebrow !== undefined && headline !== undefined && body !== undefined) {
      copy = { eyebrow, headline, body };
    }
  }

  let palette: CopyPalette | undefined;
  if (!("palette" in input)) {
    diagnostics.push(diag("spec.palette.required", "/palette", "`palette` is required"));
  } else if (!isPlainObject(input.palette)) {
    diagnostics.push(
      diag(
        "spec.palette.notObject",
        "/palette",
        `\`palette\` must be an object; got ${describeType(input.palette)}`,
      ),
    );
  } else {
    const obj = input.palette;
    for (const key of Object.keys(obj)) {
      if (!SPEC_PALETTE_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "spec.palette.unknownKey",
            `/palette/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...SPEC_PALETTE_KEYS].join(", ")}`,
          ),
        );
      }
    }
    const ground = parseHex(obj.ground, "/palette/ground", diagnostics);
    const ink = parseHex(obj.ink, "/palette/ink", diagnostics);
    const muted = parseHex(obj.muted, "/palette/muted", diagnostics);
    const accent = parseHex(obj.accent, "/palette/accent", diagnostics);
    const rule = parseHex(obj.rule, "/palette/rule", diagnostics);
    if (ground && ink && muted && accent && rule) {
      palette = { ground, ink, muted, accent, rule };
    }
  }
  return { copy, palette };
}

function parseLogo(
  input: Record<string, unknown>,
  options: ParseSpecOptions,
  diagnostics: Diagnostic[],
  density: number,
): string | undefined {
  if (!("logo" in input)) return undefined;
  const value = input.logo;
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(
      diag("spec.logo.invalid", "/logo", `\`logo\` must be a repo-relative path; got ${JSON.stringify(value)}`),
    );
    return undefined;
  }
  const issue = pathIssue(value, "logo", "spec.logo");
  if (issue) {
    diagnostics.push(diag(issue.code, "/logo", issue.message));
    return undefined;
  }
  const abs = resolve(options.root, value);
  if (!existsSync(abs)) {
    diagnostics.push(diag("spec.logo.missingFile", "/logo", `the logo is not on disk: ${abs}`));
    return undefined;
  }
  try {
    if (!statSync(abs).isFile()) {
      diagnostics.push(diag("spec.logo.missingFile", "/logo", `the logo is not on disk: ${abs}`));
      return undefined;
    }
  } catch {
    diagnostics.push(diag("spec.logo.missingFile", "/logo", `the logo is not on disk: ${abs}`));
    return undefined;
  }
  const ext = extname(value).toLowerCase();
  if (ext !== ".svg" && ext !== ".png") {
    diagnostics.push(
      diag("spec.logo.type", "/logo", `\`logo\` must be a .png or .svg; got ${JSON.stringify(value)}`),
    );
    return undefined;
  }
  const logical = logoLogicalSize(abs);
  if (!logical) {
    diagnostics.push(
      diag(
        "spec.logo.dims",
        "/logo",
        `logo ${ext.slice(1)} dimensions must be readable (png IHDR or svg width/height); got ${JSON.stringify(value)}`,
      ),
    );
    return undefined;
  }
  const baked = logoBakedSize(logical, logical.kind, density);
  // Any size from 1 to IMG_MAX_DIM as baked (patches/0020): the rasteriser
  // samples an image by its own width and height.
  if (logical.w < 1 || logical.h < 1 || baked.w > IMG_MAX_DIM || baked.h > IMG_MAX_DIM) {
    const bakedNote =
      logical.kind === "svg" && density > 1
        ? ` (bakes at ${baked.w}×${baked.h} with supersample ${density})`
        : "";
    diagnostics.push(
      diag(
        "spec.logo.dims",
        "/logo",
        `logo dimensions must be 1..${IMG_MAX_DIM} px per side as baked; got ${logical.w}×${logical.h}${bakedNote}`,
      ),
    );
    return undefined;
  }
  return value;
}

function parseLowerThirdFootage(
  input: Record<string, unknown>,
  options: ParseSpecOptions,
  diagnostics: Diagnostic[],
): LowerThirdFootage | undefined {
  if (!("footage" in input)) return undefined;
  const raw = input.footage;
  if (!isPlainObject(raw)) {
    diagnostics.push(
      diag(
        "spec.footage.notObject",
        "/footage",
        `\`footage\` must be an object; got ${describeType(raw)}`,
      ),
    );
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!SPEC_LOWER_THIRD_FOOTAGE_KEYS.has(key)) {
      diagnostics.push(
        diag(
          "spec.footage.unknownKey",
          `/footage/${key}`,
          `unknown key ${JSON.stringify(key)}; allowed keys are ${[...SPEC_LOWER_THIRD_FOOTAGE_KEYS].join(", ")}`,
        ),
      );
    }
  }
  if (typeof raw.src !== "string") {
    diagnostics.push(
      diag("spec.footage.src.missing", "/footage/src", "`footage.src` is required and must be a relative path"),
    );
    return undefined;
  }
  const issue = pathIssue(raw.src, "src", "spec.footage.src");
  if (issue) {
    diagnostics.push(diag(issue.code, "/footage/src", issue.message));
    return undefined;
  }
  const abs = resolve(options.root, raw.src);
  if (!existsSync(abs)) {
    diagnostics.push(
      diag("spec.footage.missingFile", "/footage/src", `the footage source is not on disk: ${abs}`),
    );
    return undefined;
  }
  let fit: FootageFit | undefined;
  if ("fit" in raw) {
    if (!(FOOTAGE_FIT_VALUES as readonly string[]).includes(raw.fit as string)) {
      diagnostics.push(
        diag(
          "spec.footage.fit.invalid",
          "/footage/fit",
          `\`fit\` must be one of cover, contain, stretch; got ${JSON.stringify(raw.fit)}`,
        ),
      );
      return undefined;
    }
    fit = raw.fit as FootageFit;
  }
  return fit === undefined ? { src: raw.src } : { src: raw.src, fit };
}

function parseLowerThirdBody(
  input: Record<string, unknown>,
  options: ParseSpecOptions,
  diagnostics: Diagnostic[],
  density: number,
): { copy?: LowerThirdCopy; palette?: LowerThirdPalette; logo?: string; footage?: LowerThirdFootage } {
  let copy: LowerThirdCopy | undefined;
  if (!("copy" in input)) {
    diagnostics.push(diag("spec.copy.required", "/copy", "`copy` is required"));
  } else if (!isPlainObject(input.copy)) {
    diagnostics.push(
      diag("spec.copy.notObject", "/copy", `\`copy\` must be an object; got ${describeType(input.copy)}`),
    );
  } else {
    const obj = input.copy;
    for (const key of Object.keys(obj)) {
      if (!SPEC_LOWER_THIRD_COPY_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "spec.copy.unknownKey",
            `/copy/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...SPEC_LOWER_THIRD_COPY_KEYS].join(", ")}`,
          ),
        );
      }
    }
    const name = parseCopyString(obj.name, "name", diagnostics);
    const title = parseCopyString(obj.title, "title", diagnostics);
    if (name !== undefined && title !== undefined) copy = { name, title };
  }

  let palette: LowerThirdPalette | undefined;
  if (!("palette" in input)) {
    diagnostics.push(diag("spec.palette.required", "/palette", "`palette` is required"));
  } else if (!isPlainObject(input.palette)) {
    diagnostics.push(
      diag(
        "spec.palette.notObject",
        "/palette",
        `\`palette\` must be an object; got ${describeType(input.palette)}`,
      ),
    );
  } else {
    const obj = input.palette;
    for (const key of Object.keys(obj)) {
      if (!SPEC_LOWER_THIRD_PALETTE_KEYS.has(key)) {
        diagnostics.push(
          diag(
            "spec.palette.unknownKey",
            `/palette/${key}`,
            `unknown key ${JSON.stringify(key)}; allowed keys are ${[...SPEC_LOWER_THIRD_PALETTE_KEYS].join(", ")}`,
          ),
        );
      }
    }
    const ground = parseHex(obj.ground, "/palette/ground", diagnostics);
    const ink = parseHex(obj.ink, "/palette/ink", diagnostics);
    const muted = parseHex(obj.muted, "/palette/muted", diagnostics);
    const accent = parseHex(obj.accent, "/palette/accent", diagnostics);
    const bar = parseHex(obj.bar, "/palette/bar", diagnostics);
    if (ground && ink && muted && accent && bar) {
      palette = { ground, ink, muted, accent, bar };
    }
  }

  const logo = parseLogo(input, options, diagnostics, density);
  const footage = parseLowerThirdFootage(input, options, diagnostics);
  return { copy, palette, ...(logo !== undefined ? { logo } : {}), ...(footage !== undefined ? { footage } : {}) };
}

function parseGlow(input: Record<string, unknown>, diagnostics: Diagnostic[]): true | undefined {
  if (!("glow" in input)) return undefined;
  if (input.glow === true) return true;
  if (input.glow === false) return undefined;
  diagnostics.push(
    diag("spec.glow.invalid", "/glow", `\`glow\` must be true or false; got ${JSON.stringify(input.glow)}`),
  );
  return undefined;
}

/**
 * Parse a job spec. Refuses unknown keys and a `template` this file does not
 * implement. Font files (and optional logo / footage sources) are checked on
 * disk against `options.root`.
 */
export function parseSpec(input: unknown, options: ParseSpecOptions): SpecParseResult {
  const diagnostics: Diagnostic[] = [];

  if (!isPlainObject(input)) {
    return {
      ok: false,
      diagnostics: [
        diag("spec.notObject", "", `spec must be a JSON object; got ${describeType(input)}`),
      ],
    };
  }

  const template = parseTemplate(input, diagnostics);
  // Until template is known, do not enumerate a set that would call `copy`
  // and `palette` illegal — they are required on every template this file
  // implements. Use the union so a typo still reports extra keys.
  const allowed =
    template === SPEC_TEMPLATE_LOWER_THIRD
      ? SPEC_LOWER_THIRD_ROOT_KEYS
      : template === SPEC_TEMPLATE_COPY
        ? SPEC_ROOT_KEYS
        : template === SPEC_TEMPLATE_CAPTIONS
          ? SPEC_CAPTIONS_ROOT_KEYS
          : new Set([...SPEC_ROOT_KEYS, ...SPEC_LOWER_THIRD_ROOT_KEYS, ...SPEC_CAPTIONS_ROOT_KEYS]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      diagnostics.push(
        diag(
          "spec.unknownKey",
          `/${key}`,
          `unknown key ${JSON.stringify(key)}; allowed keys are ${[...allowed].join(", ")}`,
        ),
      );
    }
  }

  const env = parseEnvelope(input, options, diagnostics, template);
  const fontsOk = env.fonts.regular !== "" && env.fonts.bold !== "";
  const glow = parseGlow(input, diagnostics);

  if (template === SPEC_TEMPLATE_COPY) {
    const body = parseCopyBody(input, diagnostics);
    if (diagnostics.length > 0) return { ok: false, diagnostics };
    if (!env.specOk || !fontsOk || !body.copy || !body.palette) {
      return {
        ok: false,
        diagnostics: [diag("spec.incomplete", "", "spec failed to materialise after validation")],
      };
    }
    return {
      ok: true,
      value: {
        spec: 1,
        template: SPEC_TEMPLATE_COPY,
        viewport: env.viewport,
        fps: env.fps,
        durationFrames: env.durationFrames,
        supersample: env.supersample,
        fonts: env.fonts,
        copy: body.copy,
        palette: body.palette,
        ...(glow ? { glow: true as const } : {}),
      },
    };
  }

  if (template === SPEC_TEMPLATE_LOWER_THIRD) {
    const body = parseLowerThirdBody(input, options, diagnostics, env.supersample);
    if (diagnostics.length > 0) return { ok: false, diagnostics };
    if (!env.specOk || !fontsOk || !body.copy || !body.palette) {
      return {
        ok: false,
        diagnostics: [diag("spec.incomplete", "", "spec failed to materialise after validation")],
      };
    }
    return {
      ok: true,
      value: {
        spec: 1,
        template: SPEC_TEMPLATE_LOWER_THIRD,
        viewport: env.viewport,
        fps: env.fps,
        durationFrames: env.durationFrames,
        supersample: env.supersample,
        fonts: env.fonts,
        copy: body.copy,
        palette: body.palette,
        ...(body.logo !== undefined ? { logo: body.logo } : {}),
        ...(body.footage !== undefined ? { footage: body.footage } : {}),
        ...(glow ? { glow: true as const } : {}),
      },
    };
  }

  if (template === SPEC_TEMPLATE_CAPTIONS) {
    const footage = parseLowerThirdFootage(input, options, diagnostics);
    const body = parseCaptionsBody(
      input,
      options.root,
      {
        viewport: env.viewport,
        fps: env.fps,
        durationFrames: env.durationFrames,
        durationDeclared: "durationFrames" in input,
      },
      diagnostics,
    );
    if (diagnostics.length > 0) return { ok: false, diagnostics };
    if (!env.specOk || !fontsOk || !body) {
      return {
        ok: false,
        diagnostics: [diag("spec.incomplete", "", "spec failed to materialise after validation")],
      };
    }
    return {
      ok: true,
      value: {
        spec: 1,
        template: SPEC_TEMPLATE_CAPTIONS,
        viewport: env.viewport,
        fps: env.fps,
        supersample: env.supersample,
        fonts: env.fonts,
        ...body,
        ...(footage !== undefined ? { footage } : {}),
      },
    };
  }

  return { ok: false, diagnostics };
}
