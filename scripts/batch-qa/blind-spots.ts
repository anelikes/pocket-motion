#!/usr/bin/env bun
/**
 * Two cards the batch's gates pass and a reader would reject, built so the
 * report's "what it cannot catch" section is something that can be re-run
 * rather than a sentence.
 *
 *   tofu       codepoints the face does not carry (Arabic, Hangul, Thai,
 *              Devanagari, U+20B9, U+200B, an emoji) staged WITHOUT the
 *              measurer. The build bakes the tofu cell and exits 0. The batch
 *              never gets here — `fit` refuses those rows — so this is what a
 *              template that does not measure every field would ship.
 *   offcanvas  the disclaimer anchored to the canvas instead of its strip,
 *              six lines from y = 900. The sixth line is below the frame.
 *              Layout clamps the box to the canvas before anything reads it,
 *              so no code can say that a line is missing.
 *
 *   bun scripts/batch-qa/blind-spots.ts [--out dist/batch-qa/blind]
 *
 * Prints each case's verdict under the batch's own rule (`judge`) and writes
 * frame 89 of each as a PNG.
 */

import { mkdirSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { runBuild } from "../../src/cli/build.ts";
import { resolveComposition } from "../../src/cli/resolve.ts";
import type { GlobalFlags } from "../../src/cli/types.ts";
import * as snapshotCmd from "../../src/cli/commands/snapshot.ts";
import * as verifyCmd from "../../src/cli/commands/verify.ts";
import { LAST_FRAME, stagedFiles, type Fitted, type FittedField } from "./template.ts";
import { judge } from "./variant.ts";

const ROOT = resolve(import.meta.dir, "../..");
const field = (text: string, px: number): FittedField => ({
  text,
  px,
  lines: text.split("\n").length,
  overflows: false,
  brokenWords: 0,
});

const LEGAL = [
  "Offer valid while supplies last. Prices exclude applicable taxes and delivery. See store for details.",
  "Battery life measured under laboratory conditions; actual results vary with use and settings.",
  "Not combinable with other offers or promotional codes. Limit 2 per customer.",
  "Financing subject to credit approval by a third-party lender. Warranty terms apply.",
  "Returns accepted within 30 days in original packaging; a restocking fee may apply.",
  "Ratings collected from verified purchasers between January and June.",
].join("\n");

const CASES: Record<string, { fitted: Fitted; edit?: (app: string) => string }> = {
  tofu: {
    fitted: {
      // Every field fits its box, so nothing but the glyphs is wrong.
      name: field("Orbit 무선 헤드폰 Pro", 88),
      claim: field("Save 20% سماعات हेडफ़ोन หูฟัง", 40),
      price: field("₹4,999.00", 80),
      disclaimer: field("Offer valid​while supplies last. 🎧", 24),
      predicted: [],
    },
  },
  offcanvas: {
    fitted: {
      name: field("Kestrel Compact Kettle", 88),
      claim: field("Two-year warranty included", 40),
      price: field("$129.00", 80),
      disclaimer: field(LEGAL, 24),
      predicted: [],
    },
    edit: (app) => {
      const out = app.replace(
        /<View debugName="legal"[^>]*>\n\s*(<Text debugName="disclaimer" class=")([^"]*)("[^\n]*)\n\s*<\/View>/,
        (_m, open: string, cls: string, rest: string) =>
          `${open}animate-legal absolute left-[120px] top-[900px] ${cls}${rest}`,
      );
      if (out === app) throw new Error("blind-spots: the legal strip was not where the edit expected it");
      return out;
    },
  },
};

const argv = process.argv.slice(2);
const oi = argv.indexOf("--out");
const out = resolve(oi >= 0 ? argv[oi + 1]! : join(ROOT, "dist", "batch-qa", "blind"));
mkdirSync(out, { recursive: true });

for (const [name, c] of Object.entries(CASES)) {
  const files = stagedFiles(c.fitted);
  if (c.edit) files["app.tsx"] = c.edit(files["app.tsx"]!);
  const dir = join(ROOT, "dist", `bqa-blind-${name}`);
  await rm(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [n, t] of Object.entries(files)) await writeFile(join(dir, n), t);
  const flags: GlobalFlags = { json: true, bundle: join(dir, "dist", "main.js"), pak: join(dir, "dist", "main.pak") };
  const unbuilt = await resolveComposition({ dir, flags, requireBundle: false });
  if (!unbuilt.ok) throw new Error(unbuilt.message);
  await runBuild(unbuilt.value);
  const envelope = (await verifyCmd.run({ dir, strict: false, flags })).json as Record<string, unknown>;
  const v = judge(envelope);
  await snapshotCmd.run({ dir, out: join(out, name), at: [LAST_FRAME], annotate: false, flags });
  console.log(
    `${name.padEnd(10)} build ok; batch verdict ${v.verdict}` +
      (v.codes.length > 0 ? ` — ${v.codes.join(" ")}` : " — no gated code, every assertion holds") +
      `; frame ${join(out, name, snapshotCmd.snapshotName(LAST_FRAME))}`,
  );
  await rm(dir, { recursive: true, force: true });
}
