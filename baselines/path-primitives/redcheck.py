#!/usr/bin/env python3
"""Introduce each defect, run the test that should catch it, revert.

    python3 -I redcheck.py <tree>/engine/core [mutation name ...]

<tree> is a pocketjs checkout with patches/0001-0045 applied (the vendored
tree, `vendor/pocketjs`, after `bun scripts/vendor.ts`). The mutations are
the core half of patch 0045's dashes; `redcheck-ts.ts` beside this file
holds the compiler half and patch 0046's morph equalisation.

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

PHASE = "let phase = if offset.is_finite() { offset - crate::layout::floorf(offset / period) * period } else { 0.0 };"
SPANS = "dash_spans(&pat, m, period, d.offset, total, sub.closed, &mut budget, &mut sc.dashes);"

MUTATIONS = [
    # (name, file, old, new, test filter)
    ("a zero gap does not join its dashes", "src/path.rs",
     "            out.push((a, b));\n            joins = gap == 0.0;",
     "            out.push((a, b));\n            joins = false;",
     "a_solid_pattern_is_the_trim_byte_for_byte"),
    ("a zero gap does not join (positions)", "src/path.rs",
     "            out.push((a, b));\n            joins = gap == 0.0;",
     "            out.push((a, b));\n            joins = false;",
     "dashes_lie_where_the_pattern_puts_them"),
    ("a zero period is a pattern", "src/path.rs",
     "if !(period > 0.0) || !period.is_finite() {",
     "if !period.is_finite() {",
     "a_solid_pattern_is_the_trim_byte_for_byte"),
    ("a negative length is a pattern", "src/path.rs",
     "if !(v >= 0.0) || !v.is_finite() {",
     "if !v.is_finite() {",
     "a_solid_pattern_is_the_trim_byte_for_byte"),
    ("the phase runs backward", "src/path.rs",
     PHASE,
     "let phase = if offset.is_finite() { -offset - crate::layout::floorf(-offset / period) * period } else { 0.0 };",
     "dashes_lie_where_the_pattern_puts_them"),
    ("an odd count is not repeated", "src/path.rs",
     "let m = if n % 2 == 1 { 2 * n } else { n };",
     "let m = n;",
     "dashes_lie_where_the_pattern_puts_them"),
    ("a zero-length dash is dropped", "src/path.rs",
     "                if a == b {\n                    if a >= sa && a <= sb {",
     "                if a == b {\n                    if false {",
     "dashes_lie_where_the_pattern_puts_them"),
    ("a zero-length dash is dropped (dots)", "src/path.rs",
     "                if a == b {\n                    if a >= sa && a <= sb {",
     "                if a == b {\n                    if false {",
     "a_zero_length_dash_is_a_dot_of_its_caps"),
    ("the dash over a closed start is two pieces", "src/path.rs",
     "let wraps = sub.closed && n >= 2",
     "let wraps = false && sub.closed && n >= 2",
     "a_dash_over_a_closed_subpaths_start_is_one_piece"),
    ("the pattern runs on across subpaths", "src/path.rs",
     SPANS,
     "dash_spans(&pat, m, period, d.offset + sub_base, total, sub.closed, &mut budget, &mut sc.dashes);",
     "dashes_restart_on_every_subpath"),
    ("dashes measured from the trim window", "src/path.rs",
     SPANS,
     "dash_spans(&pat, m, period, d.offset - sc.spans[0].0, total, sub.closed, &mut budget, &mut sc.dashes);",
     "trim_start_only_removes_samples_from_a_dashed_stroke"),
    ("a dot wound the other way", "src/path.rs",
     "    let n = pt(-d.y, d.x);\n    out.pts.push(pt(o.x + n.x * hw, o.y + n.y * hw));",
     "    let n = pt(d.y, -d.x);\n    out.pts.push(pt(o.x + n.x * hw, o.y + n.y * hw));",
     "a_zero_length_dash_is_a_dot_of_its_caps"),
    ("a dot sized by its width as radius", "src/path.rs",
     "fn stroke_dot(o: Pt, d: Pt, s: &StrokeStyle, tol: f32, out: &mut Contours) {\n    let hw = s.width * 0.5;",
     "fn stroke_dot(o: Pt, d: Pt, s: &StrokeStyle, tol: f32, out: &mut Contours) {\n    let hw = s.width;",
     "a_zero_length_dash_is_a_dot_of_its_caps"),
    ("the phase is not reduced by the period", "src/path.rs",
     PHASE,
     "let phase = if offset.is_finite() { offset } else { 0.0 };",
     "a_dash_offset_of_one_period_draws_the_same_dashes"),
    ("no piece budget", "src/path.rs",
     "let mut budget = DASH_MAX_PIECES;",
     "let mut budget = usize::MAX;",
     "a_pattern_finer_than_its_outline_stops_at_the_budget"),
    ("the walk passes no pattern", "src/draw.rs",
     "let dash = path::Dash { count: r.dash_count, lens: r.dashes, offset: r.dash_offset };",
     "let dash = path::Dash::NONE;",
     "dash_offset_animates_through_the_anim_machinery"),
    ("dashOffset is not resolved", "src/style.rs",
     "p::DASH_OFFSET => self.dash_offset = f,",
     "p::DASH_OFFSET => {}",
     "dash_offset_animates_through_the_anim_machinery"),
]


def run(test):
    r = subprocess.run(["cargo", "test", "--release", "--lib", test], cwd=ROOT, env=CARGO_ENV,
                       capture_output=True, text=True)
    out = r.stdout + r.stderr
    if "error[" in out or "could not compile" in out:
        return "BUILD-ERROR"
    if "0 passed; 0 failed" in out and "1 passed" not in out:
        return "NO-TEST"
    return "GREEN" if r.returncode == 0 else "RED"


def main():
    base = run("path_tests")
    print(f"baseline: {base}")
    only = set(sys.argv[2:])
    for name, f, old, new, test in MUTATIONS:
        if only and name not in only:
            continue
        path = os.path.join(ROOT, f)
        src = open(path).read()
        if src.count(old) != 1:
            print(f"SKIP  {name}: anchor found {src.count(old)} times")
            continue
        open(path, "w").write(src.replace(old, new))
        try:
            verdict = run(test)
        finally:
            open(path, "w").write(src)
        print(f"{verdict:5} {name}  [{test}]", flush=True)


main()
