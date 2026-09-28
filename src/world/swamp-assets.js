import * as THREE from 'three';
import { randomAt, smoothstep, lerp } from './route.js';

// Every model is unindexed with vertex colours, so trunks, moss and knees share
// one draw. Trees use height as the unit so one instance transform fits trunk and crown.
const up = new THREE.Vector3(0, 1, 0), TAU = Math.PI * 2;
const hex = value => new THREE.Color(value);

export class Parts {
  constructor() { this.vertices = []; this.colors = []; }
  point(p, color) { this.vertices.push(p[0], p[1], p[2]); this.colors.push(color.r, color.g, color.b); }
  // Winds each face away from `inside` so single-sided materials cull correctly.
  face(a, b, c, color, inside = null, colorB = color, colorC = color) {
    if (inside) {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const out = [(a[0] + b[0] + c[0]) / 3 - inside[0], (a[1] + b[1] + c[1]) / 3 - inside[1], (a[2] + b[2] + c[2]) / 3 - inside[2]];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) { [b, c] = [c, b]; [colorB, colorC] = [colorC, colorB]; }
    }
    this.point(a, color); this.point(b, colorB); this.point(c, colorC);
  }
  // Rings of [y, radius, x, z]. `shade(y)` colours by height, `flute(angle, y)` shapes the cross-section.
  lathe(rings, sides, shade, flute = () => 1, twist = 0) {
    const loops = rings.map(([y, r, x = 0, z = 0], k) => Array.from({ length: sides }, (_, i) => {
      const a = (i + (k % 2) * .5 * twist) / sides * TAU, f = flute(a, y);
      return [x + Math.cos(a) * r * f, y, z + Math.sin(a) * r * f];
    }));
    for (let k = 0; k < loops.length - 1; k++) {
      const [y0, , x0 = 0, z0 = 0] = rings[k], [y1, , x1 = 0, z1 = 0] = rings[k + 1];
      const axis = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides, a = loops[k][i], b = loops[k][j], c = loops[k + 1][i], d = loops[k + 1][j];
        this.face(a, b, c, shade(a[1]), axis, shade(b[1]), shade(c[1]));
        this.face(b, d, c, shade(b[1]), axis, shade(d[1]), shade(c[1]));
      }
    }
    return loops;
  }
  // Tapered prism between two points.
  limb(from, to, r0, r1, color, sides = 5) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize()), length = direction.length();
    const ring = (y, r) => Array.from({ length: sides }, (_, i) => {
      const p = new THREE.Vector3(Math.cos(i / sides * TAU) * r, y, Math.sin(i / sides * TAU) * r).applyQuaternion(q).add(a);
      return p.toArray();
    });
    const low = ring(0, r0), high = ring(length, r1);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, middle = a.clone().add(b).multiplyScalar(.5).toArray();
      this.face(low[i], low[j], high[i], color, middle);
      this.face(low[j], high[j], high[i], color, middle);
    }
  }
  // Faceted foliage clump, lighter on top. Detail -1 is an eight-faced lump
  // for reflections, which the water blurs and darkens anyway.
  lobe(center, size, seed, color, detail = 0) {
    // Mix coarse and fuller clumps for irregular crowns without making every
    // branch pay for the more detailed silhouette.
    const g = detail < 0 ? new THREE.OctahedronGeometry(1) : new THREE.IcosahedronGeometry(1, detail && seed % 3 === 0 ? 1 : 0);
    g.rotateY(randomAt(seed, 3401) * TAU); g.rotateX((randomAt(seed, 3402) - .5) * .5);
    const position = g.attributes.position;
    for (let i = 0; i < position.count; i += 3) {
      const tri = [0, 1, 2].map(k => [position.getX(i + k), position.getY(i + k), position.getZ(i + k)]);
      const shade = .7 + .44 * smoothstep(-1, 1, (tri[0][1] + tri[1][1] + tri[2][1]) / 3) + (randomAt(seed * 40 + i, 3403) - .5) * .08;
      const tint = color.clone().multiplyScalar(shade);
      // Warm the sunlit tops a little.
      if (shade > 1) tint.lerp(hex('#c2c46a'), (shade - 1) * .5);
      this.face(...tri.map(p => [center[0] + p[0] * size[0], center[1] + p[1] * size[1], center[2] + p[2] * size[2]]), tint, center);
    }
    g.dispose();
  }
  // Hanging moss: two crossed ragged blades, pale at the top.
  moss(top, length, width, seed, color) {
    const angle = randomAt(seed, 3411) * TAU, sway = (randomAt(seed, 3412) - .5) * .3 * length;
    for (const turn of [0, Math.PI / 2]) {
      const dx = Math.cos(angle + turn) * width, dz = Math.sin(angle + turn) * width;
      const mid = [top[0] + sway * .4, top[1] - length * .55, top[2]], tip = [top[0] + sway, top[1] - length, top[2] + sway * .3];
      const dim = color.clone().multiplyScalar(.82);
      this.face([top[0] - dx, top[1], top[2] - dz], [top[0] + dx, top[1], top[2] + dz], [mid[0] + dx * .5, mid[1], mid[2] + dz * .5], color);
      this.face([top[0] - dx, top[1], top[2] - dz], [mid[0] + dx * .5, mid[1], mid[2] + dz * .5], tip, color, null, color, dim);
      this.face([mid[0] - dx * .7, mid[1] + length * .08, mid[2] - dz * .7], [mid[0] + dx * .2, mid[1], mid[2] + dz * .2], [mid[0] - dx * .2, mid[1] - length * .3, mid[2] - dz * .2], dim);
    }
  }
  cone(base, radius, height, sides, color, seed, lean = [0, 0]) {
    const ring = Array.from({ length: sides }, (_, i) => {
      const a = (i + randomAt(seed, 3421 + i) * .4) / sides * TAU;
      return [base[0] + Math.cos(a) * radius, base[1], base[2] + Math.sin(a) * radius];
    });
    const apex = [base[0] + lean[0], base[1] + height, base[2] + lean[1]];
    for (let i = 0; i < sides; i++) this.face(ring[i], ring[(i + 1) % sides], apex, color, [base[0], base[1] + height * .3, base[2]]);
  }
  // Axis-aligned box from its centre and size, with optional top and side shades.
  box(center, size, color, { top = color, side = color.clone().multiplyScalar(.86) } = {}) {
    const [x, y, z] = center, [w, h, d] = size.map(v => v / 2);
    const c = (sx, sy, sz) => [x + sx * w, y + sy * h, z + sz * d];
    const quad = (a, b, cc, dd, shade) => { this.face(a, b, cc, shade, center); this.face(a, cc, dd, shade, center); };
    quad(c(-1, 1, -1), c(1, 1, -1), c(1, 1, 1), c(-1, 1, 1), top);
    quad(c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1), side.clone().multiplyScalar(.7));
    quad(c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1), color);
    quad(c(-1, -1, -1), c(1, -1, -1), c(1, 1, -1), c(-1, 1, -1), side);
    quad(c(1, -1, -1), c(1, -1, 1), c(1, 1, 1), c(1, 1, -1), color);
    quad(c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1), side);
  }
  // Gable roof over a footprint, ridge along z.
  roof(center, width, depth, rise, overhang, color) {
    const [x, y, z] = center, w = width / 2 + overhang, d = depth / 2 + overhang, ridge = [x, y + rise, z];
    const eave = (sx, sz) => [x + sx * w, y - overhang * .4, z + sz * d];
    const under = color.clone().multiplyScalar(.55), gableEnd = color.clone().multiplyScalar(.8);
    for (const sx of [-1, 1]) {
      const a = eave(sx, -1), b = eave(sx, 1), c = [ridge[0], ridge[1], z + d], e = [ridge[0], ridge[1], z - d];
      this.face(a, b, c, color, [x, y - 1, z]); this.face(a, c, e, color, [x, y - 1, z]);
      this.face(a, c, b, under, [x, y + 5, z]); this.face(a, e, c, under, [x, y + 5, z]);
    }
    // Gable walls sit in the wall planes, under the overhang.
    for (const sz of [-1, 1]) {
      const wall = z + sz * depth / 2;
      this.face([x - width / 2, y, wall], [x + width / 2, y, wall], [x, y + rise * .96, wall], gableEnd, [x, y, z]);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.vertices, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

const barkShade = (base, trunk, top) => y => (y < .02 ? base : y < .12 ? base.clone().lerp(trunk, (y - .02) / .1) : trunk.clone().lerp(top, smoothstep(.12, .9, y)));
const MOSS = ['#929c87', '#a2ac98', '#818f7c'].map(hex);
// Foliage is shaded near white. Instance colours supply the greens.
const LEAF = hex('#f2f4ea');

// Bald cypress: fluted buttress, knees in the water, limbs holding flat clumps high up.
function cypress(seed, { lean = 0, limbs = 7, spread = .27, low = .64, mossy = 1, knees = 4 } = {}) {
  const bark = new Parts(), crown = new Parts(), reflection = new Parts(), r = i => randomAt(seed * 37 + i, 3501);
  const shade = barkShade(hex('#3a2e26'), hex('#6f5341'), hex('#8a7361'));
  const offset = y => lean * Math.max(0, y) ** 1.6;
  const rings = [[-.06, .065], [0, .063], [.028, .046], [.085, .031], [.19, .025], [.38, .02], [.6, .016], [.78, .012], [.95, .006]]
    .map(([y, radius]) => [y, radius, offset(y), 0]);
  const phase = r(1) * TAU;
  bark.lathe(rings, 8, shade, (a, y) => 1 + .42 * (1 - smoothstep(0, .13, y)) * (.5 + .5 * Math.cos(a * 5 + phase)) + (1 - smoothstep(0, .05, y)) * .12 * Math.cos(a * 3 + phase));
  // Long buttress ridges continue up the trunk. Roots spread into the shallows.
  for (let i = 0; i < 6; i++) {
    const a = phase + i / 6 * TAU, d = .075 + r(400 + i) * .04;
    const foot = [Math.cos(a) * d, -.008, Math.sin(a) * d];
    const high = [offset(.22) + Math.cos(a) * .022, .14 + r(410 + i) * .08, Math.sin(a) * .022];
    const left = [Math.cos(a - .22) * .052, .003, Math.sin(a - .22) * .052];
    const right = [Math.cos(a + .22) * .052, .003, Math.sin(a + .22) * .052];
    bark.face(foot, left, high, shade(.06), [0, .04, 0]);
    bark.face(foot, high, right, shade(.12), [0, .04, 0]);
  }
  reflection.lathe([[-.02, .075], [.08, .035], [.3, .021], [.75, .013], [.95, .006]], 6, shade);
  const moss = (top, length, i) => { if (r(200 + i) < mossy) bark.moss(top, length, .0035 + r(300 + i) * .003, seed * 97 + i, MOSS[i % 3]); };
  const greens = LEAF;
  for (let i = 0; i < limbs; i++) {
    const t = i / Math.max(1, limbs - 1), y = lerp(low, .88, t) + (r(10 + i) - .5) * .065, angle = i * 2.399963 + phase;
    const reach = spread * (.6 + r(20 + i) * .5) * (1 - t * .25);
    const from = [offset(y), y, 0], to = [offset(y) + Math.cos(angle) * reach, y + .05 + r(30 + i) * .05, Math.sin(angle) * reach];
    bark.limb(from, to, .0075 - t * .003, .003, shade(.5));
    const size = .135 + r(40 + i) * .06 - t * .012;
    crown.lobe(to, [size * 1.15, size * (.7 + r(50 + i) * .2), size], seed * 13 + i, greens);
    reflection.lobe(to, [size * 1.15, size * .8, size], seed * 13 + i, hex('#526948'), -1);
    if (r(60 + i) < .65) crown.lobe([to[0] * .5 + offset(y) * .5, to[1] + .04, to[2] * .5], [size * .95, size * .65, size * .95], seed * 13 + i + 50, greens);
    // Hung past the clump's edge so it shows from above.
    for (let k = 0; k < 3; k++) {
      const a = angle + (r(70 + i * 5 + k) - .5) * 2.6, d = size * (.62 + r(80 + i * 5 + k) * .2);
      moss([to[0] + Math.cos(a) * d, to[1] - size * .25, to[2] + Math.sin(a) * d], .1 + r(90 + i * 5 + k) * .17, i * 5 + k);
    }
    moss([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2], .04 + r(120 + i) * .05, 40 + i);
  }
  crown.lobe([offset(.95), .95, 0], [.16, .1, .16], seed * 13 + 99, greens);
  const kneeColor = hex('#6e5a48');
  for (let i = 0; i < knees; i++) {
    const a = r(140 + i) * TAU, d = .08 + r(150 + i) * .1;
    bark.cone([Math.cos(a) * d, -.03, Math.sin(a) * d], .006 + r(160 + i) * .005, .03 + r(170 + i) * .025, 4, kneeColor, seed * 7 + i);
  }
  return { trunk: bark.build(), crown: crown.build(), reflection: reflection.build() };
}

// Broad moss-hung oak. Limbs fork low and the crown is a wide dome.
function oak(seed, { width = .5, lobes = 11, mossy = 1 } = {}) {
  const bark = new Parts(), crown = new Parts(), reflection = new Parts(), r = i => randomAt(seed * 41 + i, 3601);
  const shade = barkShade(hex('#3d332b'), hex('#5f4f42'), hex('#6f6052'));
  bark.lathe([[-.04, .07], [0, .064], [.06, .05], [.18, .043], [.32, .04]], 8, shade, (a, y) => 1 + .18 * (1 - smoothstep(0, .08, y)) * Math.cos(a * 4 + seed));
  reflection.lathe([[-.02, .065], [.12, .045], [.4, .028], [.72, .01]], 6, shade);
  const forks = 4, tips = [];
  for (let i = 0; i < forks; i++) {
    const angle = i / forks * TAU + r(i) * .8, reach = width * (.45 + r(10 + i) * .25);
    const to = [Math.cos(angle) * reach, .5 + r(20 + i) * .12, Math.sin(angle) * reach];
    bark.limb([0, .3, 0], to, .026, .012, shade(.4), 6);
    const tip = [to[0] * 1.35, to[1] + .14, to[2] * 1.35];
    bark.limb(to, tip, .012, .005, shade(.6), 5); tips.push(to, tip);
  }
  const greens = LEAF;
  for (let i = 0; i < lobes; i++) {
    const angle = i * 2.399963 + seed, d = width * Math.sqrt((i + .5) / lobes) * .9, y = .64 + (1 - d / width) * .26 + (r(40 + i) - .5) * .06;
    const size = .17 + r(50 + i) * .09;
    crown.lobe([Math.cos(angle) * d, y, Math.sin(angle) * d], [size, size * .72, size], seed * 17 + i, greens);
    reflection.lobe([Math.cos(angle) * d, y, Math.sin(angle) * d], [size, size * .72, size], seed * 17 + i, hex('#596c45'), -1);
  }
  for (let i = 0; i < 18 * mossy; i++) {
    const angle = r(100 + i) * TAU, d = width * (.55 + r(130 + i) * .6);
    bark.moss([Math.cos(angle) * d, .6 - d * .1 + r(160 + i) * .05, Math.sin(angle) * d], .06 + r(190 + i) * .13, .008 + r(220 + i) * .006, seed * 131 + i, MOSS[i % 3]);
  }
  for (const [i, tip] of tips.entries()) bark.moss(tip, .08 + r(250 + i) * .06, .009, seed * 7 + i, MOSS[(i + 1) % 3]);
  return { trunk: bark.build(), crown: crown.build(), reflection: reflection.build() };
}

// Water tupelo: swollen base, narrow oval crown.
function tupelo(seed) {
  const bark = new Parts(), crown = new Parts(), reflection = new Parts(), r = i => randomAt(seed * 43 + i, 3651);
  const shade = barkShade(hex('#3f352c'), hex('#6d5f52'), hex('#80746a'));
  bark.lathe([[-.05, .07], [0, .066], [.05, .045], [.14, .026], [.5, .018], [.86, .01]], 7, shade, (a, y) => 1 + .1 * Math.cos(a * 3 + seed) * (1 - smoothstep(0, .1, y)));
  reflection.lathe([[-.02, .066], [.14, .026], [.86, .01]], 5, shade);
  const greens = LEAF;
  for (let i = 0; i < 7; i++) {
    const t = i / 6, angle = i * 2.2 + seed, d = .1 * Math.sin(t * Math.PI) + .03, size = .12 + r(i) * .05;
    crown.lobe([Math.cos(angle) * d, .5 + t * .42, Math.sin(angle) * d], [size, size * .9, size], seed * 19 + i, greens);
    reflection.lobe([Math.cos(angle) * d, .5 + t * .42, Math.sin(angle) * d], [size, size * .9, size], seed * 19 + i, hex('#536b4b'), -1);
    if (i < 5) bark.moss([Math.cos(angle) * (d + size * .6), .46 + t * .4, Math.sin(angle) * (d + size * .6)], .07 + r(20 + i) * .08, .008, seed * 3 + i, MOSS[i % 3]);
  }
  return { trunk: bark.build(), crown: crown.build(), reflection: reflection.build() };
}

// Dead cypress: grey and broken off, a few bare limbs.
function snag(seed, { tall = .85, limbs = 3, mossy = .5 } = {}) {
  const bark = new Parts(), r = i => randomAt(seed * 47 + i, 3701);
  const shade = barkShade(hex('#3c342e'), hex('#7c7268'), hex('#9a9187'));
  const lean = (r(1) - .5) * .12, top = tall * (.75 + r(2) * .25), offset = y => lean * y * y;
  const rings = [[-.06, .07], [0, .064], [.03, .045], [.08, .03], [.2, .022], [top * .6, .016], [top, .009]].map(([y, radius]) => [y, radius, offset(y), 0]);
  bark.lathe(rings, 8, shade, (a, y) => 1 + .35 * (1 - smoothstep(0, .12, y)) * (.5 + .5 * Math.cos(a * 5 + seed)));
  // Jagged break.
  const tip = [offset(top) + (r(3) - .5) * .01, top + .03 + r(4) * .04, (r(5) - .5) * .01];
  bark.cone([offset(top), top, 0], .009, tip[1] - top, 4, shade(top), seed, [tip[0] - offset(top), tip[2]]);
  for (let i = 0; i < limbs; i++) {
    const y = top * (.5 + r(10 + i) * .4), angle = r(20 + i) * TAU, reach = .06 + r(30 + i) * .1;
    const to = [offset(y) + Math.cos(angle) * reach, y + .04 + r(40 + i) * .09, Math.sin(angle) * reach];
    bark.limb([offset(y), y, 0], to, .006, .002, shade(y), 4);
    if (r(50 + i) < .6) {
      const fork = [to[0] + Math.cos(angle + .9) * reach * .45, to[1] + .05, to[2] + Math.sin(angle + .9) * reach * .45];
      bark.limb(to, fork, .003, .0015, shade(y), 4);
    }
    if (r(60 + i) < mossy) bark.moss(to, .04 + r(70 + i) * .05, .006, seed * 11 + i, MOSS[i % 3]);
  }
  const kneeColor = hex('#6f655c');
  for (let i = 0; i < 4; i++) {
    const a = r(80 + i) * TAU, d = .07 + r(90 + i) * .06;
    bark.cone([Math.cos(a) * d, -.03, Math.sin(a) * d], .007, .02 + r(100 + i) * .02, 4, kneeColor, seed * 5 + i);
  }
  return bark.build();
}

// Dwarf palmetto: stiff fans on short stems. About 1 unit across.
function palmetto(seed) {
  const fronds = new Parts(), r = i => randomAt(seed * 53 + i, 3801);
  for (let i = 0; i < 8; i++) {
    const angle = i * 2.399963 + seed, rise = .25 + r(i) * .3, reach = .22 + r(10 + i) * .2;
    const center = [Math.cos(angle) * reach, rise, Math.sin(angle) * reach];
    const stem = hex('#5a6b3d');
    fronds.face([0, 0, 0], [center[0] * .98 + .01, center[1], center[2] * .98], [center[0] * .98 - .01, center[1], center[2] * .98], stem);
    // The fan faces outward and up.
    const normal = new THREE.Vector3(Math.cos(angle), 1.2, Math.sin(angle)).normalize();
    const side = new THREE.Vector3().crossVectors(normal, up).normalize(), lift = new THREE.Vector3().crossVectors(side, normal).normalize();
    const color = hex(['#5f7e45', '#6a8a4b', '#55733f'][i % 3]).multiplyScalar(.9 + r(20 + i) * .2);
    for (let k = 0; k < 9; k++) {
      const a = (k / 8 - .5) * 2.6, b = a + .16, length = .34 + r(30 + i * 9 + k) * .08;
      const at = (angle2, d) => [center[0] + (side.x * Math.sin(angle2) + lift.x * Math.cos(angle2)) * d, center[1] + (side.y * Math.sin(angle2) + lift.y * Math.cos(angle2)) * d - d * d * .25,
        center[2] + (side.z * Math.sin(angle2) + lift.z * Math.cos(angle2)) * d];
      fronds.face(center, at(a, length), at(b, length * .96), color.clone().multiplyScalar(k % 2 ? 1 : .88));
    }
  }
  return fronds.build();
}

// Sawgrass tuft, optionally with cattail heads. Height 1.
function reeds(seed, cattails = 0) {
  const blades = new Parts(), r = i => randomAt(seed * 59 + i, 3901);
  const base = hex('#5e7350'), tip = hex('#b7b183');
  for (let i = 0; i < 16; i++) {
    const angle = i * 2.399963 + seed, height = .55 + r(i) * .45, bend = .12 + r(10 + i) * .32, width = .036 + r(20 + i) * .022;
    const dir = [Math.cos(angle), Math.sin(angle)], side = [-dir[1] * width, dir[0] * width];
    const foot = [dir[0] * .14 * r(30 + i), 0, dir[1] * .14 * r(30 + i)];
    const knee = [foot[0] + dir[0] * bend * .3, height * .6, foot[2] + dir[1] * bend * .3];
    const end = [foot[0] + dir[0] * bend, height, foot[2] + dir[1] * bend];
    const mid = base.clone().lerp(tip, .45 + r(40 + i) * .2), top = base.clone().lerp(tip, .8 + r(50 + i) * .2);
    blades.face([foot[0] - side[0], 0, foot[2] - side[1]], [foot[0] + side[0], 0, foot[2] + side[1]], [knee[0] + side[0] * .6, knee[1], knee[2] + side[1] * .6], base, null, base, mid);
    blades.face([foot[0] - side[0], 0, foot[2] - side[1]], [knee[0] + side[0] * .6, knee[1], knee[2] + side[1] * .6], [knee[0] - side[0] * .6, knee[1], knee[2] - side[1] * .6], base, null, mid, mid);
    blades.face([knee[0] - side[0] * .6, knee[1], knee[2] - side[1] * .6], [knee[0] + side[0] * .6, knee[1], knee[2] + side[1] * .6], end, mid, null, mid, top);
  }
  const head = hex('#5b3d27');
  for (let i = 0; i < cattails; i++) {
    const angle = r(60 + i) * TAU, d = .05 + r(70 + i) * .08, height = .95 + r(80 + i) * .3;
    const x = Math.cos(angle) * d, z = Math.sin(angle) * d;
    blades.limb([x * .3, 0, z * .3], [x, height, z], .006, .004, hex('#6d7443'), 3);
    blades.limb([x, height - .02, z], [x * 1.02, height + .17, z * 1.02], .026, .024, head, 5);
  }
  return blades.build();
}

// A cluster of notched pads with a flower or two. Radius about 1.
function lilies(seed, flowers = 1) {
  const pads = new Parts(), r = i => randomAt(seed * 61 + i, 4001);
  const greens = ['#6f804b', '#7d8a51', '#586e46', '#879058'].map(hex);
  for (let i = 0; i < 8; i++) {
    const angle = i * 2.399963 + seed, d = Math.sqrt(r(i)) * .8, radius = .12 + r(10 + i) * .16;
    const cx = Math.cos(angle) * d, cz = Math.sin(angle) * d, notch = r(20 + i) * TAU, color = greens[i % 4].clone().multiplyScalar(.9 + r(30 + i) * .2);
    const segments = 6, y = .005 + i * .0015;
    for (let k = 0; k < segments - 1; k++) {
      const a = notch + (k + .5) / segments * TAU, b = notch + (k + 1.5) / segments * TAU;
      pads.face([cx, y + .004, cz], [cx + Math.cos(b) * radius, y, cz + Math.sin(b) * radius], [cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius], color.clone().multiplyScalar(k % 2 ? 1 : .93), [cx, y - 1, cz]);
    }
  }
  for (let i = 0; i < flowers; i++) {
    const angle = r(40 + i) * TAU, d = .2 + r(50 + i) * .4, cx = Math.cos(angle) * d, cz = Math.sin(angle) * d;
    const petal = hex(r(60 + i) < .3 ? '#efc3d0' : '#f2efe4'), heart = hex('#e8c24a');
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU, b = a + .5;
      pads.face([cx, .02, cz], [cx + Math.cos(a) * .09, .075, cz + Math.sin(a) * .09], [cx + Math.cos(b) * .05, .05, cz + Math.sin(b) * .05], petal, [cx, -.1, cz]);
    }
    pads.cone([cx, .02, cz], .025, .03, 5, heart, seed + i);
  }
  return pads.build();
}

// Angular riprap and island stones. Unit radius.
function rock(seed, algae = 0) {
  const stone = new Parts(), r = i => randomAt(seed * 67 + i, 4101), sides = 5 + seed % 2;
  const rings = [[-.45, .82], [.1, 1], [.62, .58]].map(([y, radius], layer) => Array.from({ length: sides }, (_, i) => {
    const a = (i + (r(i + layer * 10) - .5) * .5) / sides * TAU, d = radius * (.78 + r(20 + i + layer * 10) * .36);
    return [Math.cos(a) * d, y + (r(40 + i + layer * 10) - .5) * .22, Math.sin(a) * d];
  }));
  const light = hex('#a8a59d'), dark = hex('#5d5a54'), green = hex('#4d5c38');
  const shade = p => { const c = dark.clone().lerp(light, smoothstep(-.4, .7, p[1])); return c.lerp(green, algae * (1 - smoothstep(-.5, .1, p[1]))); };
  const top = [(r(60) - .5) * .2, .8, (r(61) - .5) * .2], bottom = [0, -.55, 0];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    for (let k = 0; k < 2; k++) {
      stone.face(rings[k][i], rings[k][j], rings[k + 1][i], shade(rings[k][i]), [0, 0, 0]);
      stone.face(rings[k][j], rings[k + 1][j], rings[k + 1][i], shade(rings[k][j]), [0, 0, 0]);
    }
    stone.face(rings[2][i], rings[2][j], top, shade(top), [0, 0, 0]);
    stone.face(rings[0][j], rings[0][i], bottom, dark, [0, 0, 0]);
  }
  return stone.build();
}

