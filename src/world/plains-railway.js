import { Color } from 'three';
import { CHUNK_LENGTH, positionAt, randomAt } from './route.js';
import { PLAINS_STEP, PLAINS_COLUMNS, plainsVertex, plainsRowStep, plainsGroundHeight } from './plains-route.js';

export const PLAINS_RAIL_REACH = 320;
const STRAIGHT = 40, RADIUS = 200, FAR_CROSS = 540;
export const PLAINS_RAIL_SPAN = STRAIGHT + RADIUS;
const ballastTint = new Color('#c0a778');

// Straight siding, then two broad curves away from the highway. The ends lie
// past the widest roadside view and the third-person fog.
export function plainsRailPath(site, parameter) {
  const base = Math.abs(site.u) + site.halfU + 1.5;
  const direction = Math.sign(parameter - site.s), distance = Math.abs(parameter - site.s);
  if (distance <= STRAIGHT) return { s: parameter, u: site.side * base, ds: 1, du: 0 };
  const angle = Math.min(Math.PI / 2, (distance - STRAIGHT) / RADIUS * Math.PI / 2);
  const tail = Math.max(0, distance - PLAINS_RAIL_SPAN) / (PLAINS_RAIL_REACH - PLAINS_RAIL_SPAN);
  // Constant-radius quarter turn, then a straight run to the far fields. Both joins are tangent.
  return { s: site.s + direction * (STRAIGHT + RADIUS * Math.sin(angle)),
    u: site.side * (base + RADIUS * (1 - Math.cos(angle)) + tail * (FAR_CROSS - base - RADIUS)),
    ds: Math.cos(angle), du: site.side * direction * Math.sin(angle) };
}

export function plainsRailClears(s, u, site, radius = 0) {
  const along = Math.abs(s - site.s), base = Math.abs(site.u) + site.halfU + 1.5, cross = u * site.side - base;
  const straight = Math.hypot(Math.max(0, along - STRAIGHT), cross);
  const angle = Math.max(0, Math.min(Math.PI / 2, Math.atan2(along - STRAIGHT, RADIUS - cross)));
  const arc = Math.hypot(along - STRAIGHT - RADIUS * Math.sin(angle), cross - RADIUS * (1 - Math.cos(angle)));
  const tail = Math.hypot(along - PLAINS_RAIL_SPAN, cross - Math.max(RADIUS, Math.min(FAR_CROSS - base, cross)));
  return Math.min(straight, arc, tail) > 4 + radius;
}

