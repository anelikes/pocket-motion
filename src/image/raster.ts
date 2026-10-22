/**
 * Line art and imagery rasterised by a generator, analytically, into plates.
 *
 * The build's SVG baker tests every subsample against every contour, which
 * is fine for an icon and hopeless for a hex grid of a thousand cells or a
 * ring the width of the frame. Everything here is a distance to a curve or a
 * closed-form field, so its cost is the pixel count: line coverage is
 * clamp(halfWidth − distance + 0.5, 0, 1). A painter returns straight RGBA;
 * `encodePlate` turns it into the PNG an `<Image>` names, through upstream's
 * encoder the way `glow.ts` reaches it, and `turnPlate` turns one by whole
 * quarter turns as an exact permutation of its pixels.
 *
 * A turn that a picture keeps belongs in its pixels, not on its node: the
 * core draws a turned textured quad as two triangles and their shared
 * diagonal shows as a faint line (compositions/mg-bauhaus, the red module at
 * rotate 540°).
 */

import { rng } from "../anim/sampled.ts";
import { pocketjsRoot } from "../runtime/boot.ts";

/** Straight (not premultiplied) RGBA, row-major. */
export interface Plate {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** The PNG bytes of a plate. */
export async function encodePlate(plate: Plate): Promise<Uint8Array> {
  const { encodePNG } = (await import(`${pocketjsRoot()}/tests/png.ts`)) as {
    encodePNG: (rgba: Uint8Array, w: number, h: number) => Uint8Array;
  };
  return encodePNG(plate.rgba, plate.width, plate.height);
}

/** A plate turned `quarters` clockwise (y down): an exact permutation of its pixels, no resampling. */
export function turnPlate(plate: Plate, quarters: number): Plate {
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) return plate;
  const { width: W, height: H, rgba } = plate;
  const w = q === 2 ? W : H;
  const h = q === 2 ? H : W;
  const out = new Uint8Array(rgba.length);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      // destination (i, j) reads the source pixel the inverse turn lands on
      const [si, sj] = q === 1 ? [j, H - 1 - i] : q === 2 ? [W - 1 - i, H - 1 - j] : [W - 1 - j, i];
      const d = (j * w + i) * 4;
      const s = (sj * W + si) * 4;
      out[d] = rgba[s]!;
      out[d + 1] = rgba[s + 1]!;
      out[d + 2] = rgba[s + 2]!;
      out[d + 3] = rgba[s + 3]!;
    }
  }
  return { width: w, height: h, rgba: out };
}

const cov = (half: number, d: number) => Math.max(0, Math.min(1, half - d + 0.5));

function paint(w: number, h: number, alpha: (x: number, y: number) => number, rgb: [number, number, number] = [255, 255, 255]): Plate {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha(x + 0.5, y + 0.5);
      const i = (y * w + x) * 4;
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
      px[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  return { width: w, height: h, rgba: px };
}

/** A ring of radius r and line width lw, in a size×size image, at `scale` pixels per unit. */
export function ring(size: number, r: number, lw: number, scale = 2): Plate {
  const n = Math.round(size * scale);
  const c = n / 2;
  return paint(n, n, (x, y) => cov((lw * scale) / 2, Math.abs(Math.hypot(x - c, y - c) - r * scale)));
}

/** A filled disc of radius r with the given alpha. */
export function disc(size: number, r: number, alpha: number, scale = 2, rgb: [number, number, number] = [255, 255, 255]): Plate {
  const n = Math.round(size * scale);
  const c = n / 2;
  return paint(n, n, (x, y) => alpha * cov(r * scale, Math.hypot(x - c, y - c)), rgb);
}

/**
 * A pointy-top hex grid of cell radius s, line width lw, visible in the
 * annulus [rIn, rOut] about the image centre with soft edges.
 */
export function hexGrid(w: number, h: number, s: number, lw: number, rIn: number, rOut: number): Plate {
  const sq3 = Math.sqrt(3);
  return paint(w, h, (x, y) => {
    const dx = x - w / 2;
    const dy = y - h / 2;
    const rr = Math.hypot(dx, dy);
    const fade = Math.min(Math.max(0, Math.min(1, (rr - rIn) / 60)), Math.max(0, Math.min(1, (rOut - rr) / 120)));
    if (fade <= 0) return 0;
    // axial coordinates of the point, then cube rounding to the cell centre
    const q = ((sq3 / 3) * dx - (1 / 3) * dy) / s;
    const r = ((2 / 3) * dy) / s;
    let cx = q;
    let cz = r;
    let cy = -cx - cz;
    let rx = Math.round(cx);
    let ry = Math.round(cy);
    let rz = Math.round(cz);
    const ex = Math.abs(rx - cx);
    const ey = Math.abs(ry - cy);
    const ez = Math.abs(rz - cz);
    if (ex > ey && ex > ez) rx = -ry - rz;
    else if (ey > ez) ry = -rx - rz;
    else rz = -rx - ry;
    void ry;
    const hx = s * sq3 * (rx + rz / 2);
    const hy = s * 1.5 * rz;
    // distance from the cell centre measured against the three edge normals
    const px = dx - hx;
    const py = dy - hy;
    const apothem = (sq3 / 2) * s;
    let m = 0;
    for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) m = Math.max(m, Math.abs(px * Math.cos(a) + py * Math.sin(a)));
    return fade * cov(lw / 2, Math.abs(apothem - m));
  });
}

