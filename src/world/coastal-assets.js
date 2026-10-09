import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { randomAt } from './route.js';
import { geometryFrom } from './level.js';


function crag(seed) {
  const vertices = [], colors = [], sides = 8;
  // One hand-tuned crown per variant. Uneven shoulder heights avoid horizontal rings.
  const profile = [
    { crown: [.76, .93, .81, .56, .62, .88, 1.02, .86], width: [.68, .59, .66, .81, .72, .51, .47, .63], lean: [-.13, .09], ridge: [1.04, 1.12] },
    { crown: [.49, .57, .73, .96, 1.04, .89, .62, .41], width: [.84, .76, .59, .52, .48, .64, .77, .83], lean: [-.22, -.08], ridge: [.96, .86] },
    { crown: [.82, 1.02, .91, .55, .69, .99, .83, .48], width: [.57, .48, .62, .57, .75, .53, .46, .73], lean: [.16, -.14], ridge: [1.12, .92] },
  ][seed - 1];
  const outline = Array.from({ length: sides }, (_, i) => ({
    angle: (i + (randomAt(seed * 19 + i, 221) - .5) * .28) / sides * Math.PI * 2,
    radius: .84 + randomAt(seed * 31 + i, 222) * .28,
  }));
  const rings = Array.from({ length: 4 }, (_, layer) => outline.map(({ angle, radius }, i) => {
    const shoulder = .13 + randomAt(seed * 43 + i, 223) * .4;
    const heights = [-1.04, -.38 + randomAt(seed, i + 224) * .23, Math.min(shoulder, profile.crown[i] - .2), profile.crown[i]];
    const widths = [.82, 1, .79 + randomAt(seed, i + 225) * .24, profile.width[i]];
    const r = radius * widths[layer];
    return [Math.cos(angle) * r + profile.lean[0] * layer / 3,
      heights[layer], Math.sin(angle) * r + profile.lean[1] * layer / 3];
  }));
  const warm = new THREE.Color('#fff2d9'), cool = new THREE.Color('#bac8ce');
  const edgeA = new THREE.Vector3(), edgeB = new THREE.Vector3();
  const face = (a, b, c, joint) => {
    vertices.push(...a, ...b, ...c);
    edgeA.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    edgeB.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const up = Math.max(0, edgeA.cross(edgeB).normalize().y);
    // Warmer on upward faces. The random tint is per joint, not per triangle.
    const color = cool.clone().lerp(warm, .32 + up * .53 + randomAt(seed, joint + 81) * .12);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    for (let layer = 0; layer < rings.length - 1; layer++) {
      const a = rings[layer][i], b = rings[layer + 1][i], c = rings[layer][j], d = rings[layer + 1][j];
      if ((i + layer + seed) % 2) { face(a, b, c, i); face(c, b, d, i); }
      else { face(a, b, d, i); face(a, d, c, i); }
    }
    face([0, -1.2, 0], rings[0][i], rings[0][j], i);
  }
  // Close the top with two offset ridge points instead of a single summit.
  const top = rings.at(-1);
  const front = [profile.lean[0] - .11, profile.ridge[0], .25 + profile.lean[1]];
  const back = [profile.lean[0] + .13, profile.ridge[1], -.24 + profile.lean[1]];
  for (let i = 0; i < sides; i++) face(i < 4 ? front : back, top[(i + 1) % sides], top[i], i);
  face(top[0], back, front, 0); face(top[4], front, back, 4);
  return geometryFrom(vertices, colors);
}

// Coast redwood: a tall, narrow spire of drooping tiers. The trunk is a
// separate instance so it can take the redwood bark colour.
function redwood(seed) {
  const vertices = [], colors = [], tiers = 5, sides = 7;
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / (tiers - 1), base = .14 + tier * .27;
    const radius = (.4 - t * .26) * (.85 + randomAt(seed * 7 + tier, 3101) * .3);
    const tip = [(randomAt(seed, tier + 3102) - .5) * .04, base + .36 - t * .05, 0];
    const rim = Array.from({ length: sides }, (_, i) => {
      const angle = (i + randomAt(i + seed * 13, tier + 3103) * .4) / sides * Math.PI * 2 + tier * .9;
      const r = radius * (.8 + randomAt(i + seed * 17, tier + 3104) * .35);
      return [Math.cos(angle) * r, base - .07 + (randomAt(i, tier + seed * 11 + 3105) - .5) * .05, Math.sin(angle) * r];
    });
    for (let i = 0; i < sides; i++) {
      const a = rim[i], b = rim[(i + 1) % sides];
      vertices.push(...a, ...tip, ...b, ...a, ...b, tip[0], base + .02, tip[2]);
      const lit = .76 + t * .14 + randomAt(i, seed + tier * 7 + 3106) * .08;
      for (let k = 0; k < 3; k++) colors.push(lit, lit, lit * .97);
      for (let k = 0; k < 3; k++) colors.push(.56, .56, .56);
    }
  }
  return geometryFrom(vertices, colors);
}

