// Faithful lift of vendor/pocketjs/engine/core/src/raster.rs `tri` + `orient`,
// against three coverage strategies. Integer-only throughout: the repo's frame
// identity forbids floats in the inner loop.
use std::time::Instant;

#[inline]
fn orient(ax: i64, ay: i64, bx: i64, by: i64, px: i64, py: i64) -> i64 {
    (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}

#[inline]
fn blend(buf: &mut [u8], off: usize, r: u32, g: u32, b: u32, a: u32) {
    let o = off * 4;
    if a >= 255 {
        buf[o] = r as u8; buf[o+1] = g as u8; buf[o+2] = b as u8; buf[o+3] = 255;
        return;
    }
    if a == 0 { return; }
    let inv = 255 - a;
    buf[o]   = ((r * a + buf[o]   as u32 * inv + 127) / 255) as u8;
    buf[o+1] = ((g * a + buf[o+1] as u32 * inv + 127) / 255) as u8;
    buf[o+2] = ((b * a + buf[o+2] as u32 * inv + 127) / 255) as u8;
    buf[o+3] = 255;
}

struct Tri { ax: i64, ay: i64, bx: i64, by: i64, cx: i64, cy: i64,
             min_x: i32, max_x: i32, min_y: i32, max_y: i32 }

fn setup(v: [(i32,i32);3], w: i32, h: i32) -> Option<Tri> {
    let (mut ax, mut ay) = (2*v[0].0 as i64, 2*v[0].1 as i64);
    let (mut bx, mut by) = (2*v[1].0 as i64, 2*v[1].1 as i64);
    let (mut cx, mut cy) = (2*v[2].0 as i64, 2*v[2].1 as i64);
    let area = orient(ax,ay,bx,by,cx,cy);
    if area == 0 { return None; }
    if area < 0 { std::mem::swap(&mut bx,&mut cx); std::mem::swap(&mut by,&mut cy); }
    let _ = &mut ax; let _ = &mut ay;
    Some(Tri { ax, ay, bx, by, cx, cy,
        min_x: v[0].0.min(v[1].0).min(v[2].0).max(0),
        max_x: v[0].0.max(v[1].0).max(v[2].0).min(w),
        min_y: v[0].1.min(v[1].1).min(v[2].1).max(0),
        max_y: v[0].1.max(v[1].1).max(v[2].1).min(h) })
}

// ---- A: current — one sample at the pixel centre, binary in/out -------------
fn tri_binary(buf: &mut [u8], stride: i32, t: &Tri, col: (u32,u32,u32,u32)) {
    let (r,g,b,a) = col;
    for py in t.min_y..t.max_y {
        let sy = 2*py as i64 + 1;
        for px in t.min_x..t.max_x {
            let sx = 2*px as i64 + 1;
            let w0 = orient(t.bx,t.by,t.cx,t.cy,sx,sy);
            let w1 = orient(t.cx,t.cy,t.ax,t.ay,sx,sy);
            let w2 = orient(t.ax,t.ay,t.bx,t.by,sx,sy);
            if w0 < 0 || w1 < 0 || w2 < 0 { continue; }
            blend(buf, (py*stride+px) as usize, r,g,b,a);
        }
    }
}

// 4x4 sub-sample count. w is linear, so each sample is the centre value plus an
// integer offset: work in 2*w so the +-0.25/+-0.75 px offsets stay integral.
#[inline]
fn cov16(w: [i64;3], dx: [i64;3], dy: [i64;3]) -> u32 {
    let mut hits = 0u32;
    for &oy in &[-3i64,-1,1,3] {
        for &ox in &[-3i64,-1,1,3] {
            let mut inside = true;
            for e in 0..3 {
                if 4*w[e] + dx[e]*ox + dy[e]*oy < 0 { inside = false; break; }
            }
            if inside { hits += 1; }
        }
    }
    hits
}

#[inline]
fn grads(t: &Tri) -> ([i64;3],[i64;3]) {
    // edge e: w = cross(v1-v0, p-v0); dw/dpx = -(v1y-v0y), dw/dpy = (v1x-v0x)
    ([-(t.cy-t.by), -(t.ay-t.cy), -(t.by-t.ay)],
     [  t.cx-t.bx ,   t.ax-t.cx ,   t.bx-t.ax ])
}

// ---- B: 4x4 coverage on every pixel ----------------------------------------
fn tri_cov_all(buf: &mut [u8], stride: i32, t: &Tri, col: (u32,u32,u32,u32)) {
    let (r,g,b,a) = col;
    let (dx,dy) = grads(t);
    for py in t.min_y..t.max_y {
        let sy = 2*py as i64 + 1;
        for px in t.min_x..t.max_x {
            let sx = 2*px as i64 + 1;
            let w = [orient(t.bx,t.by,t.cx,t.cy,sx,sy),
                     orient(t.cx,t.cy,t.ax,t.ay,sx,sy),
                     orient(t.ax,t.ay,t.bx,t.by,sx,sy)];
            let hits = cov16(w,dx,dy);
            if hits == 0 { continue; }
            blend(buf, (py*stride+px) as usize, r,g,b, a*hits/16);
        }
    }
}

// ---- C: conservative interior test; 4x4 only on boundary pixels -------------
fn tri_cov_edge(buf: &mut [u8], stride: i32, t: &Tri, col: (u32,u32,u32,u32)) {
    let (r,g,b,a) = col;
    let (dx,dy) = grads(t);
    // max |w| change from centre to any corner of the pixel, in 2*w units
    let bound = [3*(dx[0].abs()+dy[0].abs()), 3*(dx[1].abs()+dy[1].abs()), 3*(dx[2].abs()+dy[2].abs())];
    for py in t.min_y..t.max_y {
        let sy = 2*py as i64 + 1;
        for px in t.min_x..t.max_x {
            let sx = 2*px as i64 + 1;
            let w = [orient(t.bx,t.by,t.cx,t.cy,sx,sy),
                     orient(t.cx,t.cy,t.ax,t.ay,sx,sy),
                     orient(t.ax,t.ay,t.bx,t.by,sx,sy)];
            let mut outside = false; let mut interior = true;
            for e in 0..3 {
                if 4*w[e] < -bound[e] { outside = true; break; }
                if 4*w[e] < bound[e] { interior = false; }
            }
            if outside { continue; }
            if interior { blend(buf,(py*stride+px) as usize, r,g,b,a); continue; }
            let hits = cov16(w,dx,dy);
            if hits == 0 { continue; }
            blend(buf,(py*stride+px) as usize, r,g,b, a*hits/16);
        }
    }
}


// ---- D: incremental stepping, interior filled as a run ---------------------
fn fill_run(buf: &mut [u8], off: usize, len: usize, r: u32, g: u32, b: u32) {
    for i in 0..len {
        let o = (off+i)*4;
        buf[o]=r as u8; buf[o+1]=g as u8; buf[o+2]=b as u8; buf[o+3]=255;
    }
}

fn tri_cov_span(buf: &mut [u8], stride: i32, t: &Tri, col: (u32,u32,u32,u32)) {
    let (r,g,b,a) = col;
    let (dx,dy) = grads(t);
    let bound = [3*(dx[0].abs()+dy[0].abs()), 3*(dx[1].abs()+dy[1].abs()), 3*(dx[2].abs()+dy[2].abs())];
    let step = [8*dx[0], 8*dx[1], 8*dx[2]];          // per pixel, in 4w units
    let opaque = a >= 255;
    for py in t.min_y..t.max_y {
        let sy = 2*py as i64 + 1;
        let sx = 2*t.min_x as i64 + 1;
        let f0 = [4*orient(t.bx,t.by,t.cx,t.cy,sx,sy),
                  4*orient(t.cx,t.cy,t.ax,t.ay,sx,sy),
                  4*orient(t.ax,t.ay,t.bx,t.by,sx,sy)];
        // solve per edge for the pixel ranges where F >= B (interior) and F >= -B (touched)
        let solve = |e: usize, thr: i64| -> (i32,i32) {
            let (f,s) = (f0[e], step[e]);
            let n = t.max_x - t.min_x;
            if s == 0 { return if f >= thr { (0,n) } else { (0,0) }; }
            let k = thr - f;
            if s > 0 { (((k + s - 1).div_euclid(s)).clamp(0, n as i64) as i32, n) }
            else     { (0, ((k.div_euclid(s)) + 1).clamp(0, n as i64) as i32) }
        };
        let (mut il, mut ih) = (0, t.max_x - t.min_x);
        let (mut tl, mut th) = (0, t.max_x - t.min_x);
        for e in 0..3 {
            let (l,h) = solve(e, bound[e]);   il = il.max(l); ih = ih.min(h);
            let (l,h) = solve(e, -bound[e]);  tl = tl.max(l); th = th.min(h);
        }
        if th <= tl { continue; }
        if ih < il { il = tl; ih = tl; }        // no fully-interior run this row
        let mut edge_px = |lo: i32, hi: i32, buf: &mut [u8]| {
            for px in lo..hi {
                let o = 8*(px as i64);
                let w = [(f0[0]+step[0]*px as i64)/4, (f0[1]+step[1]*px as i64)/4, (f0[2]+step[2]*px as i64)/4];
                let _ = o;
                let hits = cov16(w,dx,dy);
                if hits == 0 { continue; }
                blend(buf, (py*stride + t.min_x + px) as usize, r,g,b, a*hits/16);
            }
        };
        edge_px(tl, il, buf);
        if ih > il {
            if opaque { fill_run(buf, (py*stride + t.min_x + il) as usize, (ih-il) as usize, r,g,b); }
            else { for px in il..ih { blend(buf,(py*stride + t.min_x + px) as usize, r,g,b,a); } }
        }
        edge_px(ih, th, buf);
    }
}

fn rot_rect(cx: f64, cy: f64, w: f64, h: f64, deg: f64) -> [[(i32,i32);3];2] {
    let (s,c) = (deg.to_radians().sin(), deg.to_radians().cos());
    let p = |dx: f64, dy: f64| (((cx + dx*c - dy*s).round()) as i32, ((cy + dx*s + dy*c).round()) as i32);
    let (a,b,cc,d) = (p(-w/2.,-h/2.), p(w/2.,-h/2.), p(w/2.,h/2.), p(-w/2.,h/2.));
    [[a,b,cc],[a,cc,d]]
}

fn bench(label: &str, w: i32, h: i32, rects: &[(f64,f64,f64,f64,f64)], iters: u32) {
    let mut buf = vec![0u8; (w*h*4) as usize];
    let tris: Vec<Tri> = rects.iter()
        .flat_map(|&(cx,cy,rw,rh,d)| rot_rect(cx,cy,rw,rh,d))
        .filter_map(|v| setup(v,w,h)).collect();
    let px_touched: u64 = tris.iter()
        .map(|t| ((t.max_x-t.min_x).max(0) as u64) * ((t.max_y-t.min_y).max(0) as u64)).sum();
    let mut out = [0f64;4];
    for (i,f) in [tri_binary as fn(&mut [u8],i32,&Tri,(u32,u32,u32,u32)),
                  tri_cov_all, tri_cov_edge, tri_cov_span].iter().enumerate() {
        // warm
        for t in &tris { f(&mut buf, w, t, (255,255,255,255)); }
        let t0 = Instant::now();
        for _ in 0..iters { for t in &tris { f(&mut buf, w, t, (255,255,255,255)); } }
        out[i] = t0.elapsed().as_secs_f64()*1000.0/iters as f64;
    }
    println!("{:<34} {:>10} {:>9.3} {:>9.3} {:>9.3} {:>9.3}   {:>5.2}x {:>5.2}x {:>5.2}x",
        label, px_touched, out[0], out[1], out[2], out[3], out[1]/out[0], out[2]/out[0], out[3]/out[0]);
}

fn main() {
    sweep();
    if std::env::args().any(|a| a == "--sweep-only") { return; }
    println!();
    dump();
    seam_check();
    poly_main();
    println!("");
    println!("{:<34} {:>10} {:>9} {:>9} {:>9} {:>9}   {:>6} {:>6} {:>6}",
        "scene", "bbox px", "A binary", "B cov all", "C cov edge", "D cov span", "B/A", "C/A", "D/A");
    bench("1 rect 1600x900 @ 7deg (1080p)", 1920,1080, &[(960.,540.,1600.,900.,7.)], 200);
    bench("1 rect 400x120 @ 12deg (1080p)", 1920,1080, &[(960.,540.,400.,120.,12.)], 2000);
    let bars: Vec<_> = (0..8).map(|i| (300.+i as f64*180., 540., 120., 800., 4.+i as f64)).collect();
    bench("8 bars 120x800 (the Endfield case)", 1920,1080, &bars, 500);
    bench("1 rect 3200x1800 @ 7deg (4K)", 3840,2160, &[(1920.,1080.,3200.,1800.,7.)], 60);
    let bars4k: Vec<_> = (0..8).map(|i| (600.+i as f64*360., 1080., 240., 1600., 4.+i as f64)).collect();
    bench("8 bars @ 4K (== supersample 2)", 3840,2160, &bars4k, 150);
    println!("");
    println!("{:<34} {:>9} {:>9}   {:>6}", "scene (2 TRI vs 1 POLY)", "A binary", "E poly", "E/A");
    bench_poly("1 rect 1600x900 @ 7deg (1080p)", 1920,1080, &[(960.,540.,1600.,900.,7.)], 200);
    bench_poly("8 bars 120x800 (the Endfield case)", 1920,1080, &bars, 500);
    bench_poly("1 rect 3200x1800 @ 7deg (4K)", 3840,2160, &[(1920.,1080.,3200.,1800.,7.)], 60);
    bench_poly("8 bars @ 4K", 3840,2160, &bars4k, 150);
}


// ---- E: one convex-polygon op — coverage over the whole shape, no interior edges ----
struct Poly { e: Vec<(i64,i64,i64)>, min_x: i32, max_x: i32, min_y: i32, max_y: i32 } // (F at origin-ish, dx, dy)

fn poly_setup(v: &[(i32,i32)], w: i32, h: i32) -> Option<Poly> {
    let n = v.len();
    if n < 3 { return None; }
    let p: Vec<(i64,i64)> = v.iter().map(|&(x,y)| (2*x as i64, 2*y as i64)).collect();
    let mut area = 0i64;
    for i in 0..n { let j=(i+1)%n; area += p[i].0*p[j].1 - p[j].0*p[i].1; }
    if area == 0 { return None; }
    let ccw = area > 0;
    let mut e = Vec::with_capacity(n);
    for i in 0..n {
        let (a, b) = if ccw { (p[i], p[(i+1)%n]) } else { (p[(i+1)%n], p[i]) };
        // w(px,py) = (bx-ax)*(py-ay) - (by-ay)*(px-ax)
        e.push((a.0, a.1, 0)); // placeholder, rebuilt below with both endpoints
        let _ = b;
    }
    // store (ax, ay) and the edge deltas explicitly
    let mut edges = Vec::with_capacity(n);
    for i in 0..n {
        let (a, b) = if ccw { (p[i], p[(i+1)%n]) } else { (p[(i+1)%n], p[i]) };
        edges.push((a.0, a.1, b.0, b.1));
    }
    let ex: Vec<(i64,i64,i64)> = edges.iter().map(|&(ax,ay,bx,by)| {
        // F(px,py) = (bx-ax)*(py-ay) - (by-ay)*(px-ax)  -> constant + dx*px + dy*py
        let dx = -(by-ay); let dy = bx-ax;
        let c = -(dx*ax + dy*ay);
        (c, dx, dy)
    }).collect();
    let _ = e;
    Some(Poly { e: ex,
        min_x: v.iter().map(|q|q.0).min().unwrap().max(0),
        max_x: v.iter().map(|q|q.0).max().unwrap().min(w),
        min_y: v.iter().map(|q|q.1).min().unwrap().max(0),
        max_y: v.iter().map(|q|q.1).max().unwrap().min(h) })
}

fn poly_cov(buf: &mut [u8], stride: i32, pl: &Poly, col: (u32,u32,u32,u32)) {
    let (r,g,b,a) = col;
    let n = pl.e.len();
    let bound: Vec<i64> = pl.e.iter().map(|&(_,dx,dy)| 3*(dx.abs()+dy.abs())).collect();
    let step: Vec<i64> = pl.e.iter().map(|&(_,dx,_)| 8*dx).collect();
    let opaque = a >= 255;
    let mut f0 = vec![0i64; n];
    for py in pl.min_y..pl.max_y {
        let sy = 2*py as i64 + 1;
        let sx = 2*pl.min_x as i64 + 1;
        for i in 0..n { let (c,dx,dy) = pl.e[i]; f0[i] = 4*(c + dx*sx + dy*sy); }
        let span = pl.max_x - pl.min_x;
        let solve = |i: usize, thr: i64| -> (i32,i32) {
            let (f,s) = (f0[i], step[i]);
            if s == 0 { return if f >= thr { (0,span) } else { (0,0) }; }
            let k = thr - f;
            if s > 0 { (((k + s - 1).div_euclid(s)).clamp(0, span as i64) as i32, span) }
            else     { (0, ((k.div_euclid(s)) + 1).clamp(0, span as i64) as i32) }
        };
        let (mut il, mut ih, mut tl, mut th) = (0, span, 0, span);
        for i in 0..n {
            let (l,hh)=solve(i,bound[i]);  il=il.max(l); ih=ih.min(hh);
            let (l,hh)=solve(i,-bound[i]); tl=tl.max(l); th=th.min(hh);
        }
        if th <= tl { continue; }
        if ih < il { il = tl; ih = tl; }
        let mut edge_px = |lo: i32, hi: i32, buf: &mut [u8]| {
            for px in lo..hi {
                let mut hits = 0u32;
                for &oy in &[-3i64,-1,1,3] { for &ox in &[-3i64,-1,1,3] {
                    let mut inside = true;
                    for i in 0..n {
                        if f0[i] + step[i]*px as i64 + pl.e[i].1*ox + pl.e[i].2*oy < 0 { inside=false; break; }
                    }
                    if inside { hits += 1; }
                }}
                if hits == 0 { continue; }
                blend(buf, (py*stride + pl.min_x + px) as usize, r,g,b, a*hits/16);
            }
        };
        edge_px(tl, il, buf);
        if ih > il {
            if opaque { fill_run(buf,(py*stride+pl.min_x+il) as usize,(ih-il) as usize,r,g,b); }
            else { for px in il..ih { blend(buf,(py*stride+pl.min_x+px) as usize,r,g,b,a); } }
        }
        edge_px(ih, th, buf);
    }
}

fn rot_quad(cx: f64, cy: f64, w: f64, h: f64, deg: f64) -> Vec<(i32,i32)> {
    let (s,c) = (deg.to_radians().sin(), deg.to_radians().cos());
    let p = |dx: f64, dy: f64| (((cx + dx*c - dy*s).round()) as i32, ((cy + dx*s + dy*c).round()) as i32);
    vec![p(-w/2.,-h/2.), p(w/2.,-h/2.), p(w/2.,h/2.), p(-w/2.,h/2.)]
}

fn seam_check() {
    let (w,h) = (400i32, 300i32);
    let tris_v = rot_rect(200.,150.,240.,160.,20.);
    for (name, f) in [("A binary", tri_binary as fn(&mut [u8],i32,&Tri,(u32,u32,u32,u32))),
                      ("D cov span", tri_cov_span)] {
        let mut buf = vec![0u8; (w*h*4) as usize];
        for v in tris_v { if let Some(t) = setup(v,w,h) { f(&mut buf,w,&t,(255,255,255,255)); } }
        // interior pixels that are neither 0 nor 255 -> seam / partial coverage inside the shape
        let mut hist = std::collections::BTreeMap::new();
        let mut interior_partial = 0u32;
        for y in 0..h { for x in 0..w {
            let v = buf[((y*w+x)*4) as usize];
            *hist.entry(v).or_insert(0u32) += 1;
            // an interior pixel: all 8 neighbours non-zero
            if v > 0 && v < 255 && x>0 && y>0 && x<w-1 && y<h-1 {
                let nb = [(-1,-1),(0,-1),(1,-1),(-1,0),(1,0),(-1,1),(0,1),(1,1)];
                if nb.iter().all(|&(dx,dy)| buf[(((y+dy)*w+(x+dx))*4) as usize] > 0) {
                    interior_partial += 1;
                }
            }
        }}
        let levels = hist.len();
        let white = *hist.get(&255).unwrap_or(&0);
        let black = *hist.get(&0).unwrap_or(&0);
        println!("{:<12} distinct grey levels={:<4} white={:<7} black={:<7} interior partial px={}",
                 name, levels, white, black, interior_partial);
        // print the darkest non-zero values seen, to expose a seam
        let mut lows: Vec<_> = hist.iter().filter(|(&k,_)| k>0 && k<255).map(|(&k,&v)|(k,v)).collect();
        lows.sort_by_key(|&(_,v)| std::cmp::Reverse(v));
        let top: Vec<String> = lows.iter().take(6).map(|(k,v)| format!("{}x{}",k,v)).collect();
        println!("{:<12} most common partial values: {}", "", top.join("  "));
    }
}


// ---- POLY with an N x N sample grid (N=4 -> 17 levels, 8 -> 65, 16 -> 257) ----
fn poly_cov_n(buf: &mut [u8], stride: i32, pl: &Poly, col: (u32,u32,u32,u32), n_side: i64) {
    let (r,g,b,a) = col;
    let n = pl.e.len();
    // sample offsets, in units of 1/(2*n_side) of a doubled-coord pixel:
    // for k in 0..n_side -> off = 2k+1-n_side, and F is scaled by n_side
    let offs: Vec<i64> = (0..n_side).map(|k| 2*k + 1 - n_side).collect();
    let total = (n_side*n_side) as u32;
    let bound: Vec<i64> = pl.e.iter().map(|&(_,dx,dy)| (n_side-1)*(dx.abs()+dy.abs())).collect();
    let step: Vec<i64> = pl.e.iter().map(|&(_,dx,_)| 2*n_side*dx).collect();
    let opaque = a >= 255;
    let mut f0 = vec![0i64; n];
    for py in pl.min_y..pl.max_y {
        let sy = 2*py as i64 + 1;
        let sx = 2*pl.min_x as i64 + 1;
        for i in 0..n { let (c,dx,dy) = pl.e[i]; f0[i] = n_side*(c + dx*sx + dy*sy); }
        let span = pl.max_x - pl.min_x;
        let solve = |i: usize, thr: i64| -> (i32,i32) {
            let (f,s) = (f0[i], step[i]);
            if s == 0 { return if f >= thr { (0,span) } else { (0,0) }; }
            let k = thr - f;
            if s > 0 { (((k + s - 1).div_euclid(s)).clamp(0, span as i64) as i32, span) }
            else     { (0, ((k.div_euclid(s)) + 1).clamp(0, span as i64) as i32) }
        };
        let (mut il, mut ih, mut tl, mut th) = (0, span, 0, span);
        for i in 0..n {
            let (l,hh)=solve(i,bound[i]);  il=il.max(l); ih=ih.min(hh);
            let (l,hh)=solve(i,-bound[i]); tl=tl.max(l); th=th.min(hh);
        }
        if th <= tl { continue; }
        if ih < il { il = tl; ih = tl; }
        let mut edge_px = |lo: i32, hi: i32, buf: &mut [u8]| {
            for px in lo..hi {
                let mut hits = 0u32;
                for &oy in &offs { for &ox in &offs {
                    let mut inside = true;
                    for i in 0..n {
                        if f0[i] + step[i]*px as i64 + pl.e[i].1*ox + pl.e[i].2*oy < 0 { inside=false; break; }
                    }
                    if inside { hits += 1; }
                }}
                if hits == 0 { continue; }
                blend(buf, (py*stride + pl.min_x + px) as usize, r,g,b, a*hits/total);
            }
        };
        edge_px(tl, il, buf);
        if ih > il {
            if opaque { fill_run(buf,(py*stride+pl.min_x+il) as usize,(ih-il) as usize,r,g,b); }
            else { for px in il..ih { blend(buf,(py*stride+pl.min_x+px) as usize,r,g,b,a); } }
        }
        edge_px(ih, th, buf);
    }
}

fn dump_levels() {
    let (w,h) = (1920i32, 1080i32);
    let bars: Vec<(f64,f64,f64,f64,f64)> = (0..8).map(|i| (300.+i as f64*180., 540., 120., 800., 4.+i as f64)).collect();
    let polys: Vec<Poly> = bars.iter()
        .filter_map(|&(cx,cy,rw,rh,d)| poly_setup(&rot_quad(cx,cy,rw,rh,d),w,h)).collect();
    for n_side in [8i64,16] {
        let mut b = vec![0u8;(w*h*4) as usize];
        for p in &polys { poly_cov_n(&mut b,w,p,(255,255,255,255), n_side); }
        dump_ppm(&format!("scene_poly_{}.ppm", n_side), &b, w, h);
    }
}

fn sweep() {
    let (w,h) = (1920i32, 1080i32);
    let bars: Vec<(f64,f64,f64,f64,f64)> = (0..8).map(|i| (300.+i as f64*180., 540., 120., 800., 4.+i as f64)).collect();
    let tris: Vec<Tri> = bars.iter().flat_map(|&(cx,cy,rw,rh,d)| rot_rect(cx,cy,rw,rh,d))
        .filter_map(|v| setup(v,w,h)).collect();
    let polys: Vec<Poly> = bars.iter()
        .filter_map(|&(cx,cy,rw,rh,d)| poly_setup(&rot_quad(cx,cy,rw,rh,d),w,h)).collect();
    let mut buf = vec![0u8;(w*h*4) as usize];
    let iters = 120;
    for t in &tris { tri_binary(&mut buf,w,t,(255,255,255,255)); }
    let t0 = Instant::now();
    for _ in 0..iters { for t in &tris { tri_binary(&mut buf,w,t,(255,255,255,255)); } }
    let base = t0.elapsed().as_secs_f64()*1000.0/iters as f64;
    println!("{:<28} {:>9} {:>9} {:>8}   {:>7}", "variant", "levels", "ms/frame", "vs today", "");
    println!("{:<28} {:>9} {:>9.3} {:>8}", "A  today (binary TRI)", 2, base, "1.00x");
    for n_side in [4i64, 8, 16] {
        for p in &polys { poly_cov_n(&mut buf,w,p,(255,255,255,255), n_side); }
        let t1 = Instant::now();
        for _ in 0..iters { for p in &polys { poly_cov_n(&mut buf,w,p,(255,255,255,255), n_side); } }
        let ms = t1.elapsed().as_secs_f64()*1000.0/iters as f64;
        // measure achieved levels
        let mut b2 = vec![0u8;(w*h*4) as usize];
        for p in &polys { poly_cov_n(&mut b2,w,p,(255,255,255,255), n_side); }
        let mut seen = [false;256];
        for i in 0..(w*h) as usize { seen[b2[i*4] as usize] = true; }
        let levels = seen.iter().filter(|&&x| x).count();
        println!("{:<28} {:>9} {:>9.3} {:>7.2}x", format!("E  POLY {}x{} samples", n_side, n_side), levels, ms, ms/base);
    }
}

fn poly_seam() {
    let (w,h) = (400i32, 300i32);
    let mut buf = vec![0u8; (w*h*4) as usize];
    let q = rot_quad(200.,150.,240.,160.,20.);
    if let Some(pl) = poly_setup(&q,w,h) { poly_cov(&mut buf,w,&pl,(255,255,255,255)); }
    let mut hist = std::collections::BTreeMap::new();
    let mut interior_partial = 0u32;
    for y in 0..h { for x in 0..w {
        let v = buf[((y*w+x)*4) as usize];
        *hist.entry(v).or_insert(0u32) += 1;
        if v > 0 && v < 255 && x>0 && y>0 && x<w-1 && y<h-1 {
            let nb = [(-1,-1),(0,-1),(1,-1),(-1,0),(1,0),(-1,1),(0,1),(1,1)];
            if nb.iter().all(|&(dx,dy)| buf[(((y+dy)*w+(x+dx))*4) as usize] > 0) { interior_partial += 1; }
        }
    }}
    println!("{:<12} distinct grey levels={:<4} white={:<7} black={:<7} interior partial px={}",
             "E poly", hist.len(), hist.get(&255).unwrap_or(&0), hist.get(&0).unwrap_or(&0), interior_partial);
}

fn bench_poly(label: &str, w: i32, h: i32, rects: &[(f64,f64,f64,f64,f64)], iters: u32) {
    let mut buf = vec![0u8; (w*h*4) as usize];
    let tris: Vec<Tri> = rects.iter().flat_map(|&(cx,cy,rw,rh,d)| rot_rect(cx,cy,rw,rh,d))
        .filter_map(|v| setup(v,w,h)).collect();
    let polys: Vec<Poly> = rects.iter()
        .filter_map(|&(cx,cy,rw,rh,d)| poly_setup(&rot_quad(cx,cy,rw,rh,d),w,h)).collect();
    for t in &tris { tri_binary(&mut buf,w,t,(255,255,255,255)); }
    let t0 = Instant::now();
    for _ in 0..iters { for t in &tris { tri_binary(&mut buf,w,t,(255,255,255,255)); } }
    let a = t0.elapsed().as_secs_f64()*1000.0/iters as f64;
    for p in &polys { poly_cov(&mut buf,w,p,(255,255,255,255)); }
    let t1 = Instant::now();
    for _ in 0..iters { for p in &polys { poly_cov(&mut buf,w,p,(255,255,255,255)); } }
    let e = t1.elapsed().as_secs_f64()*1000.0/iters as f64;
    println!("{:<34} {:>9.3} {:>9.3}   {:>5.2}x", label, a, e, e/a);
}

fn poly_main() {
    poly_seam();
    println!();
    println!("{:<34} {:>9} {:>9}   {:>6}", "scene: 2 TRI (binary) vs 1 POLY (AA)", "A binary", "E poly", "E/A");
    let bars: Vec<_> = (0..8).map(|i| (300.+i as f64*180., 540., 120., 800., 4.+i as f64)).collect();
    let bars4k: Vec<_> = (0..8).map(|i| (600.+i as f64*360., 1080., 240., 1600., 4.+i as f64)).collect();
    bench_poly("1 rect 1600x900 @ 7deg (1080p)", 1920,1080, &[(960.,540.,1600.,900.,7.)], 200);
    bench_poly("8 bars 120x800 (Endfield case)", 1920,1080, &bars, 500);
    bench_poly("1 rect 3200x1800 @ 7deg (4K)", 3840,2160, &[(1920.,1080.,3200.,1800.,7.)], 60);
    bench_poly("8 bars @ 4K", 3840,2160, &bars4k, 150);
}

fn dump_ppm(path: &str, buf: &[u8], w: i32, h: i32) {
    let mut out = format!("P6\n{} {}\n255\n", w, h).into_bytes();
    for i in 0..(w*h) as usize { out.push(buf[i*4]); out.push(buf[i*4+1]); out.push(buf[i*4+2]); }
    std::fs::write(path, out).unwrap();
}

fn dump() {
    // the identical scene HyperFrames rendered: 1920x1080, 8 bars 120x800,
    // centres at (300+i*180, 540), rotation 4+i degrees
    let (w,h) = (1920i32, 1080i32);
    let bars: Vec<(f64,f64,f64,f64,f64)> = (0..8).map(|i| (300.+i as f64*180., 540., 120., 800., 4.+i as f64)).collect();
    let mut sa = vec![0u8;(w*h*4) as usize];
    for &(cx,cy,rw,rh,d) in &bars { for v in rot_rect(cx,cy,rw,rh,d) { if let Some(t)=setup(v,w,h) { tri_binary(&mut sa,w,&t,(255,255,255,255)); } } }
    dump_ppm("scene_a_binary.ppm",&sa,w,h);
    let mut se = vec![0u8;(w*h*4) as usize];
    for &(cx,cy,rw,rh,d) in &bars { if let Some(p)=poly_setup(&rot_quad(cx,cy,rw,rh,d),w,h) { poly_cov(&mut se,w,&p,(255,255,255,255)); } }
    dump_ppm("scene_e_poly.ppm",&se,w,h);
    let (w,h) = (400i32, 300i32);
    let mut a = vec![0u8;(w*h*4) as usize];
    for v in rot_rect(200.,150.,240.,160.,20.) { if let Some(t)=setup(v,w,h) { tri_binary(&mut a,w,&t,(255,255,255,255)); } }
    dump_ppm("out_a_binary.ppm",&a,w,h);
    let mut d = vec![0u8;(w*h*4) as usize];
    for v in rot_rect(200.,150.,240.,160.,20.) { if let Some(t)=setup(v,w,h) { tri_cov_span(&mut d,w,&t,(255,255,255,255)); } }
    dump_ppm("out_d_tri_cov.ppm",&d,w,h);
    let mut e = vec![0u8;(w*h*4) as usize];
    if let Some(p)=poly_setup(&rot_quad(200.,150.,240.,160.,20.),w,h) { poly_cov(&mut e,w,&p,(255,255,255,255)); }
    dump_ppm("out_e_poly.ppm",&e,w,h);
}

// Exact per-pixel area coverage of the SAME integer-vertex polygon: clip the
// polygon to each pixel square (Sutherland-Hodgman) and take the shoelace area.
// f64 here on purpose — this is the ground truth the integer samplers approximate.
fn exact_coverage_scene(path: &str) {
    let (w,h) = (1920i32, 1080i32);
    let mut buf = vec![0u8;(w*h*4) as usize];
    let bars: Vec<(f64,f64,f64,f64,f64)> = (0..8).map(|i| (300.+i as f64*180., 540., 120., 800., 4.+i as f64)).collect();
    for &(cx,cy,rw,rh,d) in &bars {
        let q: Vec<(f64,f64)> = rot_quad(cx,cy,rw,rh,d).iter().map(|&(x,y)| (x as f64, y as f64)).collect();
        let (mnx,mxx) = (q.iter().map(|p|p.0).fold(f64::MAX,f64::min).floor().max(0.0) as i32,
                         q.iter().map(|p|p.0).fold(f64::MIN,f64::max).ceil().min(w as f64) as i32);
        let (mny,mxy) = (q.iter().map(|p|p.1).fold(f64::MAX,f64::min).floor().max(0.0) as i32,
                         q.iter().map(|p|p.1).fold(f64::MIN,f64::max).ceil().min(h as f64) as i32);
        for py in mny..mxy { for px in mnx..mxx {
            // clip q to [px,px+1] x [py,py+1]
            let mut poly = q.clone();
            let planes: [(f64,f64,f64);4] = [
                (1.0,0.0,-(px as f64)), (-1.0,0.0,(px+1) as f64),
                (0.0,1.0,-(py as f64)), (0.0,-1.0,(py+1) as f64)];
            for (a,b,c) in planes {
                if poly.is_empty() { break; }
                let dist = |p:&(f64,f64)| a*p.0 + b*p.1 + c;
                let mut out: Vec<(f64,f64)> = Vec::with_capacity(poly.len()+2);
                for i in 0..poly.len() {
                    let (s, e) = (poly[i], poly[(i+1)%poly.len()]);
                    let (ds, de) = (dist(&s), dist(&e));
                    if ds >= 0.0 { out.push(s); }
                    if (ds >= 0.0) != (de >= 0.0) {
                        let t = ds/(ds-de);
                        out.push((s.0 + t*(e.0-s.0), s.1 + t*(e.1-s.1)));
                    }
                }
                poly = out;
            }
            if poly.len() < 3 { continue; }
            let mut a2 = 0.0;
            for i in 0..poly.len() { let j=(i+1)%poly.len(); a2 += poly[i].0*poly[j].1 - poly[j].0*poly[i].1; }
            let area = (a2/2.0).abs().clamp(0.0,1.0);
            let v = (area*255.0).round() as u8;
            let o = ((py*w+px) as usize)*4;
            let nv = (buf[o] as u32 + v as u32).min(255) as u8;
            buf[o]=nv; buf[o+1]=nv; buf[o+2]=nv; buf[o+3]=255;
        }}
    }
    dump_ppm(path,&buf,w,h);
}
