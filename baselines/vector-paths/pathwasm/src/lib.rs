//! Exports for the wasm run: scene digests and the dense-frame timings.

use pocketjs_core::draw::Affine;
use pocketjs_core::path::{PathEntry, PathStats};
use pocketjs_core::path_scenes as ps;

pub struct Dense {
    pub entries: Vec<(PathEntry, Affine, u32, u32, f32)>,
    pub words: Vec<u32>,
    pub stats: PathStats,
    pub fb: Vec<u8>,
}

pub const KINDS: [ps::Dense; 3] = [ps::Dense::Spiky, ps::Dense::Smooth, ps::Dense::LineArt];

impl Dense {
    pub fn new(kind: ps::Dense) -> Dense {
        Dense { entries: ps::dense_entries_of(kind), words: Vec::new(), stats: PathStats::default(), fb: Vec::new() }
    }

    /// Geometry for one frame: morph, flatten, trim, stroke, emit.
    pub fn emit(&mut self, frame: u32) -> usize {
        let (w, st) = ps::dense_words(&self.entries, frame);
        self.words = w;
        self.stats = st;
        self.words.len()
    }

    /// Rasterise the last emitted frame.
    pub fn raster(&mut self, scale: u32) -> u64 {
        self.fb = ps::render(&self.words, ps::DENSE_W, ps::DENSE_H, scale);
        self.fb.iter().step_by(4099).map(|&b| b as u64).sum()
    }

    /// `ui_draw_hash` over the last words (FNV-1a over their bytes, as
    /// engine/wasm/src/lib.rs computes it).
    pub fn draw_hash(&self) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for word in &self.words {
            for byte in word.to_le_bytes() {
                hash ^= byte as u64;
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        hash
    }
}

static mut DENSE: Option<Dense> = None;

#[allow(static_mut_refs)]
fn dense() -> &'static mut Dense {
    unsafe { DENSE.as_mut().unwrap() }
}

#[no_mangle]
pub extern "C" fn scene_count() -> u32 {
    ps::SCENE_NAMES.len() as u32
}

#[no_mangle]
pub extern "C" fn scene_words_digest(i: u32) -> u64 {
    ps::scene_digest(i as usize).0
}

#[no_mangle]
pub extern "C" fn scene_fb_digest(i: u32) -> u64 {
    ps::scene_digest(i as usize).1
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn dense_load(kind: u32) {
    unsafe { DENSE = Some(Dense::new(KINDS[kind as usize])) }
}

#[no_mangle]
pub extern "C" fn dense_emit(frame: u32) -> u32 {
    dense().emit(frame) as u32
}

#[no_mangle]
pub extern "C" fn dense_raster(scale: u32) -> u64 {
    dense().raster(scale)
}

#[no_mangle]
pub extern "C" fn dense_hash() -> u64 {
    dense().draw_hash()
}

#[no_mangle]
pub extern "C" fn dense_chords() -> u32 {
    dense().stats.chords as u32
}

#[no_mangle]
pub extern "C" fn dense_vertices() -> u32 {
    dense().stats.vertices as u32
}
