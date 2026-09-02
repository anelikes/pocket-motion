// Mirrors raster.rs `tex_tri`: integer edge functions, f32 barycentric, f32 UV.
// tex_tri already divides (`inv_area`) and does 6 f32 muls + 4 adds per pixel,
// so perspective correction is the same kind of arithmetic, not a new kind.
use std::time::Instant;

const TEX: f64 = 256.0;

#[derive(Clone, Copy)]
struct V { x: i32, y: i32, u: f32, v: f32, f: f32 }

fn fz(pz: f32, d: f32) -> f32 { d / (d - pz).max(1.0) }

fn quad(cx: f32, cy: f32, w: f32, h: f32, deg: f32, d: f32) -> [V; 4] {
    let (s, c) = (deg.to_radians().sin(), deg.to_radians().cos());
    let mk = |lx: f32, ly: f32| {
        let (px, pz) = ((lx - w / 2.0) * c, (lx - w / 2.0) * s);
        let f = fz(pz, d);
        V { x: (cx + px * f).round() as i32, y: (cy + (ly - h / 2.0) * f).round() as i32,
            u: lx / w, v: ly / h, f }
    };
    [mk(0.0, 0.0), mk(w, 0.0), mk(w, h), mk(0.0, h)]
}

fn seg(v: f32) -> u32 { if v <= 1.02 { 1 } else { (1.0 + (v - 1.0) * 16.0).min(8.0) as u32 } }
fn grid_dims(q: &[V; 4]) -> (u32, u32) {
    let r = |a: f32, b: f32| if a > b { a / b } else { b / a };
    (seg(r(q[0].f, q[1].f).max(r(q[3].f, q[2].f))), seg(r(q[0].f, q[3].f).max(r(q[1].f, q[2].f))))
}
fn cells(cx: f32, cy: f32, w: f32, h: f32, deg: f32, d: f32, nx: u32, ny: u32) -> Vec<[V; 4]> {
    let (s, c) = (deg.to_radians().sin(), deg.to_radians().cos());
    let mk = |lx: f32, ly: f32| {
        let (px, pz) = ((lx - w / 2.0) * c, (lx - w / 2.0) * s);
        let f = fz(pz, d);
        V { x: (cx + px * f).round() as i32, y: (cy + (ly - h / 2.0) * f).round() as i32,
            u: lx / w, v: ly / h, f }
    };
    let mut out = Vec::new();
    for j in 0..ny { for i in 0..nx {
        let (t0, t1) = (i as f32 / nx as f32, (i + 1) as f32 / nx as f32);
        let (s0, s1) = (j as f32 / ny as f32, (j + 1) as f32 / ny as f32);
        out.push([mk(w*t0, h*s0), mk(w*t1, h*s0), mk(w*t1, h*s1), mk(w*t0, h*s1)]);
    }}
    out
}

