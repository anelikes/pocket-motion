#!/usr/bin/env bun
/**
 * Every composition in `baselines/digests.json`, rendered with
 * `render --workers N` and its digest held to the recorded one.
 *
 *   bun baselines/segments/ledger.ts [--workers 4] [--only a,b]
 *
 * Each composition is built through the CLI first, as the ledger builds it,
 * then rendered to an mp4 in a scratch directory that is removed afterwards.
 * Prints one line per composition and exits 1 on any mismatch or failure.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const workers = Number(arg("--workers") ?? "4");
const only = arg("--only")?.split(",");
const ledger = (await Bun.file("baselines/digests.json").json()) as {
  hash: string;
  compositions: Record<string, { frames: number; digest: string }>;
};
const scratch = mkdtempSync(join(tmpdir(), "segments-ledger-"));
let bad = 0;
try {
  for (const [dir, want] of Object.entries(ledger.compositions)) {
    if (only && !only.some((o) => dir.endsWith(o))) continue;
    const build = Bun.spawnSync(["bun", "src/cli/main.ts", "build", dir], { stdout: "pipe", stderr: "pipe" });
    if (build.exitCode !== 0) {
      console.log(`FAIL  ${dir}  build: ${build.stderr.toString().trim().split("\n").at(-1)}`);
      bad++;
      continue;
    }
    const t0 = performance.now();
    const r = Bun.spawnSync(
      ["bun", "src/cli/main.ts", "render", dir, "--workers", String(workers), "--out", join(scratch, "film.mp4"), "--json"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const sec = ((performance.now() - t0) / 1000).toFixed(1);
    let json: { ok?: boolean; digest?: string; error?: string; workers?: { count: number } } = {};
    try {
      json = JSON.parse(r.stdout.toString());
    } catch {
      json = { error: r.stderr.toString().trim() };
    }
    const ok = json.ok === true && json.digest === want.digest;
    if (!ok) bad++;
    console.log(
      `${ok ? "ok  " : "FAIL"}  ${dir}  ${want.frames} frames, ${json.workers?.count ?? "?"} workers, ${sec} s` +
        (ok ? "" : `  got ${json.digest ?? json.error}`),
    );
    rmSync(join(scratch, "film.mp4"), { force: true });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(bad === 0 ? "all equal to the ledger" : `${bad} differ or failed`);
process.exit(bad === 0 ? 0 : 1);
