//! Native: print the scene digests, then time the three dense frames.
use std::time::Instant;

use pathwasm::{Dense, KINDS};
use pocketjs_core::path_scenes as ps;

/// (min, median) in ms. The minimum is what the code costs; the median is
/// what a loaded machine charged for it.
fn time<R>(n: usize, mut f: impl FnMut() -> R) -> (f64, f64) {
    let mut t = Vec::new();
    for _ in 0..n {
        let s = Instant::now();
        std::hint::black_box(f());
        t.push(s.elapsed().as_secs_f64() * 1e3);
    }
    t.sort_by(|a, b| a.partial_cmp(b).unwrap());
    (t[0], t[t.len() / 2])
}

fn ms(v: (f64, f64)) -> String {
    format!("{:.2} ({:.2})", v.0, v.1)
}

fn main() {
    for i in 0..ps::SCENE_NAMES.len() {
        let (w, f) = ps::scene_digest(i);
        println!("digest {:2} {:016x} {:016x} {}", i, w, f, ps::SCENE_NAMES[i]);
    }
    for kind in KINDS {
        let mut d = Dense::new(kind);
        for (frame, label) in [(0u32, "static"), (17, "animated")] {
            let emit = time(25, || d.emit(frame));
            let hash = time(15, || d.draw_hash());
            let r1 = time(25, || d.raster(1));
            let r2 = time(15, || d.raster(2));
            println!(
                "{kind:?} {label}: min (median) ms: emit {} | raster x1 {} | raster x2 {} | draw hash {} | words {} | flattened points {} | contour vertices {}",
                ms(emit), ms(r1), ms(r2), ms(hash), d.words.len(), d.stats.chords, d.stats.vertices
            );
        }
    }
}