/** A line graph through `ys` (one value per `step` px), drawn `lw` thick. */
export function trace(w: number, h: number, ys: number[], step: number, lw: number): Plate {
  return paint(w, h, (x, y) => {
    const k = x / step;
    const i = Math.min(ys.length - 2, Math.max(0, Math.floor(k)));
    const u = k - i;
    const yy = ys[i]! + (ys[i + 1]! - ys[i]!) * u;
    const slope = (ys[i + 1]! - ys[i]!) / step;
    // vertical distance corrected for the slope gives the distance to the segment
    return cov(lw / 2, Math.abs(y - yy) / Math.sqrt(1 + slope * slope));
  });
}

/** An ellipse outline with semi-axes a, b, centred in a w×h image. */
export function ellipse(w: number, h: number, a: number, b: number, lw: number, scale = 2): Plate {
  const W = Math.round(w * scale);
  const H = Math.round(h * scale);
  return paint(W, H, (x, y) => {
    const dx = x / scale - w / 2;
    const dy = y / scale - h / 2;
    const q = Math.hypot(dx / a, dy / b);
    const g = Math.hypot(dx / (a * a), dy / (b * b)) / Math.max(q, 1e-6);
    return cov((lw * scale) / 2, (Math.abs(q - 1) / Math.max(g, 1e-6)) * scale);
  });
}

/**
 * Polylines with a glow: a `core`-wide line over a gaussian halo `glow` px
 * wide, plus fainter dotted `guides`. Only the pixels near each segment are
 * visited, so the cost is the drawn length, not the frame.
 */
export function polylines(
  w: number,
  h: number,
  lines: [number, number][][],
  core: number,
  glow: number,
  guides: [number, number][][] = [],
  fade?: { r0: number; r1: number },
  guideAlpha = 0.28,
): Plate {
  const alpha = new Float32Array(w * h);
  const seg = (x0: number, y0: number, x1: number, y1: number, f: (d: number, along: number) => number, reach: number) => {
    const minx = Math.max(0, Math.floor(Math.min(x0, x1) - reach));
    const maxx = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + reach));
    const miny = Math.max(0, Math.floor(Math.min(y0, y1) - reach));
    const maxy = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + reach));
    if (minx > maxx || miny > maxy) return;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const u = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
        const d = Math.hypot(px - (x0 + u * dx), py - (y0 + u * dy));
        const a = f(d, u * Math.sqrt(len2));
        const k = y * w + x;
        if (a > alpha[k]!) alpha[k] = a;
      }
    }
  };
  for (const l of guides) {
    let run = 0;
    for (let i = 0; i + 1 < l.length; i++) {
      const [x0, y0] = l[i]!;
      const [x1, y1] = l[i + 1]!;
      const base = run;
      seg(x0, y0, x1, y1, (d, along) => ((base + along) % 10 < 4 ? guideAlpha * cov(0.6, d) : 0), 2);
      run += Math.hypot(x1 - x0, y1 - y0);
    }
  }
  for (const l of lines) {
    for (let i = 0; i + 1 < l.length; i++) {
      const [x0, y0] = l[i]!;
      const [x1, y1] = l[i + 1]!;
      seg(x0, y0, x1, y1, (d) => {
        const c = cov(core / 2, d);
        const g = 0.32 * Math.exp(-((d / glow) ** 2));
        return c + g * (1 - c);
      }, glow * 2.5);
    }
  }
  const px = new Uint8Array(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    // an optional soft disc about the image centre: whole inside r0, gone by r1
    let f = 1;
    if (fade) {
      const d = Math.hypot((k % w) + 0.5 - w / 2, Math.floor(k / w) + 0.5 - h / 2);
      const u = Math.max(0, Math.min(1, (fade.r1 - d) / (fade.r1 - fade.r0)));
      f = u * u * (3 - 2 * u);
    }
    px[k * 4] = 255;
    px[k * 4 + 1] = 255;
    px[k * 4 + 2] = 255;
    px[k * 4 + 3] = Math.round(Math.min(1, alpha[k]!) * f * 255);
  }
  return { width: w, height: h, rgba: px };
}

