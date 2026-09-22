import * as THREE from 'three';
import { randomAt, roadFrame } from './route.js';

const ACCENTS = ['#486f69', '#955e4f', '#aa894f', '#52687c', '#687451'];
const STONE = new THREE.Color('#c7c1b3'), IRON = new THREE.Color('#475359');

// Face coordinates are shared by trim and glazing, including the reversed
// riverbank frontage. Long strips follow the road instead of cutting a chord
// through a curved wall. All decoration goes into the existing chunk batches.
export function buildingFacades(chunk, b) {
  const { s0, s1, u0, u1 } = b, facing = u1 < 0 ? 1 : -1, front = facing > 0 ? u1 : u0;
  return [
    { length: s1 - s0, normal: [facing, 0, 0], point: (d, y, depth = .05) => chunk.at(s0 + d, front + facing * depth, y) },
    ...[[s0, -1], [s1, 1]].map(([s, direction]) => ({ length: u1 - u0, normal: [0, 0, -direction],
      point: (d, y, depth = .05) => chunk.at(s + direction * depth, u0 + d, y) })),
  ];
}

export function facadePanel(chunk, target, face, from, to, low, high, color, depth = .05) {
  let steps = 1;
  if (to - from > 4) {
    const a = face.point(from, low, depth), b = face.point(to, low, depth), mid = face.point((from + to) / 2, low, depth);
    steps = Math.max(1, Math.ceil(Math.sqrt(Math.hypot(mid.x - (a.x + b.x) / 2, mid.z - (a.z + b.z) / 2) / .018)));
  }
  for (let k = 0; k < steps; k++) {
    const a = from + (to - from) * k / steps, b = from + (to - from) * (k + 1) / steps;
    chunk.quad(target, [face.point(a, low, depth), face.point(b, low, depth), face.point(b, high, depth), face.point(a, high, depth)], color, face.normal);
  }
}

export function buildParapet(chunk, b, roof, color, height = .7) {
  const { s0, s1, u0, u1 } = b, target = chunk.scenery.blocks;
  const edges = [
    { length: s1 - s0, normal: [-1, 0, 0], point: (d, inset, y) => chunk.at(s0 + d, u0 + inset, y) },
    { length: s1 - s0, normal: [1, 0, 0], point: (d, inset, y) => chunk.at(s0 + d, u1 - inset, y) },
    { length: u1 - u0, normal: [0, 0, 1], point: (d, inset, y) => chunk.at(s0 + inset, u0 + d, y) },
    { length: u1 - u0, normal: [0, 0, -1], point: (d, inset, y) => chunk.at(s1 - inset, u0 + d, y) },
  ];
  const cap = color.clone().lerp(STONE, .45), inside = color.clone().multiplyScalar(.78);
  for (const edge of edges) {
    const a = edge.point(0, 0, roof), b = edge.point(edge.length, 0, roof), mid = edge.point(edge.length / 2, 0, roof);
    const count = Math.max(1, Math.ceil(Math.sqrt(Math.hypot(mid.x - (a.x + b.x) / 2, mid.z - (a.z + b.z) / 2) / .018)));
    for (let k = 0; k < count; k++) {
      const a = edge.length * k / count, z = edge.length * (k + 1) / count, p = edge.point;
      chunk.quad(target, [p(a, 0, roof), p(z, 0, roof), p(z, 0, roof + height), p(a, 0, roof + height)], color, edge.normal);
      chunk.quad(target, [p(a, .38, roof), p(z, .38, roof), p(z, .38, roof + height), p(a, .38, roof + height)], inside, edge.normal.map(n => -n));
      chunk.quad(target, [p(a, 0, roof + height), p(z, 0, roof + height), p(z, .38, roof + height), p(a, .38, roof + height)], cap, [0, 1, 0]);
    }
  }
}

