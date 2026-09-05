
// ---- poly sweep (measurement harness, not part of either tree) ----------------
// Appended identically to two copies of tests.rs: the vendored core at the pin
// with patches/0008 (design A) and pocket-stack/pocketjs#301 at 20b663c
// (design B). Each case builds one scene through the same test helpers, ticks,
// hashes the draw list words and the software-rasterised RGBA framebuffer, and
// writes one line per case to $POLY_SWEEP_OUT. $POLY_SWEEP_DUMP=<id> also
// writes that case's raw framebuffer beside it.

fn sweep_hash(bytes: &[u8]) -> u64 {
    // FNV-1a 64: no dependency, same on both sides.
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn sweep_words_bytes(words: &[u32]) -> alloc::vec::Vec<u8> {
    let mut out = alloc::vec::Vec::with_capacity(words.len() * 4);
    for w in words {
        out.extend_from_slice(&w.to_le_bytes());
    }
    out
}

struct SweepCase {
    desc: alloc::string::String,
    build: alloc::boxed::Box<dyn Fn(&mut Ui)>,
}

fn sweep_cases() -> alloc::vec::Vec<SweepCase> {
    use alloc::boxed::Box;
    use alloc::format;
    let mut cases: alloc::vec::Vec<SweepCase> = alloc::vec::Vec::new();
    let mut add = |desc: alloc::string::String, f: Box<dyn Fn(&mut Ui)>| {
        cases.push(SweepCase { desc, build: f });
    };
    fn centred(ui: &mut Ui, w: f64, h: f64) -> i32 {
        place_box(ui, w, h, 240.0 - w / 2.0, 136.0 - h / 2.0)
    }

    // 1. sizes × angles, opaque white, centred
    let sizes: [(f64, f64); 11] = [
        (1.0, 1.0), (2.0, 3.0), (5.0, 5.0), (9.0, 4.0), (16.0, 16.0), (31.0, 17.0),
        (64.0, 40.0), (120.0, 56.0), (200.0, 100.0), (300.0, 150.0), (400.0, 260.0),
    ];
    let angles: [f64; 23] = [
        0.0, 0.5, 1.0, 7.0, 13.0, 20.0, 30.0, 33.3, 45.0, 60.0, 75.0, 89.0, 90.0, 91.0,
        120.0, 135.0, 150.0, 180.0, 200.0, 225.0, 270.0, 315.0, 359.5,
    ];
    for &(w, h) in sizes.iter() {
        for &a in angles.iter() {
            add(format!("white {w}x{h} rot {a}"), Box::new(move |ui| {
                let n = centred(ui, w, h);
                ui.set_prop(n, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
                ui.set_prop(n, spec::prop::ROTATE, a);
            }));
        }
    }

    // 2. colours and alpha
    let colours: [(&str, u32); 5] = [
        ("red", abgr(255, 0, 0, 255)),
        ("blue a128", abgr(0, 0, 255, 128)),
        ("white a1", abgr(255, 255, 255, 1)),
        ("green a200", abgr(0, 200, 40, 200)),
        ("grey a77", abgr(90, 90, 90, 77)),
    ];
    for &(w, h) in [(120.0, 56.0), (31.0, 17.0)].iter() {
        for &a in [20.0, 33.3, 45.0, 89.0].iter() {
            for &(name, c) in colours.iter() {
                add(format!("{name} {w}x{h} rot {a}"), Box::new(move |ui| {
                    let n = centred(ui, w, h);
                    ui.set_prop(n, spec::prop::BG_COLOR, c as f64);
                    ui.set_prop(n, spec::prop::ROTATE, a);
                }));
            }
        }
    }

    // 3. sub-pixel placement
    for &fx in [0.0, 0.125, 0.25, 0.5, 0.75, 0.9].iter() {
        for &fy in [0.0, 0.3, 0.5].iter() {
            add(format!("white 120x56 rot 20 at +{fx},+{fy}"), Box::new(move |ui| {
                let n = place_box(ui, 120.0, 56.0, 180.0 + fx, 108.0 + fy);
                ui.set_prop(n, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
                ui.set_prop(n, spec::prop::ROTATE, 20.0);
            }));
        }
    }

    // 4. scale with rotation
    for &s in [0.01, 0.3, 0.5, 1.0, 1.7, 3.0].iter() {
        for &a in [0.0, 20.0, 45.0].iter() {
            add(format!("white 120x56 rot {a} scale {s}"), Box::new(move |ui| {
                let n = centred(ui, 120.0, 56.0);
                ui.set_prop(n, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
                ui.set_prop(n, spec::prop::ROTATE, a);
                ui.set_prop(n, spec::prop::SCALE, s);
            }));
        }
    }
    add(format!("white 120x56 rot 20 scale_x 2"), Box::new(move |ui| {
        let n = centred(ui, 120.0, 56.0);
        ui.set_prop(n, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
        ui.set_prop(n, spec::prop::ROTATE, 20.0);
        ui.set_prop(n, spec::prop::SCALE_X, 2.0);
    }));

    // 5. rounded corners under rotation
    for &r in [4.0, 12.0, 28.0].iter() {
        for &a in [0.0, 20.0, 45.0].iter() {
            add(format!("white 120x56 radius {r} rot {a}"), Box::new(move |ui| {
                let n = centred(ui, 120.0, 56.0);
                ui.set_prop(n, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
                ui.set_prop(n, spec::prop::RADIUS, r);
                ui.set_prop(n, spec::prop::ROTATE, a);
            }));
        }
    }

    // 6. node opacity
    for &o in [0.5, 0.1].iter() {
        add(format!("white 120x56 rot 20 opacity {o}"), Box::new(move |ui| {
            let n = centred(ui, 120.0, 56.0);
            ui.set_prop(n, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
            ui.set_prop(n, spec::prop::ROTATE, 20.0);
            ui.set_prop(n, spec::prop::OPACITY, o);
        }));
    }

    // 7. partly off screen
    for &(x, y) in [(-40.0, 100.0), (440.0, 100.0), (200.0, -20.0), (200.0, 250.0), (-30.0, -20.0)].iter() {
        add(format!("white 120x56 rot 25 at {x},{y} (clipped)"), Box::new(move |ui| {
            let n = place_box(ui, 120.0, 56.0, x, y);
            ui.set_prop(n, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
            ui.set_prop(n, spec::prop::ROTATE, 25.0);
        }));
    }

    // 8. inside an overflow-hidden parent
    add(format!("rotated child under overflow-hidden parent"), Box::new(move |ui| {
        let p = place_box(ui, 100.0, 60.0, 200.0, 100.0);
        ui.set_prop(p, spec::prop::OVERFLOW, spec::Overflow::Hidden as u32 as f64);
        ui.set_prop(p, spec::prop::BG_COLOR, abgr(40, 40, 40, 255) as f64);
        let c = ui.create_node(0);
        ui.set_prop(c, spec::prop::WIDTH, 150.0);
        ui.set_prop(c, spec::prop::HEIGHT, 80.0);
        ui.set_prop(c, spec::prop::POS_TYPE, spec::PosType::Absolute as u32 as f64);
        ui.set_prop(c, spec::prop::INSET_L, -20.0);
        ui.set_prop(c, spec::prop::INSET_T, -10.0);
        ui.set_prop(c, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
        ui.set_prop(c, spec::prop::ROTATE, 30.0);
        ui.insert_before(p, c, 0);
    }));

    // 9. two overlapping rotated boxes with alpha
    add(format!("white rot 20 under red a128 rot -35"), Box::new(move |ui| {
        let a = centred(ui, 160.0, 70.0);
        ui.set_prop(a, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
        ui.set_prop(a, spec::prop::ROTATE, 20.0);
        let b = centred(ui, 140.0, 90.0);
        ui.set_prop(b, spec::prop::BG_COLOR, abgr(255, 0, 0, 128) as f64);
        ui.set_prop(b, spec::prop::ROTATE, -35.0);
    }));

    // 10. 3D: a perspective root with a rotate_y child
    for &ry in [20.0, 40.0, 60.0, 85.0].iter() {
        add(format!("perspective 800 child rotate_y {ry}"), Box::new(move |ui| {
            let p = centred(ui, 300.0, 200.0);
            ui.set_prop(p, spec::prop::PERSPECTIVE, 800.0);
            let c = ui.create_node(0);
            ui.set_prop(c, spec::prop::WIDTH, 160.0);
            ui.set_prop(c, spec::prop::HEIGHT, 90.0);
            ui.set_prop(c, spec::prop::POS_TYPE, spec::PosType::Absolute as u32 as f64);
            ui.set_prop(c, spec::prop::INSET_L, 70.0);
            ui.set_prop(c, spec::prop::INSET_T, 55.0);
            ui.set_prop(c, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
            ui.set_prop(c, spec::prop::ROTATE_Y, ry);
            ui.insert_before(p, c, 0);
        }));
    }

    // 11. border and shadow under rotation (box decoration)
    add(format!("white 120x56 rot 20 border 3"), Box::new(move |ui| {
        let n = centred(ui, 120.0, 56.0);
        ui.set_prop(n, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
        ui.set_prop(n, spec::prop::BORDER_WIDTH, 3.0);
        ui.set_prop(n, spec::prop::BORDER_COLOR, abgr(255, 0, 0, 255) as f64);
        ui.set_prop(n, spec::prop::ROTATE, 20.0);
    }));
    add(format!("white 120x56 rot 20 shadow 2"), Box::new(move |ui| {
        let n = centred(ui, 120.0, 56.0);
        ui.set_prop(n, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
        ui.set_prop(n, spec::prop::SHADOW, 2.0);
        ui.set_prop(n, spec::prop::ROTATE, 20.0);
    }));

    // 12. controls: a rotated gradient (TRI path, not POLY) and an axis-aligned box (RECT)
    add(format!("control: gradient 120x56 rot 20 (TRI)"), Box::new(move |ui| {
        let n = centred(ui, 120.0, 56.0);
        ui.set_prop(n, spec::prop::GRAD_FROM, abgr(255, 0, 0, 255) as f64);
        ui.set_prop(n, spec::prop::GRAD_TO, abgr(0, 0, 255, 255) as f64);
        ui.set_prop(n, spec::prop::GRAD_DIR, spec::GradDir::ToRight as u32 as f64);
        ui.set_prop(n, spec::prop::ROTATE, 20.0);
    }));
    add(format!("control: white 120x56 rot 0 (RECT)"), Box::new(move |ui| {
        let n = centred(ui, 120.0, 56.0);
        ui.set_prop(n, spec::prop::BG_COLOR, abgr(255, 255, 255, 255) as f64);
    }));

    cases
}

#[test]
fn poly_sweep() {
    use std::io::Write;
    let out = match std::env::var("POLY_SWEEP_OUT") {
        Ok(p) => p,
        Err(_) => return, // not a test of either tree; runs only when asked
    };
    let dump = std::env::var("POLY_SWEEP_DUMP").ok();
    let mut f = std::fs::File::create(&out).expect("open POLY_SWEEP_OUT");
    let mut polys = 0usize;
    for (id, case) in sweep_cases().into_iter().enumerate() {
        let mut ui = Ui::new();
        (case.build)(&mut ui);
        ui.tick();
        let words = ui.draw().words.clone();
        let mut i = 0usize;
        let mut has_poly = false;
        while i < words.len() {
            match words[i] {
                spec::draw_op::RECT => i += 4,
                spec::draw_op::GRAD_RECT => i += 6,
                spec::draw_op::GLYPH_RUN => i += 3 + 2 * ((words[i + 1] >> 16) as usize),
                spec::draw_op::TEX_QUAD => i += 9,
                spec::draw_op::SCISSOR => i += 3,
                spec::draw_op::SCISSOR_POP => i += 1,
                spec::draw_op::TRI => i += 7,
                spec::draw_op::TEX_TRI => i += 12,
                spec::draw_op::POLY => { has_poly = true; i += 3 + words[i + 1] as usize }
                _ => break,
            }
        }
        if has_poly { polys += 1; }
        let fb = raster_fb(&mut ui);
        writeln!(
            f,
            "{id}\t{}\t{:016x}\t{:016x}\t{}",
            if has_poly { "POLY" } else { "----" },
            sweep_hash(&sweep_words_bytes(&words)),
            sweep_hash(&fb),
            case.desc
        )
        .unwrap();
        if dump.as_deref() == Some(&alloc::format!("{id}")) {
            std::fs::write(alloc::format!("{out}.{id}.rgba"), &fb).unwrap();
            std::fs::write(alloc::format!("{out}.{id}.words"), &sweep_words_bytes(&words)).unwrap();
        }
    }
    std::println!("poly_sweep: {polys} POLY cases written to {out}");
}