/**
 * Speed lines for a push-in: `n` radial strokes between radii r0 and r1 about
 * the image centre, each brightest two thirds of the way out and gone at both
 * ends. Angles and lengths come from `seed`.
 */
export function streaks(w: number, h: number, n: number, r0: number, r1: number, seed: number): Plate {
  const rnd = rng(seed);
  const lines: { th: number; a: number; b: number; lw: number; peak: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = r0 + rnd() * (r1 - r0) * 0.5;
    lines.push({ th: rnd() * Math.PI * 2, a, b: a + (r1 - a) * (0.35 + rnd() * 0.65), lw: 0.8 + rnd() * 1.6, peak: 0.35 + rnd() * 0.65 });
  }
  const cx = w / 2;
  const cy = h / 2;
  return paint(w, h, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy);
    if (r < r0) return 0;
    const th = Math.atan2(dy, dx);
    let best = 0;
    for (const l of lines) {
      if (r < l.a || r > l.b) continue;
      // atan2 is in (-π, π] and the strokes' angles in [0, 2π): wrap the difference into [-π, π) before measuring
      const dth = Math.abs(((((th - l.th) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      const d = dth * r;
      if (d > l.lw + 1) continue;
      const u = (r - l.a) / (l.b - l.a);
      const along = u < 0.66 ? u / 0.66 : (1 - u) / 0.34;
      best = Math.max(best, l.peak * along * cov(l.lw / 2, d));
    }
    return best;
  });
}

/**
 * A radar wedge: alpha fades over `span` degrees counter-clockwise behind a
 * leading edge pointing up, inside radius r. Turned by its parent.
 */
export function wedge(size: number, r: number, span: number, maxAlpha: number, scale = 1): Plate {
  const n = Math.round(size * scale);
  const c = n / 2;
  return paint(n, n, (x, y) => {
    const dx = x - c;
    const dy = y - c;
    const d = Math.hypot(dx, dy);
    if (d > r * scale + 1) return 0;
    const th = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360; // clockwise from up
    const behind = (360 - th) % 360;
    if (behind > span) return 0;
    return maxAlpha * (1 - behind / span) ** 1.5 * cov(r * scale, d);
  });
}

/**
 * A synthetic SAR chip, grey on opaque: sea clutter as fully developed
 * speckle (an exponential intensity under a long swell), and, when `ship` is
 * set, a vessel heading `hdg` degrees (clockwise from up) up and right of
 * the chip's centre — a bright return with its range/azimuth sidelobe cross, the dark
 * turbulent wake straight behind it, and the two bright Kelvin arms at
 * ±19.47° to the track. The same `seed` gives the same speckle with or
 * without the ship, so one can dissolve into the other.
 */
export function sar(size: number, seed: number, ship: boolean, hdg = 72, at: [number, number] = [0.64, 0.4], k = 1, gain = 1): Plate {
  const rnd = rng(seed);
  // the arms' jitter draws from a stream of its own, so the speckle is the same pixel for pixel with or without a ship
  const jitter = rng(seed ^ 0x5a5a5a5a);
  const th = (hdg * Math.PI) / 180;
  const fx = Math.sin(th); // heading, screen x
  const fy = -Math.cos(th); // heading, screen y (up is negative)
  // where the ship sits, as fractions of the chip; `k` scales the hull, the wake and the speckle's grain together
  const cx = size * at[0];
  const cy = size * at[1];
  const kelvin = (19.47 * Math.PI) / 180;
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const speckle = -Math.log(Math.max(1e-6, rnd()));
      const swell = 0.75 + 0.25 * Math.sin(((x * 0.8 + y * 0.35) * 0.09) / k) * Math.sin(((x * 0.2 - y * 0.6) * 0.05) / k);
      let v = 0.2 * swell * Math.sqrt(speckle);
      if (ship) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const along = dx * fx + dy * fy; // + ahead of the ship
        const across = -dx * fy + dy * fx;
        // the hull: a bright ellipse 36 px long, 7 wide, and its sidelobe cross
        const hull = Math.exp(-((along / (18 * k)) ** 2) - (across / (3.5 * k)) ** 2);
        const lobe = 0.35 * (Math.exp(-((dy / 1.2) ** 2)) * Math.exp(-((dx / (60 * k)) ** 2)) + Math.exp(-((dx / 1.2) ** 2)) * Math.exp(-((dy / (60 * k)) ** 2)));
        const r = Math.hypot(dx, dy);
        if (along < -10 * k) {
          const back = -along;
          const fade = Math.exp(-back / (160 * k));
          // the turbulent wake: a dark band straight behind
          v *= 1 - 0.75 * fade * Math.exp(-((across / (5 * k)) ** 2));
          // the Kelvin arms: bright lines at ±19.47° to the track
          for (const sign of [-1, 1]) {
            const arm = Math.abs(across - sign * back * Math.tan(kelvin));
            v += 0.55 * fade * Math.exp(-((arm / (1.6 * k)) ** 2)) * (0.6 + 0.4 * jitter());
          }
        }
        v += 1.4 * hull + lobe * Math.exp(-r / (90 * k));
      }
      const g = Math.round(Math.max(0, Math.min(1, v * gain)) * 255);
      const o = (y * size + x) * 4;
      px[o] = g;
      px[o + 1] = g;
      px[o + 2] = g;
      px[o + 3] = 255;
    }
  }
  return { width: size, height: size, rgba: px };
}

