/**
 * The batch-QA prototype's pure parts: the data its report was measured on,
 * and the rule that turns `verify`'s envelope into a verdict.
 *
 * `docs/batch-qa-prototype.md` quotes counts measured over one data set,
 * named there by the sha256 of the JSONL `scripts/batch-qa/rows.ts` writes
 * for its default seed. The generator is committed and the rows are not, so
 * the digest below is the only thing that ties the numbers in the report to
 * the rows they were measured on: an edit to the generator moves it, and the
 * report then describes data nobody can rebuild.
 *
 * `judge` is the one place the prototype decides which findings fail a
 * variant. The case that matters most is `text_not_painted` passing: every
 * field of the card fades in, so every node carries that code at frame 0 and
 * gating on it would fail all 1,000 variants.
 */

import { describe, expect, test } from "bun:test";

import { CATEGORIES, generateRows } from "../scripts/batch-qa/rows.ts";
import { appSource, brokenWords, clean, sidecarSource, type Fitted } from "../scripts/batch-qa/template.ts";
import { GATED, judge } from "../scripts/batch-qa/variant.ts";

/** sha256 of `bun scripts/batch-qa/rows.ts --out <file>` with the defaults. */
const ROWS_SHA256 = "71b6fdc3e8cd39aa41cb25eae142c7bf600165a3dc9eab9811f3335a9048e95c";

describe("batch-qa rows", () => {
  const rows = generateRows();

  test("the default seed rebuilds the data set the report was measured on", () => {
    const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    expect(new Bun.CryptoHasher("sha256").update(text).digest("hex")).toBe(ROWS_SHA256);
  });

  test("every category is present and ids are unique", () => {
    expect(new Set(rows.map((r) => r.category))).toEqual(new Set(CATEGORIES));
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  test("a copy follows its source and carries its content", () => {
    const index = new Map(rows.map((r, i) => [r.id, i]));
    for (const [i, r] of rows.entries()) {
      if (r.copyOf === undefined) continue;
      const src = rows[index.get(r.copyOf)!]!;
      expect(index.get(r.copyOf)!).toBeLessThan(i);
      const fields = (x: typeof r) => [x.name, x.price, x.claim, x.disclaimer];
      if (r.category === "duplicate") expect(fields(r)).toEqual(fields(src));
      else expect(fields(r).map(clean)).toEqual(fields(src).map(clean));
    }
  });
});

const ok = { ok: true };
const envelope = (layoutFindings: unknown[], extra: Record<string, unknown> = {}) => ({
  ok: true,
  lint: ok,
  realm: ok,
  keyframes: ok,
  visibility: { ok: true, failures: [] },
  assertions: { ok: true, assertions: [] },
  layout: [{ ok: true, frame: 0, findings: layoutFindings }],
  ...extra,
});

describe("batch-qa judge", () => {
  test("text_not_painted is reported and does not fail a variant", () => {
    const v = judge(envelope([{ code: "text_not_painted", name: "disclaimer", detail: "faded in later" }]));
    expect(v.verdict).toBe("pass");
    expect(v.ungated).toEqual({ text_not_painted: 1 });
    expect(GATED.has("text_not_painted")).toBe(false);
  });

  test("a gated code fails it, named by node", () => {
    const v = judge(envelope([{ code: "escaped_container", name: "price-row", detail: "41px past the bottom" }]));
    expect(v.verdict).toBe("fail");
    expect(v.codes).toEqual(["escaped_container:price-row"]);
  });

  test("an excused finding does not count", () => {
    const v = judge(
      envelope([{ code: "content_overlap", name: "badge", detail: "x", allowedBy: "intended" }]),
    );
    expect(v.verdict).toBe("pass");
  });

  test("a failing assertion and a failing section each fail it", () => {
    const a = judge(
      envelope([], {
        assertions: {
          ok: false,
          assertions: [{ node: "disclaimer", predicate: "dwellFrames", ok: false, detail: "0 frames" }],
        },
      }),
    );
    expect(a.codes).toEqual(["assert:disclaimer.dwellFrames"]);
    const s = judge(envelope([], { realm: { ok: false, error: "guest op" } }));
    expect(s.verdict).toBe("fail");
    expect(s.sectionErrors).toEqual(["realm"]);
  });
});

describe("batch-qa template", () => {
  test("a break between two letters is a broken word; a break at a space or between ideographs is not", () => {
    expect(brokenWords("Acme Kühlschrankzubehör", "Acme Kühlschra\nnkzubehör")).toBe(1);
    expect(brokenWords("Acme Kühlschrankzubehör", "Acme\nKühlschrankzubehör")).toBe(0);
    expect(brokenWords("无线降噪头戴式耳机", "无线降噪\n头戴式耳机")).toBe(0);
    expect(brokenWords("Noise-Cancelling", "Noise-\nCancelling")).toBe(0);
  });

  test("every node the sidecar asserts about is a debugName the card carries", () => {
    const f = { text: "x", px: 24, lines: 1, overflows: false, brokenWords: 0 };
    const app = appSource({ name: f, claim: f, price: f, disclaimer: f, predicted: [] } satisfies Fitted);
    const named = new Set([...app.matchAll(/debugName="([^"]+)"/g)].map((m) => m[1]));
    const asserted = (JSON.parse(sidecarSource()) as { assertions: { node: string }[] }).assertions.map((a) => a.node);
    for (const node of asserted) expect(named.has(node)).toBe(true);
  });
});
