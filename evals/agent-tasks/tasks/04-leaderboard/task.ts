import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Assertion, Criterion, Task } from "../../lib/task.ts";
import { count, toHsv, type Rgb } from "../../lib/pixels.ts";

const PLAYERS = [
  { player: "Kai Nakamura", team: "Tidebreakers", score: 18240 },
  { player: "José Álvarez", team: "Red Comets", score: 21075 },
  { player: "李华", team: "Jade Wolves", score: 19960 },
  { player: "Amara Okoye", team: "Lumen", score: 24310 },
  { player: "Sven Lindqvist", team: "Northwind", score: 15880 },
  { player: "Priya Raman", team: "Red Comets", score: 22745 },
  { player: "Mateus Costa", team: "Tidebreakers", score: 9870 },
  { player: "Élodie Martin", team: "Lumen", score: 17505 },
];
const RANKED = [...PLAYERS].sort((a, b) => b.score - a.score);
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const gold = (c: Rgb) => {
  const [h, s, v] = toHsv(c);
  return h >= 30 && h <= 58 && s >= 0.4 && v >= 0.45;
};

export default {
  id: "leaderboard",
  ext: "mp4",
  canvas: { w: 1920, h: 1080, fps: 30, frames: 240 },
  async inputs(dir) {
    writeFileSync(join(dir, "leaderboard.json"), `${JSON.stringify({ players: PLAYERS }, null, 2)}\n`);
  },
  assertions: () => {
    const out: Assertion[] = [
      { node: "title", inPicture: [0, 239] },
      { node: "row-8", entersBy: 20 },
      { node: "row-1", entersBy: 125 },
    ];
    for (let k = 1; k <= 7; k++) out.push({ node: `row-${k + 1}`, before: `row-${k}` });
    for (let k = 1; k <= 8; k++) out.push({ node: `row-${k}`, inPicture: [130, 239] });
    return out;
  },
  async observe(ctx) {
    const out: Criterion[] = [];
    const nodes = await ctx.layout(200);
    const named = (n: string) => nodes.find((x) => x.name === n);
    const wrongText: string[] = [];
    for (let k = 1; k <= 8; k++) {
      const p = RANKED[k - 1]!;
      const name = named(`name-${k}`)?.text?.trim();
      const score = named(`score-${k}`)?.text?.trim();
      if (name !== p.player) wrongText.push(`name-${k} ${JSON.stringify(name)} ≠ ${JSON.stringify(p.player)}`);
      if (score !== thousands(p.score)) wrongText.push(`score-${k} ${JSON.stringify(score)} ≠ "${thousands(p.score)}"`);
    }
    out.push({
      id: "rows-text",
      pass: wrongText.length === 0,
      detail: wrongText.length === 0 ? "all 16 name and score texts as ranked" : wrongText.join("; "),
    });
    const ys = Array.from({ length: 8 }, (_, i) => named(`row-${i + 1}`)?.y);
    const ordered = ys.every((y, i) => y !== undefined && (i === 0 || y > ys[i - 1]!));
    out.push({ id: "rows-ordered", pass: ordered, detail: `row y at frame 200: ${ys.join(", ")}` });
    const f = await ctx.frame(200);
    const r1 = named("row-1");
    const r2 = named("row-2");
    const g1 = r1 ? count(f, r1, gold) / (r1.w * r1.h) : 0;
    const g2 = r2 ? count(f, r2, gold) / (r2.w * r2.h) : 0;
    out.push({
      id: "rank-1-gold",
      pass: g1 >= 0.05 && g1 >= 3 * g2,
      detail: `gold pixel share: row-1 ${g1.toFixed(3)}, row-2 ${g2.toFixed(3)}`,
    });
    return out;
  },
  unchecked: ["that each row slides (only order and timing are read)", "the rank numbers"],
} satisfies Task;