// Fallen trunk along x, mossy on top. One variant carries basking turtles.
function log(seed, turtles = 0) {
  const wood = new Parts(), r = i => randomAt(seed * 71 + i, 4201), sides = 6;
  const bark = hex('#4d3f33'), moss = hex('#5b7040'), end = hex('#8d7a62');
  const ring = x => Array.from({ length: sides }, (_, i) => { const a = i / sides * TAU; return [x, Math.sin(a) * .055, Math.cos(a) * .055]; });
  const a = ring(-.5), b = ring(.5);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides, color = a[i][1] + a[j][1] > .05 ? moss.clone().multiplyScalar(.9 + r(i) * .2) : bark;
    wood.face(a[i], a[j], b[i], color, [0, 0, 0]); wood.face(a[j], b[j], b[i], color, [0, 0, 0]);
    wood.face([-.5, 0, 0], a[j], a[i], end, [0, 0, 0]); wood.face([.5, 0, 0], b[i], b[j], end, [0, 0, 0]);
  }
  wood.limb([.2, .02, 0], [.3, .09, .08], .012, .005, bark, 4);
  const shell = hex('#3b4230');
  for (let i = 0; i < turtles; i++) {
    const x = -.3 + i * .17 + r(10 + i) * .05;
    wood.cone([x, .048, 0], .028, .026, 6, shell, seed + i);
    wood.limb([x - .03, .055, 0], [x - .05, .065, 0], .007, .005, hex('#4a5236'), 4);
  }
  return wood.build();
}

