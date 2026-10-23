#!/usr/bin/env bun
/**
 * The four sound roles, one of each, on a composition that also declares
 * footage — because one of the four is placed on the clip's clock rather than
 * the composition's.
 *
 *   bun compositions/sound-roles/gen.ts
 *
 * `bed`, `narration[]` and `cues[]` are placed on the composition clock, so a
 * recut moves the picture and not the mix. `dialogue[]` is not: in-scene
 * speech belongs to the shot it came from, so a line names a declared
 * `footage[].id` and a frame on THAT clip's clock, and the composition frame
 * it lands on is the footage mapping inverted:
 *
 *   track.startFrame + (line.sourceFrame - track.sourceFrame)
 *   = 30 + (80 - 20) = 90
 *
 * `DIALOGUE_COMPOSITION_FRAME` below is that number written out, and the
 * generator refuses to write anything if `dialogueCompositionFrame` — the
 * function `lint`, `sound` and the mixer all use — disagrees with it. The
 * arithmetic is the reason dialogue is clip-relative, so a fixture that copied
 * it from the implementation would be checking the implementation against
 * itself.
 *
 * It also declares one of each shape the schema gained after the four roles,
 * each placed so `sound --verify` has somewhere to see it:
 *
 *   - `bed.ducks`: the bed at 0.5 for the whole cut the clip is on screen,
 *     frames 30-150, whatever is playing — not for the length of one line;
 *   - an `envelope` on the dialogue line, on THAT line's clock: up from 0 over
 *     its first 3 frames, down to 0 over its last 9, so it rides the clip
 *     mapping with the line;
 *   - `optional` on a second cue whose file is deliberately not in the tree,
 *     so `lint` passes, `render` reports it skipped and `sound --verify` says
 *     `skipped` rather than calling it missing;
 *   - `silentTailMs`: the last 500 ms are digital silence, measured after the
 *     mux, with the bed's fade-out completing before them.
 *
 * Sound is OUTSIDE frame-digest identity by construction: audio is a separate
 * mux pass and the frame hash never opens an audio file. So this composition's
 * ledger entry is a claim about its picture only — the shapes above were added
 * without moving it — and what checks the mix is `render` followed by
 * `sound --verify`.
 */

import { join } from "node:path";

import { footageTrack, tileNodes } from "../../src/footage/declare.ts";
import { dialogueCompositionFrame, TEX_MAX_DIM } from "../../src/manifest/sidecar.ts";

const DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");

export const VIEW = { w: 1280, h: 720 } as const;
export const FPS = 30;
export const DURATION_FRAMES = 180;
export const TILE = TEX_MAX_DIM;

/** The one track, drawn at its own aspect so no `fit` is needed here. */
export const TRACK = {
  id: "clip",
  src: "assets/synthetic/bars-16x9-24fps.mp4",
  nodePrefix: "footage:clip",
  box: { x: 320, y: 180, w: 640, h: 360 },
  startFrame: 30,
  endFrame: 150,
  sourceFrame: 20,
} as const;

/** The clip frame the line is spoken at, and where that lands on the film. */
export const DIALOGUE_SOURCE_FRAME = 80;
export const DIALOGUE_COMPOSITION_FRAME = 90;

export const NARRATION_START_FRAME = 15;
export const CUE_AT_FRAME = 150;

/** The cut the clip is on screen for, ducked as one window. */
export const CUT_DUCK = { startFrame: TRACK.startFrame, endFrame: TRACK.endFrame, duck: 0.5 } as const;

/**
 * The dialogue file is 1.5 s, 45 frames at 30 fps. Frames are the line's own,
 * counted from where it lands (composition frame 90), not the film's.
 */
export const DIALOGUE_ENVELOPE = [
  { frame: 0, gain: 0 },
  { frame: 3, gain: 1 },
  { frame: 36, gain: 1 },
  { frame: 45, gain: 0 },
] as const;

/** Declared optional, and not in the tree on purpose. */
export const OPTIONAL_CUE = {
  id: "cue-2",
  src: "assets/synthetic/sting-not-shipped.wav",
  atFrame: 120,
} as const;

export const SILENT_TAIL_MS = 500;

const derived = dialogueCompositionFrame(
  { sourceFrame: DIALOGUE_SOURCE_FRAME },
  TRACK,
);
if (derived !== DIALOGUE_COMPOSITION_FRAME) {
  throw new Error(
    `sound-roles: dialogue lands on composition frame ${derived}, and this file ` +
      `says ${DIALOGUE_COMPOSITION_FRAME}. One of the two is wrong; the mapping is ` +
      "track.startFrame + (line.sourceFrame - track.sourceFrame).",
  );
}

