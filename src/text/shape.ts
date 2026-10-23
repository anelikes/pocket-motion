/**
 * PROTOTYPE — complex-script shaping as a pure function of declared bytes.
 *
 * Not wired into any command. It exists to measure the one property the
 * build-time shaping plan in `docs/text-shaping.design.md` rests on: that a
 * shaper can turn (shaper bytes, font bytes, text, direction, script,
 * language, features) into positioned glyph records that are the same bytes
 * on every machine, so the records can be baked into a pak like an atlas is.
 *
 * The shaper is HarfBuzz compiled to wasm by harfbuzzjs (`hb.wasm`). Its
 * emscripten JS glue is NOT used: this module instantiates the module itself,
 * and the five host functions the module imports are the whole of what the
 * shaper can ask the host for. Four of them throw and one grows linear
 * memory, so no reading of a clock, a locale, a file or an environment
 * variable can reach the output — what is not imported cannot be read.
 * `HB_IMPORTS` is that list and `openShaper` refuses a module importing
 * anything else.
 *
 * Positions come back in FONT UNITS (`hb_font_set_scale(upem, upem)`), so
 * they are integers before any pixel size is applied. Scaling to a slot's px
 * and rounding to the pixel grid is the baker's and the core's business, not
 * the shaper's — and is the place a cross-platform difference could enter,
 * which is why the canonical bytes below are taken before it.
 */

import { createHash } from "node:crypto";

/** The host functions hb.wasm (harfbuzzjs 0.10.x) imports, each with what
 *  this host does when it is called. Nothing here returns host state. */
const HB_IMPORTS: Record<string, Record<string, "throw" | "grow" | "noop">> = {
  wasi_snapshot_preview1: { proc_exit: "throw" },
  env: {
    _emscripten_runtime_keepalive_clear: "noop",
    _abort_js: "throw",
    // A timer is host state; hb_shape never sets one, so a call is a fault.
    _setitimer_js: "throw",
    emscripten_resize_heap: "grow",
  },
};

export type Direction = "ltr" | "rtl" | "ttb" | "btt";

/** HB_DIRECTION_* (hb-common.h): LTR 4, RTL 5, TTB 6, BTT 7. */
const DIRECTION: Record<Direction, number> = { ltr: 4, rtl: 5, ttb: 6, btt: 7 };

export interface ShapeRequest {
  readonly text: string;
  readonly direction: Direction;
  /** ISO 15924 tag, e.g. "Arab", "Hebr", "Thai", "Deva". Never guessed:
   *  guessing reads HarfBuzz's own Unicode tables, which is deterministic,
   *  but a run's script is a property of the composition, so it is stated. */
  readonly script: string;
  /** BCP-47 tag. Never left to `hb_language_get_default`, which reads
   *  setlocale() in a native build. */
  readonly language: string;
  /** HarfBuzz feature strings ("liga=0", "+kern", "vert"). Default none. */
  readonly features?: readonly string[];
  /** `[tag, value]` design-space coordinates for a variable face. Default
   *  none, which is the face's default instance. */
  readonly variations?: readonly (readonly [string, number])[];
}

/** One output glyph. Every number is an integer in font units except
 *  `cluster`, which is a UTF-16 code-unit offset into `text`. */
export interface ShapedGlyph {
  /** Glyph id in the FONT (not an atlas id; not a codepoint). */
  readonly gid: number;
  readonly cluster: number;
  readonly xAdvance: number;
  readonly yAdvance: number;
  readonly xOffset: number;
  readonly yOffset: number;
}

export interface ShapedRun {
  readonly upem: number;
  /** Glyphs in VISUAL order: for an RTL run HarfBuzz returns them reversed,
   *  first glyph leftmost. */
  readonly glyphs: readonly ShapedGlyph[];
}

export interface Shaper {
  /** `hb_version_string()` of the module — what produced the records. */
  readonly version: string;
  /** sha256 of the module bytes, the identity a build record would carry. */
  readonly sha256: string;
  /** Load a face. `index` selects a member of a collection. */
  face(bytes: Uint8Array, index?: number): ShaperFace;
}

export interface ShaperFace {
  readonly upem: number;
  shape(req: ShapeRequest): ShapedRun;
}

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/**
 * Instantiate the shaper. Refuses a module whose imports are not exactly
 * `HB_IMPORTS`: a module that can call a host function this file has not
 * read is a module whose output this file cannot vouch for.
 */
