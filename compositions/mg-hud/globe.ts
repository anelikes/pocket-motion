/**
 * The hologram globe: Natural Earth land sampled to a lat/lon dot lattice and
 * set on a sphere in the core's own 3D, so one rotateY turns the whole thing.
 *
 * The core composes a node's 3D transform as translate, then rotate, rotateX,
 * rotateY (draw.rs, collect_3d) — translation is OUTERMOST. A point on a
 * sphere needs the opposite (rotate, then push out along the turned axis), so
 * each dot is three nested nodes: a longitude node (rotateY λ), a latitude
 * node (rotateX φ) and a push node (translateZ R). Dots that share a longitude
 * share its node.
 *
 * Depth: a perspective root painter-sorts every projected quad by camera
 * depth, so a translucent disc set at z = 0 is drawn after the far side and
 * before the near side — it dims the back of the globe without anyone
 * computing which dot is behind.
 */

export interface LandDot {
  lat: number;
  lon: number;
}

type Ring = number[][];

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi! > lat !== yj! > lat && lon < ((xj! - xi!) * (lat - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

/** Land dots on a lattice of `step` degrees, with rows staggered like a printed dot map. */
export function landDots(geojson: { features: { geometry: { type: string; coordinates: unknown } }[] }, step: number): LandDot[] {
  const polys: Ring[][] = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (g.type === "Polygon") polys.push(g.coordinates as Ring[]);
    else if (g.type === "MultiPolygon") for (const p of g.coordinates as Ring[][]) polys.push(p);
  }
  const out: LandDot[] = [];
  for (let lat = -56; lat <= 78; lat += step) {
    // keep dot spacing roughly even on the sphere: fewer longitudes near the poles
    const n = Math.max(6, Math.round((360 / step) * Math.cos((lat * Math.PI) / 180)));
    const dl = 360 / n;
    const off = (Math.round((lat + 90) / step) % 2) * dl * 0.5;
    for (let k = 0; k < n; k++) {
      const lon = -180 + off + k * dl;
      let land = false;
      for (const p of polys) {
        if (inRing(lon, lat, p[0]!) && !p.slice(1).some((h) => inRing(lon, lat, h))) {
          land = true;
          break;
        }
      }
      if (land) out.push({ lat, lon: Math.round(lon * 100) / 100 });
    }
  }
  return out;
}
