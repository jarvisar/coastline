import * as THREE from 'three';
import { joinCoplanarFaces } from './surface-joins.js';
import { roadHeight, randomAt } from './route.js';
import { volcanicCrossing } from './volcanic-route.js';
import { solidSpan } from './colliders.js';
import { registerChunkResources } from './chunk-resources.js';

const steelMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .3, roughness: .82 });
const concreteMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
registerChunkResources('volcanic-bridge', { steelMaterial, concreteMaterial });
const colors = Object.fromEntries(Object.entries({
  web: '#45484a', flange: '#676962', edge: '#797b74', dark: '#292c2c', rust: '#665044',
  deck: '#3e3d40', concrete: '#68625b', cap: '#827b6d', stripe: '#b29855', line: '#c4bcb0', yellow: '#b5934c',
}).map(([key, value]) => [key, new THREE.Color(value)]));

// A short, heavy plate-girder crossing. Everything is baked into two chunk
// meshes; the clear opening has no columns planted in the molten channel.
export function buildVolcanicBridge(chunk) {
  const bridge = volcanicCrossing(chunk.start + 64);
  if (bridge.centre <= chunk.start || bridge.centre >= chunk.start + 128) return;
  const { start, end } = bridge;
  const steel = { positions: [], colors: [] }, concrete = { positions: [], colors: [] };
  const at = (s, u, h) => chunk.at(s, u, roadHeight(s) + h);
  function face(data, a, b, c, color) {
    for (const p of [a, b, c]) { data.positions.push(p.x, p.y, p.z); data.colors.push(color.r, color.g, color.b); }
  }
  function prism(data, p, color) {
    const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
    for (const [index, [a, b, c, d]] of faces.entries()) {
      const tint = color.clone().multiplyScalar(index === 0 ? .7 : index === 1 ? 1.04 : .9 + (index % 3) * .045);
      face(data, p[a], p[b], p[c], tint); face(data, p[a], p[c], p[d], tint);
    }
  }
  function box(data, s0, s1, u0, u1, low, high, color) {
    prism(data, [at(s0, u0, low), at(s1, u0, low), at(s1, u1, low), at(s0, u1, low),
      at(s0, u0, high), at(s1, u0, high), at(s1, u1, high), at(s0, u1, high)], color);
  }
  function beam(a, b, width, depth, color) {
    const direction = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(width / 2);
    const up = new THREE.Vector3().crossVectors(right, direction).normalize().multiplyScalar(depth / 2);
    const corner = (p, across, lift) => ({ x: p.x + right.x * across + up.x * lift, y: p.y + right.y * across + up.y * lift, z: p.z + right.z * across + up.z * lift });
    prism(steel, [corner(a, -1, -1), corner(b, -1, -1), corner(b, 1, -1), corner(a, 1, -1),
      corner(a, -1, 1), corner(b, -1, 1), corner(b, 1, 1), corner(a, 1, 1)], color);
  }
  const surface = (s0, s1, u0, u1, h, color, target = steel) => {
    const a = at(s0, u0, h), b = at(s1, u0, h), c = at(s1, u1, h), d = at(s0, u1, h);
    face(target, a, c, b, color); face(target, a, d, c, color);
  };

  // The deck follows the road's curve and grade in short plates. Its black
  // wearing course leaves room for narrow, recessed maintenance gratings.
  for (let s = start; s < end; s += 2) {
    const next = Math.min(s + 2, end);
    box(steel, s, next, -7.45, 7.45, -.48, -.025, colors.web);
    surface(s, next, -5.5, 5.5, .06, colors.deck, concrete);
    for (const side of [-1, 1]) {
      const u = side * 6.35;
      surface(s, next, u - .66, u + .66, .035, colors.dark);
      box(steel, s, next, side * 5.64 - .08, side * 5.64 + .08, -.01, .1, colors.flange);
      box(steel, s, next, side * 7.05 - .17, side * 7.05 + .17, -.06, .29, colors.flange);
      surface(s, next, side * 5.13 - .085, side * 5.13 + .085, .078, colors.line, concrete);
      surface(s, next, side * .14 - .045, side * .14 + .045, .078, colors.stripe, concrete);
      // The deep web sits below the deck; stiffeners and paired flange plates
      // give its side a strong horizontal silhouette without a tall truss.
      box(steel, s, next, side * 7.22 - .18, side * 7.22 + .18, -1.9, -.23, colors.web);
      for (const h of [-1.92, -.25]) box(steel, s, next, side * 7.22 - .46, side * 7.22 + .46, h - .12, h + .12, colors.flange);
      beam(at(s, side * 7.22, .95), at(next, side * 7.22, .95), .23, .19, colors.edge);
      beam(at(s, side * 7.22, .48), at(next, side * 7.22, .48), .13, .12, colors.flange);
    }
  }
  // Grating crossbars catch occasional slivers of light; they remain sparse
  // enough to read clearly from the overhead driving camera.
  for (let s = start + .3; s < end; s += .55) for (const side of [-1, 1]) {
    box(steel, s, s + .07, side * 6.35 - .62, side * 6.35 + .62, .025, .075, colors.flange);
  }
  const bays = Math.ceil((end - start) / 3.5), bay = (end - start) / bays;
  for (let i = 0; i <= bays; i++) {
    const s = start + i * bay;
    for (const side of [-1, 1]) {
      box(steel, s - .13, s + .13, side * 7.22 - .24, side * 7.22 + .24, -.3, 1.08, colors.flange);
      box(steel, s - .09, s + .09, side * 7.22 - .39, side * 7.22 + .39, -1.78, -.35, colors.flange);
      const outside = side * 7.66;
      for (const h of [-1.73, -.45]) for (const ds of [-.2, .2]) {
        box(steel, s + ds - .055, s + ds + .055, outside - .045, outside + .045, h - .055, h + .055, colors.edge);
      }
      if (i % 2 === 0) box(steel, s - .09, s + .09, side * 7.22 - .26, side * 7.22 + .26, .8, .94, colors.yellow);
      if (i < bays) solidSpan(chunk, at(s, side * 7.22, 0), at(s + bay, side * 7.22, 0), .27);
    }
    if (i < bays) {
      beam(at(s, -6.8, -1.27), at(s, 6.8, -1.27), .25, .55, colors.web);
      beam(at(s, -6.7, -1.36), at(s + bay, 6.7, -1.36), .16, .16, colors.flange);
      beam(at(s, 6.7, -1.4), at(s + bay, -6.7, -1.4), .16, .16, colors.flange);
    }
  }
  for (const [s, direction] of [[start, -1], [end, 1]]) {
    box(concrete, s - 1.7, s + 1.7, -8.05, 8.05, -6.8, -.56, colors.concrete);
    box(concrete, s - 1.9, s + 1.9, -8.35, 8.35, -.72, -.35, colors.cap);
    // Narrow expansion plates interrupt the wearing course at each landing.
    surface(s - .17, s + .17, -5.5, 5.5, .084, colors.dark);
    for (const d of [-.22, .22]) surface(s + d - .055, s + d + .055, -5.5, 5.5, .085, colors.flange);
    for (const side of [-1, 1]) {
      // Battered retaining cheeks sink into the embankment. Their far caps
      // follow the actual ground instead of projecting flat concrete spokes.
      const landing = (along, across, raised) => {
        const p = at(along, across, 0), floor = chunk.ground(p.x, p.z) ?? p.y;
        p.y = Math.min(p.y + raised, floor + .12); return p;
      };
      const a = landing(s + direction * .5, side * 7.4, .16), b = landing(s + direction * 4.2, side * 9.5, .08);
      const c = landing(s + direction * 4.2, side * 10.2, .08), d = landing(s + direction * .5, side * 8.4, .16);
      let top = [a, b, c, d];
      if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0) top.reverse();
      prism(concrete, [...top.map(p => ({ ...p, y: p.y - 5.5 })), ...top], colors.concrete);
      box(concrete, s - .8, s + .8, side * 7.55 - .6, side * 7.55 + .6, -2.6, .34, colors.concrete);
      box(concrete, s - .9, s + .9, side * 7.55 - .68, side * 7.55 + .68, .26, .4, colors.cap);
      box(steel, s - .3, s + .3, side * 7.22 - .36, side * 7.22 + .36, -.08, 1.23, colors.dark);
      for (let n = 0; n < 3; n++) box(steel, s - .31, s + .31, side * 7.22 - .37, side * 7.22 + .37, .22 + n * .27, .34 + n * .27, colors.yellow);
      // Short splayed approach rails tie the industrial deck into the road.
      for (let j = 0; j < 3; j++) {
        const t0 = j / 3, t1 = (j + 1) / 3;
        const p = at(s + direction * t0 * 6, side * (7.22 + t0 * .55), .95 - t0 * .15);
        const q = at(s + direction * t1 * 6, side * (7.22 + t1 * .55), .95 - t1 * .15);
        beam(p, q, .2, .18, colors.flange);
        beam({ ...p, y: p.y - .42 }, { ...q, y: q.y - .42 }, .13, .12, colors.flange);
        const along = s + direction * t1 * 6, across = side * (7.22 + t1 * .55);
        box(steel, along - .09, along + .09, across - .13, across + .13, -.3, .99 - t1 * .15, colors.flange);
        solidSpan(chunk, p, q, .2);
      }
    }
  }
  // A few oxidised plates break the uniform paint, concentrated underneath.
  for (let n = 0; n < 5; n++) {
    const s = start + 2 + randomAt(bridge.index, 80730 + n) * (end - start - 4), side = n % 2 ? -1 : 1;
    box(steel, s, s + .6, side * 7.41 - .012, side * 7.41 + .012, -1.65, -.95, colors.rust);
  }
  for (const [data, material, name] of [[steel, steelMaterial, 'volcanic-bridge-steel'], [concrete, concreteMaterial, 'volcanic-bridge-abutments']]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
    joinCoplanarFaces(geometry);
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    chunk.addMesh(geometry, material, name, true);
  }
  chunk.features.bridges.push({ ...bridge, deckHalfWidth: 7.45, clearance: 3.35, kind: 'plate-girder' });
}
