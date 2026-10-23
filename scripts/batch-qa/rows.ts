#!/usr/bin/env bun
/**
 * Synthetic product rows for the batch-QA prototype (`scripts/batch-qa.ts`).
 *
 * The rows are generated, never hand-written, so the file a run read can be
 * rebuilt from the seed and this source. Most of them are ordinary; the rest
 * are the inputs that break a layout someone designed once against a sample:
 *
 *   plain            what the template was designed against
 *   long-name        names of 60-260 characters
 *   german           compound nouns of 4-8 stems, which have no break inside
 *   cjk              Chinese and Japanese copy with no spaces anywhere
 *   mixed            Latin with CJK, Cyrillic, Greek, Arabic, Hebrew, Thai,
 *                    Devanagari, Hangul, emoji and combining marks
 *   empty            one or more fields empty or whitespace-only
 *   price            prices of 10-40 digits, in several group conventions
 *   long-disclaimer  legal copy of 4-14 sentences
 *   duplicate        an earlier row's content under a new id
 *   near-duplicate   an earlier row with whitespace added that may or may not
 *                    survive line breaking
 *
 *   bun scripts/batch-qa/rows.ts --out dist/batch-qa/rows.jsonl [--n 1000] [--seed 20261023]
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface Row {
  readonly id: string;
  readonly category: Category;
  readonly name: string;
  readonly price: string;
  readonly claim: string;
  readonly disclaimer: string;
  /** For `duplicate` and `near-duplicate`: the row whose content this copies. */
  readonly copyOf?: string;
}

