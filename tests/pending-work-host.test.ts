/**
 * The host's copy of the framework's pending-work readers (`patches/0003`).
 *
 * `check` reports "nothing scheduled" from `totalPendingWork`, so the copy is
 * held to two rules that keep that sentence about what was examined: a
 * registry the guest reports and this mirror does not name is still counted,
 * and a registry this mirror names and the guest did not report is counted as
 * outstanding rather than read as an empty queue. The guest side — that every
 * registry the frame pump drains is reported at all — is upstream's
 * `tests/pending-work.test.ts`, added by the same patch.
 */

import { describe, expect, test } from "bun:test";

import { copyPendingWork, PENDING_WORK_KEYS, totalPendingWork } from "../src/runtime/boot.ts";

const zero = (): Record<string, number> => Object.fromEntries(PENDING_WORK_KEYS.map((k) => [k, 0]));

describe("copyPendingWork / totalPendingWork", () => {
  test("every named registry zero is zero", () => {
    const w = copyPendingWork(zero());
    expect(totalPendingWork(w)).toBe(0);
    expect(w.missing).toEqual([]);
    expect(w.unrecognised).toEqual({});
  });

  test("each named registry counts", () => {
    for (const key of PENDING_WORK_KEYS) {
      expect(totalPendingWork(copyPendingWork({ ...zero(), [key]: 1 })), key).toBe(1);
    }
  });

  test("a registry the guest reports and the mirror does not name is still counted", () => {
    const w = copyPendingWork({ ...zero(), aQueueAddedUpstream: 2 });
    expect(w.unrecognised).toEqual({ aQueueAddedUpstream: 2 });
    expect(totalPendingWork(w)).toBe(2);
  });

  test("a named registry the guest did not report is outstanding, not empty", () => {
    const partial = zero();
    delete partial.modelTasks;
    const w = copyPendingWork(partial);
    expect(w.missing).toEqual(["modelTasks"]);
    expect(totalPendingWork(w)).toBe(1);
  });
});