#[inline]
fn orient(ax: i64, ay: i64, bx: i64, by: i64, px: i64, py: i64) -> i64 {
    (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}

/// mode 0 = affine (today), 1 = perspective-correct per pixel,
/// 2..= segmented: exact every `mode` pixels, linear between.
fn tex_tri(a: V, b: V, c: V, mode: u32, mut sink: impl FnMut(i32, i32, f32, f32, f32, f32)) {
    let (ax, ay) = (2*a.x as i64, 2*a.y as i64);
    let (mut bx, mut by) = (2*b.x as i64, 2*b.y as i64);
    let (mut cx, mut cy) = (2*c.x as i64, 2*c.y as i64);
    let (mut bu, mut bv, mut bf) = (b.u, b.v, b.f);
    let (mut cu, mut cv, mut cf) = (c.u, c.v, c.f);
    let mut area = orient(ax, ay, bx, by, cx, cy);
    if area == 0 { return; }
    if area < 0 {
        core::mem::swap(&mut bx, &mut cx); core::mem::swap(&mut by, &mut cy);
        core::mem::swap(&mut bu, &mut cu); core::mem::swap(&mut bv, &mut cv);
        core::mem::swap(&mut bf, &mut cf);
        area = -area;
    }
    let (min_x, max_x) = (a.x.min(b.x).min(c.x), a.x.max(b.x).max(c.x));
    let (min_y, max_y) = (a.y.min(b.y).min(c.y), a.y.max(b.y).max(c.y));
    let inv_area = 1.0f32 / area as f32;
    // perspective-correct needs u*f, v*f, f interpolated linearly
    let (auf, avf) = (a.u*a.f, a.v*a.f);
    let (buf, bvf) = (bu*bf, bv*bf);
    let (cuf, cvf) = (cu*cf, cv*cf);
    for py in min_y..max_y {
        let sy = 2*py as i64 + 1;
        // segmented state
        let (mut seg_x0, mut su0, mut sv0, mut su1, mut sv1) = (i32::MIN, 0.0f32, 0.0, 0.0, 0.0);
        for px in min_x..max_x {
            let sx = 2*px as i64 + 1;
            let w0 = orient(bx, by, cx, cy, sx, sy);
            let w1 = orient(cx, cy, ax, ay, sx, sy);
            let w2 = orient(ax, ay, bx, by, sx, sy);
            if w0 < 0 || w1 < 0 || w2 < 0 { continue; }
            let (f0, f1, f2) = (w0 as f32 * inv_area, w1 as f32 * inv_area, w2 as f32 * inv_area);
            // affine — exactly what tex_tri does today
            let ua = a.u*f0 + bu*f1 + cu*f2;
            let va = a.v*f0 + bv*f1 + cv*f2;
            // exact perspective-correct, the reference
            let ff = a.f*f0 + bf*f1 + cf*f2;
            let inv = 1.0 / ff;
            let ue = (auf*f0 + buf*f1 + cuf*f2) * inv;
            let ve = (avf*f0 + bvf*f1 + cvf*f2) * inv;
            let (u, v) = match mode {
                0 => (ua, va),
                1 => (ue, ve),
                n => {
                    let base = px - px.rem_euclid(n as i32);
                    if base != seg_x0 {
                        seg_x0 = base;
                        let at = |x: i32| -> (f32, f32) {
                            let sxx = 2*x as i64 + 1;
                            let (q0,q1,q2) = (orient(bx,by,cx,cy,sxx,sy), orient(cx,cy,ax,ay,sxx,sy), orient(ax,ay,bx,by,sxx,sy));
                            let (g0,g1,g2) = (q0 as f32*inv_area, q1 as f32*inv_area, q2 as f32*inv_area);
                            let gf = a.f*g0 + bf*g1 + cf*g2;
                            let gi = 1.0/gf;
                            ((auf*g0 + buf*g1 + cuf*g2)*gi, (avf*g0 + bvf*g1 + cvf*g2)*gi)
                        };
                        let e0 = at(base); let e1 = at(base + n as i32);
                        su0 = e0.0; sv0 = e0.1; su1 = e1.0; sv1 = e1.1;
                    }
                    let t = (px - seg_x0) as f32 / n as f32;
                    (su0 + (su1-su0)*t, sv0 + (sv1-sv0)*t)
                }
            };
            sink(px, py, u, v, ue, ve);
        }
    }
}

#[derive(Default)]
struct E { sum: f64, max: f64, n: u64 }
impl E {
    fn add(&mut self, e: f64) { self.sum += e; if e > self.max { self.max = e } self.n += 1 }
    fn mean(&self) -> f64 { if self.n == 0 { 0.0 } else { self.sum/self.n as f64 } }
}

fn err_of(qs: &[[V;4]], mode: u32) -> E {
    let mut e = E::default();
    for q in qs { for (a,b,c) in [(q[0],q[1],q[2]), (q[0],q[2],q[3])] {
        tex_tri(a,b,c,mode,|_x,_y,u,v,ue,ve| {
            let du = (u-ue) as f64 * TEX; let dv = (v-ve) as f64 * TEX;
            e.add((du*du + dv*dv).sqrt());
        });
    }}
    e
}

fn time_of(qs: &[[V;4]], mode: u32, iters: u32) -> f64 {
    let mut sink = 0.0f32;
    for q in qs { for (a,b,c) in [(q[0],q[1],q[2]),(q[0],q[2],q[3])] {
        tex_tri(a,b,c,mode,|_x,_y,u,_v,_ue,_ve| sink += u); }}
    let t = Instant::now();
    for _ in 0..iters { for q in qs { for (a,b,c) in [(q[0],q[1],q[2]),(q[0],q[2],q[3])] {
        tex_tri(a,b,c,mode,|_x,_y,u,_v,_ue,_ve| sink += u); }}}
    let ms = t.elapsed().as_secs_f64()*1000.0/iters as f64;
    if sink == 12345.6789 { println!("unreachable"); }
    ms
}

fn main() {
    let d = 1000.0f32;
    let (w, h) = (800.0f32, 600.0f32);
    println!("quad {w}x{h} at 1920x1080, perspective distance {d}, texture 256x256");
    println!("error in texels against exact per-pixel perspective correction\n");
    println!("{:>6} {:>7} | {:>16} | {:>16} | {:>16} | {:>16}",
        "rot-y", "grid", "A affine (2 op)", "B grid (today)", "D seg-16 (2 op)", "D seg-32 (2 op)");
    println!("{:>6} {:>7} | {:>7} {:>8} | {:>7} {:>8} | {:>7} {:>8} | {:>7} {:>8}",
        "deg","nx x ny","mean","max","mean","max","mean","max","mean","max");
    for deg in [20.0f32, 40.0, 60.0, 70.0] {
        let q = quad(960.0,540.0,w,h,deg,d);
        let (nx,ny) = grid_dims(&q);
        let one = vec![q];
        let cs = cells(960.0,540.0,w,h,deg,d,nx,ny);
        let (ea, eb) = (err_of(&one,0), err_of(&cs,0));
        let (e16, e32) = (err_of(&one,16), err_of(&one,32));
        println!("{:>6.0} {:>3}x{:<3} | {:>7.3} {:>8.3} | {:>7.3} {:>8.3} | {:>7.3} {:>8.3} | {:>7.3} {:>8.3}",
            deg, nx, ny, ea.mean(), ea.max, eb.mean(), eb.max, e16.mean(), e16.max, e32.mean(), e32.max);
    }

    println!("\ncost, rot-y 40, ms per quad (median of 5)");
    let q = quad(960.0,540.0,w,h,40.0,d);
    let (nx,ny) = grid_dims(&q);
    let one = vec![q];
    let cs = cells(960.0,540.0,w,h,40.0,d,nx,ny);
    let med = |mut v: Vec<f64>| { v.sort_by(|a,b| a.partial_cmp(b).unwrap()); v[v.len()/2] };
    let run = |qs: &Vec<[V;4]>, m: u32| med((0..5).map(|_| time_of(qs, m, 200)).collect());
    let ta = run(&one, 0);
    let tb = run(&cs, 0);
    let tc = run(&one, 1);
    let t8 = run(&one, 8);
    let t16 = run(&one, 16);
    let t32 = run(&one, 32);
    println!("  {:<34} {:>7.3} ms  {:>5} ops  {:>6}", "A  affine (today, per triangle)", ta, 2, "1.00x");
    println!("  {:<34} {:>7.3} ms  {:>5} ops  {:>5.2}x", format!("B  grid {}x{} (today, per image)", nx, ny), tb, nx*ny*2, tb/ta);
    println!("  {:<34} {:>7.3} ms  {:>5} ops  {:>5.2}x", "C  perspective-correct per pixel", tc, 2, tc/ta);
    println!("  {:<34} {:>7.3} ms  {:>5} ops  {:>5.2}x", "D  segmented, every 8 px", t8, 2, t8/ta);
    println!("  {:<34} {:>7.3} ms  {:>5} ops  {:>5.2}x", "D  segmented, every 16 px", t16, 2, t16/ta);
    println!("  {:<34} {:>7.3} ms  {:>5} ops  {:>5.2}x", "D  segmented, every 32 px", t32, 2, t32/ta);
}