// Crown lobes shaded lighter on top so a single instance colour reads as foliage.
// Flattened cypress plates get away with a 36-face dodecahedron. Round oak
// crowns need the 80-face icosahedron or their big facets look cut.
function lobe(scale, position, salt = 0, round = false) {
  const g = round ? new THREE.IcosahedronGeometry(1, 1) : new THREE.DodecahedronGeometry(1, 0);
  g.scale(...scale); g.translate(...position);
  const colors = [], normals = g.attributes.normal;
  for (let j = 0; j < normals.count; j += 3) {
    const up = (normals.getY(j) + normals.getY(j + 1) + normals.getY(j + 2)) / 3;
    const shade = .72 + Math.max(0, up) * .28 + randomAt(j, salt + 916) * .04;
    for (let k = 0; k < 3; k++) colors.push(shade, shade, shade * .96);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}
function limbs() {
  const bark = [], up = new THREE.Vector3(0, 1, 0);
  const branch = (from, to, width) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(width * .58, width, direction.length(), 5, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize()));
    g.translate(...a.add(b).multiplyScalar(.5).toArray()); bark.push(g);
  };
  return { bark, branch };
}
function merged(bark, leaves) {
  const result = { bark: mergeGeometries(bark), leaves: mergeGeometries(leaves) };
  for (const part of [...bark, ...leaves]) part.dispose();
  return result;
}

// Monterey cypress, sheared flat by the sea wind. The crown streams toward +x,
// which the scenery turns inland, and the top is clipped level.
function cypress() {
  const { bark, branch } = limbs(), leaves = [];
  branch([0, -.09, 0], [.1, .3, .02], .08);
  branch([.1, .3, .02], [.26, .55, -.02], .058);
  const plates = [
    [-.08, .62, .04, .3, .09, .26], [.24, .7, -.12, .38, .1, .3], [.3, .66, .22, .34, .09, .28],
    [.56, .64, .02, .36, .09, .3], [.32, .79, .04, .42, .08, .36], [.02, .74, -.18, .26, .08, .22],
  ];
  plates.forEach(([x, y, z, sx, sy, sz], i) => {
    branch([.2 + x * .2, .45 + i * .015, z * .3], [x * .85, y - .05, z * .8], .03);
    leaves.push(lobe([sx, sy, sz], [x, y, z], i * 31));
  });
  return merged(bark, leaves);
}

// Coast live oak: a short trunk forking into a broad, rounded crown.
function oak() {
  const { bark, branch } = limbs(), leaves = [];
  branch([0, -.08, 0], [.03, .27, 0], .075);
  leaves.push(lobe([.46, .3, .44], [.02, .66, 0], 7, true));
  for (let i = 0; i < 3; i++) {
    const angle = i * 2.1 + .4 + randomAt(i, 3111) * .3, radius = .32 + randomAt(i, 3112) * .08;
    const crown = [Math.cos(angle) * radius, .5 + randomAt(i, 3113) * .08, Math.sin(angle) * radius];
    branch([.03, .25, 0], [crown[0] * .8, crown[1] - .06, crown[2] * .8], .04);
    leaves.push(lobe([.36 + randomAt(i, 3114) * .06, .26, .34], crown, i * 17, true));
  }
  return merged(bark, leaves);
}

export const coastalCrags = [crag(1), crag(2), crag(3)];
export const coastalRedwoods = [redwood(1), redwood(2)];
export const coastalCypress = cypress();
export const coastalOak = oak();

function scrub(seed) {
  // Low mound of overlapping lobes, lighter on top. The base sits at y = 0.
  const lobes = [
    [[0, .46, 0, .74, .54, .7], [.56, .32, .24, .52, .38, .48], [-.5, .3, -.2, .56, .4, .52], [.06, .28, -.58, .46, .34, .42]],
    [[0, .42, 0, .7, .5, .76], [.46, .34, -.36, .54, .42, .46], [-.44, .28, .36, .5, .34, .48]],
  ][seed - 1];
  const parts = lobes.map(([x, y, z, sx, sy, sz], i) => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(sx, sy, sz); g.rotateY(i * 1.3 + seed); g.translate(x, y, z);
    g.computeVertexNormals();
    const colors = [], normals = g.attributes.normal;
    for (let j = 0; j < normals.count; j += 3) {
      const up = (normals.getY(j) + normals.getY(j + 1) + normals.getY(j + 2)) / 3;
      const shade = .74 + Math.max(0, up) * .3 + randomAt(j + i * 60, seed + 2291) * .06;
      for (let k = 0; k < 3; k++) colors.push(shade, shade, shade * .95);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return g;
  });
  const result = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  result.computeBoundingSphere();
  return result;
}
export const coastalScrub = [scrub(1), scrub(2)];