// Wading birds face -z and stand 1 unit tall.
function wader(seed, { body, neck, beak, legs, stretch = 1 }) {
  const bird = new Parts(), r = i => randomAt(seed * 73 + i, 4301);
  bird.lobe([0, .55, .02], [.13, .12, .26], seed, body);
  bird.lobe([0, .56, .22], [.06, .05, .1], seed + 1, body.clone().multiplyScalar(.92));
  const base = [0, .62, -.16], bend = [0, .74 * stretch, -.1], head = [0, .86 * stretch, -.19];
  bird.limb(base, bend, .035, .026, neck, 5); bird.limb(bend, head, .026, .022, neck, 5);
  bird.lobe(head, [.045, .045, .06], seed + 2, neck);
  bird.limb([head[0], head[1], head[2] - .03], [head[0], head[1] - .02, head[2] - .17], .012, .003, beak, 4);
  for (const side of [-1, 1]) bird.limb([side * .04, .5, .02], [side * .045 + (r(side + 3) - .5) * .03, 0, .03], .008, .006, legs, 3);
  return bird.build();
}

// Alligator facing -z, one unit long. Only the ridge and eyes clear the water line.
function gator(seed, basking = false) {
  const hide = new Parts(), r = i => randomAt(seed * 79 + i, 4401);
  const back = hex('#4a523b'), belly = hex('#7a7656');
  const stations = [[-.5, .022, .008], [-.4, .04, .024], [-.3, .05, .036], [-.2, .085, .04], [-.05, .1, .042], [.1, .09, .038], [.2, .06, .03], [.35, .035, .02], [.5, .006, .01]];
  const sides = 6, lift = basking ? .045 : 0;
  const rings = stations.map(([z, width, top]) => Array.from({ length: sides }, (_, i) => {
    const a = i / sides * TAU;
    return [Math.cos(a) * width, lift + (Math.sin(a) > 0 ? Math.sin(a) * top : Math.sin(a) * width * .55), z];
  }));
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides, color = rings[k][i][1] + rings[k][j][1] > lift * 2 ? back.clone().multiplyScalar(.9 + r(k * 8 + i) * .2) : belly;
    const center = [0, lift, (stations[k][0] + stations[k + 1][0]) / 2];
    hide.face(rings[k][i], rings[k][j], rings[k + 1][i], color, center); hide.face(rings[k][j], rings[k + 1][j], rings[k + 1][i], color, center);
  }
  const eye = hex('#c9b04a');
  for (const side of [-1, 1]) {
    hide.cone([side * .026, lift + .028, -.31], .012, .018, 4, back, seed + side);
    hide.cone([side * .027, lift + .042, -.31], .004, .006, 3, eye, seed + side + 4);
    for (const z of [-.12, .12]) hide.limb([side * .07, lift, z], [side * .13, lift - .03, z - .03], .016, .012, back, 4);
  }
  const ridge = hex('#66704f');
  for (let k = 0; k < 7; k++) for (const x of [-.018, .018]) hide.cone([x, lift + .036 - Math.abs(k - 2) * .003, -.15 + k * .07], .009, .014, 3, ridge, seed + k * 2 + x * 100 + 9);
  return hide.build();
}

// Two variants of each kind. Every variant costs a draw per chunk for its
// trunk, crown, reflection and shadow. Random turns and sizes hide the repeats.
export const cypressTrees = [cypress(1), cypress(4, { lean: -.055, limbs: 6, spread: .3, low: .66, mossy: 1.2 })];
export const oakTrees = [oak(1), tupelo(3)];
export const snagTrees = [snag(1), snag(3, { tall: .6, limbs: 2, mossy: 0 })];
export const palmettoGeometry = palmetto(1);
export const reedTufts = [reeds(1), reeds(2, 3)];
export const lilyClusters = [lilies(1, 1), lilies(3, 2)];
export const swampRocks = [rock(1), rock(2, .8), rock(3, .4)];
export const swampLogs = [log(1), log(2, 2)];
export const egretGeometry = wader(1, { body: hex('#f1f0e8'), neck: hex('#ecebe2'), beak: hex('#e0b23a'), legs: hex('#2c2c28') });
export const heronGeometry = wader(2, { body: hex('#7a8a9b'), neck: hex('#a9b3bb'), beak: hex('#c9a246'), legs: hex('#3c3f3a'), stretch: 1.12 });
export const gatorGeometry = gator(1);
export const baskingGatorGeometry = gator(2, true);