/** Role, and where the sidecar places it. Drawn as the caption, in order. */
const CAPTIONS: readonly { readonly name: string; readonly text: string }[] = [
  { name: "role:bed", text: "bed        composition clock   startAt 0s   gain 0.3   fade 600/1200 ms" },
  { name: "role:narration", text: `narration  composition frame ${NARRATION_START_FRAME}   ducks the bed to 0.2` },
  {
    name: "role:dialogue",
    text:
      `dialogue   clip frame ${DIALOGUE_SOURCE_FRAME} of track ${JSON.stringify(TRACK.id).slice(1, -1)}` +
      `   lands on composition frame ${DIALOGUE_COMPOSITION_FRAME}`,
  },
  { name: "role:cue", text: `cue        composition frame ${CUE_AT_FRAME}` },
];

export function source(): string {
  const tiles = tileNodes({
    nodePrefix: TRACK.nodePrefix,
    width: TRACK.box.w,
    height: TRACK.box.h,
    tile: TILE,
    indent: "        ",
  });
  const captions = CAPTIONS.map(
    (c, i) =>
      `      <Text debugName="${c.name}" class="absolute left-[40px] top-[${556 + i * 30}px] ` +
      `text-[20px] text-[#cbd5e1]">{${JSON.stringify(c.text)}}</Text>`,
  );
  return `// GENERATED by compositions/sound-roles/gen.ts — do not edit.

import { Image, Text, View } from "@pocketjs/framework/components";

export default function SoundRoles() {
  return (
    <View class="w-full h-full bg-[#05070a]">
      <Text debugName="title" class="absolute left-[40px] top-[48px] text-[36px] font-bold text-[#f8fafc]">{"sound roles"}</Text>
      <View class="absolute left-[${TRACK.box.x}px] top-[${TRACK.box.y}px] w-[${TRACK.box.w}px] h-[${TRACK.box.h}px]">
${tiles}
      </View>
${captions.join("\n")}
    </View>
  );
}
`;
}

export function sidecar(): string {
  return (
    JSON.stringify(
      {
        motion: 1,
        durationFrames: DURATION_FRAMES,
        fps: FPS,
        supersample: 1,
        footage: [
          footageTrack({
            id: TRACK.id,
            src: TRACK.src,
            nodePrefix: TRACK.nodePrefix,
            tile: TILE,
            width: TRACK.box.w,
            height: TRACK.box.h,
            startFrame: TRACK.startFrame,
            endFrame: TRACK.endFrame,
            sourceFrame: TRACK.sourceFrame,
          }),
        ],
        fonts: {
          regular: "assets/fonts/HarmonyOS_Sans_Regular.ttf",
          bold: "assets/fonts/HarmonyOS_Sans_Bold.ttf",
        },
        sound: {
          bed: {
            src: "assets/synthetic/bed-220hz-8000ms.wav",
            startAt: 0,
            gain: 0.3,
            fadeInMs: 600,
            fadeOutMs: 1200,
            ducks: [CUT_DUCK],
          },
          narration: [
            {
              id: "narration-1",
              src: "assets/synthetic/narration-440hz-2000ms.wav",
              startFrame: NARRATION_START_FRAME,
              gain: 1,
              duck: 0.2,
            },
          ],
          dialogue: [
            {
              id: "dialogue-1",
              src: "assets/synthetic/dialogue-660hz-1500ms.wav",
              track: TRACK.id,
              sourceFrame: DIALOGUE_SOURCE_FRAME,
              gain: 1,
              envelope: DIALOGUE_ENVELOPE,
            },
          ],
          cues: [
            {
              id: "cue-1",
              src: "assets/synthetic/cue-880hz-300ms.wav",
              atFrame: CUE_AT_FRAME,
              gain: 1,
            },
            { ...OPTIONAL_CUE, gain: 1, optional: true },
          ],
          silentTailMs: SILENT_TAIL_MS,
        },
      },
      null,
      2,
    ) + "\n"
  );
}

if (import.meta.main) {
  await Bun.write(join(DIR, "app.tsx"), source());
  await Bun.write(join(DIR, "pocket-motion.json"), sidecar());
  console.error(
    `sound-roles: 4 role(s), 1 track, dialogue at clip frame ${DIALOGUE_SOURCE_FRAME} ` +
      `-> composition frame ${DIALOGUE_COMPOSITION_FRAME}; a cut duck, a dialogue envelope, ` +
      `an optional cue and a ${SILENT_TAIL_MS} ms silent tail`,
  );
}