export function buildPlainsRailway(chunk, site) {
  if (chunk.start >= site.s + PLAINS_RAIL_SPAN || chunk.start + CHUNK_LENGTH <= site.s - PLAINS_RAIL_SPAN) return;
  const parameterAt = s => {
    const distance = Math.abs(s - site.s);
    if (distance <= STRAIGHT) return s;
    return site.s + Math.sign(s - site.s) * (STRAIGHT + RADIUS * 2 / Math.PI * Math.asin(Math.min(1, (distance - STRAIGHT) / RADIUS)));
  };
  const first = chunk.start <= site.s - PLAINS_RAIL_SPAN ? site.s - PLAINS_RAIL_REACH : parameterAt(chunk.start);
  const last = chunk.start + CHUNK_LENGTH > site.s + PLAINS_RAIL_SPAN ? site.s + PLAINS_RAIL_REACH : parameterAt(chunk.start + CHUNK_LENGTH);
  if (first >= last) return;
  const vertices = new Map();
  const vertex = (row, col) => {
    const key = `${row},${col}`;
    if (!vertices.has(key)) vertices.set(key, plainsVertex(row, col));
    return vertices.get(key);
  };
  // Sample the shared terrain facets so both sides of a seam agree. The chunk's
  // own sampler can't see the neighbour's facet under a rail end. Sites keep
  // these cells out of pond basins.
  const ground = (s, u) => {
    const p = positionAt(s, u), baseRow = Math.floor(s / PLAINS_STEP);
    const column = PLAINS_COLUMNS.findIndex(cross => cross > u) - 1;
    for (let row = baseRow - 1; row <= baseRow + 1; row += .5) {
      if (!Number.isInteger(row) && plainsRowStep(row - .5) === 1) continue;
      for (let col = Math.max(0, column - 1); col <= Math.min(PLAINS_COLUMNS.length - 2, column + 1); col++) {
        const next = row + plainsRowStep(row);
        const a = vertex(row, col), b = vertex(next, col), c = vertex(row, col + 1), d = vertex(next, col + 1);
        const triangles = randomAt(Math.round(row * 2), col + 2805) > .5 ? [[a, b, d], [a, d, c]] : [[a, b, c], [b, d, c]];
        for (const [v0, v1, v2] of triangles) {
          const denominator = (v1.z - v2.z) * (v0.x - v2.x) + (v2.x - v1.x) * (v0.z - v2.z);
          const a = ((v1.z - v2.z) * (p.x - v2.x) + (v2.x - v1.x) * (p.z - v2.z)) / denominator;
          const b = ((v2.z - v0.z) * (p.x - v2.x) + (v0.x - v2.x) * (p.z - v2.z)) / denominator;
          if (a >= -1e-7 && b >= -1e-7 && a + b <= 1 + 1e-7) {
            return { x: p.x, y: a * v0.y + b * v1.y + (1 - a - b) * v2.y, z: p.z + chunk.start };
          }
        }
      }
    }
    return { x: p.x, y: plainsGroundHeight(s, u), z: p.z + chunk.start };
  };
  const at = (s, offset, lift = 0) => {
    const p = plainsRailPath(site, s);
    const result = ground(p.s - offset * p.du, p.u + offset * p.ds);
    result.y += lift;
    return result;
  };
  const { railwayRails, railwaySleepers, dirt, dirtTints, painted } = chunk.scenery;
  // Matches the dirt tint so the ballast needs no separate ground mesh.
  const tint = ballastTint;
  const face = (a, b, c) => {
    if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) { dirt.push(p.x, p.y, p.z); dirtTints.push(tint.r, tint.g, tint.b); }
  };
  for (let s = first; s < last - 1e-6;) {
    const end = Math.min(last, (Math.floor(s / 2) + 1) * 2);
    const a = at(s, -1.9, .07), b = at(end, -1.9, .07), c = at(s, 1.9, .07), d = at(end, 1.9, .07);
    face(a, b, c); face(b, d, c);
    // Rails stay continuous through field crossings. Scenery gives way.
    for (const side of [-1, 1]) chunk.beam(railwayRails, at(s, side * .75, .23), at(end, side * .75, .23), .13, '#6a675f');
    // Space sleepers by arc length so they don't crowd on bends.
    const count = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 1.4));
    for (let i = 0; i < count; i++) {
      const t = s + (end - s) * (i + .5) / count;
      chunk.beam(railwaySleepers, at(t, -1.25, .13), at(t, 1.25, .13), .25, '#5d4d3b');
    }
    s = end;
  }
  const carS = site.s + 24;
  if (carS >= chunk.start && carS < chunk.start + CHUNK_LENGTH) {
    const p = at(carS, 0), a = at(carS - 1, 0), b = at(carS + 1, 0), yaw = Math.atan2(a.x - b.x, a.z - b.z);
    painted.push({ p: [p.x, p.y + 2.25, p.z], scale: [2.7, 2.7, 11.5], r: [0, yaw, 0], color: '#8a5340' });
    painted.push({ p: [p.x, p.y + 3.75, p.z], scale: [2.9, .3, 11.8], r: [0, yaw, 0], color: '#6f4434' });
    for (const ds of [-3.9, 3.9]) {
      const q = at(carS + ds, 0);
      painted.push({ p: [q.x, q.y + .55, q.z], scale: [2.2, .7, 1.8], r: [0, yaw, 0], color: '#3c3a36' });
    }
  }
}
