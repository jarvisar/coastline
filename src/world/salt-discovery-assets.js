import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { joinCoplanarFaces, roofShell } from './surface-joins.js';
import { registerChunkResources } from './chunk-resources.js';
import { randomAt } from './route.js';
import { saltBoulders } from './salt-assets.js';
import { discoveryMaterial } from './salt-materials.js';
import { SALT_ISLANDS, ISLAND_LANDING } from './salt-discoveries.js';

// Models face the road along -x and oncoming traffic along +z, standing on
// the crust at y = 0.
const up = new THREE.Vector3(0, 1, 0);
const turn = rotation => rotation.isQuaternion ? rotation : new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));

// Flat-coloured parts merged into one shared model. `frame` places a whole
// sub-assembly, such as a wagon knocked off its rails.
class SaltParts {
  constructor() { this.parts = []; this.frames = [new THREE.Matrix4()]; }
  frame(position, rotation, build) {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...position), turn(rotation), new THREE.Vector3(1, 1, 1));
    this.frames.push(this.frames.at(-1).clone().multiply(local)); build(); this.frames.pop();
  }
  // A null colour keeps the source's own vertex colours.
  add(source, position = [0, 0, 0], color = null, rotation = [0, 0, 0]) {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position), turn(rotation), new THREE.Vector3(1, 1, 1)).premultiply(this.frames.at(-1)));
    if (color !== null) {
      const c = new THREE.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    this.parts.push(g);
  }
  box(p, size, color, rotation) { this.add(new THREE.BoxGeometry(...size), p, color, rotation); }
  cylinder(p, top, bottom, height, color, sides = 8, rotation) { this.add(new THREE.CylinderGeometry(top, bottom, height, sides), p, color, rotation); }
  // Prism from a to b, `radius` at a and `end` at b.
  beam(a, b, radius, color, sides = 6, end = radius) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
    const g = new THREE.CylinderGeometry(end, radius, direction.length(), sides);
    this.add(g, from.add(to).multiplyScalar(.5).toArray(), color, new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
  }
  lump(p, scale, color, rotation) { const g = new THREE.IcosahedronGeometry(1, 0); g.scale(...scale); this.add(g, p, color, rotation); }
  stone(p, scale, color, rotation) { const g = new THREE.DodecahedronGeometry(1, 0); g.scale(...scale); this.add(g, p, color, rotation); }
  // Triangles given as flat [x, y, z] lists, wound to face up in plan.
  faces(triangles, color) {
    const positions = [];
    for (let [a, b, c] of triangles) {
      if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) < 0) [b, c] = [c, b];
      positions.push(...a, ...b, ...c);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.add(g, [0, 0, 0], color);
  }
  // Organic models have no overlapping flat faces to join.
  finish(join = true) {
    let g = mergeGeometries(this.parts); this.parts.forEach(part => part.dispose());
    if (join) g = joinCoplanarFaces(g);
    if (g.index) g = g.toNonIndexed();
    g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
}

