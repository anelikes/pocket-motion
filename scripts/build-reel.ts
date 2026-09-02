#!/usr/bin/env bun
/**
 * Generate, build and render the introduction reel in one step.
 *
 * The font is a build parameter, not a default: upstream bakes Inter, and the
 * reel is baked with the faces in ./assets/fonts. Since a render's identity
 * includes the font bytes, that choice belongs in a script under version
 * control rather than in whatever a shell history happens to hold.
 *
 *   bun scripts/build-reel.ts                      # build + render to /tmp
 *   bun scripts/build-reel.ts --out reel.mp4
 *   bun scripts/build-reel.ts --font inter         # the vendored Inter Display
 *   bun scripts/build-reel.ts --silent             # picture only, no mix
 *   bun scripts/build-reel.ts --no-render
 *
 * Sound comes from compositions/reel/sound.ts and assets/audio/, which is
 * checked in — every file there is Mixkit-licensed for commercial use with a
 * recorded source URL (assets/audio/ATTRIBUTION.md). The previous cut used a
 * commercial track it had no licence for; that is why provenance is now a
 * selection rule rather than a footnote.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const VENDOR = join(ROOT, "vendor/pocketjs");

const FACES = {
  harmony: {
    regular: join(ROOT, "assets/fonts/HarmonyOS_Sans_Regular.ttf"),
    bold: join(ROOT, "assets/fonts/HarmonyOS_Sans_Bold.ttf"),
  },
  inter: {
    regular: join(VENDOR, "assets/fonts/InterDisplay-Regular.ttf"),
    bold: join(VENDOR, "assets/fonts/InterDisplay-Bold.ttf"),
  },
} as const;

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const faceName = (flag("font") ?? "harmony") as keyof typeof FACES;
const face = FACES[faceName];
if (!face) {
  console.error(`unknown --font ${faceName}; expected one of ${Object.keys(FACES).join(", ")}`);
  process.exit(2);
}
const out = flag("out") ?? "/tmp/pocketjs-motion-reel.mp4";
const render = !argv.includes("--no-render");

const run = async (cmd: string[]): Promise<void> => {
  const p = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit", cwd: ROOT });
  const code = await p.exited;
  if (code !== 0) process.exit(code);
};

const probeDuration = async (path: string): Promise<number> => {
  const p = Bun.spawn(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { stdout: "pipe", stderr: "pipe" },
  );
  const text = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(`ffprobe failed on ${path}`);
  return Number(text.trim());
};

await run(["bun", "compositions/reel/gen.ts"]);
await run([
  "bun",
  `${VENDOR}/tools/build.ts`,
  "compositions/reel/main.tsx",
  "--outdir=dist/reel",
  "--framework=solid",
  `--font-regular=${face.regular}`,
  `--font-bold=${face.bold}`,
]);
await run(["bun", "src/cli/main.ts", "check", "compositions/reel"]);

/**
 * Mix the reel's sound under the finished picture.
 *
 * A separate pass on purpose. Frame hashes are taken before encoding and the
 * digest this script prints describes the picture; adding sound must not be
 * able to move it, and running the mix as its own step is what guarantees
 * that. The video stream is copied, never re-encoded.
 *
 * The bed enters at a chosen point in the track rather than at zero — see
 * compositions/reel/sound.ts, where the entry is picked so the track's drop
 * lands on the reel's midpoint. Cues are `adelay`ed onto their own branches
 * and folded in with `amix ... normalize=0`, which sums instead of dividing by
 * the input count: with normalisation on, adding a cue would quietly duck the
 * whole bed.
 */
const mixSound = async (videoPath: string): Promise<void> => {
  const { BGM, SFX } = (await import(`${ROOT}/compositions/reel/sound.ts`)) as typeof import("../compositions/reel/sound.ts");

  // The audio is gitignored and fetched by scripts/assets.ts. Say so here
  // rather than letting ffmpeg report "No such file or directory" from inside a
  // forty-argument filter graph — the point of allowing an ignored dependency
  // at all is that its absence stays legible.
  const needed = [`${ROOT}/${BGM.src}`, ...SFX.map((c) => `${ROOT}/assets/audio/sfx/${c.src}.mp3`)];
  const absent = [...new Set(needed)].filter((p) => !existsSync(p));
  if (absent.length > 0) {
    throw new Error(
      `PocketJS Motion: ${absent.length} audio file(s) are missing — fetch them with ` +
        "`bun scripts/assets.ts`.\nThey are third-party media, kept out of the repository and " +
        "reconstructed from assets/audio/manifest.json:\n" +
        absent.map((p) => `  ${p.slice(ROOT.length + 1)}`).join("\n"),
    );
  }

  const vDur = await probeDuration(videoPath);

  const inputs: string[] = ["-i", videoPath, "-ss", String(BGM.startAt), "-i", `${ROOT}/${BGM.src}`];
  const filters: string[] = [
    `[1:a]volume=${BGM.gain},` +
      `afade=t=in:st=0:d=${(BGM.fadeInMs / 1000).toFixed(3)},` +
      `afade=t=out:st=${Math.max(0, vDur - BGM.fadeOutMs / 1000).toFixed(3)}:d=${(BGM.fadeOutMs / 1000).toFixed(3)}` +
      `[bed]`,
  ];
  const legs: string[] = ["[bed]"];

  SFX.forEach((cue, i) => {
    const idx = i + 2;
    inputs.push("-i", `${ROOT}/assets/audio/sfx/${cue.src}.mp3`);
    // adelay wants one value per channel; the cues are stereo
    filters.push(`[${idx}:a]adelay=${cue.at}|${cue.at},volume=${cue.gain}[c${i}]`);
    legs.push(`[c${i}]`);
  });
  filters.push(`${legs.join("")}amix=inputs=${legs.length}:normalize=0:dropout_transition=0[a]`);

  const tmp = `${videoPath}.mixing.mp4`;
  console.log(
    `  sound: ${BGM.src.split("/").pop()} from ${BGM.startAt}s at gain ${BGM.gain}, ` +
      `${SFX.length} cue(s) over ${vDur.toFixed(2)}s`,
  );
  await run([
    "ffmpeg", "-y", "-v", "error",
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "0:v:0", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-t", String(vDur),
    "-movflags", "+faststart",
    tmp,
  ]);
  await run(["mv", tmp, videoPath]);
};

if (render) {
  await run(["bun", "src/cli/main.ts", "render", "compositions/reel", "--out", out]);
  if (!argv.includes("--silent")) await mixSound(out);
}
