// wasm build of the same benchmark. Timing is done by the host: this exports
// one entry point that runs `iters` passes and returns an accumulator, so the
// work cannot be optimised away.
// Mirrors raster.rs `tex_tri`: integer edge functions, f32 barycentric, f32 UV.
// tex_tri already divides (`inv_area`) and does 6 f32 muls + 4 adds per pixel,
// so perspective correction is the same kind of arithmetic, not a new kind.

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

static mut CAP: f32 = 8.0;
fn seg(v: f32) -> u32 { if v <= 1.02 { 1 } else { (1.0 + (v - 1.0) * 16.0).min(unsafe { CAP }) as u32 } }
#[no_mangle]
pub extern "C" fn set_cap(c: u32) { unsafe { CAP = c as f32 } }
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


#[no_mangle]
pub extern "C" fn bench(mode: u32, iters: u32, deg_x10: u32, grid: u32) -> f32 {
    let d = 1000.0f32;
    let (w, h) = (800.0f32, 600.0f32);
    let deg = deg_x10 as f32 / 10.0;
    let q = quad(960.0, 540.0, w, h, deg, d);
    let qs: Vec<[V; 4]> = if grid == 1 {
        let (nx, ny) = grid_dims(&q);
        cells(960.0, 540.0, w, h, deg, d, nx, ny)
    } else {
        vec![q]
    };
    let mut sink = 0.0f32;
    for _ in 0..iters {
        for qq in &qs {
            for (a, b, c) in [(qq[0], qq[1], qq[2]), (qq[0], qq[2], qq[3])] {
                tex_tri(a, b, c, mode, |_x, _y, u, _v, _ue, _ve| sink += u);
            }
        }
    }
    sink
}

#[no_mangle]
pub extern "C" fn grid_cells(deg_x10: u32) -> u32 {
    let q = quad(960.0, 540.0, 800.0, 600.0, deg_x10 as f32 / 10.0, 1000.0);
    let (nx, ny) = grid_dims(&q);
    nx * ny
}

#[no_mangle]
pub extern "C" fn pixels(deg_x10: u32, grid: u32) -> u32 {
    let d = 1000.0f32;
    let (w, h) = (800.0f32, 600.0f32);
    let deg = deg_x10 as f32 / 10.0;
    let q = quad(960.0, 540.0, w, h, deg, d);
    let qs: Vec<[V; 4]> = if grid == 1 {
        let (nx, ny) = grid_dims(&q);
        cells(960.0, 540.0, w, h, deg, d, nx, ny)
    } else { vec![q] };
    let mut n = 0u32;
    for qq in &qs { for (a,b,c) in [(qq[0],qq[1],qq[2]),(qq[0],qq[2],qq[3])] {
        tex_tri(a,b,c,0,|_x,_y,_u,_v,_ue,_ve| n += 1); }}
    n
}

/// mean/max texel error of the grid at the current cap, x1000 so it returns an int
#[no_mangle]
pub extern "C" fn grid_err(deg_x10: u32, want_max: u32) -> u32 {
    let d = 1000.0f32; let (w,h) = (800.0f32, 600.0f32);
    let deg = deg_x10 as f32 / 10.0;
    let q = quad(960.0,540.0,w,h,deg,d);
    let (nx,ny) = grid_dims(&q);
    let cs = cells(960.0,540.0,w,h,deg,d,nx,ny);
    let (mut sum, mut mx, mut n) = (0.0f64, 0.0f64, 0u64);
    for cell in &cs { for (a,b,c) in [(cell[0],cell[1],cell[2]),(cell[0],cell[2],cell[3])] {
        tex_tri(a,b,c,0,|_x,_y,u,v,ue,ve| {
            let du = (u-ue) as f64 * 256.0; let dv = (v-ve) as f64 * 256.0;
            let e = (du*du+dv*dv).sqrt();
            sum += e; if e > mx { mx = e } n += 1;
        }); }}
    let v = if want_max == 1 { mx } else if n > 0 { sum / n as f64 } else { 0.0 };
    (v * 1000.0) as u32
}
