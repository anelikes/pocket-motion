import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Criterion, Task } from "../../lib/task.ts";
import { encodePng } from "../../lib/png.ts";
import { photo } from "../../lib/photos.ts";
import { fmt, full, px } from "../../lib/pixels.ts";

const SPEAKER = { name: "Dr. Amara Okafor", role: "Director of Climate Research, Helios Institute" };
const BACKGROUND = { w: 1920, h: 1080, seed: 51, hue: 205 };

export default {
  id: "speaker-lower-third",
  ext: "mp4",
  canvas: { w: 1920, h: 1080, fps: 30, frames: 180 },
  async inputs(dir) {
    writeFileSync(join(dir, "background.png"), encodePng(photo(BACKGROUND)));
    writeFileSync(join(dir, "speaker.json"), `${JSON.stringify(SPEAKER, null, 2)}\n`);
  },
  assertions: () => [
    { node: "background", inPicture: [0, 179] },
    { node: "bar", entersBy: 22 },
    { node: "bar", before: "name" },
    { node: "name", before: "role" },
    { node: "bar", inPicture: [35, 139] },
    { node: "name", inPicture: [45, 139] },
    { node: "role", inPicture: [45, 139] },
    { node: "bar", exitsBy: 160 },
    { node: "name", exitsBy: 160 },
    { node: "role", exitsBy: 160 },
  ],
  async observe(ctx) {
    const out: Criterion[] = [];
    const nodes = await ctx.layout(90);
    const named = (n: string) => nodes.find((x) => x.name === n);
    const bar = named("bar");
    const name = named("name");
    const role = named("role");
    out.push({
      id: "texts",
      pass: name?.text?.trim() === SPEAKER.name && role?.text?.trim() === SPEAKER.role,
      detail: `name ${JSON.stringify(name?.text)}, role ${JSON.stringify(role?.text)}`,
    });
    if (!bar || !name?.ink || !role?.ink) {
      out.push({ id: "text-inside-bar", pass: false, detail: "bar, name or role not laid out at frame 90" });
      return out;
    }
    const inside = (i: { x: number; y: number; w: number; h: number }) =>
      i.x >= bar.x - 2 && i.y >= bar.y - 2 && i.x + i.w <= bar.x + bar.w + 2 && i.y + i.h <= bar.y + bar.h + 2;
    const flagged = [name, role].flatMap((n) =>
      n.findings.filter((f) => ["text_box_overflow", "clipped_text", "text_occluded"].includes(f.code)).map((f) => `${n.name}: ${f.code}`),
    );
    out.push({
      id: "text-inside-bar",
      pass: inside(name.ink) && inside(role.ink) && flagged.length === 0,
      detail: `bar ${JSON.stringify([bar.x, bar.y, bar.w, bar.h])}, name ink ${JSON.stringify(name.ink)}, role ink ${JSON.stringify(role.ink)}${flagged.length ? `; ${flagged.join(", ")}` : ""}`,
    });
    out.push({
      id: "lower-left",
      pass: bar.x <= 300 && bar.y >= 600 && bar.y + bar.h <= 1080 && bar.x + bar.w <= 1400,
      detail: `bar at ${bar.x},${bar.y} size ${bar.w}×${bar.h}`,
    });
    // After the exit, the frame is the background as given, 1:1.
    const [f170, src] = [await ctx.frame(170), ctx.input("background.png")];
    let sum = 0;
    let n = 0;
    for (let y = 0; y < f170.h; y += 3)
      for (let x = 0; x < f170.w; x += 3) {
        const a = px(f170, x, y);
        const b = px(src, x, y);
        sum += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        n += 3;
      }
    out.push({
      id: "background-as-given",
      pass: sum / n < 6 && f170.w === full(src).w,
      detail: `mean |frame 170 − background.png| per channel ${fmt(sum / n)}`,
    });
    return out;
  },
  unchecked: ["the slide and wipe motion itself (only order and timing are read)"],
} satisfies Task;