/**
 * A vessel's track: a filled dot on each AIS ping joined by a thin solid
 * line, then the silent leg after the last ping as a dashed line.
 */
export function track(w: number, h: number, pings: [number, number][], silent: [number, number][]): Plate {
  const solid = polylineCoverage(w, h, [pings], (d) => cov(0.8, d));
  const dashed = polylineCoverage(w, h, [silent], (d, along) => (along % 14 < 8 ? cov(1, d) : 0));
  const px = new Uint8Array(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    let a = Math.max(solid[k]!, dashed[k]!);
    const x = (k % w) + 0.5;
    const y = Math.floor(k / w) + 0.5;
    for (const [cx, cy] of pings) a = Math.max(a, cov(4, Math.hypot(x - cx, y - cy)));
    px[k * 4] = 255;
    px[k * 4 + 1] = 255;
    px[k * 4 + 2] = 255;
    px[k * 4 + 3] = Math.round(Math.min(1, a) * 255);
  }
  return { width: w, height: h, rgba: px };
}

/** Per-pixel coverage of polylines under `f(distance, distanceAlongLine)`, visiting only pixels near each segment. */
function polylineCoverage(w: number, h: number, lines: [number, number][][], f: (d: number, along: number) => number, reach = 4): Float32Array {
  const alpha = new Float32Array(w * h);
  for (const l of lines) {
    let run = 0;
    for (let i = 0; i + 1 < l.length; i++) {
      const [x0, y0] = l[i]!;
      const [x1, y1] = l[i + 1]!;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len2 = dx * dx + dy * dy || 1;
      for (let y = Math.max(0, Math.floor(Math.min(y0, y1) - reach)); y <= Math.min(h - 1, Math.ceil(Math.max(y0, y1) + reach)); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(x0, x1) - reach)); x <= Math.min(w - 1, Math.ceil(Math.max(x0, x1) + reach)); x++) {
          const u = Math.max(0, Math.min(1, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / len2));
          const d = Math.hypot(x + 0.5 - (x0 + u * dx), y + 0.5 - (y0 + u * dy));
          const a = f(d, run + u * Math.sqrt(len2));
          if (a > alpha[y * w + x]!) alpha[y * w + x] = a;
        }
      }
      run += Math.sqrt(len2);
    }
  }
  return alpha;
}
