/**
 * The PNGs this suite writes (its synthetic photos) and reads (frames the
 * checkout's `frame` command writes): 8-bit RGB or RGBA, not interlaced.
 * Written here rather than imported from `vendor/`, because the runner has to
 * work before a checkout's `vendor/` exists and against any revision of it.
 */

import { deflateSync, inflateSync } from "node:zlib";

export interface Rgba {
  readonly w: number;
  readonly h: number;
  /** w × h × 4 bytes, row-major. */
  readonly data: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

export function encodePng(img: Rgba): Uint8Array {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, img.w);
  hv.setUint32(4, img.h);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = img.w * 4;
  const raw = new Uint8Array((stride + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function decodePng(bytes: Uint8Array): Rgba {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8;
  let w = 0;
  let h = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  while (o < bytes.length) {
    const len = view.getUint32(o);
    const type = new TextDecoder().decode(bytes.subarray(o + 4, o + 8));
    const body = bytes.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = view.getUint32(o + 8);
      h = view.getUint32(o + 12);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("png: only 8-bit, non-interlaced");
      colorType = body[9]!;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    o += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`png: colour type ${colorType} not supported`);
  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let j = 0;
  for (const p of idat) {
    joined.set(p, j);
    j += p.length;
  }
  const raw = inflateSync(joined);
  const stride = w * channels;
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels]! : 0;
      const b = prev ? prev[i]! : 0;
      const c = prev && i >= channels ? prev[i - channels]! : 0;
      let v = src[i]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 0xff;
    }
  }
  if (channels === 4) return { w, h, data: px };
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = px[i * 3]!;
    data[i * 4 + 1] = px[i * 3 + 1]!;
    data[i * 4 + 2] = px[i * 3 + 2]!;
    data[i * 4 + 3] = 255;
  }
  return { w, h, data };
}