// Broad glazing bands survive the fog without hundreds of individual panes.
// Interpolate the actual flat tower faces, so details cannot sink into their
// chords on bends. Reuse the skyline batch: no new draws, shadows or updates.
export function dressSkyline(chunk, b, base, roof, color, lane) {
  const { s0, s1, u0, u1 } = b, target = chunk.scenery.skyline;
  const corners = [[s0, u0], [s1, u0], [s1, u1], [s0, u1]].map(([s, u]) => chunk.at(s, u, 0));
  const glass = color.clone().multiplyScalar(lane < 2 ? .72 : .84), cap = color.clone().multiplyScalar(1.12);
  // Group more floors at the back; at most sixteen bands per face.
  const rows = Math.min(16, Math.max(3, Math.floor((roof - base) / (lane < 2 ? 6.4 : 9.6))));
  const pitch = (roof - base - 3) / rows;
  for (const [i, j, outward] of [[0, 1, [-1, 0, 0]], [1, 2, [0, 0, -1]], [3, 0, [0, 0, 1]]]) {
    const a = corners[i], b = corners[j], length = Math.hypot(b.x - a.x, b.z - a.z);
    const point = (t, y) => ({ x: a.x + (b.x - a.x) * t + outward[0] * .06, y, z: a.z + (b.z - a.z) * t + outward[2] * .06 });
    const band = (low, high, inset, tint) => chunk.quad(target,
      [point(inset, low), point(1 - inset, low), point(1 - inset, high), point(inset, high)], tint, outward);
    for (let row = 0; row < rows; row++) {
      const low = base + 2 + row * pitch;
      band(low, low + pitch * .55, 1 / length, glass);
    }
    band(roof - .65, roof - .15, 0, cap);
  }
}

export function rooftopTank(b, seed) {
  const chance = b.u0 > 0 && b.u0 < 40 ? .28 : b.u0 > -240 && b.u0 < 150 ? .12 : 0;
  if (b.simple || b.height < 12 || b.roof === 'gable' || randomAt(seed, 3521) >= chance) return null;
  return { s: b.s0 + (b.s1 - b.s0) * .65, u: b.u0 + (b.u1 - b.u0) * .66 };
}

export function dressBuilding(chunk, b, base, roof, seed) {
  const { blocks } = chunk.scenery, { s0, s1, u0, u1 } = b;
  const near = u0 > 0 && u0 < 40;
  const stone = new THREE.Color(b.wall).lerp(STONE, .55), faces = buildingFacades(chunk, b);
  const accent = new THREE.Color(ACCENTS[Math.abs(seed) % ACCENTS.length]);
  const trim = (bottom, top, depth, color = stone) => {
    for (const face of faces) facadePanel(chunk, blocks, face, 0, face.length, bottom, top, color, depth);
  };
  trim(base + .12, base + .72, .07);
  trim(base + 3.8, base + 4.05, .09);
  if (b.roof !== 'gable') {
    trim(roof - .5, roof - .12, .09);
    trim(roof - .75, roof - .5, .065, stone.clone().multiplyScalar(.7));
  }
  if (near) {
    // Slim stone piers frame masonry facades. The recessed glass remains the
    // dominant detail; a few broad bands read better than tiny brick textures.
    if (randomAt(seed, 3520) < .55) {
      for (const s of [s0 + .12, s1 - .4]) chunk.prism(blocks, s, s + .28, u0 - .12, u0 + .05, base + 4, roof - .2, stone.clone().multiplyScalar(.94));
    }
  } else {
    // Coarse architectural rhythm survives at driving distance: grouped bays,
    // a few belt courses, and corner piers instead of dense brick geometry.
    const masonry = b.windows !== 'ribbon', piers = randomAt(seed, 3540) < .7;
    for (const face of faces) {
      if (piers) for (const d of [.12, face.length - .52]) facadePanel(chunk, blocks, face, d, d + .4, base + .7, roof - .5, stone, .085);
      if (!masonry) {
        const count = Math.max(2, Math.floor(face.length / 7));
        for (let k = 1; k < count; k++) {
          const d = face.length * k / count;
          facadePanel(chunk, blocks, face, d - .12, d + .12, base + 4.1, roof - .8, stone, .09);
        }
      }
    }
    const floorHeight = u0 > -240 && u0 < 90 ? 3.2 : 4.2;
    if (masonry && !b.simple) for (let floor = 4; floor * floorHeight < b.height - 3; floor += 4) trim(base + floor * floorHeight + .35, base + floor * floorHeight + .58, .08);
    // Recessed entrances give residential blocks a ground floor, too.
    if (!b.shop && b.windows !== 'none') {
      const face = faces[0], mid = face.length * .5;
      facadePanel(chunk, blocks, face, mid - 1.15, mid + 1.15, base + .18, base + 3.45, stone, .095);
      facadePanel(chunk, blocks, face, mid - .85, mid + .85, base + .2, base + 2.9, IRON, .11);
      facadePanel(chunk, blocks, face, mid - 1.15, mid + 1.15, base + 2.95, base + 3.42, accent, .13);
      facadePanel(chunk, blocks, face, mid - .045, mid + .045, base + .25, base + 2.85, stone, .14);
    }
  }
  if (u0 < 0 && b.windows === 'none') {
    // Wharf workshops: broad lintels, shutter rails and a pitched canopy over
    // the loading bays. The geometry projects only into their reserved lot edge.
    const face = faces[0];
    for (let d = 2; d < face.length - 3; d += 6.5) {
      for (const x of [d - .16, d + 2.6]) facadePanel(chunk, blocks, face, x, x + .16, base + .25, base + 3.65, stone, .09);
      facadePanel(chunk, blocks, face, d - .16, d + 2.76, base + 3.3, base + 3.65, stone, .09);
      for (const y of [1.1, 2.1]) facadePanel(chunk, blocks, face, d, d + 2.6, base + y, base + y + .07, IRON, .09);
      chunk.quad(blocks, [face.point(d - .25, base + 3.85, .1), face.point(d + 2.85, base + 3.85, .1),
        face.point(d + 2.85, base + 3.55, .6), face.point(d - .25, base + 3.55, .6)], accent, [1, 1, 0]);
    }
    const middle = face.length / 2;
    facadePanel(chunk, blocks, face, middle - 2.6, middle + 2.6, roof - 2.9, roof - 1.8, accent, .09);
    facadePanel(chunk, blocks, face, middle - 1.6, middle + 1.6, roof - 2.52, roof - 2.25, stone, .11);
  }
  const tank = rooftopTank(b, seed);
  if (tank) {
    const { s, u } = tank;
    chunk.furniture('tank', s, u, -roadFrame(s).angle, { lift: roof - chunk.ground(s, u).y + .05 });
  }
}

