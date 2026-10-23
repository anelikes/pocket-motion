/**
 * The shaping PROTOTYPE (`src/text/shape.ts`, docs/text-shaping.design.md).
 *
 * Two layers, and only the first always runs.
 *
 * The import refusal needs no third-party bytes: a hand-assembled module that
 * imports one host function the shaper loader has not read is refused before
 * it is instantiated. That refusal is what the claim "the shaper can only
 * depend on its inputs" stands on, so it is the part held on every run. Red
 * case: with the `extra.length > 0` check in `openShaper` removed, the module
 * instantiates far enough to fail on a missing export instead, and the message
 * this test asserts is gone.
 *
 * The determinism half needs HarfBuzz's wasm build and a face, neither of
 * which this repository carries yet — where they would be declared is part of
 * the design. Set SHAPER_WASM to harfbuzzjs 0.10.3's `hb.wasm` and
 * SHAPER_ARABIC / SHAPER_DEVANAGARI to its test faces
 * `test/fonts/noto/NotoSansArabic-Variable.ttf` and
 * `test/fonts/noto/NotoSansDevanagari-Regular.otf`; the sha256 of each is
 * pinned below and checked before anything is compared. Without them the
 * tests say so and skip. Red case: SHAPER_ARABIC set to Noto Naskh Arabic
 * (another face for the same script) fails on the face pin, and with that pin
 * commented out it fails on the corpus digest.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { CORPUS } from "../scripts/shape-probe.ts";
import { canonicalBytes, openShaper } from "../src/text/shape.ts";

/** (module) imports env.now: () -> f64, and exports nothing. */
const CLOCK_IMPORTER = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7c,
  0x02, 0x0b, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x03, 0x6e, 0x6f, 0x77, 0x00, 0x00,
]);

test("a shaper module importing a host function this loader has not read is refused", async () => {
  await expect(openShaper(CLOCK_IMPORTER)).rejects.toThrow(
    "shape: the shaper imports env.now, which this host has not read",
  );
});

const PINS = {
  wasm: "ea319787a8efdf90599ade77e33d1f245d61da390380f6c8299ab3195ff00d6d",
  arabic: "ee489b994b3e62def9874c918145e32b133b625abaf98cec60502bdb40102c56",
  devanagari: "4775b7eeee96cb61c42f66d9136d535a0aa728c2009ad0f4cd2bc970149d9ac7",
};
/** Recorded on darwin-arm64 and reproduced on linux-x64 (Docker, emulated),
 *  Bun 1.3.11, with the inputs pinned above. */
const CORPUS_DIGEST = "21b0666815e9b5ed6755b857d5dbab3c87b280f889f44377f13282c81d836866";

const paths = {
  wasm: process.env.SHAPER_WASM,
  arabic: process.env.SHAPER_ARABIC,
  devanagari: process.env.SHAPER_DEVANAGARI,
};
const present = Object.values(paths).every((p) => p !== undefined && existsSync(p));
if (!present) {
  console.log("shape.test: SHAPER_WASM / SHAPER_ARABIC / SHAPER_DEVANAGARI not set — determinism half skipped");
}

const read = async (p: string) => new Uint8Array(await Bun.file(p).arrayBuffer());
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe.skipIf(!present)("shaping is a function of its declared bytes", () => {
  test("the inputs are the pinned ones", async () => {
    expect(sha(await read(paths.wasm!))).toBe(PINS.wasm);
    expect(sha(await read(paths.arabic!))).toBe(PINS.arabic);
    expect(sha(await read(paths.devanagari!))).toBe(PINS.devanagari);
  });

  const corpusBytes = async (): Promise<Uint8Array[]> => {
    const shaper = await openShaper(await read(paths.wasm!));
    const faces = {
      arabic: shaper.face(await read(paths.arabic!)),
      devanagari: shaper.face(await read(paths.devanagari!)),
    };
    return CORPUS.map((req) => canonicalBytes(faces[req.face].shape(req)));
  };

  test("two fresh instances produce byte-identical runs", async () => {
    const [a, b] = [await corpusBytes(), await corpusBytes()];
    expect(a.length).toBe(CORPUS.length);
    a.forEach((run, i) => expect(Buffer.from(run).equals(Buffer.from(b[i]!))).toBe(true));
  });

  test("the corpus digest is the one recorded on two platforms", async () => {
    const h = createHash("sha256");
    for (const run of await corpusBytes()) h.update(run);
    expect(h.digest("hex")).toBe(CORPUS_DIGEST);
  });
});
