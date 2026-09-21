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
    const first = Math.floor(Math.min(...outline.map(p => p.s)) / this.step), last = Math.floor(Math.max(...outline.map(p => p.s)) / this.step);
    const minU = Math.min(...outline.map(p => p.u)), maxU = Math.max(...outline.map(p => p.u));
    let area = 0;
    for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; area += a.s * b.u - b.s * a.u; }
    const winding = Math.sign(area), visited = new Set(), polygons = [];
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
      if (polygon.length >= 3) polygons.push(polygon.map(p => ({ ...p, y: p.y + lift })));
    }
    return polygons;
  }
}