// The same model reflected across one axis, rewound so its faces still point out.
function mirrored(source, axis) {
  const g = source.clone(), position = g.attributes.position;
  for (let i = 0; i < position.count; i++) position.setComponent(i, axis, -position.getComponent(i, axis));
  for (const attribute of Object.values(g.attributes)) for (let i = 0; i < attribute.count; i += 3) for (let k = 0; k < attribute.itemSize; k++) {
    const b = attribute.getComponent(i + 1, k);
    attribute.setComponent(i + 1, k, attribute.getComponent(i + 2, k)); attribute.setComponent(i + 2, k, b);
  }
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// Train graveyard: a locomotive, its tender and three wagons rusting on a
// short length of half-buried metre-gauge track. The locomotive leads toward +z.
const RUST = '#9b4f2b', RUST_DARK = '#7b3d25', RUST_LIGHT = '#b8693b', SOOT = '#332a27', IRON = '#4d3d35', RED_OXIDE = '#8e3a28';
const RAIL = '#6b4c3c', SALT = '#f5efe5', SALT_SHADE = '#e7ded0', SLEEPERS = ['#6b5846', '#5d4b3c', '#7a6552'];

function wheel(p, x, y, z, radius, color = SOOT) {
  p.cylinder([x, y, z], radius, radius, .16, color, 10, [0, 0, Math.PI / 2]);
  p.cylinder([x + Math.sign(x) * .1, y, z], radius * .32, radius * .32, .06, RUST_DARK, 6, [0, 0, Math.PI / 2]);
}
function bogie(p, z, radius = .45) {
  for (const dz of [-.8, .8]) for (const x of [-.62, .62]) wheel(p, x, radius, z + dz, radius);
  p.box([0, radius + .1, z], [1.55, .3, 2.2], IRON);
}
function locomotive(p) {
  for (const z of [-1.7, 0, 1.7]) for (const x of [-.62, .62]) wheel(p, x, .7, z, .7);
  for (const x of [-.62, .62]) wheel(p, x, .42, 3.95, .42);
  for (const x of [-.79, .79]) p.box([x, .78, 0], [.06, .12, 3.7], RUST_LIGHT);
  p.box([0, 1.12, .8], [1.45, .4, 9.2], IRON);
  for (const x of [-1.05, 1.05]) p.box([x, 1.38, 1.3], [.62, .06, 7.2], RUST_DARK);
  p.cylinder([0, 2.2, 1.55], .8, .8, 4.9, RUST, 10, [Math.PI / 2, 0, 0]);
  for (const z of [.2, 1.6, 3]) p.cylinder([0, 2.2, z], .84, .84, .1, RUST_DARK, 10, [Math.PI / 2, 0, 0]);
  p.cylinder([0, 2.2, 4.55], .86, .86, 1.1, SOOT, 10, [Math.PI / 2, 0, 0]);
  p.cylinder([0, 2.2, 5.13], .64, .64, .08, '#4a3a32', 10, [Math.PI / 2, 0, 0]);
  p.cylinder([0, 2.2, 5.2], .12, .12, .08, RUST_LIGHT, 6, [Math.PI / 2, 0, 0]);
  // The stack leans where it has rusted through.
  p.frame([0, 2.9, 4.55], [.1, 0, .07], () => {
    p.cylinder([0, .5, 0], .27, .24, 1, SOOT, 8);
    p.cylinder([0, 1.05, 0], .38, .3, .2, SOOT, 8);
  });
  p.cylinder([0, 3.1, 2.45], .36, .41, .46, RUST_LIGHT, 8); p.lump([0, 3.34, 2.45], [.37, .15, .37], RUST_LIGHT);
  p.cylinder([0, 3.02, 1], .27, .31, .34, RUST, 8); p.lump([0, 3.2, 1], [.28, .12, .28], RUST);
  p.box([0, 3.12, 4.92], [.36, .36, .34], SOOT); p.box([0, 3.12, 5.1], [.24, .22, .03], '#ddd3bc');
  for (const x of [-.88, .88]) p.beam([x, 2.62, -.7], [x, 2.62, 4.2], .03, RUST_LIGHT, 4);
  // Cab, with a hole rusted through one side and the roof sagging.
  p.box([0, 1.9, -1.55], [1.5, .9, 1.3], SOOT);
  for (const x of [-1.2, 1.2]) {
    p.box([x, 2.1, -2.35], [.1, 1.4, 2.7], RUST_DARK);
    for (const z of [-1.07, -3.62]) p.box([x, 3.4, z], [.1, 1.2, .22], RUST_DARK);
  }
  p.box([0, 2.7, -.98], [2.5, 2.6, .1], RUST);
  for (const x of [-.7, .7]) p.box([x, 3.4, -.92], [.5, .5, .04], '#211b19');
  p.box([0, 1.5, -3.68], [2.5, .25, .1], IRON);
  p.box([0, 4.05, -2.35], [2.8, .12, 3.2], RUST_DARK, [.04, 0, .08]);
  p.box([-1.26, 2.25, -2.9], [.03, .55, .75], '#3b2922');
  // Sun-bleached cab plates and the two surviving boarding steps.
  for (const side of [-1, 1]) {
    p.box([side * 1.26, 2.38, -1.8], [.035, .3, .62], '#c29b69');
    for (const z of [-1.98, -1.8, -1.62]) p.box([side * 1.282, 2.38, z], [.015, .16, .045], RUST_DARK);
    for (let k = 0; k < 2; k++) p.box([side * (1.3 + k * .14), .98 - k * .3, -3.2], [.36, .08, .65], IRON);
  }
  // Buffer beam and cowcatcher.
  p.box([0, 1.12, 5.35], [2.3, .44, .22], RED_OXIDE);
  for (const x of [-.8, .8]) p.cylinder([x, 1.12, 5.62], .15, .15, .34, SOOT, 8, [Math.PI / 2, 0, 0]);
  p.frame([0, .5, 5.95], [.83, 0, 0], () => {
    p.box([0, 0, 0], [1.9, .06, 1.3], RUST_DARK);
    for (const x of [-.75, -.37, 0, .37, .75]) p.box([x, .07, 0], [.08, .1, 1.35], RUST);
  });
}
function tender(p) {
  bogie(p, -1.5); bogie(p, 1.5);
  p.box([0, .98, 0], [2.1, .24, 5.3], IRON);
  p.box([0, 1.2, 0], [2.3, .2, 5.1], SOOT);
  for (const x of [-1.1, 1.1]) p.box([x, 1.95, 0], [.1, 1.5, 5.1], RUST);
  for (const z of [-2.5, 2.5]) p.box([0, 1.95, z], [2.3, 1.5, .1], RUST_DARK);
  for (const x of [-1.13, 1.13]) p.box([x, 2.72, 0], [.16, .1, 5.2], RUST_LIGHT);
  p.box([0, 1.75, -1.35], [2.1, 1, 2.3], '#6f3924');
  p.cylinder([0, 2.3, -1.6], .32, .32, .12, SOOT, 8);
  // The last of the coal.
  p.lump([0, 1.4, 1.1], [.85, .3, 1.05], '#2a2422');
  p.box([-1.18, 1.8, 1.4], [.03, .6, .5], '#3b2922');
}
function boxcar(p) {
  const body = '#98492d', rib = '#6e3421';
  bogie(p, -2.5); bogie(p, 2.5);
  p.box([0, 1.02, 0], [2.2, .28, 7.2], IRON);
  // Dark shell inside, seen through the doorways and the hole in the roof.
  p.box([0, 2.3, 0], [2.36, 2.2, 7.1], '#2a211e');
  for (const x of [-1.24, 1.24]) {
    for (const [a, b] of [[-3.6, -.95], [.95, 3.6]]) p.box([x, 2.3, (a + b) / 2], [.08, 2.25, b - a], body);
    p.box([x, 3.22, 0], [.08, .42, 1.9], body);
    for (const z of [-3.3, -2.2, -1.1, 1.1, 2.2, 3.3]) p.box([x * 1.035, 2.3, z], [.05, 2.25, .1], rib);
  }
  for (const z of [-3.6, 3.6]) p.box([0, 2.3, z], [2.56, 2.25, .08], body);
  // A slipped sliding door still carries islands of the old blue-green paint.
  for (const side of [-1, 1]) {
    p.box([side * 1.36, 3.16, 0], [.08, .09, 4.4], IRON);
    p.frame([side * 1.39, 2.18, -1.26], [side * .045, 0, 0], () => {
      p.box([0, 0, 0], [.08, 1.9, 1.55], '#647c73');
      for (const z of [-.66, 0, .66]) p.box([side * .055, 0, z], [.035, 1.92, .07], '#495b50');
      for (const [y, z, h, w] of [[-.77, -.4, .36, .65], [.73, .45, .4, .5], [-.32, .57, .26, .28]]) {
        p.box([side * .047, y, z], [.018, h, w], body);
      }
      p.box([side * .1, -.04, .49], [.09, .3, .05], IRON);
    });
    // A little worn cream livery breaks up the large rust-coloured panels.
    p.box([side * 1.291, 2.77, 2.55], [.018, .22, .65], '#c1a079');
  }
  for (const x of [-.9, -.48]) p.beam([x, 1.25, 3.71], [x, 3.35, 3.71], .035, IRON, 4);
  for (let y = 1.4; y < 3.3; y += .38) p.beam([-.9, y, 3.73], [-.48, y, 3.73], .03, RUST_LIGHT, 4);
  for (const [a, b] of [[-3.75, -1.4], [.2, 3.75]]) for (const side of [-1, 1]) {
    p.box([side * .66, 3.5, (a + b) / 2], [1.36, .07, b - a], RUST_DARK, [0, 0, -side * .12]);
  }
  p.box([-.66, 3.5, -.6], [1.36, .07, 1.6], RUST_DARK, [0, 0, .12]);
  p.box([.45, 3.05, -.6], [1.3, .07, 1.5], RUST_DARK, [.5, .3, .9]);
}
function gondola(p) {
  const body = '#a4552f';
  bogie(p, -2.2); bogie(p, 2.2);
  p.box([0, 1.02, 0], [2.2, .28, 6.6], IRON);
  p.box([0, 1.22, 0], [2.4, .14, 6.6], '#5a3a2c');
  // One side has lost a panel; it lies on the salt nearby.
  for (const x of [-1.16, 1.16]) for (const [a, b] of x < 0 ? [[-3.3, -.4], [1.6, 3.3]] : [[-3.3, 3.3]]) {
    p.box([x, 1.85, (a + b) / 2], [.08, 1.1, b - a], body);
  }
  for (const z of [-3.26, 3.26]) p.box([0, 1.85, z], [2.4, 1.1, .08], RUST_DARK);
  for (const x of [-1.22, 1.22]) for (let z = -3; z <= 3; z++) if (x > 0 || z < -.4 || z > 1.6) p.box([x, 1.85, z], [.05, 1.15, .1], RUST_DARK);
}
function skeleton(p) {
  bogie(p, -2.1); bogie(p, 2.1);
  for (const x of [-1.05, 1.05]) p.box([x, 1.12, 0], [.16, .3, 6.4], RUST_DARK);
  for (let z = -3; z <= 3; z += 1.5) p.box([0, 1.12, z], [2.1, .16, .14], RUST);
  p.box([0, 1.08, 0], [.3, .26, 6.4], IRON);
  for (const [x, z] of [[-1.05, -2.8], [1.05, -2.8], [-1.05, 1.2]]) p.box([x, 1.8, z], [.12, 1.2, .12], RUST);
  p.box([.2, 1.32, 1.6], [2.2, .08, .35], SLEEPERS[2], [0, .1, 0]);
}
function trainGraveyard() {
  const p = new SaltParts();
  // Rails come and go under the crust. Only some sleepers show.
  for (const [k, x] of [[0, -.6], [1, .6]]) for (let z = -23, n = 0; z < 22.5; n++) {
    const end = Math.min(22.5, z + 3 + randomAt(n, 9102 + k) * 6), depth = randomAt(n, 9104 + k) * .05;
    p.box([x, .03 - depth, (z + end) / 2], [.09, .14, end - z], RAIL);
    z = end + (randomAt(n, 9103 + k) < .3 ? .6 + randomAt(n, 9105 + k) * 1.6 : .08);
  }
  for (let z = -22.6, n = 0; z < 22; z += .95, n++) {
    if (randomAt(n, 9106) < .45) continue;
    p.box([(randomAt(n, 9107) - .5) * .2, -.03 + randomAt(n, 9108) * .05, z], [2.05, .1, .26], SLEEPERS[n % 3], [0, (randomAt(n, 9109) - .5) * .12, 0]);
  }
  // Each car sunk into the salt at its own angle.
  p.frame([0, -.34, 15.4], [.015, 0, .035], () => locomotive(p));
  p.frame([0, -.4, 8.4], [0, 0, -.03], () => tender(p));
  p.frame([.15, -.3, -.3], [-.01, .025, .06], () => boxcar(p));
  p.frame([-1.7, -.52, -9.4], [.03, -.2, -.1], () => gondola(p));
  p.frame([.2, -.46, -17.9], [0, .05, .05], () => skeleton(p));
  // A wheelset rolled off to one side, a loose wheel, stacked sleepers, drums,
  // the gondola's lost panel and a rail bent up out of the salt.
  p.frame([-3.4, -.1, 3.4], [0, .7, 0], () => {
    for (const x of [-.62, .62]) wheel(p, x, .5, 0, .5);
    p.cylinder([0, .5, 0], .09, .09, 1.3, IRON, 6, [0, 0, Math.PI / 2]);
  });
  p.cylinder([3.3, .02, -5.8], .5, .5, .14, SOOT, 10); p.cylinder([3.3, .1, -5.8], .16, .16, .1, RUST_DARK, 6);
  p.frame([3.6, 0, 12.8], [0, -.25, 0], () => {
    for (let layer = 0; layer < 2; layer++) for (let i = 0; i < 3; i++) {
      p.box([(i - 1) * .33, .06 + layer * .12, 0], [.28, .12, 2.1], SLEEPERS[(i + layer) % 3], [0, layer * .06, 0]);
    }
  });
  p.cylinder([-3.3, .38, -2.6], .32, .32, .86, '#a95a30', 10); p.cylinder([-3.3, .82, -2.6], .33, .33, .05, RUST_DARK, 10);
  p.cylinder([-2.7, .28, -3.9], .32, .32, .86, '#8e4a2c', 10, [0, .9, Math.PI / 2]);
  p.box([-3.4, .04, -12.2], [1.15, .07, 2.1], '#a4552f', [0, .45, .04]);
  p.beam([2.4, -.1, -12.4], [3.1, .8, -13.7], .06, RAIL, 4);
  p.beam([3.1, .8, -13.7], [3.2, 1.5, -14.1], .06, RAIL, 4, .05);
  // Salt drifted against the wheels.
  const drifts = [[-1.3, 13.6], [-1.35, 17.2], [1.3, 15.5], [1.35, 19.6], [-1.3, 7.2], [1.25, 9.8], [-1.35, -2.4], [1.3, 1.9],
    [-3.1, -9], [.1, -7.2], [-1.2, -19.2], [1.4, -16.4], [-3.6, 3.9], [3.5, -5.4]];
  drifts.forEach(([x, z], n) => p.lump([x, -.04, z], [.9 + randomAt(n, 9110) * .8, .3 + randomAt(n, 9111) * .14, .7 + randomAt(n, 9112) * .5],
    n % 2 ? SALT : SALT_SHADE, [0, randomAt(n, 9113) * 3, 0]));
  return p.finish();
}
// Footprints that stop the car, in model coordinates.
export const SALT_TRAIN_SOLIDS = [
  { x: 0, z: 16.7, halfWidth: 1.35, halfLength: 5.2 },
  { x: 0, z: 8.4, halfWidth: 1.2, halfLength: 2.7 },
  { x: .15, z: -.3, halfWidth: 1.35, halfLength: 3.8, yaw: .025 },
  { x: -1.7, z: -9.4, halfWidth: 1.3, halfLength: 3.35, yaw: -.2 },
  { x: .2, z: -17.9, halfWidth: 1.2, halfLength: 3.2, yaw: .05 },
];

// Salt-block lodge. Walls are courses of hand-cut salt bricks over a mortar
// core. The roof, door and shutters are a separate white model so each lodge
// can be painted its own colour.
const BRICKS = ['#f4eee3', '#ece3d3', '#f8f4ec', '#e7ddcb', '#efe8dc'], MORTAR = '#d6c9b3', TIMBER = '#7c5f45', GLASS = '#34495a';
const COURSE = .46, PAINT = '#f4f4f4', PAINT_SHADE = '#d2d2d2';
export const SALT_LODGE_PAINT = ['#2f78b7', '#c4452f', '#1f9486', '#e0a526', '#5b9a3b'];
const GREENS = ['#6f8a55', '#657e4e', '#7a9160'], SPINES = '#b9b06e';

// Openings are { from, to, bottom, top } along the wall.
function saltWall(p, axis, at, from, to, courses, openings, seed) {
  const put = (along, y, length, height, depth, color) => axis === 'z'
    ? p.box([at, y, along], [depth, height, length], color) : p.box([along, y, at], [length, height, depth], color);
  const top = courses * COURSE;
  let start = from;
  for (const o of [...openings].sort((a, b) => a.from - b.from)) {
    if (o.from > start) put((start + o.from) / 2, top / 2, o.from - start, top, .42, MORTAR);
    if (o.bottom > 0) put((o.from + o.to) / 2, o.bottom / 2, o.to - o.from, o.bottom, .42, MORTAR);
    if (o.top < top) put((o.from + o.to) / 2, (o.top + top) / 2, o.to - o.from, top - o.top, .42, MORTAR);
    start = o.to;
  }
  if (to > start) put((start + to) / 2, top / 2, to - start, top, .42, MORTAR);
  for (let course = 0; course < courses; course++) {
    const low = course * COURSE, high = low + COURSE;
    for (let along = from - (course % 2 ? .55 : 0), n = 0; along < to; n++) {
      const length = .95 + randomAt(course * 31 + n, seed) * .35;
      let pieces = [[Math.max(along, from), Math.min(along + length, to)]];
      for (const o of openings) if (high > o.bottom + .01 && low < o.top - .01) {
        pieces = pieces.flatMap(([a, b]) => [[a, Math.min(b, o.from)], [Math.max(a, o.to), b]]).filter(([a, b]) => b - a > .12);
      }
      const tint = BRICKS[Math.floor(randomAt(course * 31 + n, seed + 1) * BRICKS.length)];
      for (const [a, b] of pieces) put((a + b) / 2, (low + high) / 2, b - a - .06, COURSE - .06, .5, tint);
      along += length;
    }
  }
}
// Door or window through a wall. `out` is the side the wall faces.
function fitOpening(p, paint, axis, at, out, o, door) {
  const put = (parts, along, y, depth, [length, height, thickness], color) => axis === 'z'
    ? parts.box([at + out * depth, y, along], [thickness, height, length], color)
    : parts.box([along, y, at + out * depth], [length, height, thickness], color);
  const middle = (o.from + o.to) / 2, width = o.to - o.from, height = o.top - o.bottom, y = (o.top + o.bottom) / 2;
  put(p, middle, o.top + .08, .2, [width + .4, .16, .18], TIMBER);
  if (door) {
    put(paint, middle, y, .05, [width, height, .08], PAINT);
    for (let k = 1; k < 4; k++) put(paint, o.from + width * k / 4, y, .1, [.04, height - .1, .03], PAINT_SHADE);
    put(p, o.from + width * .82, y, .13, [.06, .06, .06], '#2e2a26');
    return;
  }
  put(p, middle, y, 0, [width, height, .08], GLASS);
  put(paint, middle, y, .06, [.06, height, .06], PAINT);
  put(paint, middle, o.bottom - .03, .27, [width + .2, .08, .12], PAINT);
  // Shutters folded back against the wall.
  for (const side of [-1, 1]) put(paint, side < 0 ? o.from - .28 : o.to + .28, y, .28, [.5, height + .05, .05], PAINT);
}
function cactus(p, x, y, z, height, seed) {
  const r = .24 + height * .025, green = GREENS[Math.floor(randomAt(seed, 9161) * GREENS.length)];
  const arms = height < 2.4 ? 0 : 1 + Math.floor(randomAt(seed, 9162) * (height > 5 ? 3 : 2));
  // Woody at the foot, woolly spines on the crown.
  p.cylinder([x, y + .25, z], r * 1.06, r * 1.12, .9, '#8c7f58', 8);
  // Alternating narrow facets suggest ribs without individual needles or textures.
  const stem = (a, b, bottom, top) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
    const g = new THREE.CylinderGeometry(top, bottom, direction.length(), 12).toNonIndexed();
    const positions = g.attributes.position, colors = [], tint = new THREE.Color(green);
    for (let i = 0; i < positions.count; i += 3) {
      const angle = Math.atan2(positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2),
        positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2));
      const facet = Math.floor((angle + Math.PI * 2) / (Math.PI / 6)) % 12;
      const shade = facet % 2 ? .84 : 1.12;
      for (let k = 0; k < 3; k++) colors.push(tint.r * shade, tint.g * shade, tint.b * shade);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    p.add(g, from.add(to).multiplyScalar(.5).toArray(), null, new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
  };
  stem([x, y + .65, z], [x, y + height, z], r, r * .92);
  p.cylinder([x, y + height + r * .3, z], r * .35, r * .92, r * .6, SPINES, 8);
  const start = randomAt(seed, 9163) * Math.PI * 2;
  for (let k = 0; k < arms; k++) {
    const angle = start + k * Math.PI * 2 / arms + (randomAt(seed, 9164 + k) - .5) * .8;
    const at = y + height * (.32 + randomAt(seed, 9167 + k) * .22), reach = r + .42 + randomAt(seed, 9170 + k) * .2;
    const arm = r * .74, dx = Math.sin(angle), dz = Math.cos(angle);
    const elbow = [x + dx * reach, at + .3, z + dz * reach];
    const tip = [elbow[0], Math.min(at + .3 + height * (.28 + randomAt(seed, 9173 + k) * .3), y + height - .25), elbow[2]];
    p.beam([x + dx * r * .4, at, z + dz * r * .4], elbow, arm, green, 7);
    p.lump(elbow, [arm * 1.08, arm * 1.08, arm * 1.08], green);
    stem(elbow, tip, arm, arm * .92);
    p.cylinder([tip[0], tip[1] + arm * .25, tip[2]], arm * .35, arm * .9, arm * .5, SPINES, 7);
  }
  // Just a few warm flowers, visible as small accents on the skyline.
  if (height > 3 && randomAt(seed, 9178) < .28) {
    const crown = y + height + r * .6;
    p.cylinder([x, crown + .08, z], .16, .08, .18, '#dba269', 5);
    p.cylinder([x, crown + .18, z], .075, .1, .07, '#edd6a0', 5);
  }
}
function expeditionTruck(p) {
  const body = '#f1ede4', trim = '#2e3033', glass = '#2c3b47', tyre = '#262626', tarp = '#2d6fb0';
  // Forward is +x.
  for (const x of [-1.42, 1.38]) for (const z of [-.82, .82]) {
    p.cylinder([x, .42, z], .42, .42, .3, tyre, 10, [Math.PI / 2, 0, 0]);
    p.cylinder([x, .42, z + Math.sign(z) * .16], .2, .2, .04, '#a8a79f', 6, [Math.PI / 2, 0, 0]);
  }
  p.box([-.05, .62, 0], [4.2, .3, 1.6], trim);
  p.box([0, 1.02, 0], [4.5, .72, 1.86], body);
  p.box([0, .78, 0], [4.52, .22, 1.88], '#dcd1bf');
  p.box([-.55, 1.7, 0], [3.2, .66, 1.8], body);
  p.box([-.55, 1.72, 0], [3, .46, 1.84], glass);
  for (const x of [-.55, -1.45]) p.box([x, 1.72, 0], [.14, .47, 1.86], body);
  p.box([1.08, 1.68, 0], [.08, .52, 1.62], glass, [0, 0, -.35]);
  p.box([-2.17, 1.72, 0], [.06, .42, 1.5], glass);
  for (const x of [2.33, -2.33]) p.box([x, .72, 0], [.18, .26, 1.96], trim);
  p.box([2.26, 1.12, 0], [.06, .3, 1.2], trim);
  for (const z of [-.68, .68]) p.box([2.27, 1.14, z], [.05, .18, .26], '#f3eeda');
  for (const z of [-.8, .8]) p.box([-2.26, 1.1, z], [.05, .22, .14], '#b3372d');
  p.beam([1, 1.05, .96], [.95, 2.1, .96], .06, trim);
  p.cylinder([-2.5, 1.2, 0], .4, .4, .24, tyre, 10, [0, 0, Math.PI / 2]);
  // Roof rack loaded under a roped tarp, with jerry cans.
  p.box([-.55, 2.08, 0], [3.1, .08, 1.7], trim);
  p.box([-.7, 2.38, 0], [2.3, .5, 1.45], tarp);
  p.lump([-.5, 2.6, .1], [.9, .22, .6], tarp);
  for (const x of [-1.4, -.4, .6]) p.box([x, 2.42, 0], [.05, .58, 1.5], '#e4d9b2');
  for (const z of [-.45, .1]) p.box([.75, 2.3, z], [.3, .4, .45], '#e7b82a');
}
function flags(p) {
  const patchwork = ['#d93a3a', '#f08c2b', '#f2d13a', '#f4f1e8', '#3a9d5d', '#3877c2', '#7f45a8'];
  const poles = [[-7.3, -5.6, 5.6], [-8.2, -6.3, 6.3], [-6.5, -6.8, 5]];
  poles.forEach(([x, z, height], n) => {
    p.cylinder([x, height / 2, z], .05, .06, height, '#d9d9d6', 6);
    p.lump([x, height + .06, z], [.09, .09, .09], '#d8b24a');
    const top = height - .2;
    if (n === 0) {
      for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) {
        p.box([x, top - .15 - row * .3, z + .22 + column * .33], [.03, .3, .33], patchwork[(row + column) % patchwork.length]);
      }
    } else if (n === 1) {
      [['#1f8f8a', 1.3], ['#f4f1e8', 1], ['#e0572e', .7]].forEach(([color, length], row) => {
        p.box([x, top - .14 - row * .26, z + .08 + length / 2], [.03, .26, length], color);
      });
    } else {
      p.box([x, top - .4, z + .7], [.03, .8, 1.2], '#f0c23a');
      p.cylinder([x, top - .4, z + .7], .24, .24, .05, '#d6452f', 10, [0, 0, Math.PI / 2]);
    }
  });
}
function lodge() {
  const p = new SaltParts(), paint = new SaltParts(), top = 6 * COURSE, ridge = 4.1, slope = .36;
  const window = (from, to) => ({ from, to, bottom: .95, top: 1.9 });
  const door = (from, to) => ({ from, to, bottom: 0, top: 2.05 });
  const walls = [
    ['z', -3, -1, [door(-.55, .55), window(-2.9, -1.9), window(1.9, 2.9)], [true, false, false]],
    ['z', 3, 1, [window(2, 3)], [false]],
    ['x', 4.5, 1, [window(-1.4, -.4), window(.8, 1.8)], [false, false]],
    ['x', -4.5, -1, [window(-.5, .5)], [false]],
  ];
  walls.forEach(([axis, at, out, openings, doors], n) => {
    const [from, to] = axis === 'z' ? [-4.75, 4.75] : [-2.75, 2.75];
    saltWall(p, axis, at, from, to, 6, openings, 9121 + n * 2);
    openings.forEach((o, k) => fitOpening(p, paint, axis, at, out, o, doors[k]));
  });
  // Gables under a painted, corrugated roof.
  for (const z of [-4.5, 4.5]) {
    const shape = new THREE.Shape([new THREE.Vector2(-3.25, 0), new THREE.Vector2(3.25, 0), new THREE.Vector2(0, 3.25 * slope)]);
    const gable = new THREE.ExtrudeGeometry(shape, { depth: .5, bevelEnabled: false, curveSegments: 1 }); gable.clearGroups();
    p.add(gable, [0, top, z - .25], '#ede5d7');
  }
  const eave = ridge - slope * 3.7;
  paint.add(roofShell([[-3.7, eave], [0, ridge], [3.7, eave]], 10.4, .16), [0, 0, 0], PAINT);
  const angle = Math.atan(slope), length = 3.7 / Math.cos(angle);
  for (const side of [-1, 1]) for (let z = -5; z <= 5.01; z += .45) {
    paint.box([side * 1.85, ridge - slope * 1.85 + .025, z], [length, .04, .07], PAINT_SHADE, [0, 0, -side * angle]);
  }
  paint.box([0, ridge - .07, 0], [.3, .3, 10.45], PAINT_SHADE, [0, 0, Math.PI / 4]);
  p.cylinder([1.2, 4, -2.2], .1, .1, 1.4, '#2d2a28', 6); p.cylinder([1.2, 4.74, -2.2], .18, .14, .12, '#2d2a28', 6);
  // Shaded porch: a salt-block deck under a slatted cane roof.
  p.box([-4.6, .15, 0], [3.2, .3, 9.2], '#ebe3d5');
  p.box([-6.4, .075, 0], [.5, .15, 1.4], '#e4dac9');
  for (const z of [-4.3, -1.45, 1.45, 4.3]) {
    p.box([-5.95, 1.55, z], [.2, 2.5, .2], TIMBER);
    p.box([-4.55, 2.95, z], [3.1, .16, .14], TIMBER);
    p.beam([-5.95, 2.28, z], [-5.28, 2.95, z], .07, TIMBER, 4);
    p.box([-5.95, .46, z], [.29, .32, .29], BRICKS[3]);
  }
  p.box([-5.95, 2.9, 0], [.22, .22, 9.1], TIMBER);
  for (let z = -4.5, n = 0; z <= 4.51; z += .36, n++) p.box([-4.6, 3.08, z], [3.5, .06, .2], n % 2 ? '#d4ae62' : '#c9a256');
  // Two small amber lanterns frame the entrance under the porch shade.
  for (const z of [-.86, .86]) {
    p.box([-3.38, 2.26, z], [.24, .05, .05], '#443b30');
    p.box([-3.48, 2.05, z], [.17, .26, .17], '#e6ba72');
    for (const y of [1.89, 2.2]) p.box([-3.48, y, z], [.23, .06, .23], '#443b30');
    for (const dz of [-.09, .09]) p.box([-3.58, 2.05, z + dz], [.025, .28, .025], '#443b30');
  }
  p.box([-3.75, .315, 0], [.9, .025, 1.15], '#a66b48');
  for (const z of [-.43, -.32, .32, .43]) p.box([-3.75, .332, z], [.82, .01, .055], '#e5c999');
  // Salt table and benches, a striped blanket and a hammock.
  for (const z of [-2.8, -1.6]) p.box([-4.6, .65, z], [.7, .7, .4], BRICKS[1]);
  p.box([-4.6, 1.06, -2.2], [.95, .12, 1.9], '#f1ebe0');
  for (const x of [-5.4, -3.8]) p.box([x, .52, -2.2], [.42, .44, 1.8], BRICKS[2]);
  ['#d43d51', '#f08a24', '#e9c22f', '#2f8f83', '#8e3f9e'].forEach((color, k) => p.box([-5.58 + k * .09, .76, -2.2], [.09, .04, 1.3], color));
  for (let k = 0; k < 6; k++) {
    const a = 1.65 + k * .42, b = a + .42, sag = t => 1.95 - .55 * Math.sin(Math.PI * (t - 1.65) / 2.52);
    const drop = sag(b) - sag(a);
    p.box([-5.75, (sag(a) + sag(b)) / 2, (a + b) / 2], [.8, .05, Math.hypot(.42, drop)], k % 2 ? '#f2b134' : '#d9486b', [-Math.atan2(drop, .42), 0, 0]);
  }
  for (const z of [1.55, 4.2]) p.beam([-5.75, 1.95, z], [-5.85, 2.3, z < 3 ? 1.45 : 4.3], .02, '#d9cfb4', 4);
  // Cacti in salt-brick planters either side of the steps.
  for (const [z, height] of [[-1.2, 1.3], [1.2, 1.7]]) {
    p.box([-6.5, .25, z], [.55, .5, .55], BRICKS[3]);
    cactus(p, -6.5, .5, z, height, 9131 + Math.round(z * 10));
  }
  // Store room behind, with a water tank and a solar panel on its roof.
  saltWall(p, 'z', 6.35, -4.35, .95, 5, [window(-2.4, -1.5)], 9141);
  saltWall(p, 'x', -4.1, 3.25, 6.1, 5, [], 9143);
  saltWall(p, 'x', .7, 3.25, 6.1, 5, [door(4.2, 5.1)], 9145);
  fitOpening(p, paint, 'z', 6.35, 1, window(-2.4, -1.5), false);
  fitOpening(p, paint, 'x', .7, 1, door(4.2, 5.1), true);
  p.box([4.93, 5 * COURSE + .07, -1.7], [3.75, .14, 5.6], '#9b8a73');
  p.cylinder([5.5, 2.95, -3.2], .55, .55, 1, '#2f3336', 10); p.cylinder([5.5, 3.48, -3.2], .2, .2, .08, '#2f3336', 8);
  for (const x of [3.9, 4.9]) p.box([x, 2.55, -.6], [.06, .3, .06], '#8f9396');
  p.frame([4.4, 2.78, -.6], [0, 0, .35], () => {
    p.box([0, 0, 0], [1.5, .07, 1], '#b5b8b1');
    p.box([0, .045, 0], [1.38, .025, .88], '#2a3a5c');
    for (const x of [-.23, .23]) p.box([x, .061, 0], [.018, .008, .88], '#8094ab');
    p.box([0, .061, 0], [1.38, .008, .018], '#8094ab');
  });
  // Freshly cut blocks stacked for building, and a gas bottle.
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 6; i++) {
    const [a, b] = [(i % 3 - 1) * .47, (Math.floor(i / 3) - .5) * .9], turned = layer % 2;
    p.box([4.8 + (turned ? b : a), .22 + layer * .44, 3.4 + (turned ? a : b)], turned ? [.85, .4, .42] : [.42, .4, .85], BRICKS[(i + layer) % BRICKS.length]);
  }
  p.cylinder([3.62, .45, 1.35], .18, .18, .9, '#d1462f', 8); p.cylinder([3.62, .95, 1.35], .06, .06, .1, '#8f9396', 6);
  p.frame([-9.4, 0, 5.6], [0, .45, 0], () => expeditionTruck(p));
  flags(p);
  return { main: p.finish(), paint: paint.finish() };
}
export const SALT_LODGE_SOLIDS = [
  { x: -1.6, z: 0, halfWidth: 4.65, halfLength: 4.8 },
  { x: 4.9, z: -1.7, halfWidth: 1.75, halfLength: 2.7 },
  { x: -9.4, z: 5.6, halfWidth: 2.35, halfLength: .98, yaw: .45 },
  { x: 4.8, z: 3.4, halfWidth: .75, halfLength: .75 },
  ...[[-7.3, -5.6], [-8.2, -6.3], [-6.5, -6.8]].map(([x, z]) => ({ x, z, radius: .25 })),
];