function sedge() {
  const vertices = [], colors = [];
  for (let blade = 0; blade < 9; blade++) {
    const angle = blade * 2.4, height = .5 + randomAt(blade, 2271) * .55;
    const x = Math.cos(angle), z = Math.sin(angle), width = .065;
    const base = [x * .12, -.08, z * .12];
    const left = [base[0] - z * width, 0, base[2] + x * width];
    const right = [base[0] + z * width, 0, base[2] - x * width];
    const mid = [x * .3, height * .64, z * .3], tip = [x * .55, height, z * .55];
    for (const triangle of [[left, right, mid], [right, tip, mid]]) {
      for (const p of [...triangle, ...triangle.toReversed()]) {
        vertices.push(...p);
        const light = .78 + Math.max(0, p[1]) * .22;
        colors.push(light, light, light * .91);
      }
    }
  }
  const g = geometryFrom(vertices, colors);
  // Point all normals up so back-facing blades don't render black.
  const normals = g.attributes.normal;
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
  return g;
}
export const coastalSedge = sedge();

// Buckets terrain triangles by XZ cell once so each height lookup checks only
// a few faces instead of raycasting the whole chunk.
export function terrainSampler(mesh, topmost = false) {
  const positions = mesh.geometry.attributes.position, buckets = new Map(), step = 16;
  // Integer keys avoid string building per lookup. They wrap every 524 km,
  // far larger than a chunk.
  const cell = (x, z) => ((Math.floor(x / step) & 0x7fff) << 15) | (Math.floor(z / step) & 0x7fff);
  for (let i = 0; i < positions.count; i += 3) {
    const a = { x: positions.getX(i), y: positions.getY(i), z: positions.getZ(i) };
    const b = { x: positions.getX(i + 1), y: positions.getY(i + 1), z: positions.getZ(i + 1) };
    const c = { x: positions.getX(i + 2), y: positions.getY(i + 2), z: positions.getZ(i + 2) }, points = [a, b, c];
    const lowX = Math.floor(Math.min(a.x, b.x, c.x) / step), highX = Math.floor(Math.max(a.x, b.x, c.x) / step);
    const lowZ = Math.floor(Math.min(a.z, b.z, c.z) / step), highZ = Math.floor(Math.max(a.z, b.z, c.z) / step);
    for (let x = lowX; x <= highX; x++) for (let z = lowZ; z <= highZ; z++) {
      const key = ((x & 0x7fff) << 15) | (z & 0x7fff), bucket = buckets.get(key);
      if (bucket) bucket.push(points); else buckets.set(key, [points]);
    }
  }
  const sample = (x, z) => {
    let height = null;
    for (const [a, b, c] of buckets.get(cell(x, z)) ?? []) {
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(det) < 1e-8) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
      if (u >= -.00001 && v >= -.00001 && u + v <= 1.00001) {
        const y = u * a.y + v * b.y + (1 - u - v) * c.y;
        if (!topmost) return y;
        height = height === null ? y : Math.max(height, y);
      }
    }
    return height;
  };
  // Returns the face under a point as a height function over its plane.
  // Nearby lookups usually hit the same face, so the last one is tried first.
  const planeOf = ([a, b, c]) => {
    const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(det) < 1e-8) return null;
    const plane = (x, z) => {
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
      return u * a.y + v * b.y + (1 - u - v) * c.y;
    };
    plane.contains = (x, z) => {
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
      return u >= -.00001 && v >= -.00001 && u + v <= 1.00001;
    };
    return plane;
  };
  const planes = new WeakMap();
  let last = null;
  sample.plane = (x, z) => {
    if (last?.contains(x, z)) return last;
    for (const triangle of buckets.get(cell(x, z)) ?? []) {
      if (!planes.has(triangle)) planes.set(triangle, planeOf(triangle));
      const plane = planes.get(triangle);
      if (plane?.contains(x, z)) return (last = plane);
    }
    return null;
  };
  return sample;
}