// One deliberate roof composition per building: a stair house, glazed roof
// lantern, or a small planted terrace. These replace the anonymous flat lids
// behind the boulevard without adding meshes, lights, textures or animation.
export function buildRoofDetails(chunk, b, roof, seed) {
  if (b.roof === 'gable') return;
  const { blocks } = chunk.scenery, { s0, s1, u0, u1 } = b;
  const width = s1 - s0, depth = u1 - u0;
  if (width < 10 || depth < 8) return;
  const color = new THREE.Color(b.wall).lerp(STONE, .25), cap = new THREE.Color('#929797');
  const rs = s0 + width * .2, ru = u0 + depth * .24;
  const w = Math.min(6, width * .3), d = Math.min(6.5, depth * .3);
  const variant = Math.floor(randomAt(seed, 3550) * 3);
  const topPanel = (a, z, u, v, y, tint) => chunk.quad(blocks, [[a, u], [z, u], [z, v], [a, v]].map(([s, t]) => chunk.at(s, t, y)), tint, [0, 1, 0]);
  if (variant === 0 && b.height >= 12) {
    const h = b.height > 28 ? 4.5 : 2.9;
    chunk.prism(blocks, rs, rs + w, ru, ru + d, roof, roof + h, color);
    chunk.prism(blocks, rs - .15, rs + w + .15, ru - .15, ru + d + .15, roof + h, roof + h + .22, cap);
    const faces = buildingFacades(chunk, { s0: rs, s1: rs + w, u0: ru, u1: ru + d });
    facadePanel(chunk, blocks, faces[0], .6, 1.65, roof + .1, roof + 2.3, IRON, .06);
    for (const face of faces.slice(1)) facadePanel(chunk, blocks, face, .65, face.length - .65, roof + h - 1.4, roof + h - .55, IRON, .06);
  } else if (variant === 1 || b.windows === 'none') {
    chunk.prism(blocks, rs, rs + w, ru, ru + d, roof, roof + .35, cap);
    const middle = ru + d / 2;
    for (const [edge, normal] of [[ru, [-1, 1, 0]], [ru + d, [1, 1, 0]]]) {
      chunk.quad(blocks, [chunk.at(rs, edge, roof + .35), chunk.at(rs + w, edge, roof + .35),
        chunk.at(rs + w, middle, roof + 1.15), chunk.at(rs, middle, roof + 1.15)], new THREE.Color('#66818a'), normal);
      for (let k = 0; k <= 3; k++) {
        const s = rs + (w - .09) * k / 3;
        chunk.quad(blocks, [chunk.at(s, edge, roof + .39), chunk.at(s + .09, edge, roof + .39),
          chunk.at(s + .09, middle, roof + 1.19), chunk.at(s, middle, roof + 1.19)], cap, normal);
      }
    }
    for (const [s, normal] of [[rs, [0, 0, 1]], [rs + w, [0, 0, -1]]]) {
      const peak = chunk.at(s, middle, roof + 1.15);
      chunk.quad(blocks, [chunk.at(s, ru, roof + .35), chunk.at(s, ru + d, roof + .35), peak, peak], IRON, normal);
    }
  } else {
    topPanel(rs, rs + w, ru, ru + d, roof + .035, new THREE.Color('#98958a'));
    for (const s of [rs, rs + w - .7]) {
      chunk.prism(blocks, s, s + .7, ru, ru + d, roof + .04, roof + .6, color);
      chunk.prism(blocks, s + .09, s + .61, ru + .1, ru + d - .1, roof + .6, roof + 1.05, new THREE.Color('#657c51'));
    }
  }
}

