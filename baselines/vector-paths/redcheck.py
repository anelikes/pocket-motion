#!/usr/bin/env python3
"""Introduce each defect, run the test that should catch it, revert.

    python3 -I redcheck.py <tree>/engine/core [mutation name ...]

<tree> is a pocketjs checkout with patches/0001-0043 applied (the stage-1
prototype tree's anchors are in this file's history, commit ec26435).

Prints one line per mutation: RED (the guard caught it), GREEN (it did not),
or SKIP (its anchor is not found exactly once, so it did not run). Names
after the path run only those mutations. Nothing else may build the tree
while this runs: each defect is written into the source and restored after.
"""
import os
import subprocess
import sys

ROOT = sys.argv[1]  # engine/core of the scratch clone
# rustup's cargo, not whatever is first on PATH (scripts/vendor.ts says why).
try:
    _cargo = subprocess.run(["rustup", "which", "cargo"], capture_output=True, text=True, check=True).stdout.strip()
    CARGO_ENV = dict(os.environ, PATH=os.path.dirname(_cargo) + ":" + os.environ["PATH"])
except (OSError, subprocess.CalledProcessError):
    CARGO_ENV = dict(os.environ)

MUTATIONS = [
    # (name, file, old, new, test filter)
    ("first crossing rounded down", "src/raster.rs",
     "let c0 = ceil_div(num, d);",
     "let c0 = num.div_euclid(d);",
     "path_coverage_equals_the_brute_force_reference"),
    ("DDA carry on zero remainder", "src/raster.rs",
     "let carry = (e.rem < 0) as i32;",
     "let carry = (e.rem <= 0) as i32;",
     "path_coverage_equals_the_brute_force_reference"),
    ("closed y range (Y <= ybot)", "src/raster.rs",
     "let r1 = (ceil_div(b.1 - 32, 64) as i32 - 1).min(rhi - 1);",
     "let r1 = ((b.1 - 32).div_euclid(64) as i32).min(rhi - 1);",
     "path_coverage_equals_the_brute_force_reference"),
    ("closed y range vs partition", "src/raster.rs",
     "let r1 = (ceil_div(b.1 - 32, 64) as i32 - 1).min(rhi - 1);",
     "let r1 = ((b.1 - 32).div_euclid(64) as i32).min(rhi - 1);",
     "abutting_paths_partition"),
    ("sweep: partial head miscounted", "src/raster.rs",
     "let head = k * (4 - (prev & 3)) as u32;",
     "let head = k * (3 - (prev & 3)) as u32;",
     "path_coverage_equals_the_brute_force_reference"),
    ("sweep: full run one pixel short", "src/raster.rs",
     "emit(py, (pa + 1) as i32, pb as i32, 4 * k);",
     "emit(py, (pa + 1) as i32, pb as i32 - 1, 4 * k);",
     "path_coverage_equals_the_brute_force_reference"),
    ("merge drops a tail", "src/raster.rs",
     "    out.extend_from_slice(&a[i..]);\n    out.extend_from_slice(&b[j..]);",
     "    out.extend_from_slice(&a[i..]);",
     "path_coverage_equals_the_brute_force_reference"),
    ("sample lattice offset 32 -> 16", "src/raster.rs",
     "let y = 64 * r0 as i64 + 32;",
     "let y = 64 * r0 as i64 + 16;",
     "convex_path_counts_what_poly_counts"),
    ("scale ignored", "src/raster.rs",
     "let sc = scale as i64;",
     "let sc = 1i64;",
     "convex_path_counts_what_poly_counts"),
    ("partial opaque pixel filled as opaque", "src/raster.rs",
     "if h >= 16 && opaque {",
     "if h >= 15 && opaque {",
     "path_blends_each_pixel"),
    ("outer join on the inner side", "src/path.rs",
     "    let outer = if side > 0.0 { a_outer } else { !a_outer };\n    let c = s0.n.x",
     "    let outer = if side > 0.0 { !a_outer } else { a_outer };\n    let c = s0.n.x",
     "stroke_outline_fills_to_exactly_the_union"),
    ("inner meet regardless of length", "src/path.rs",
     "let inside = dot > 0.0 && hw * sin * 1.125 <= short;",
     "let inside = dot > 0.0;",
     "stroke_outline_fills_to_exactly_the_union"),
    ("inner meet without the length margin", "src/path.rs",
     "let inside = dot > 0.0 && hw * sin * 1.125 <= short;",
     "let inside = dot > 0.0 && hw * sin * 0.25 <= short;",
     "stroke_outline_fills_to_exactly_the_union"),
    ("round join merged too eagerly", "src/path.rs",
     "let g = 1.0 + tol / (32.0 * hw);",
     "let g = 1.0 + tol * 4.0 / hw;",
     "stroke_outline_fills_to_exactly_the_union"),
    ("miter merged past its limit", "src/path.rs",
     "                k >= 2.0 / (lim * lim) && k > 0.0\n            }",
     "                k > 0.0\n            }",
     "miter_tip_sits"),
    ("round arcs: no bisection", "src/path.rs",
     "const ARC_MAX_LEVELS: u32 = 7;",
     "const ARC_MAX_LEVELS: u32 = 0;",
     "round_stroke_is_the_true_offset"),
    ("round cap faces backward", "src/path.rs",
     "arc(out, o, hw, n, d, d, levels);\n            out.push(pt(o.x + d.x * hw, o.y + d.y * hw));",
     "arc(out, o, hw, n, pt(-d.x, -d.y), d, levels);\n            out.push(pt(o.x - d.x * hw, o.y - d.y * hw));",
     "round_stroke_is_the_true_offset"),
    ("bevelled miter drawn as a miter", "src/path.rs",
     "            if k >= 2.0 / (lim * lim) && k > 0.0 {",
     "            if k > 0.0 {",
     "miter_tip_sits"),
    ("full trim window not short-circuited", "src/path.rs",
     "        if e - s >= 1.0 {\n            return Some(None);\n        }",
     "",
     "a_trim_window_of_the_whole_length"),
    ("wrapped closed piece split in two", "src/path.rs",
     "if wraps && sub.closed {",
     "if false {",
     "trimmed_length_is_the_window"),
    ("trim cut not interpolated", "src/path.rs",
     "(lerp_pt(a, b, u), j)",
     "(a, j)",
     "trimmed_length_is_the_window"),
    ("morph lerp inexact at its end", "src/path.rs",
     "out.push(pt(a[2 * i] * g + b[2 * i] * f, a[2 * i + 1] * g + b[2 * i + 1] * f));",
     "out.push(pt(a[2 * i] + (b[2 * i] - a[2 * i]) * f, a[2 * i + 1] + (b[2 * i + 1] - a[2 * i + 1]) * f));",
     "morph_at_a_key"),
    ("morph key off by one", "src/path.rs",
     "let a = &self.coords[2 * n * k..2 * n * (k + 1)];",
     "let k = if k > 0 { k - 1 } else { k };\n        let a = &self.coords[2 * n * k..2 * n * (k + 1)];",
     "morph_at_a_key"),
    ("scale bound by row norm", "src/path.rs",
     "    sqrtf(xf.a * xf.a + xf.b * xf.b + xf.c * xf.c + xf.d * xf.d)\n}",
     "    let r0 = if xf.a < 0.0 { -xf.a } else { xf.a } + if xf.c < 0.0 { -xf.c } else { xf.c };\n    let r1 = if xf.b < 0.0 { -xf.b } else { xf.b } + if xf.d < 0.0 { -xf.d } else { xf.d };\n    if r0 > r1 { r0 } else { r1 }\n}",
     "chord_count_does_not_follow_rotation"),
    ("Wang bound quartered", "src/path.rs",
     "let q = 0.5625 * m2 / (tol * tol);",
     "let q = 0.140625 * m2 / (tol * tol);",
     "flattened_curve_stays_within_tolerance"),
    ("no guard clip", "src/path.rs",
     "        if bx0 < x0 || by0 < y0 || bx1 > x1 || by1 > y1 {\n            let b",
     "        if false {\n            let b",
     "emitted_coordinates_stay_inside_the_guard"),
    ("damage does not know PATH", "src/damage.rs",
     "            spec::draw_op::PATH => {\n                let n = self.words.get(start + 1)",
     "            999 => {\n                let n = self.words.get(start + 1)",
     "damage_tracking_decodes_path"),
    ("damage bounds short by a pixel", "src/damage.rs",
     "            max_x = max_x.max((x + 255).div_euclid(256) as i32);",
     "            max_x = max_x.max(x.div_euclid(256) as i32 - 1);",
     "damage_tracking_decodes_path"),
    ("table: first verb not checked", "src/path.rs",
     "if shapes.is_empty() || shapes.len() > PATH_MAX_SHAPES || verbs.first() != Some(&VERB_MOVE) {",
     "if shapes.is_empty() || shapes.len() > PATH_MAX_SHAPES {",
     "path_table_round_trips"),
    ("walk ignores the trim", "src/draw.rs",
     "                path::emit_stroke(&mut dl.words, &xf, tol, stroke, &style, &trim, self.screen, &mut sc);",
     "                path::emit_stroke(&mut dl.words, &xf, tol, stroke, &style, &path::Trim::NONE, self.screen, &mut sc);",
     "trim_end_animates_through"),
    ("bg-clip-path paints the box too", "src/draw.rs",
     "        let clip_text = (r.bg_clip == spec::BgClip::Text as u8 && node.node_type == spec::NodeType::Text as u8) || clip_path;",
     "        let clip_text = r.bg_clip == spec::BgClip::Text as u8 && node.node_type == spec::NodeType::Text as u8;",
     "bg_clip_path_paints"),
    ("hidden node still draws its path", "src/draw.rs",
     "        // still whatever layout last wrote.\n        if slot == self.hide_slot {\n            return;\n        }",
     "        // still whatever layout last wrote.",
     "debug_hide_removes_both"),
    ("table: shape count not bounded", "src/path.rs",
     "if shapes.is_empty() || shapes.len() > PATH_MAX_SHAPES || verbs.first() != Some(&VERB_MOVE) {",
     "if shapes.is_empty() || verbs.first() != Some(&VERB_MOVE) {",
     "path_table_round_trips"),
    # Added at the landing (patches/0042).
    ("compositor op table does not know PATH", "src/compositor.rs",
     "        crate::spec::draw_op::PATH => Some(*words.get(at + 1)? as usize).filter(|&n| n >= raster::PATH_HEADER)?,\n",
     "",
     "every_draw_list_walker_steps_over_a_path"),
    ("surface-frame walk does not know PATH", "src/lib.rs",
     "                x if x == spec::draw_op::PATH => {",
     "                x if x == 0xffff_ffff => {",
     "every_draw_list_walker_steps_over_a_path"),
    ("table count read but entries skipped", "src/style.rs",
     "        let (paths, _) = crate::path::PathTable::parse(bytes, o, path_count)?;",
     "        let (paths, _) = crate::path::PathTable::parse(bytes, o, 0)?;\n        let _ = path_count;",
     "a_style_table_without_paths_is_the_same_bytes_and_a_truncated_one_is_refused"),
    ("the scenes' mask in the format 0024 replaced", "src/path_scenes.rs",
     "    for &(x, y) in pts {\n        words.push(x.to_bits());\n        words.push(y.to_bits());\n    }",
     "    for &(x, y) in pts {\n        words.push(x as u32 | ((y as u32) << 16));\n    }",
     "path_under_a_mask_is_the_rect_under_that_mask"),
    ("gradient fill painted without its PAINT_PUSH", "src/draw.rs",
     "            if clip_path && grad {",
     "            if false {",
     "bg_clip_path_paints"),
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
