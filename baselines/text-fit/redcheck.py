#!/usr/bin/env python3
"""Introduce each defect, run the test that should catch it, revert.

    python3 -I redcheck.py <tree>/engine/core [mutation name ...]

<tree> is a pocketjs checkout with patches/0001-0059 applied (the vendored
tree, `vendor/pocketjs`, after `bun scripts/vendor.ts`). The mutations are
patch 0059's core half — fit, wrap, clamp and the record paint and the host
read; `tests/text-fit.test.ts` holds the host half.

Prints one line per mutation: RED (the guard caught it), GREEN (it did not),
or SKIP (its anchor is not found exactly once, so it did not run). Names
after the path run only those mutations. Nothing else may build the tree
while this runs: each defect is written into the source and restored after.
"""
import os
import subprocess
import sys

ROOT = sys.argv[1]
# rustup's cargo, not whatever is first on PATH (scripts/vendor.ts says why).
try:
    _cargo = subprocess.run(["rustup", "which", "cargo"], capture_output=True, text=True, check=True).stdout.strip()
    CARGO_ENV = dict(os.environ, PATH=os.path.dirname(_cargo) + ":" + os.environ["PATH"])
except (OSError, subprocess.CalledProcessError):
    CARGO_ENV = dict(os.environ)

HOLDS = """            let holds = widest <= max_w
                && lines as f32 * lh <= max_h
                && (spec.clamp == 0 || lines <= spec.clamp as usize)
                && w.split == 0;"""

MUTATIONS = [
    # (name, file, old, new, test filter)
    ("a block's height is not a bound", "src/text_fit.rs", HOLDS,
     HOLDS.replace("                && lines as f32 * lh <= max_h\n", ""),
     "a_block_too_tall_for_its_box_gives_way_to_the_next_rung"),
    ("a rung that cuts a segment holds", "src/text_fit.rs", HOLDS,
     HOLDS.replace("\n                && w.split == 0;", ";"),
     "a_rung_that_must_cut_a_segment_does_not_hold"),
    ("U+200B is part of a segment", "src/text_fit.rs",
     "                if c == ' ' || c == BREAK_MARK {\n                    break;",
     "                if c == ' ' {\n                    break;",
     "a_line_breaks_at_spaces_and_u200b_and_u200b_is_never_drawn"),
    ("the clamp counts nothing it drops", "src/text_fit.rs",
     "                dropped += line.chars().filter(|&c| c != ' ').count() as u32;",
     "                let _ = line;",
     "a_clamp_keeps_its_lines_ends_with_an_ellipsis_and_counts_what_it_left_out"),
    ("the ellipsis never shortens its line", "src/text_fit.rs",
     "                if width <= max_w || kept.is_empty() {",
     "                if true {",
     "a_clamp_keeps_its_lines_ends_with_an_ellipsis_and_counts_what_it_left_out"),
    ("a mark is cut from its base", "src/text_fit.rs",
     "                    if !is_mark(c) {\n                        break;\n                    }",
     "                    break;",
     "a_clamp_keeps_its_lines_ends_with_an_ellipsis_and_counts_what_it_left_out"),
    ("the pen leaves tracking out", "src/text_fit.rs",
     "(self.width + (pair + adv + self.tracking), gid)",
     "(self.width + (pair + adv), gid)",
     "a_fitted_block_measures_as_its_laid_out_text"),
    ("the clamped line's old width is kept", "src/text_fit.rs",
     "            let mut last = w.lines.pop().unwrap_or_default();\n            w.widths.pop();",
     "            let mut last = w.lines.pop().unwrap_or_default();",
     "a_fitted_block_measures_as_its_laid_out_text"),
    ("paint draws the style's slot", "src/draw.rs",
     "            slot = fit.slot;\n",
     "",
     "layout_records_the_fit_and_paint_draws_it"),
    ("a node's height is never a bound", "src/layout.rs",
     "    (spec, !r.height.is_nan() || !r.max_h.is_nan())",
     "    (spec, false)",
     "layout_records_the_fit_and_paint_draws_it"),
    ("readback fits an unbounded height", "src/layout.rs",
     "                let h = l.size.height - ((l.padding.top + l.border.top) + (l.padding.bottom + l.border.bottom));",
     "                let h = f32::INFINITY;",
     "layout_records_the_fit_and_paint_draws_it"),
    ("the ladder ends at the first word", "src/text_fit.rs",
     "for byte in bytes.iter().flatten().copied().take(spec::TEXT_FIT_MAX_RUNGS) {",
     "for byte in bytes[0].iter().copied() {",
     "the_ladder_unpacks_from_its_two_words"),
]


def run(test):
    r = subprocess.run(["cargo", "test", "--offline", "--lib", test], cwd=ROOT, env=CARGO_ENV,
                       capture_output=True, text=True)
    out = r.stdout + r.stderr
    if "error[" in out or "could not compile" in out:
        return "BUILD-ERROR"
    if "0 passed; 0 failed" in out and "1 passed" not in out:
        return "NO-TEST"
    return "GREEN" if r.returncode == 0 else "RED"


def main():
    base = run("text_fit")
    print(f"baseline: {base}")
    only = set(sys.argv[2:])
    for name, f, old, new, test in MUTATIONS:
        if only and name not in only:
            continue
        path = os.path.join(ROOT, f)
        src = open(path, encoding="utf-8").read()
        if src.count(old) != 1:
            print(f"SKIP  {name}: anchor found {src.count(old)} times")
            continue
        open(path, "w", encoding="utf-8").write(src.replace(old, new))
        try:
            verdict = run(test)
        finally:
            open(path, "w", encoding="utf-8").write(src)
        print(f"{verdict:5} {name}  [{test}]", flush=True)


main()
