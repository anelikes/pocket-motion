/**
 * Run by `tests/isolation.test.ts` as a `bun test` of its own, so what the
 * preload decides can be watched from outside the process it decides it for.
 * Not discovered by `bun test ./tests/`: the name carries no `.test.`.
 */

import { test } from "bun:test";

import { SCRATCH_ROOT, scratchDir } from "../scratch.ts";

test("probe", () => {
  console.log(`probe ran; scratch root ${SCRATCH_ROOT}; dir ${scratchDir("probe")}`);
});
