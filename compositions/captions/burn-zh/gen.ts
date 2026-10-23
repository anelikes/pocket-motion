#!/usr/bin/env bun
/**
 * captions/burn-zh — a sample of the `captions` job template. Everything it draws
 * comes from `spec.default.json` and the transcript it names; the generator
 * is `src/captions/template.ts`, and this file only says where the sample is.
 *
 *   bun compositions/captions/burn-zh/gen.ts
 *   bun src/cli/main.ts render compositions/captions/burn-zh --spec job.json --out out.mov --format mov --alpha
 */

import { runSampleGenerator, stageCaptionsJob } from "../../../src/captions/template.ts";

export const stageJob = stageCaptionsJob;

if (import.meta.main) {
  await runSampleGenerator(new URL(".", import.meta.url).pathname, process.argv.slice(2));
}
