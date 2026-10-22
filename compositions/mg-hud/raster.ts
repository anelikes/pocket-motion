/**
 * Line art rasterised here, analytically, into white-on-transparent PNGs.
 *
 * The build's SVG baker tests every subsample against every contour, which is
 * fine for an icon and hopeless for a hex grid of a thousand cells or a ring
 * the width of the frame. Everything here is a distance to a curve, so its
 * cost is the pixel count: coverage is clamp(halfWidth - distance + 0.5, 0, 1).
 */

import { encodePNG } from "../../vendor/pocketjs/tests/png.ts";

const cov = (half: number, d: number) => Math.max(0, Math.min(1, half - d + 0.5));

function png(w: number, h: number, alpha: (x: number, y: number) => number, rgb: [number, number, number] = [255, 255, 255]): Buffer {
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
  return encodePNG(px, w, h);
}

/** A ring of radius r and line width lw, in a size×size image, at `scale` pixels per unit. */
export function ring(size: number, r: number, lw: number, scale = 2): Buffer {
  const n = Math.round(size * scale);
  const c = n / 2;
  return png(n, n, (x, y) => cov((lw * scale) / 2, Math.abs(Math.hypot(x - c, y - c) - r * scale)));
}

/** A filled disc of radius r with the given alpha. */
export function disc(size: number, r: number, alpha: number, scale = 2, rgb: [number, number, number] = [255, 255, 255]): Buffer {
  const n = Math.round(size * scale);
  const c = n / 2;
  return png(n, n, (x, y) => alpha * cov(r * scale, Math.hypot(x - c, y - c)), rgb);
}

/**
 * A pointy-top hex grid of cell radius s, line width lw, visible in the
 * annulus [rIn, rOut] about the image centre with soft edges.
 */
export function hexGrid(w: number, h: number, s: number, lw: number, rIn: number, rOut: number): Buffer {
  const sq3 = Math.sqrt(3);
  return png(w, h, (x, y) => {
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
export function trace(w: number, h: number, ys: number[], step: number, lw: number): Buffer {
  return png(w, h, (x, y) => {
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
export function ellipse(w: number, h: number, a: number, b: number, lw: number, scale = 2): Buffer {
  const W = Math.round(w * scale);
  const H = Math.round(h * scale);
  return png(W, H, (x, y) => {
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
export function polylines(w: number, h: number, lines: [number, number][][], core: number, glow: number, guides: [number, number][][] = []): Buffer {
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
      seg(x0, y0, x1, y1, (d, along) => ((base + along) % 10 < 4 ? 0.28 * cov(0.6, d) : 0), 2);
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
    px[k * 4] = 255;
    px[k * 4 + 1] = 255;
    px[k * 4 + 2] = 255;
    px[k * 4 + 3] = Math.round(Math.min(1, alpha[k]!) * 255);
  }
  return encodePNG(px, w, h);
}

/**
 * A radar wedge: alpha fades over `span` degrees counter-clockwise behind a
 * leading edge pointing up, inside radius r. Turned by its parent.
 */
export function wedge(size: number, r: number, span: number, maxAlpha: number, scale = 1): Buffer {
  const n = Math.round(size * scale);
  const c = n / 2;
  return png(n, n, (x, y) => {
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
