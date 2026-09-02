/**
 * CheckpointLadder eviction — count cap, keep frame 0 unless max === 1.
 * A byte budget was withdrawn: it collapsed the ladder to the playhead snap
 * and made rewind throw.
 */

import { describe, expect, test } from "bun:test";
import {
  CHECKPOINT_LADDER_MAX,
  CheckpointLadder,
  type CoreSnapshot,
} from "../src/runtime/checkpoint.ts";

function snap(frame: number): CoreSnapshot {
  return { memory: new Uint8Array([frame & 0xff]), frame, bytes: 1 };
}

describe("CheckpointLadder bounds", () => {
  test("size never exceeds max; keeps frame 0 and the playhead", () => {
    const ladder = new CheckpointLadder(30, 4);
    for (const f of [0, 30, 60, 90, 120, 150]) {
      ladder.put(snap(f));
      expect(ladder.size).toBeLessThanOrEqual(4);
    }
    expect(ladder.size).toBe(4);
    expect(ladder.nearest(150)?.frame).toBe(150);
    expect(ladder.nearest(0)?.frame).toBe(0);
    expect(ladder.nearest(30)?.frame).toBe(0);
    expect(ladder.nearest(90)?.frame).toBe(90);
    expect(ladder.nearest(120)?.frame).toBe(120);
  });

  test("default max is the documented cap, not unbounded", () => {
    const ladder = new CheckpointLadder(30);
    expect(ladder.max).toBe(CHECKPOINT_LADDER_MAX);
    for (let f = 0; f <= 30 * 40; f += 30) ladder.put(snap(f));
    expect(ladder.size).toBe(CHECKPOINT_LADDER_MAX);
    expect(ladder.nearest(1200)?.frame).toBe(1200);
    expect(ladder.nearest(0)?.frame).toBe(0);
  });

  test("max 1 keeps only the latest snap", () => {
    const ladder = new CheckpointLadder(30, 1);
    ladder.put(snap(0));
    ladder.put(snap(30));
    expect(ladder.size).toBe(1);
    expect(ladder.nearest(30)?.frame).toBe(30);
    expect(ladder.nearest(0)).toBeUndefined();
  });

  test("rejects a non-positive max", () => {
    expect(() => new CheckpointLadder(30, 0)).toThrow(/max/);
  });
});