export async function openShaper(wasm: Uint8Array): Promise<Shaper> {
  const mod = new WebAssembly.Module(wasm);
  const wanted = Object.entries(HB_IMPORTS).flatMap(([m, fns]) => Object.keys(fns).map((n) => `${m}.${n}`));
  const got = WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}`);
  const extra = got.filter((g) => !wanted.includes(g));
  if (extra.length > 0) {
    throw new Error(`shape: the shaper imports ${extra.join(", ")}, which this host has not read`);
  }

  // Filled once the instance exists; the memory is the module's own export.
  let memory: WebAssembly.Memory | undefined;
  const imports: Record<string, Record<string, (...a: number[]) => number | void>> = {};
  for (const [m, fns] of Object.entries(HB_IMPORTS)) {
    const table: Record<string, (...a: number[]) => number | void> = {};
    for (const [name, what] of Object.entries(fns)) {
      table[name] =
        what === "throw"
          ? () => {
              throw new Error(`shape: the shaper called ${m}.${name}`);
            }
          : what === "noop"
            ? () => {}
            : (requested: number) => {
                const mem = memory!;
                const need = Math.ceil((requested - mem.buffer.byteLength) / 65536);
                if (need <= 0) return 1;
                try {
                  mem.grow(need);
                  return 1;
                } catch {
                  return 0;
                }
              };
    }
    imports[m] = table;
  }
  const instance = new WebAssembly.Instance(mod, imports);
  const x = instance.exports as Record<string, any>;
  memory = x.memory as WebAssembly.Memory;
  x.__wasm_call_ctors();

  const u8 = () => new Uint8Array(memory!.buffer);
  const cstr = (s: string): number => {
    const bytes = new TextEncoder().encode(s);
    const p = x.malloc(bytes.length + 1) as number;
    u8().set(bytes, p);
    u8()[p + bytes.length] = 0;
    return p;
  };
  const readCstr = (p: number): string => {
    const m = u8();
    let end = p;
    while (m[end] !== 0) end++;
    return new TextDecoder().decode(m.subarray(p, end));
  };

  const version = readCstr(x.hb_version_string());

  return {
    version,
    sha256: sha256(wasm),
    face(bytes: Uint8Array, index = 0): ShaperFace {
      const data = x.malloc(bytes.length) as number;
      u8().set(bytes, data);
      // HB_MEMORY_MODE_READONLY = 1; no destroy callback, the bytes stay
      // resident for the life of this shaper.
      const blob = x.hb_blob_create(data, bytes.length, 1, 0, 0);
      const face = x.hb_face_create(blob, index);
      const upem = x.hb_face_get_upem(face) as number;
      return {
        upem,
        shape(req: ShapeRequest): ShapedRun {
          // A font per request: hb_font_set_variations is state on the font,
          // and a run must not inherit the coordinates the previous one set.
          const font = x.hb_font_create(face);
          x.hb_font_set_scale(font, upem, upem);
          if (req.variations && req.variations.length > 0) {
            // hb_variation_t is { tag u32, value f32 }.
            const v = x.malloc(req.variations.length * 8) as number;
            const dv = new DataView(memory!.buffer);
            req.variations.forEach(([tag, value], i) => {
              dv.setUint32(v + i * 8, tagOf(tag), true);
              dv.setFloat32(v + i * 8 + 4, value, true);
            });
            x.hb_font_set_variations(font, v, req.variations.length);
            x.free(v);
          }
          const buf = x.hb_buffer_create();
          const units = new Uint16Array(req.text.length);
          for (let i = 0; i < req.text.length; i++) units[i] = req.text.charCodeAt(i);
          const tp = x.malloc(units.length * 2 || 2) as number;
          new Uint16Array(memory!.buffer, tp, units.length).set(units);
          x.hb_buffer_add_utf16(buf, tp, units.length, 0, units.length);
          x.free(tp);
          x.hb_buffer_set_direction(buf, DIRECTION[req.direction]);
          const sp = cstr(req.script);
          x.hb_buffer_set_script(buf, x.hb_script_from_string(sp, -1));
          x.free(sp);
          const lp = cstr(req.language);
          x.hb_buffer_set_language(buf, x.hb_language_from_string(lp, -1));
          x.free(lp);

          const feats = req.features ?? [];
          // hb_feature_t is { tag, value, start, end }, 16 bytes.
          const fp = feats.length > 0 ? (x.malloc(feats.length * 16) as number) : 0;
          feats.forEach((f, i) => {
            const s = cstr(f);
            const ok = x.hb_feature_from_string(s, -1, fp + i * 16);
            x.free(s);
            if (!ok) throw new Error(`shape: ${JSON.stringify(f)} is not a HarfBuzz feature string`);
          });
          x.hb_shape(font, buf, fp, feats.length);
          if (fp) x.free(fp);

          const n = x.hb_buffer_get_length(buf) as number;
          const infos = (x.hb_buffer_get_glyph_infos(buf, 0) as number) / 4;
          const poss = (x.hb_buffer_get_glyph_positions(buf, 0) as number) / 4;
          const U = new Uint32Array(memory!.buffer);
          const I = new Int32Array(memory!.buffer);
          const glyphs: ShapedGlyph[] = [];
          // hb_glyph_info_t and hb_glyph_position_t are both 5 words.
          for (let i = 0; i < n; i++) {
            glyphs.push({
              gid: U[infos + i * 5]!,
              cluster: U[infos + i * 5 + 2]!,
              xAdvance: I[poss + i * 5]!,
              yAdvance: I[poss + i * 5 + 1]!,
              xOffset: I[poss + i * 5 + 2]!,
              yOffset: I[poss + i * 5 + 3]!,
            });
          }
          x.hb_buffer_destroy(buf);
          x.hb_font_destroy(font);
          return { upem, glyphs };
        },
      };
    },
  };
}

function tagOf(s: string): number {
  if (s.length !== 4) throw new Error(`shape: ${JSON.stringify(s)} is not a four-character tag`);
  return ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
}

/**
 * The canonical bytes of a run: six little-endian i32 per glyph — gid,
 * cluster, x advance, y advance, x offset, y offset — after a u32 upem. Two
 * runs are the same shaping exactly when these bytes are equal, which is the
 * comparison every determinism claim about the shaper is made in.
 */
export function canonicalBytes(run: ShapedRun): Uint8Array {
  const out = new Uint8Array(4 + run.glyphs.length * 24);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, run.upem, true);
  run.glyphs.forEach((g, i) => {
    const o = 4 + i * 24;
    dv.setUint32(o, g.gid, true);
    dv.setUint32(o + 4, g.cluster, true);
    dv.setInt32(o + 8, g.xAdvance, true);
    dv.setInt32(o + 12, g.yAdvance, true);
    dv.setInt32(o + 16, g.xOffset, true);
    dv.setInt32(o + 20, g.yOffset, true);
  });
  return out;
}

export const runDigest = (run: ShapedRun): string => sha256(canonicalBytes(run));