export function buildShopfront(chunk, b, y0, seed) {
  const { s0, s1, u0 } = b, { blocks, lit } = chunk.scenery;
  const accent = new THREE.Color(ACCENTS[Math.abs(seed) % ACCENTS.length]);
  const frame = new THREE.Color('#b9b2a2'), glass = new THREE.Color('#354c54');
  const front = (start, end, low, high, color, target = blocks, depth = .08) => chunk.quad(target,
    [chunk.at(start, u0 - depth, y0 + low), chunk.at(end, u0 - depth, y0 + low), chunk.at(end, u0 - depth, y0 + high), chunk.at(start, u0 - depth, y0 + high)], color, [-1, 0, 0]);
  const bayCount = Math.max(2, Math.floor((s1 - s0) / 3.4)), width = (s1 - s0 - 1.2) / bayCount;
  const doorBay = Math.floor(randomAt(seed, 3530) * bayCount);
  for (let i = 0; i < bayCount; i++) {
    const a = s0 + .6 + i * width, end = a + width - .18, door = i === doorBay;
    const warm = !door && randomAt(seed + i, 3531) < .36;
    front(a - .1, end + .1, .28, 2.92, frame, blocks, .07);
    front(a + .08, end - .08, door ? .25 : .65, 2.75, warm ? new THREE.Color('#bbaa84') : glass, warm ? lit : blocks, .1);
    front(a + .08, end - .08, 2.18, 2.25, frame, blocks, .12);
    if (door) {
      front(a + .08, end - .08, .3, .56, accent, blocks, .12);
      front(end - .3, end - .24, 1.05, 1.4, frame, blocks, .14);
    } else {
      front(a - .06, end + .06, .27, .57, accent, blocks, .12);
      const mid = (a + end) / 2;
      front(mid - .035, mid + .035, .6, 2.78, frame, blocks, .12);
    }
  }
  chunk.prism(blocks, s0 + .22, s1 - .22, u0 - .22, u0 + .04, y0 + 2.98, y0 + 3.6, accent);
  // A small inset plaque on the fascia, without illegible text at driving scale.
  front(s0 + (s1 - s0) * .36, s0 + (s1 - s0) * .64, 3.16, 3.4, frame, blocks, .23);
  if (randomAt(seed, 3532) < .72) {
    const a0 = s0 + .45, a1 = s1 - .45, count = Math.ceil((a1 - a0) / .9);
    const striped = randomAt(seed, 3533) < .55;
    for (let i = 0; i < count; i++) {
      const a = a0 + (a1 - a0) * i / count, end = a0 + (a1 - a0) * (i + 1) / count;
      const color = striped && i % 2 ? new THREE.Color('#c0b9a5') : accent.clone();
      chunk.quad(blocks, [chunk.at(a, u0 - .24, y0 + 3.05), chunk.at(end, u0 - .24, y0 + 3.05), chunk.at(end, u0 - 1.5, y0 + 2.65), chunk.at(a, u0 - 1.5, y0 + 2.65)], color, [-1, 1, 0]);
      chunk.quad(blocks, [chunk.at(a, u0 - 1.5, y0 + 2.65), chunk.at(end, u0 - 1.5, y0 + 2.65), chunk.at(end, u0 - 1.5, y0 + 2.4), chunk.at(a, u0 - 1.5, y0 + 2.4)], color.clone().multiplyScalar(.88), [-1, 0, 0]);
    }
  }
  if (u0 < 40) {
    for (const s of [s0 + .8, s1 - .8]) {
      const y = chunk.ground(s, u0 - .65).y;
      chunk.prism(blocks, s - .45, s + .45, u0 - 1.1, u0 - .25, y, y + .55, new THREE.Color('#8c8575'));
      chunk.prism(blocks, s - .4, s + .4, u0 - 1.04, u0 - .31, y + .5, y + .95, new THREE.Color('#60794c'));
    }
  }
}
