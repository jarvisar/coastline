// Intersect surface ribbons with the actual terrain facets in route coordinates.
// Every new point inherits its triangle's plane, including cliff transitions.
// This avoids floating ribbons, buried cascades and gaps at chunk boundaries.
// The optional lateral bound also lets ash deposits use the same projection
// on both road shoulders without extending the lava builder's search area.
export class FlowSurface {
  constructor(step, minU = 18) { this.step = step; this.minU = minU; this.rows = new Map(); }
  add(a, b, c) {
    if (Math.max(a.u, b.u, c.u) < this.minU) return;
    const face = { points: [a, b, c], minU: Math.min(a.u, b.u, c.u), maxU: Math.max(a.u, b.u, c.u) };
    const first = Math.floor(Math.min(a.s, b.s, c.s) / this.step), last = Math.floor(Math.max(a.s, b.s, c.s) / this.step);
    for (let row = first; row <= last; row++) {
      if (!this.rows.has(row)) this.rows.set(row, []);
      this.rows.get(row).push(face);
    }
  }
  project(outline, lift = .075) {
    outline = cleanPolygon(outline);
    // Tapered streams end at zero width. A degenerate clipping polygon has
    // no interior; treating its winding as zero would accept entire terrain
    // facets and paint large, unrelated orange sheets around the tip.
    const signedArea = area(outline);
    if (!Number.isFinite(signedArea) || Math.abs(signedArea) < 1e-8) return [];
    const first = Math.floor(Math.min(...outline.map(p => p.s)) / this.step), last = Math.floor(Math.max(...outline.map(p => p.s)) / this.step);
    const minU = Math.min(...outline.map(p => p.u)), maxU = Math.max(...outline.map(p => p.u));
    const winding = Math.sign(signedArea), visited = new Set(), polygons = [];
    for (let row = first; row <= last; row++) for (const face of this.rows.get(row) ?? []) {
      if (visited.has(face) || face.maxU < minU || face.minU > maxU) continue;
      visited.add(face);
      let polygon = face.points;
      for (let i = 0; i < outline.length && polygon.length; i++) {
        const a = outline[i], b = outline[(i + 1) % outline.length];
        const depth = p => winding * ((b.s - a.s) * (p.u - a.u) - (b.u - a.u) * (p.s - a.s));
        const next = [];
        for (let j = 0; j < polygon.length; j++) {
          const p = polygon[j], q = polygon[(j + 1) % polygon.length], dp = depth(p), dq = depth(q);
          if (dp >= 0) next.push(p);
          if ((dp >= 0) !== (dq >= 0)) {
            const t = dp / (dp - dq), point = {};
            for (const key of ['s', 'u', 'x', 'y', 'z']) point[key] = p[key] + (q[key] - p[key]) * t;
            next.push(point);
          }
        }
        polygon = next;
      }
      polygon = cleanPolygon(polygon);
      if (polygon.length >= 3 && Math.abs(area(polygon)) > 1e-8) polygons.push(polygon.map(p => ({ ...p, y: p.y + lift })));
    }
    return polygons;
  }
}

// Boolean clipping can return a closing vertex a few floating-point ulps from
// the first. Its microscopic edge must not become another clipping plane:
// that plane can cut a visible triangular hole from a perfectly valid flow.
function cleanPolygon(polygon) {
  const result = [], same = (a, b) => Math.abs(a.s - b.s) < 1e-8 && Math.abs(a.u - b.u) < 1e-8;
  for (const p of polygon) if (!result.length || !same(p, result.at(-1))) result.push(p);
  if (result.length > 1 && same(result[0], result.at(-1))) result.pop();
  return result;
}

const area = polygon => polygon.reduce((sum, p, i) => {
  const q = polygon[(i + 1) % polygon.length], origin = polygon[0];
  return sum + (p.s - origin.s) * (q.u - origin.u) - (q.s - origin.s) * (p.u - origin.u);
}, 0) / 2;
const bounds = polygon => ({ minS: Math.min(...polygon.map(p => p.s)), maxS: Math.max(...polygon.map(p => p.s)),
  minU: Math.min(...polygon.map(p => p.u)), maxU: Math.max(...polygon.map(p => p.u)) });
const overlaps = (a, b) => a.minS < b.maxS - 1e-8 && a.maxS > b.minS + 1e-8 && a.minU < b.maxU - 1e-8 && a.maxU > b.minU + 1e-8;
function halfPlane(polygon, a, b, sign) {
  const result = [], depth = p => sign * ((b.s - a.s) * (p.u - a.u) - (b.u - a.u) * (p.s - a.s));
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], dp = depth(p), dq = depth(q);
    if (dp >= 0) result.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq), point = {};
      for (const key of Object.keys(p)) {
        if (typeof p[key] === 'number') point[key] = p[key] + (q[key] - p[key]) * t;
        else if (p[key]?.isColor) point[key] = p[key].clone().lerp(q[key], t);
      }
      result.push(point);
    }
  }
  return cleanPolygon(result);
}

// A union of ribbon footprints, indexed along the route. Subtracting already
// covered areas produces disjoint faces, so tributaries cannot z-fight and
// their edge glow cannot run across the middle of another molten surface.
export class FlowCoverage {
  constructor(step = 8) { this.step = step; this.rows = new Map(); }
  add(polygon) {
    for (let i = 1; i < polygon.length - 1; i++) {
      const points = [polygon[0], polygon[i], polygon[i + 1]], signedArea = area(points);
      if (Math.abs(signedArea) < 1e-8) continue;
      const mask = { points, sign: Math.sign(signedArea), ...bounds(points) };
      for (let row = Math.floor(mask.minS / this.step); row <= Math.floor(mask.maxS / this.step); row++) {
        if (!this.rows.has(row)) this.rows.set(row, []);
        this.rows.get(row).push(mask);
      }
    }
  }
  subtract(polygon) {
    polygon = cleanPolygon(polygon);
    const signedArea = area(polygon);
    if (!Number.isFinite(signedArea) || Math.abs(signedArea) < 1e-8) return [];
    const box = bounds(polygon), visited = new Set();
    let pieces = [polygon];
    for (let row = Math.floor(box.minS / this.step); row <= Math.floor(box.maxS / this.step); row++) for (const mask of this.rows.get(row) ?? []) {
      if (visited.has(mask) || !overlaps(box, mask)) continue;
      visited.add(mask);
      const next = [];
      for (const piece of pieces) {
        if (!overlaps(bounds(piece), mask)) { next.push(piece); continue; }
        let inside = piece;
        for (let i = 0; i < mask.points.length && inside.length >= 3; i++) {
          const a = mask.points[i], b = mask.points[(i + 1) % mask.points.length];
          const outside = halfPlane(inside, a, b, -mask.sign);
          if (outside.length >= 3 && Math.abs(area(outside)) > 1e-8) next.push(outside);
          inside = halfPlane(inside, a, b, mask.sign);
        }
      }
      pieces = next;
      if (!pieces.length) return pieces;
    }
    return pieces;
  }
}