// Cactus island: a faceted rocky knoll ringed and crowned with boulders, tall
// branching cacti and a trail winding up across the side the camera sees.
const KNOLL_ROCK = ['#8a7462', '#7b6757', '#957e69', '#836d5c'], KNOLL_SOIL = ['#b39670', '#a98c68', '#bea27a'], KNOLL_SALT = ['#e4dac9', '#d9cdb9'];
const RINGS = [[1.05, -.6], [1, .1], [.9, .75], [.76, 2.1], [.6, 3.5], [.44, 4.8], [.28, 5.9], [.13, 6.75]];
function cactusIsland({ radius, height }, seed) {
  const p = new SaltParts(), sides = 22, scale = height / 7.4, rand = (a, b) => randomAt(a, seed + b);
  const phase = [0, 1, 2].map(k => rand(k, 1) * Math.PI * 2);
  const outline = angle => radius * (1 + .13 * Math.sin(2 * angle + phase[0]) + .08 * Math.sin(3 * angle + phase[1]) + .05 * Math.sin(5 * angle + phase[2]));
  const summit = { x: (rand(0, 2) - .5) * radius * .3, z: (rand(1, 2) - .5) * radius * .3 };
  // Rings lean toward an off-centre summit, so one side is steeper.
  const at = (angle, t) => ({ x: summit.x * Math.max(0, 1 - t) + Math.sin(angle) * outline(angle) * t, z: summit.z * Math.max(0, 1 - t) + Math.cos(angle) * outline(angle) * t });
  const rings = RINGS.map(([t, y], j) => Array.from({ length: sides }, (_, i) => {
    const angle = (i + (rand(i, 10 + j) - .5) * .35) / sides * Math.PI * 2, point = at(angle, j ? t * (1 + (rand(i, 20 + j) - .5) * .14) : t);
    return [point.x, (y + (j > 1 ? (rand(i, 30 + j) - .5) * .9 : 0)) * scale, point.z];
  }));
  const apex = [summit.x, height, summit.z], triangles = [];
  for (let j = 0; j < rings.length; j++) for (let i = 0; i < sides; i++) {
    const a = rings[j][i], b = rings[j][(i + 1) % sides];
    if (j === rings.length - 1) { triangles.push([a, b, apex]); continue; }
    const c = rings[j + 1][i], d = rings[j + 1][(i + 1) % sides];
    triangles.push(...((i + j) % 2 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]]));
  }
  // Pale salt-crusted foot, rock on the steep faces, sandy soil on the gentle ones.
  const normal = new THREE.Vector3(), edge = new THREE.Vector3(), byColor = new Map();
  triangles.forEach(([a, b, c], n) => {
    normal.set(...b).sub(new THREE.Vector3(...a)).cross(edge.set(...c).sub(new THREE.Vector3(...a))).normalize();
    const low = (a[1] + b[1] + c[1]) / 3, pick = list => list[Math.floor(rand(n, 40) * list.length)];
    const color = low < .4 * scale ? pick(KNOLL_SALT) : Math.abs(normal.y) < .84 ? pick(KNOLL_ROCK) : pick(KNOLL_SOIL);
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color).push([a, b, c]);
  });
  for (const [color, faces] of byColor) p.faces(faces, color);
  const surface = (x, z) => {
    for (const [a, b, c] of triangles) {
      const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det, v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) return u * a[1] + v * b[1] + (1 - u - v) * c[1];
    }
    return 0;
  };
  // The trail starts on the salt at one flank and sweeps across the camera side to the top.
  const trail = Array.from({ length: 61 }, (_, k) => {
    const t = k / 60, angle = ISLAND_LANDING + (-1.25 - ISLAND_LANDING) * t;
    return at(angle, 1.12 - .98 * t ** .92);
  });
  const nearTrail = (x, z) => Math.min(...trail.map(q => Math.hypot(q.x - x, q.z - z)));
  const ribbon = [];
  trail.forEach((q, k) => {
    const next = trail[Math.min(k + 1, trail.length - 1)], previous = trail[Math.max(k - 1, 0)];
    const dx = next.x - previous.x, dz = next.z - previous.z, length = Math.hypot(dx, dz), half = .51 + .045 * Math.sin(k * .63);
    const edges = [-1, 1].map(side => { const x = q.x + side * dz / length * half, z = q.z - side * dx / length * half; return [x, Math.max(surface(x, z), 0) + .09, z]; });
    ribbon.push(edges);
    if (k % 3 === 1 && k < 57) {
      const side = k % 2 ? 1 : -1, x = q.x + side * dz / length * (half + .3), z = q.z - side * dx / length * (half + .3);
      p.stone([x, Math.max(surface(x, z), 0) + .06, z], [.2 + rand(k, 41) * .12, .14, .18 + rand(k, 42) * .1], KNOLL_ROCK[k % 4], [0, k, 0]);
    }
  });
  for (let k = 0; k < ribbon.length - 1; k++) {
    const [a, b] = ribbon[k], [c, d] = ribbon[k + 1];
    p.faces([[a, b, c], [b, d, c]], Math.floor(k / 7) % 2 ? '#c9b48c' : '#cdb991');
  }
  // Boulders heaped round the foot and on the slopes, a few crowning the top.
  const rocks = [];
  for (let n = 0; rocks.length < (radius > 14 ? 17 : 13) && n < 120; n++) {
    const angle = rand(n, 50) * Math.PI * 2, t = rocks.length < 3 ? .12 + rand(n, 51) * .12 : .3 + rand(n, 51) * .78;
    const size = (t > .85 ? 1.5 : 1) + rand(n, 52) * (t > .85 ? 2.1 : 1.4), point = at(angle, t);
    if (nearTrail(point.x, point.z) < size + 1 || Math.hypot(point.x - summit.x, point.z - summit.z) < size + .9
      || rocks.some(r => Math.hypot(r.x - point.x, r.z - point.z) < (r.size + size) * .8)) continue;
    rocks.push({ ...point, size });
    const g = saltBoulders[n % 3].clone(), colors = g.attributes.color, tint = new THREE.Color(KNOLL_ROCK[n % 4]);
    for (let i = 0; i < colors.count; i++) colors.setXYZ(i, colors.getX(i) * tint.r * 1.08, colors.getY(i) * tint.g * 1.08, colors.getZ(i) * tint.b * 1.08);
    g.scale(size, size * .8, size * (.8 + rand(n, 53) * .3));
    p.add(g, [point.x, surface(point.x, point.z) + size * .1, point.z], null, [(rand(n, 54) - .5) * .3, rand(n, 55) * 6.3, (rand(n, 56) - .5) * .3]);
  }
  // Pebbles spilled onto the salt.
  for (let n = 0; n < 16; n++) {
    const angle = rand(n, 57) * Math.PI * 2, point = at(angle, 1.03 + rand(n, 58) * .2);
    if (nearTrail(point.x, point.z) > 1.4) p.stone([point.x, .04, point.z], [.2 + rand(n, 59) * .25, .15, .2 + rand(n, 60) * .2], KNOLL_ROCK[n % 4], [0, n, 0]);
  }
  // The giant cacti stand highest, where they break the skyline.
  const cacti = [];
  for (let n = 0; cacti.length < (radius > 14 ? 15 : 11) && n < 300; n++) {
    const angle = rand(n, 61) * Math.PI * 2, t = .1 + rand(n, 62) * .8, point = at(angle, t);
    if (nearTrail(point.x, point.z) < 1.6 || Math.hypot(point.x - summit.x, point.z - summit.z) < 1.5
      || rocks.some(r => Math.hypot(r.x - point.x, r.z - point.z) < r.size * .75 + .5)
      || cacti.some(c => Math.hypot(c.x - point.x, c.z - point.z) < 2.3)) continue;
    const tall = (1.9 + rand(n, 63) * 2.6 + (1 - t) * 3.6) * (.8 + scale * .2);
    cacti.push({ ...point, tall });
    cactus(p, point.x, surface(point.x, point.z) - .25, point.z, tall, seed * 7 + n);
  }
  // A cairn on the top and a marker post where the trail leaves the salt.
  [[.6, .32], [.46, .28], [.34, .24], [.2, .2]].reduce((y, [size, rise], n) => {
    p.stone([summit.x + (n % 2 ? .08 : -.05), y + rise / 2, summit.z], [size, rise, size * .9], KNOLL_ROCK[n], [0, n * 1.3, 0]);
    return y + rise * .85;
  }, height - .05);
  const foot = trail[3], side = Math.hypot(foot.x, foot.z);
  const post = [foot.x * (side + 1.1) / side, foot.z * (side + 1.1) / side];
  p.beam([post[0], -.1, post[1]], [post[0], 1.35, post[1]], .07, TIMBER, 5);
  p.box([post[0], 1.18, post[1]], [.06, .32, .7], '#9a7a55', [0, Math.atan2(foot.x, foot.z) + Math.PI / 2, 0]);
  // Tufts of tola between the rocks, drawn with the roadside shrubs.
  const shrubs = [];
  for (let n = 0; shrubs.length < 12 && n < 200; n++) {
    const angle = rand(n, 70) * Math.PI * 2, t = .25 + rand(n, 71) * .8, point = at(angle, t);
    if (nearTrail(point.x, point.z) < 1.2 || cacti.some(c => Math.hypot(c.x - point.x, c.z - point.z) < 1.1)
      || rocks.some(r => Math.hypot(r.x - point.x, r.z - point.z) < r.size * .8)) continue;
    shrubs.push([point.x, surface(point.x, point.z), point.z, .6 + rand(n, 72) * .5]);
  }
  // Round collider that stays inside the rocky foot on every side.
  const solid = Math.min(...Array.from({ length: 36 }, (_, i) => outline(i / 36 * Math.PI * 2))) * .9;
  return { geometry: p.finish(false), shrubs, solid };
}
const islands = SALT_ISLANDS.map((island, n) => cactusIsland(island, 9201 + n * 97));
export const SALT_ISLAND_DETAILS = islands.map(({ shrubs, solid }) => ({ shrubs, solid }));

const lodgeModels = lodge();
// Right-hand and left-hand versions. Left-hand lodges are mirrored front to
// back so the truck and flags stay on the oncoming-traffic side.
export const saltDiscoveryAssets = {
  train: trainGraveyard(),
  lodge: [lodgeModels.main, mirrored(lodgeModels.main, 2)],
  lodgePaint: [lodgeModels.paint, mirrored(lodgeModels.paint, 2)],
  // Left-hand islands are mirrored so the trail still crosses the camera side.
  islands: islands.map(({ geometry }) => [geometry, mirrored(geometry, 0)]),
};
registerChunkResources('salt-discoveries', { saltDiscoveryAssets, discoveryMaterial });
