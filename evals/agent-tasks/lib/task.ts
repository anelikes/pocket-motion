/**
 * What a task is: the brief an agent is given (`brief.md` beside the task),
 * the inputs it is given, and the acceptance it is held to — `assertions[]`
 * the checker writes into the delivered sidecar in place of the agent's own,
 * and observable criteria read off `layout` and the frames. The agent sees
 * the brief and the inputs and nothing in this file.
 */

import type { CheckContext } from "./check.ts";

export interface Criterion {
  /** Stable id, so two runs' reports line up. */
  readonly id: string;
  readonly pass: boolean;
  /** What was measured, in a line. */
  readonly detail: string;
}

/** One sidecar `assertions[]` entry, as `src/manifest/sidecar.ts` parses it. */
export type Assertion =
  | { node: string; inPicture: [number, number] }
  | { node: string; entersBy: number }
  | { node: string; exitsBy: number }
  | { node: string; before: string }
  | { node: string; dwellFrames: number }
  | { node: string; insideBox: true };

export interface Task {
  /** The composition directory name the agent delivers, `compositions/<id>`. */
  readonly id: string;
  /** Delivered video's extension. */
  readonly ext: "mp4" | "mov";
  /** Appended to the preamble's first deliverable bullet. */
  readonly deliverExtra?: string;
  readonly canvas: {
    readonly w: number;
    readonly h: number;
    readonly fps: number;
    /** Exact `durationFrames`, or the least the brief allows. */
    readonly frames: number | { readonly atLeast: number };
  };
  /** Writes the inputs the brief names into `dir`. */
  inputs(dir: string): Promise<void>;
  /** The assertions the delivery must satisfy, written over the agent's own. */
  assertions(ctx: CheckContext): Assertion[] | Promise<Assertion[]>;
  /** Everything else the brief asks for that a reading can decide. */
  observe(ctx: CheckContext): Promise<Criterion[]>;
  /** The parts of the brief no criterion reads, said rather than implied. */
  readonly unchecked?: readonly string[];
}