export const CATEGORIES = [
  "plain",
  "long-name",
  "german",
  "cjk",
  "mixed",
  "empty",
  "price",
  "long-disclaimer",
  "duplicate",
  "near-duplicate",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Share of each category in 1000 rows. Scaled for other `n`, remainder to plain. */
const QUOTA: Readonly<Record<Category, number>> = {
  plain: 380,
  "long-name": 90,
  german: 80,
  cjk: 100,
  mixed: 80,
  empty: 50,
  price: 80,
  "long-disclaimer": 60,
  duplicate: 50,
  "near-duplicate": 30,
};

export const DEFAULT_SEED = 20261023;
export const DEFAULT_N = 1000;

/** mulberry32: a 32-bit seeded generator, so a seed names one data set everywhere. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rand {
  readonly int: (lo: number, hi: number) => number;
  readonly one: <T>(xs: readonly T[]) => T;
  readonly chance: (p: number) => boolean;
  readonly shuffle: <T>(xs: T[]) => T[];
}

function picker(next: () => number): Rand {
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  return {
    int,
    one: (xs) => xs[int(0, xs.length - 1)]!,
    chance: (p) => next() < p,
    shuffle: (xs) => {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = int(0, i);
        [xs[i], xs[j]] = [xs[j]!, xs[i]!];
      }
      return xs;
    },
  };
}

const BRANDS = ["Northwind", "Acme", "Lumen", "Kestrel", "Orbit", "Halcyon", "Brightline", "Copperleaf", "Tidewater", "Fennec"];
const ADJECTIVES = [
  "Ultra", "Pro", "Compact", "Wireless", "Noise-Cancelling", "Ergonomic", "Stainless", "Smart",
  "Portable", "Organic", "Premium", "Classic", "Heavy-Duty", "Cordless", "Waterproof", "Foldable",
  "Insulated", "Rechargeable", "Low-Profile", "All-Weather",
];
const NOUNS = [
  "Headphones", "Blender", "Kettle", "Backpack", "Desk Lamp", "Running Shoes", "Coffee Grinder",
  "Air Fryer", "Water Bottle", "Office Chair", "Keyboard", "Monitor Arm", "Yoga Mat", "Robot Vacuum",
  "Toaster", "Rice Cooker", "Electric Toothbrush", "Camping Tent", "Smartwatch", "Speaker",
];
const MODELS = ["X200", "Gen 3", "Series 9", "Mk II", "S", "Air", "Max", "Mini", "2026 Edition", "Plus"];
const CLAIMS = [
  "Up to {n} hours of battery life",
  "Save {p}% this week only",
  "Free shipping on orders over $50",
  "Rated 4.{d} by {n},000 customers",
  "Now {p}% quieter than the last model",
  "Two-year warranty included",
  "Ready in {n} minutes, cleans up in one",
  "Made from {p}% recycled materials",
  "The lightest one we have ever made",
  "Brews a full pot in under {n} minutes",
];
const DISCLAIMERS = [
  "Offer valid while supplies last.",
  "Prices exclude applicable taxes and delivery.",
  "Battery life measured under laboratory conditions; actual results vary with use and settings.",
  "See store for details.",
  "Not combinable with other offers or promotional codes.",
  "Limit {n} per customer.",
  "Savings shown against the manufacturer's suggested retail price.",
  "Images are illustrative; the product may differ from the picture.",
  "Warranty terms apply; registration required within 30 days of purchase.",
  "Financing subject to credit approval by a third-party lender.",
  "Ratings collected from verified purchasers between January and June.",
  "Free shipping applies to standard delivery to the contiguous United States only.",
  "Returns accepted within 30 days in original packaging; a restocking fee may apply.",
  "Recycled content by weight, excluding packaging and electronics.",
];

const fill = (p: Rand, s: string): string =>
  s
    .replace(/\{n\}/g, () => String(p.int(2, 60)))
    .replace(/\{p\}/g, () => String(p.int(5, 70)))
    .replace(/\{d\}/g, () => String(p.int(1, 9)));

const plainName = (p: Rand): string =>
  `${p.one(BRANDS)} ${p.chance(0.6) ? `${p.one(ADJECTIVES)} ` : ""}${p.one(NOUNS)}${p.chance(0.5) ? ` ${p.one(MODELS)}` : ""}`;
const plainPrice = (p: Rand): string =>
  `$${p.int(5, 1499)}.${p.one(["00", "49", "95", "99"])}`;
const plainClaim = (p: Rand): string => fill(p, p.one(CLAIMS));
const plainDisclaimer = (p: Rand, sentences = p.int(1, 2)): string =>
  Array.from({ length: sentences }, () => fill(p, p.one(DISCLAIMERS))).join(" ");

/** A long name: brand, a run of adjectives and features, a model, a pack size. */
function longName(p: Rand): string {
  const target = p.int(60, 260);
  const parts = [p.one(BRANDS)];
  while (parts.join(" ").length < target) {
    parts.push(
      p.one([
        p.one(ADJECTIVES),
        p.one(NOUNS),
        p.one(MODELS),
        `with ${p.one(["USB-C", "Bluetooth 5.3", "Active Noise Cancellation", "Dual-Zone Temperature Control", "Carrying Case"])}`,
        `(${p.int(2, 12)}-Pack)`,
        p.one(["Midnight Blue", "Arctic White", "Graphite", "Sage Green"]),
      ]),
    );
  }
  return parts.join(" ");
}

const GERMAN_STEMS = [
  "Donau", "dampf", "schiff", "fahrts", "gesellschafts", "kapitäns", "mützen", "Rind", "fleisch",
  "etikettierungs", "überwachungs", "aufgaben", "übertragungs", "gesetz", "Kraft", "fahrzeug",
  "haftpflicht", "versicherungs", "Hochleistungs", "staub", "sauger", "zubehör", "Kühl", "schrank",
  "Energie", "spar", "Garantie", "verlängerungs", "Edelstahl", "wasser", "kocher", "Geräusch",
  "unterdrückungs", "kopfhörer",
];
const GERMAN_TAILS = ["set", "paket", "angebot", "modell", "gerät", "bedingungen"];

function germanCompound(p: Rand): string {
  const n = p.int(4, 8);
  const stems = Array.from({ length: n }, () => p.one(GERMAN_STEMS).toLowerCase());
  const word = stems.join("") + p.one(GERMAN_TAILS);
  return word[0]!.toUpperCase() + word.slice(1);
}

function germanRow(p: Rand): Pick4 {
  return {
    name: `${p.one(BRANDS)} ${germanCompound(p)}`,
    price: `${p.int(9, 999)},${p.one(["00", "49", "99"])} €`,
    claim: p.chance(0.5)
      ? `Jetzt mit ${germanCompound(p)}`
      : `${germanCompound(p)} inklusive`,
    disclaimer:
      `Angebot gültig solange der Vorrat reicht. Alle Preise inkl. gesetzlicher Mehrwertsteuer ` +
      `zzgl. Versandkosten. ${germanCompound(p)} gemäß ${germanCompound(p)}.`,
  };
}

const ZH_BRANDS = ["北风", "极光", "青岚", "远山", "星河"];
const ZH_PRODUCTS = [
  "无线降噪头戴式耳机", "智能恒温电热水壶", "超静音变频空气净化器", "多功能家用料理机",
  "人体工学办公椅", "全自动扫拖一体机器人", "便携式户外露营帐篷", "大容量智能电饭煲",
];
const ZH_CLAIMS = [
  "续航长达四十小时，快充十分钟听歌五小时",
  "限时直降三百元，下单即送原装收纳包",
  "一键智能清洁，告别繁琐的日常家务劳动让生活更轻松自在",
  "采用航空级铝合金机身轻至两百克却依然坚固耐用",
];
const ZH_DISCLAIMERS = [
  "活动时间以页面公示为准，图片仅供参考，商品以实物为准。",
  "续航数据来自实验室测试环境，实际使用时间因使用习惯与设置而异。",
  "优惠券不可与其他优惠同时使用，每位用户限领一张，最终解释权归本公司所有。",
  "价格含增值税，偏远地区运费另计，详情请咨询在线客服。",
];
const JA_PRODUCTS = ["ワイヤレスノイズキャンセリングヘッドホン", "電気ケトル温度調節機能付き", "コードレススティック掃除機"];
const JA_CLAIMS = ["期間限定セール中！今だけ送料無料", "最大四十時間の連続再生が可能になりました"];
const JA_DISCLAIMERS = [
  "※価格はすべて税込みです。在庫がなくなり次第終了となります。",
  "※バッテリー駆動時間は当社試験条件によるもので、使用環境により異なります。",
];

function cjkRow(p: Rand): Pick4 {
  if (p.chance(0.3)) {
    return {
      name: p.one(JA_PRODUCTS) + (p.chance(0.5) ? p.one(JA_PRODUCTS) : ""),
      price: `¥${p.int(980, 99800).toLocaleString("en-US")}`,
      claim: p.one(JA_CLAIMS),
      disclaimer: p.one(JA_DISCLAIMERS) + (p.chance(0.5) ? p.one(JA_DISCLAIMERS) : ""),
    };
  }
  // Some names repeat the product run with no punctuation at all, which is
  // the case a word segmenter has to split without any help.
  const name = p.one(ZH_BRANDS) + Array.from({ length: p.int(1, 4) }, () => p.one(ZH_PRODUCTS)).join("");
  return {
    name,
    price: `¥${p.int(99, 19999)}.${p.one(["00", "90", "99"])}`,
    claim: Array.from({ length: p.int(1, 3) }, () => p.one(ZH_CLAIMS)).join(""),
    disclaimer: Array.from({ length: p.int(1, 4) }, () => p.one(ZH_DISCLAIMERS)).join(""),
  };
}

/** Script runs a Latin name may be mixed with. Some the default face carries, some it does not. */
const MIXED = [
  "北风", "超静音", "Ультра", "Чайник", "Σmart", "κ-3", "سماعات لاسلكية", "אוזניות", "หูฟังไร้สาย",
  "हेडफ़ोन", "무선 헤드폰", "🎧", "🔥", "Café", "Café", "naïve", "Crème brûlée", "Ångström",
  "​zero​width", "ワイヤレス", "Straße", "İstanbul", "Łódź", "x²", "№5",
];

function mixedRow(p: Rand): Pick4 {
  const mix = (): string => `${p.one(MIXED)} ${p.one(NOUNS)} ${p.one(MIXED)}`;
  return {
    name: `${p.one(BRANDS)} ${mix()}`,
    price: p.chance(0.3) ? `${p.int(100, 9999)} ₽` : plainPrice(p),
    claim: p.chance(0.5) ? `${plainClaim(p)} ${p.one(MIXED)}` : plainClaim(p),
    disclaimer: p.chance(0.3) ? `${plainDisclaimer(p, 1)} ${p.one(MIXED)}` : plainDisclaimer(p),
  };
}

function manyDigitPrice(p: Rand): string {
  const digits = p.int(10, 40);
  let whole = String(p.int(1, 9));
  while (whole.length < digits) whole += String(p.int(0, 9));
  const group = (s: string, sep: string): string => s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  switch (p.int(0, 5)) {
    case 0: return `$${group(whole, ",")}.${p.int(10, 99)}`;
    case 1: return `${group(whole, ".")},${p.int(10, 99)} €`;
    case 2: return `¥${whole}`;
    case 3: return `USD ${group(whole, ",")}.00`;
    case 4: return `-$${group(whole, ",")}`;
    default: return `₹${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${whole.slice(-3)}.00`;
  }
}

function emptyRow(p: Rand): Pick4 {
  const base: Pick4 = {
    name: plainName(p),
    price: plainPrice(p),
    claim: plainClaim(p),
    disclaimer: plainDisclaimer(p),
  };
  const blank = (): string => p.one(["", "", " ", "   ", "\t"]);
  const which = p.int(0, 5);
  switch (which) {
    case 0: return { ...base, name: blank() };
    case 1: return { ...base, price: blank() };
    case 2: return { ...base, claim: blank() };
    case 3: return { ...base, disclaimer: blank() };
    case 4: return { ...base, claim: blank(), disclaimer: blank() };
    default: return { name: blank(), price: blank(), claim: blank(), disclaimer: blank() };
  }
}

type Pick4 = Pick<Row, "name" | "price" | "claim" | "disclaimer">;

function contentFor(category: Category, p: Rand): Pick4 {
  switch (category) {
    case "plain":
      return { name: plainName(p), price: plainPrice(p), claim: plainClaim(p), disclaimer: plainDisclaimer(p) };
    case "long-name":
      return { name: longName(p), price: plainPrice(p), claim: plainClaim(p), disclaimer: plainDisclaimer(p) };
    case "german":
      return germanRow(p);
    case "cjk":
      return cjkRow(p);
    case "mixed":
      return mixedRow(p);
    case "empty":
      return emptyRow(p);
    case "price":
      return { name: plainName(p), price: manyDigitPrice(p), claim: plainClaim(p), disclaimer: plainDisclaimer(p) };
    case "long-disclaimer":
      return { name: plainName(p), price: plainPrice(p), claim: plainClaim(p), disclaimer: plainDisclaimer(p, p.int(4, 14)) };
    case "duplicate":
    case "near-duplicate":
      throw new Error(`rows: ${category} copies another row and has no content of its own`);
  }
}

/** Whitespace a near-duplicate adds. Some of it a line breaker drops, some it keeps. */
function perturb(p: Rand, row: Pick4): Pick4 {
  switch (p.int(0, 3)) {
    case 0: return { ...row, name: `${row.name} ` };
    case 1: return { ...row, disclaimer: `${row.disclaimer}  ` };
    case 2: return { ...row, claim: row.claim.replace(" ", "  ") };
    default: return { ...row, name: ` ${row.name}` };
  }
}

export function generateRows(n: number = DEFAULT_N, seed: number = DEFAULT_SEED): Row[] {
  const p = picker(rng(seed));
  const counts = new Map<Category, number>();
  let assigned = 0;
  for (const c of CATEGORIES) {
    const k = Math.floor((QUOTA[c] * n) / DEFAULT_N);
    counts.set(c, k);
    assigned += k;
  }
  counts.set("plain", counts.get("plain")! + (n - assigned));

  // Originals first, shuffled, so a copy always has an earlier row to copy.
  const originals: Category[] = [];
  for (const c of CATEGORIES) {
    if (c === "duplicate" || c === "near-duplicate") continue;
    for (let i = 0; i < counts.get(c)!; i++) originals.push(c);
  }
  p.shuffle(originals);

  const rows: Array<Omit<Row, "id">> = originals.map((category) => ({ category, ...contentFor(category, p) }));
  const copies: Category[] = [
    ...Array.from({ length: counts.get("duplicate")! }, () => "duplicate" as const),
    ...Array.from({ length: counts.get("near-duplicate")! }, () => "near-duplicate" as const),
  ];
  p.shuffle(copies);
  // Each copy is inserted after its source, so the order still reads as a
  // feed where a product reappears later.
  const out: Array<Omit<Row, "id"> & { sourceIndex?: number }> = rows.map((r) => ({ ...r }));
  for (const category of copies) {
    const candidates = out.filter((r) => r.category !== "duplicate" && r.category !== "near-duplicate");
    const source = p.one(candidates);
    const sourceIndex = out.indexOf(source);
    const at = p.int(sourceIndex + 1, out.length);
    const content: Pick4 = { name: source.name, price: source.price, claim: source.claim, disclaimer: source.disclaimer };
    out.splice(at, 0, {
      category,
      ...(category === "near-duplicate" ? perturb(p, content) : content),
      sourceIndex,
    });
    // Record the source by object, since later inserts shift indices.
    (out[at] as { source?: object }).source = source;
  }

  const ids = new Map<object, string>();
  out.forEach((r, i) => ids.set(r, `r${String(i).padStart(4, "0")}`));
  return out.map((r) => {
    const source = (r as { source?: object }).source;
    return {
      id: ids.get(r)!,
      category: r.category,
      name: r.name,
      price: r.price,
      claim: r.claim,
      disclaimer: r.disclaimer,
      ...(source ? { copyOf: ids.get(source)! } : {}),
    };
  });
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`rows: ${name} needs a value`);
  return v;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const out = flag(argv, "--out");
  if (!out) throw new Error("rows: --out <file.jsonl> is required");
  const n = Number(flag(argv, "--n") ?? DEFAULT_N);
  const seed = Number(flag(argv, "--seed") ?? DEFAULT_SEED);
  const rows = generateRows(n, seed);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  await Bun.write(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.category, (by.get(r.category) ?? 0) + 1);
  console.log(`rows: wrote ${rows.length} to ${out} (seed ${seed})`);
  for (const [c, k] of by) console.log(`  ${c.padEnd(16)} ${k}`);
}
