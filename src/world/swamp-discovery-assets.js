import * as THREE from 'three';
import { Parts } from './swamp-assets.js';
import { randomAt, smoothstep, lerp } from './route.js';
import { waterClock } from './water.js';
import { material } from './swamp-materials.js';
import { CHAPEL_DRIVE } from './swamp-discoveries.js';

// Landmark models stand on the water at y = 0, facing the isometric camera
// along -x and oncoming traffic along +z. Each has a body, an unlit glow layer
// and a reflection silhouette. Shared by every chunk that shows one.
const TAU = Math.PI * 2, hex = value => new THREE.Color(value);
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// Parts drawn through a frame stack, so an assembly can sink, lean or swing as
// one. A model's body and glow layers share the stack.
class Layer extends Parts {
  constructor(stack) { super(); this.stack = stack; }
  point(p, color) {
    const e = this.stack.at(-1).elements, [x, y, z] = p;
    super.point([e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]], color);
  }
  quad(a, b, c, d, color, inside) { this.face(a, b, c, color, inside); this.face(a, c, d, color, inside); }
  // Convex polygon, wound away from `inside`.
  fan(points, color, inside) { for (let i = 1; i < points.length - 1; i++) this.face(points[0], points[i], points[i + 1], color, inside); }
  // Thin sheet seen from both sides: flags, scallops, the bell's mouth.
  sheet(points, color, back = color) {
    for (let i = 1; i < points.length - 1; i++) { this.face(points[0], points[i], points[i + 1], color); this.face(points[0], points[i + 1], points[i], back); }
  }
  // Square-cut timber from a to b, `width` across and `depth` along `hint`.
  beam(from, to, width, depth, color, hint = [0, 1, 0]) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), axis = b.clone().sub(a).normalize();
    const up = new THREE.Vector3(...hint).addScaledVector(axis, -new THREE.Vector3(...hint).dot(axis));
    if (up.lengthSq() < 1e-6) up.set(1, 0, 0).addScaledVector(axis, -axis.x);
    up.normalize();
    const side = new THREE.Vector3().crossVectors(axis, up), middle = a.clone().add(b).multiplyScalar(.5).toArray();
    const ring = p => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => p.clone().addScaledVector(side, sx * width / 2).addScaledVector(up, sy * depth / 2).toArray());
    const low = ring(a), high = ring(b), shades = [.7, .88, 1, .88];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.quad(low[i], low[j], high[j], high[i], color.clone().multiplyScalar(shades[i]), middle); }
    this.quad(...low, color, middle); this.quad(...high, color, middle);
  }
  // Eight-faced bead, for lamps and finials.
  bulb([x, y, z], size, color) {
    const points = [[x + size, y, z], [x, y, z + size], [x - size, y, z], [x, y, z - size]];
    for (let i = 0; i < 4; i++) {
      const a = points[i], b = points[(i + 1) % 4];
      this.face(a, b, [x, y + size, z], color, [x, y, z]); this.face(a, b, [x, y - size, z], color.clone().multiplyScalar(.8), [x, y, z]);
    }
  }
}
class Model {
  constructor() {
    this.stack = [new THREE.Matrix4()];
    this.body = new Layer(this.stack); this.glow = new Layer(this.stack); this.silhouette = new Layer(this.stack);
  }
  frame(position, rotation, build, scale = 1) {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(scale, scale, scale));
    this.stack.push(this.stack.at(-1).clone().multiply(local)); build(); this.stack.pop();
  }
  build() { return { body: this.body.build(), glow: this.glow.build(), reflection: this.silhouette.build() }; }
}

const MOSS = ['#929c87', '#a2ac98', '#818f7c'].map(hex);
const GREENS = ['#50674f', '#5d7555', '#465f4c', '#677d59', '#4d6a55'].map(hex);

// A white egret at roost, facing -z, about `size` metres tall.
function egret(model, position, yaw, size, seed) {
  model.frame(position, [0, yaw, 0], () => {
    const { body } = model, white = hex('#efeee6'), shade = hex('#d6d8d2');
    body.lobe([0, .45, .02], [.2, .17, .36], seed, white);
    body.lobe([0, .47, .3], [.09, .06, .15], seed + 1, shade);
    body.limb([0, .52, -.22], [0, .72, -.17], .06, .05, white, 4);
    body.limb([0, .72, -.17], [0, .84, -.27], .05, .045, white, 4);
    body.lobe([0, .86, -.3], [.06, .06, .08], seed + 2, white);
    body.limb([0, .86, -.36], [0, .83, -.54], .018, .004, hex('#d9ab3a'), 4);
    for (const side of [-1, 1]) body.limb([side * .05, .32, 0], [side * .06, 0, .02], .014, .012, hex('#2c2c28'), 3);
  }, size);
}
// Round pads with a notch, floating just clear of the water.
function lilyPads(layer, center, count, spread, seed) {
  const colors = ['#6f804b', '#7d8a51', '#586e46', '#879058'].map(hex);
  for (let i = 0; i < count; i++) {
    const angle = randomAt(seed * 31 + i, 5091) * TAU, d = Math.sqrt(randomAt(seed * 31 + i, 5092)) * spread, radius = .45 + randomAt(seed * 31 + i, 5093) * .5;
    const cx = center[0] + Math.cos(angle) * d, cz = center[2] + Math.sin(angle) * d, notch = randomAt(seed * 31 + i, 5094) * TAU, y = .015 + i * .002;
    const color = colors[i % 4];
    for (let k = 0; k < 7; k++) {
      const a = notch + (k + .5) / 8 * TAU, b = notch + (k + 1.5) / 8 * TAU;
      layer.face([cx, y + .01, cz], [cx + Math.cos(b) * radius, y, cz + Math.sin(b) * radius], [cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius],
        color.clone().multiplyScalar(k % 2 ? 1 : .92), [cx, y - 1, cz]);
    }
    if (i % 5 === 2) for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU;
      layer.face([cx, .05, cz], [cx + Math.cos(a) * .22, .2, cz + Math.sin(a) * .22], [cx + Math.cos(a + .5) * .12, .14, cz + Math.sin(a + .5) * .12], hex('#f2efe4'), [cx, -.3, cz]);
    }
  }
}
// A broad, flat-bottomed clump of three lobes, lit from above like the
// swamp's own crowns.
function pad(model, center, size, seed, color) {
  const [x, y, z] = center;
  model.body.lobe(center, [size * 1.1, size * .6, size], seed, color, 1);
  for (let k = 0; k < 2; k++) {
    const a = randomAt(seed, 5061 + k) * TAU, d = size * (.55 + randomAt(seed, 5063 + k) * .2), s = size * (.62 + randomAt(seed, 5065 + k) * .15);
    model.body.lobe([x + Math.cos(a) * d, y - size * .12, z + Math.sin(a) * d], [s, s * .62, s], seed * 7 + k + 1, color.clone().multiplyScalar(.94 + k * .08), 1);
  }
  model.silhouette.lobe(center, [size * 1.5, size * .6, size * 1.4], seed, color.clone().multiplyScalar(.8), -1);
}

// ---------------------------------------------------------------------------
// Ancient hollow cypress: a colossal bald cypress with a pointed cleft through
// its buttressed base, lit inside by foxfire. The top was broken off by
// lightning long ago and a scar spirals down from the splintered crown. Egrets
// roost on its flat pads and a ring of knees stands in the water around it.
function hollowCypress() {
  const model = new Model(), { body, glow, silhouette } = model, r = i => randomAt(i, 5101);
  const DARK = hex('#2f261e'), BARK = hex('#6a5242'), GREY = hex('#8d7d6d'), SCAR = hex('#c2b6a3'), HEART = hex('#a0805f'), HOLLOW = hex('#2a211b');
  const DEAD = hex('#a8a197'), KNEE_LOW = hex('#3a2f27'), KNEE_TOP = hex('#978169');
  const FOXFIRE = ['#8ff2c9', '#6fe3c0', '#b6f5a8', '#a3f0dd'].map(hex);
  const lean = y => [.0021 * Math.max(0, y) ** 1.55, -.0011 * Math.max(0, y) ** 1.5];
  const axis = y => { const [x, z] = lean(y); return [x, y, z]; };
  const girth = y => (1.95 + 3.4 * Math.exp(-Math.max(0, y + .6) / 2.4)) * (1 - .42 * smoothstep(9, 33, y));
  const ridge = (a, y) => .5 + .5 * Math.cos(a * 7 + 1.1 + y * .045);
  const flute = (a, y) => 1 + .38 * (1 - smoothstep(-.5, 6.5, y)) * ridge(a, y) ** 1.4 + .05 * Math.cos(a * 3 + .6) + .03 * ridge(a, y);
  const outer = (a, y) => { const [x, z] = lean(y), radius = girth(y) * flute(a, y); return [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius]; };
  const inner = (a, y) => {
    const [x, z] = lean(y), radius = girth(y) * (1 + .1 * (1 - smoothstep(-.5, 5, y))) - .5 - .5 * (1 - smoothstep(-.5, 3, y));
    return [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius];
  };
  const barkAt = (a, y) => {
    const color = DARK.clone().lerp(BARK, smoothstep(-.3, 2.2, y)).lerp(GREY, smoothstep(6, 30, y) * .6).multiplyScalar(.84 + .26 * ridge(a, y));
    // The lightning scar spirals down from the broken top.
    if (y > 8) color.lerp(SCAR, smoothstep(.9, .975, Math.cos(a - 2.3 - y * .085)) * smoothstep(8, 13, y) * .85);
    return color;
  };

  // The shell is two walls between a tall cleft facing the camera and a narrow
  // slit behind. Opening widths are arc lengths, so the cleft keeps its shape as
  // the trunk narrows, and each closes to a point on its own ring.
  const openings = [{ center: Math.PI / 2, width: 2.05, height: 7.6 }, { center: -Math.PI / 2 + .35, width: .8, height: 4.6 }];
  const halfAngle = (o, y) => {
    const t = y / o.height;
    if (t >= 1) return 0;
    const shape = t <= .42 ? 1 + .15 * smoothstep(.42, -.3, t) : (1 - ((t - .42) / .58) ** 1.7) ** .75;
    return o.width * shape / girth(y);
  };
  // Each opening's height is a ring, so it closes exactly.
  const K = 15, rings = [-2.4, -1.2, 0, .7, 1.4, 2.1, 2.8, 3.5, 4.1, 4.6, 5.2, 5.8, 6.4, 7, 7.6, 8.8, 10.4, 12.4, 14.5, 17, 19.5, 22, 24.5, 27, 29.3, 31];
  const CAVITY = 8.8, APEX = 10.8;
  const walls = [[0, 1], [1, 0]];
  const columns = y => walls.map(([from, to]) => {
    const start = openings[from].center + halfAngle(openings[from], y);
    let end = openings[to].center - halfAngle(openings[to], y);
    while (end <= start) end += TAU;
    return Array.from({ length: K + 1 }, (_, j) => lerp(start, end, j / K));
  });
  const grid = rings.map(columns);
  for (let k = 0; k < rings.length - 1; k++) for (let w = 0; w < 2; w++) for (let j = 0; j < K; j++) {
    const y0 = rings[k], y1 = rings[k + 1], [a0, a1, b0, b1] = [grid[k][w][j], grid[k][w][j + 1], grid[k + 1][w][j], grid[k + 1][w][j + 1]];
    const middle = axis((y0 + y1) / 2);
    body.face(outer(a0, y0), outer(a1, y0), outer(b1, y1), barkAt(a0, y0), middle, barkAt(a1, y0), barkAt(b1, y1));
    body.face(outer(a0, y0), outer(b1, y1), outer(b0, y1), barkAt(a0, y0), middle, barkAt(b1, y1), barkAt(b0, y1));
    // The cavity, with the same columns so the jambs meet both surfaces.
    if (y1 > CAVITY) continue;
    const away = p => { const c = axis(p[1]); return [c[0] + (p[0] - c[0]) * 3, p[1], c[2] + (p[2] - c[2]) * 3]; };
    const shade = y => HOLLOW.clone().lerp(DARK, smoothstep(0, 6, y) * .5);
    const p = [inner(a0, y0), inner(a1, y0), inner(b1, y1), inner(b0, y1)], out = away(inner((a0 + b1) / 2, (y0 + y1) / 2));
    body.face(p[0], p[1], p[2], shade(y0), out, shade(y0), shade(y1)); body.face(p[0], p[2], p[3], shade(y0), out, shade(y1), shade(y1));
  }
  // Ceiling of the cavity, and the jambs where the bark shell shows its thickness.
  const cavityRing = columns(CAVITY), top = axis(APEX);
  for (const angles of cavityRing) for (let j = 0; j < K; j++) body.face(inner(angles[j], CAVITY), inner(angles[j + 1], CAVITY), top, HOLLOW, [top[0], APEX + 5, top[2]]);
  for (const [w, j, adjacent] of [[0, 0, 1], [1, K, K - 1], [0, K, K - 1], [1, 0, 1]]) {
    const opening = openings[j === 0 ? w : 1 - w];
    for (let k = 0; k < rings.length - 1 && rings[k + 1] <= opening.height; k++) {
      const y0 = rings[k], y1 = rings[k + 1], a0 = grid[k][w][j], b0 = grid[k + 1][w][j];
      const wall = [(outer(grid[k][w][adjacent], y0)[0] + inner(grid[k][w][adjacent], y0)[0]) / 2, y0 + .01,
        (outer(grid[k][w][adjacent], y0)[2] + inner(grid[k][w][adjacent], y0)[2]) / 2];
      const tint = HEART.clone().multiplyScalar(.75 + .3 * smoothstep(-.5, 4, y0));
      body.quad(outer(a0, y0), outer(b0, y1), inner(b0, y1), inner(a0, y0), tint, wall);
    }
  }
  // Lightning-broken top: a rotten hollow and a crown of silver splinters.
  const rim = rings.at(-1), crownRing = grid.at(-1).flatMap(angles => angles.slice(0, K)).map(a => outer(a, rim)), pit = axis(rim - 1.1);
  crownRing.forEach((p, i) => body.face(p, crownRing[(i + 1) % crownRing.length], pit, HOLLOW, [pit[0], rim - 6, pit[2]], HOLLOW, DARK));
  [[2.4, 5.4, .52], [3.5, 3.2, .42], [1.2, 2.3, .38], [4.6, 1.6, .34], [5.7, 2.8, .32], [.2, 1.3, .3]].forEach(([angle, height, radius], i) => {
    const [x, z] = lean(rim), d = girth(rim) * .72;
    body.cone([x + Math.cos(angle) * d, rim - .4, z + Math.sin(angle) * d], radius, height, 4, DEAD.clone().multiplyScalar(.9 + i * .03), 71 + i,
      [Math.cos(angle) * .3, Math.sin(angle) * .3]);
  });
  silhouette.lathe(rings.filter((_, k) => k % 3 === 0 || k === rings.length - 1).map(y => [y, girth(y) * 1.12, ...lean(y)]), 8, y => barkAt(0, y));

  // Buttress roots reach out under the water between the openings.
  const rootTops = [];
  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * TAU + (r(80 + i) - .5) * .3 + .15;
    if (openings.some(o => Math.abs(wrap(angle - o.center)) < .42)) continue;
    const base = girth(.3) * 1.05, reach = 8 + r(90 + i) * 3.4, mid = lerp(base, reach, .42), at = (d, y) => [Math.cos(angle) * d, y, Math.sin(angle) * d];
    const hump = .75 + r(100 + i) * .45;
    body.limb(at(base - .6, .9), at(mid, hump), .95, .55, KNEE_LOW.clone().lerp(BARK, .45), 6);
    body.limb(at(mid, hump), at(reach, -.5), .55, .14, KNEE_LOW.clone().lerp(BARK, .25), 5);
    for (const f of [.55, .85]) rootTops.push(at(lerp(base - .6, mid, f), lerp(.9, hump, f) + lerp(.95, .55, f) * .85));
  }
  // Knees crowd the shallows like a congregation, thinning out with distance.
  for (let i = 0; i < 38; i++) {
    const angle = r(140 + i) * TAU, d = 6.2 + r(180 + i) ** .85 * 9;
    if (Math.abs(wrap(angle - Math.PI / 2)) < .28 && d < 11) continue;
    const height = (.5 + r(220 + i) ** 1.4 * 2.3) * (1 - (d - 6) / 22), radius = .2 + height * .13;
    const x = Math.cos(angle) * d, z = Math.sin(angle) * d, tx = (r(260 + i) - .5) * .3 * height, tz = (r(300 + i) - .5) * .3 * height;
    body.lathe([[-.6, radius * 1.2, x, z], [height * .45, radius * .74, x + tx * .45, z + tz * .45], [height * .85, radius * .4, x + tx * .85, z + tz * .85],
      [height, radius * .08, x + tx, z + tz]], 6, y => KNEE_LOW.clone().lerp(KNEE_TOP, smoothstep(-.2, 2.4, y)));
  }

  // Limbs spread flat from high on the trunk into a broad umbrella, one of
  // them long dead. Old foliage is paler and more olive than the young trees'.
  const perches = [], SAGE = ['#63734f', '#6d7b55', '#58694b', '#72805a', '#5e6e52'].map(hex);
  for (let i = 0; i < 11; i++) {
    const t = i / 10, y = lerp(15.5, 28.5, t) + (r(20 + i) - .5) * .8, angle = i * 2.399963 + .9, dead = i === 3;
    const reach = (dead ? 8 : 11 + r(30 + i) * 4) * (1 - t * .32), [ax, az] = lean(y), dir = [Math.cos(angle), Math.sin(angle)];
    const wander = (r(50 + i) - .5) * 2.4;
    const from = [ax, y, az], elbow = [ax + dir[0] * reach * .55, y + .8 + r(40 + i), az + dir[1] * reach * .55];
    const tip = [ax + dir[0] * reach - dir[1] * wander, y + 2.2 + r(60 + i) * 1.8, az + dir[1] * reach + dir[0] * wander];
    const color = dead ? DEAD : barkAt(angle, y);
    body.limb(from, elbow, girth(y) * .36, .44, color, 6);
    body.limb(elbow, tip, .44, .15, color, 5);
    silhouette.limb(from, elbow, girth(y) * .36, .44, color, 4); silhouette.limb(elbow, tip, .44, .15, color, 4);
    const along = f => [lerp(from[0], tip[0], f), lerp(from[1], tip[1], f) - .5, lerp(from[2], tip[2], f)];
    if (dead) {
      const fork = [tip[0] + dir[0] * 2.2, tip[1] + 1.6, tip[2] + dir[1] * 2.2 + 1];
      body.limb(tip, fork, .15, .05, DEAD, 4);
      body.limb(elbow, [elbow[0] - dir[1] * 2.4, elbow[1] + 2.2, elbow[2] + dir[0] * 2.4], .2, .05, DEAD, 4);
      for (const f of [.4, .62, .85]) body.moss(along(f), 2.8 + r(70 + i * 3 + f * 10) * 2.5, .22, 900 + i * 7 + f * 10, MOSS[i % 3]);
      continue;
    }
    const size = 3.7 + r(110 + i) * 1.3 - t * .6, green = SAGE[i % SAGE.length];
    pad(model, [tip[0], tip[1] + .3, tip[2]], size, 200 + i * 5, green);
    pad(model, [lerp(elbow[0], tip[0], .45) - dir[1] * 1.4, elbow[1] + 1.3, lerp(elbow[2], tip[2], .45) + dir[0] * 1.4], size * .78, 201 + i * 5, SAGE[(i + 2) % SAGE.length]);
    if (r(120 + i) < .7) pad(model, [tip[0] + dir[1] * 2.4, tip[1] - .4, tip[2] - dir[0] * 2.4], size * .72, 202 + i * 5, SAGE[(i + 3) % SAGE.length]);
    perches.push([tip[0], tip[1] + .3 + size * .5, tip[2]]);
    // Curtains of moss along the limb and round the pads' edges.
    for (let k = 0; k < 11; k++) {
      const f = .25 + k / 10 * .75, p = along(f), side = (r(400 + i * 11 + k) - .5) * 2.4;
      body.moss([p[0] - dir[1] * side, p[1] - .1, p[2] + dir[0] * side], 2.4 + r(500 + i * 11 + k) * 4.2, .17 + r(600 + i * 11 + k) * .12, 1000 + i * 11 + k, MOSS[k % 3]);
    }
    for (let k = 0; k < 6; k++) {
      const a = r(700 + i * 6 + k) * TAU, d = size * (.85 + r(800 + i * 6 + k) * .25);
      body.moss([tip[0] + Math.cos(a) * d, tip[1] - size * .1, tip[2] + Math.sin(a) * d], 2 + r(900 + i * 6 + k) * 3.4, .16, 1200 + i * 6 + k, MOSS[(k + 1) % 3]);
    }
  }
  for (let i = 0; i < 3; i++) {
    const angle = 1.6 + i * 2.1, [x, z] = lean(29);
    pad(model, [x + Math.cos(angle) * 3, 29.4 + i * .5, z + Math.sin(angle) * 3], 3, 260 + i, SAGE[(i + 1) % SAGE.length]);
  }
  // An egret rookery on the high pads.
  perches.forEach((p, i) => {
    egret(model, p, r(1300 + i) * TAU, 1.2 + r(1310 + i) * .25, 1320 + i * 3);
    if (i % 3 === 1) egret(model, [p[0] + 1.3, p[1] - .2, p[2] - .8], r(1340 + i) * TAU, 1.15, 1350 + i * 3);
  });

  // Foxfire: glowing brackets on the inside walls, round the cleft and on the roots.
  const shelf = (p, out, size, color) => {
    const side = [-out[1], out[0]], points = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 5 - .5) * Math.PI;
      return [p[0] + (side[0] * Math.sin(a) + out[0] * Math.cos(a)) * size, p[1] - .12 * size * Math.cos(a), p[2] + (side[1] * Math.sin(a) + out[1] * Math.cos(a)) * size];
    });
    for (let i = 0; i < 5; i++) {
      glow.face(p, points[i], points[i + 1], color, [p[0], p[1] - 1, p[2]]);
      glow.face(p, points[i + 1], points[i], color.clone().multiplyScalar(.62), [p[0], p[1] + 1, p[2]]);
    }
  };
  for (let i = 0; i < 11; i++) {
    const angle = -Math.PI / 2 + (i / 10 - .5) * 3.6 + (r(1400 + i) - .5) * .2, base = .5 + r(1410 + i) * 4.8;
    if (Math.abs(wrap(angle - openings[1].center)) < .5 && base < openings[1].height + .5) continue;
    for (let k = 0, count = 2 + Math.floor(r(1420 + i) * 3); k < count; k++) {
      const y = base + k * .32, p = inner(angle + (r(1430 + i * 4 + k) - .5) * .12, y), c = axis(y);
      const out = [c[0] - p[0], c[2] - p[2]], length = Math.hypot(...out);
      shelf(p, [out[0] / length, out[1] / length], .42 - k * .07, FOXFIRE[(i + k) % FOXFIRE.length]);
    }
  }
  // Round the cleft's flanks, clear of the opening itself.
  for (const [angle, base] of [[2.55, .7], [2.75, 1.6], [.45, .9], [3.3, .6], [.05, 1.8], [2.62, 3.4], [.62, 2.9]]) {
    for (let k = 0; k < 3; k++) {
      const y = base + k * .34, p = outer(angle, y), c = axis(y), out = [p[0] - c[0], p[2] - c[2]], length = Math.hypot(...out);
      shelf(p, [out[0] / length, out[1] / length], .48 - k * .1, FOXFIRE[(k + 1) % FOXFIRE.length]);
    }
  }
  // Little glowing caps in clusters along the roots.
  rootTops.forEach(([x, y, z], i) => {
    for (let k = 0; k < 3; k++) {
      const a = r(1500 + i * 3 + k) * TAU, d = .12 + r(1510 + i * 3 + k) * .3, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, height = .1 + k * .07;
      body.limb([px, y - .1, pz], [px, y + height, pz], .035, .03, hex('#d9d2bc'), 3);
      glow.cone([px, y + height, pz], .13 + r(1530 + i * 3 + k) * .07, .09, 6, FOXFIRE[(i + k) % FOXFIRE.length], 1540 + i * 3 + k);
    }
  });

  // A pirogue nosed into the cleft, its paddle across the gunwales.
  model.frame([.35, 0, 5], [0, .2, 0], () => {
    const hull = hex('#5d4432'), floor = hex('#35271d'), stations = [-2.2, -1.8, -1.1, -.35, .4, 1.15, 1.85, 2.2];
    const half = z => .38 * Math.max(0, 1 - (z / 2.2) ** 2) ** .55 + .02, lip = z => .24 + .08 * (z / 2.2) ** 2;
    for (let k = 0; k < stations.length - 1; k++) {
      const [z0, z1] = [stations[k], stations[k + 1]];
      for (const side of [-1, 1]) {
        const a = [side * half(z0), lip(z0), z0], b = [side * half(z1), lip(z1), z1], c = [side * half(z1) * .55, -.1, z1], d = [side * half(z0) * .55, -.1, z0];
        body.quad(a, b, c, d, hull, [0, .1, (z0 + z1) / 2]);
        body.quad(a, b, [0, .02, z1], [0, .02, z0], floor, [0, -1, (z0 + z1) / 2]);
      }
    }
    body.limb([-.55, .3, .6], [.6, .28, -.2], .03, .03, hex('#8a6d50'), 4);
    body.box([.72, .28, -.3], [.18, .03, .45], hex('#8a6d50'));
  });
  lilyPads(body, [3.5, 0, 9.5], 9, 3.2, 1); lilyPads(body, [-8.5, 0, 6.5], 7, 2.6, 2); lilyPads(body, [9, 0, -1], 6, 2.4, 3);
  return model.build();
}

// ---------------------------------------------------------------------------
// Roadside chapel: a white carpenter-gothic chapel on a raised lawn beside the
// causeway, lit for an evening service. A drive drops off the road into a
// paved lot with cars, lamp posts and a sign at the entrance, and live oaks
// hung with moss shade the lawn and a small churchyard of whitewashed tombs.
// Model x runs away from the road and y = 0 is the lawn.
const SIDING = hex('#e6e2d6'), PLINTH = hex('#8a5b49'), TRIM = hex('#f2efe6'), SLATE = hex('#58626a'), LEADING = hex('#262229');
const ASPHALT = hex('#3a3f44'), PAINT = hex('#dcdad0'), CONCRETE = hex('#aeaba2'), IRON = hex('#232629');
const GLASS = { amber: '#efb24f', gold: '#f5d06a', ruby: '#cf4f45', blue: '#4d78cf', green: '#5ea56a', violet: '#8f64bf' };
// Horizontal courses between y0 and y1, clipped to `edge(y)` so gables taper.
// `at(t, y, d)` maps wall coordinates to the model, `d` outward from the face.
function siding(layer, at, edge, y0, y1, inside, seed) {
  for (let y = y0, i = 0; y < y1 - .01; y += .34, i++) {
    const top = Math.min(y1, y + .34), [a0, a1] = edge(y), [b0, b1] = edge(top);
    if (a1 - a0 < .02) break;
    const color = SIDING.clone().multiplyScalar((i % 2 ? .94 : 1) * (.97 + randomAt(seed * 53 + i, 5211) * .04));
    layer.quad(at(a0, y), at(a1, y), at(b1, top), at(b0, top), color, inside);
  }
}
// A pointed lancet of stained glass with its trim, drawn on a wall's face.
function lancet(model, at, t, sill, width, spring, palette) {
  const { body, glow } = model, w = width / 2, apex = spring + .866 * width;
  // Equilateral arch: each side is an arc centred on the opposite spring.
  const arc = (d, from, to) => Array.from({ length: 4 }, (_, i) => {
    const a = (from + (to - from) * i / 3) * Math.PI / 180, cx = from < 90 ? t - w : t + w;
    return at(cx + 2 * w * Math.cos(a), spring + 2 * w * Math.sin(a), d);
  });
  const outline = d => [at(t - w, sill, d), at(t + w, sill, d), at(t + w, spring, d), ...arc(d, 0, 60).slice(1), ...arc(d, 120, 180).slice(1, 3), at(t - w, spring, d)];
  const toward = at(t, (sill + apex) / 2, -1);
  body.fan(outline(.03), LEADING, toward);
  const m = .08, mid = lerp(sill, spring, .5), cells = [
    [[t - w + m, sill + m], [t - .04, sill + m], [t - .04, mid - .04], [t - w + m, mid - .04]],
    [[t + .04, sill + m], [t + w - m, sill + m], [t + w - m, mid - .04], [t + .04, mid - .04]],
    [[t - w + m, mid + .04], [t - .04, mid + .04], [t - .04, spring], [t - w + m, spring]],
    [[t + .04, mid + .04], [t + w - m, mid + .04], [t + w - m, spring], [t + .04, spring]],
    [[t - w + m, spring + .05], [t - .04, spring + .05], [t - .04, apex - .2], [t - w * .55, spring + .6 * width]],
    [[t + .04, spring + .05], [t + w - m, spring + .05], [t + w * .55, spring + .6 * width], [t + .04, apex - .2]],
  ];
  cells.forEach((cell, i) => glow.fan(cell.map(([u, v]) => at(u, v, .05)), hex(GLASS[palette[i]]), toward));
  const trim = (a, b) => body.beam(at(...a, .07), at(...b, .07), .13, .1, TRIM, at(0, 0, 1).map((v, i) => v - at(0, 0, 0)[i]));
  trim([t - w - .06, sill], [t - w - .06, spring]); trim([t + w + .06, sill], [t + w + .06, spring]);
  const hood = (cx, from) => [0, 1, 2, 3].map(i => {
    const a = (from + (from ? -i : i) * 20) * Math.PI / 180;
    return [cx + (2 * w + .06) * Math.cos(a), spring + (2 * w + .06) * Math.sin(a)];
  });
  for (const curve of [hood(t + w, 180), hood(t - w, 0)]) for (let i = 0; i < 3; i++) trim(curve[i], curve[i + 1]);
  body.beam(at(t - w - .18, sill - .04, .1), at(t + w + .18, sill - .04, .1), .12, .2, TRIM, at(0, 0, 1).map((v, i) => v - at(0, 0, 0)[i]));
}
// A rose window of radiating petals round a gold eye.
function rose(model, at, cx, cy, radius, colors) {
  const { body, glow } = model, toward = at(cx, cy, -1), point = (a, d, z) => at(cx + Math.cos(a) * d, cy + Math.sin(a) * d, z);
  body.fan(Array.from({ length: 12 }, (_, i) => point(i / 12 * TAU, radius, .03)), LEADING, toward);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU, b = (i + 1) / 8 * TAU;
    glow.fan([point(a + .09, radius * .34, .05), point(a + .06, radius * .86, .05), point((a + b) / 2, radius * .93, .05), point(b - .06, radius * .86, .05), point(b - .09, radius * .34, .05)],
      hex(GLASS[colors[i % colors.length]]), toward);
  }
  glow.fan(Array.from({ length: 8 }, (_, i) => point(i / 8 * TAU, radius * .24, .05)), hex(GLASS.gold), toward);
  const normal = at(0, 0, 1).map((v, i) => v - at(0, 0, 0)[i]);
  for (let i = 0; i < 12; i++) body.beam(point(i / 12 * TAU, radius + .07, .07), point((i + 1) / 12 * TAU, radius + .07, .07), .14, .1, TRIM, normal);
}
// The chapel itself: nave, tower and spire, facade toward +z, floor at y = 0
// on a brick plinth down to `ground`. Doors stand open on the lit nave.
function chapelBuilding(model, ground) {
  const { body, glow } = model;
  const W = 3.5, FRONT = 5, BACK = -7, EAVE = 5.3, RIDGE = 9.7, TW = 1.6, TD = 3.2, SHAFT = 8.9, BELFRY = 12.1, SPIRE = 19.4;
  const gable = y => y <= EAVE ? [-W, W] : [-W * (RIDGE - y) / (RIDGE - EAVE), W * (RIDGE - y) / (RIDGE - EAVE)];
  body.box([0, ground / 2, (FRONT + BACK) / 2], [2 * W + .24, -ground + .04, FRONT - BACK + .24], PLINTH);
  body.box([0, ground / 2, FRONT + TD / 2], [2 * TW + .24, -ground + .04, TD + .24], PLINTH);
  for (const side of [-1, 1]) {
    const at = (t, y, d = 0) => [side * (W + d), y, t];
    siding(body, at, () => [BACK, FRONT], 0, EAVE, [0, 3, -1], 3 + side);
    for (const z of [BACK, FRONT]) body.beam([side * (W + .04), 0, z - Math.sign(z) * .08], [side * (W + .04), EAVE, z - Math.sign(z) * .08], .2, .14, TRIM, [side, 0, 0]);
    [-4.3, -1, 2.3].forEach((z, i) => lancet(model, at, z, 1.3, 1.15, 3.1,
      [['blue', 'blue', 'amber', 'amber', 'ruby', 'ruby'], ['green', 'green', 'gold', 'gold', 'violet', 'violet'], ['ruby', 'ruby', 'amber', 'amber', 'blue', 'blue']][(i + (side > 0 ? 1 : 0)) % 3]));
  }
  for (const [z, dir] of [[FRONT, 1], [BACK, -1]]) {
    const at = (t, y, d = 0) => [t, y, z + dir * d];
    siding(body, at, gable, 0, RIDGE, [0, 3, z - dir], 7 + dir);
    if (dir < 0) {
      rose(model, at, 0, 6.9, .95, ['ruby', 'blue', 'gold', 'blue']);
      for (const t of [-1.4, 1.4]) lancet(model, at, t, 1.6, .8, 3.2, ['amber', 'amber', 'ruby', 'ruby', 'gold', 'gold']);
    } else for (const t of [-2.55, 2.55]) lancet(model, at, t, 1.8, .75, 3.4, ['gold', 'gold', 'amber', 'amber', 'ruby', 'ruby']);
  }
  // Slate roof with a paler ridge, eaves and carpenter-gothic bargeboards.
  const eaveX = W + .55, eaveY = EAVE - .38, over = .45, rows = 6;
  for (const side of [-1, 1]) for (let k = 0; k < rows; k++) {
    const x0 = side * lerp(eaveX, 0, k / rows), y0 = lerp(eaveY, RIDGE, k / rows), x1 = side * lerp(eaveX, 0, (k + 1) / rows), y1 = lerp(eaveY, RIDGE, (k + 1) / rows);
    const color = SLATE.clone().multiplyScalar(.92 + randomAt(k + side * 7, 5212) * .12 + (k % 2) * .04);
    body.quad([x0, y0, BACK - over], [x0, y0, FRONT + over], [x1, y1, FRONT + over], [x1, y1, BACK - over], color, [0, y0 - 4, 0]);
    body.quad([x0, y0 - .14, BACK - over], [x0, y0 - .14, FRONT + over], [x1, y1 - .14, FRONT + over], [x1, y1 - .14, BACK - over], SLATE.clone().multiplyScalar(.6), [x0 + side * 4, y0 + 4, 0]);
  }
  body.beam([0, RIDGE + .02, BACK - over], [0, RIDGE + .02, FRONT + over], .26, .16, SLATE.clone().multiplyScalar(1.3));
  for (const side of [-1, 1]) {
    body.beam([side * eaveX, eaveY - .1, BACK - over], [side * eaveX, eaveY - .1, FRONT + over], .12, .26, TRIM, [side, 0, 0]);
    for (const z of [BACK - over, FRONT + over]) body.beam([side * eaveX, eaveY - .05, z], [0, RIDGE, z], .3, .1, TRIM, [0, 0, Math.sign(z)]);
  }
  body.beam([0, RIDGE, BACK - over + .2], [0, RIDGE + 1.3, BACK - over + .2], .14, .14, TRIM, [0, 0, 1]);
  body.beam([-.4, RIDGE + .9, BACK - over + .2], [.4, RIDGE + .9, BACK - over + .2], .12, .12, TRIM, [0, 0, 1]);

  model.frame([0, 0, FRONT], [0, 0, 0], () => {
    // The bell tower, 3.2 m square, against the facade.
    const front = (t, y, d = 0) => [t, y, TD + d];
    siding(body, front, () => [-TW, TW], 0, SHAFT, [0, 4, 0], 11);
    for (const side of [-1, 1]) {
      const at = (t, y, d = 0) => [side * (TW + d), y, TD - t];
      siding(body, at, () => [0, TD], 0, SHAFT, [0, 4, TD / 2], 12 + side);
      lancet(model, at, TD / 2, 4.9, .6, 5.85, ['amber', 'amber', 'gold', 'gold', 'ruby', 'ruby']);
      body.beam([side * (TW + .05), 0, TD + .05], [side * (TW + .05), SHAFT, TD + .05], .2, .16, TRIM, [side, 0, 1]);
    }
    // Doors thrown open on the lit nave, with a lamp either side.
    const w = .78, spring = 2.5, apex = spring + .866 * 2 * w, normal = [0, 0, 1];
    glow.fan([front(-w, 0, .03), front(w, 0, .03), front(w, spring, .03), front(w * .5, apex - .25, .03), front(0, apex, .03), front(-w * .5, apex - .25, .03), front(-w, spring, .03)],
      hex('#ffcf86'), [0, 2, 0]);
    for (const side of [-1, 1]) {
      model.frame([side * w, 0, TD + .06], [0, side * 1.3, 0], () => body.box([-side * (w / 2 - .03), 1.25, 0], [w - .06, 2.5, .08], hex('#6b4a38')));
      body.beam(front(side * (w + .08), 0, .08), front(side * (w + .08), spring, .08), .16, .12, TRIM, normal);
      body.beam(front(side * (w + .08), spring, .08), front(0, apex + .1, .08), .16, .12, TRIM, normal);
      body.box([side * 1.22, 2.55, TD + .12], [.16, .22, .16], hex('#2b2723'));
      glow.box([side * 1.22, 2.3, TD + .12], [.14, .28, .14], hex('#ffd58a'));
    }
    rose(model, front, 0, 5.75, .82, ['ruby', 'gold', 'blue', 'gold']);
    // Front steps down to the walk, with rails.
    for (let i = 0; i < 3; i++) {
      const top = ground * (i + 1) / 4;
      body.box([0, (top + ground) / 2, TD + .19 + i * .38], [2.3, top - ground, .38], CONCRETE.clone().multiplyScalar(1.04 - i * .03));
    }
    for (const side of [-1, 1]) {
      body.beam([side * 1.2, .9, TD], [side * 1.2, ground + .9, TD + 1.14], .07, .07, TRIM);
      for (const [dz, y] of [[0, 0], [1.14, ground]]) body.box([side * 1.2, y + .45, TD + dz], [.08, .9, .08], TRIM);
    }
    body.box([0, SHAFT + .12, TD / 2], [2 * TW + .4, .24, TD + .4], TRIM);
    body.box([0, SHAFT + .3, TD / 2], [2 * TW, .12, TD], hex('#4e4238'));
    // Open belfry with the bell in view.
    for (const x of [-TW + .17, TW - .17]) for (const z of [.17, TD - .17]) body.box([x, (SHAFT + BELFRY) / 2, z], [.34, BELFRY - SHAFT, .34], TRIM);
    for (const [a, b, n] of [[[-TW, TD], [TW, TD], [0, 0, 1]], [[-TW, 0], [TW, 0], [0, 0, -1]], [[-TW, 0], [-TW, TD], [-1, 0, 0]], [[TW, 0], [TW, TD], [1, 0, 0]]]) {
      const mid = [(a[0] + b[0]) / 2, BELFRY - .35, (a[1] + b[1]) / 2];
      body.beam([a[0], SHAFT + 1.8, a[1]], mid, .16, .12, TRIM, n); body.beam([b[0], SHAFT + 1.8, b[1]], mid, .16, .12, TRIM, n);
      body.beam([a[0], SHAFT + .85, a[1]], [b[0], SHAFT + .85, b[1]], .1, .1, TRIM, n);
    }
    const bronze = hex('#b08c45'), patina = hex('#7c9a86');
    body.lathe([[10.1, .66, 0, TD / 2], [10.25, .62, 0, TD / 2], [10.6, .48, 0, TD / 2], [11, .41, 0, TD / 2], [11.3, .33, 0, TD / 2], [11.45, .1, 0, TD / 2]], 10,
      y => patina.clone().lerp(bronze, .5 + smoothstep(10.1, 11.2, y) * .4));
    body.sheet(Array.from({ length: 10 }, (_, i) => [Math.cos(-i / 10 * TAU) * .6, 10.14, TD / 2 + Math.sin(-i / 10 * TAU) * .6]), hex('#2c2a24'));
    body.beam([-TW + .2, 11.55, TD / 2], [TW - .2, 11.55, TD / 2], .22, .22, hex('#4e4238'));
    body.box([0, BELFRY + .1, TD / 2], [2 * TW + .45, .24, TD + .45], TRIM);
    // Octagonal spire and cross.
    const base = Array.from({ length: 8 }, (_, i) => { const a = (i + .5) / 8 * TAU; return [Math.cos(a) * 2.05, BELFRY + .2, TD / 2 + Math.sin(a) * 2.05]; });
    base.forEach((p, i) => body.face(p, base[(i + 1) % 8], [0, SPIRE, TD / 2], SLATE.clone().multiplyScalar(i % 2 ? .92 : 1.08), [0, BELFRY + 2, TD / 2]));
    body.beam([0, SPIRE - .15, TD / 2], [0, SPIRE + 1.65, TD / 2], .14, .14, TRIM, [0, 0, 1]);
    body.beam([-.5, SPIRE + 1.1, TD / 2], [.5, SPIRE + 1.1, TD / 2], .12, .12, TRIM, [0, 0, 1]);
  });
}
// A parked car, nose to +x. Pickups have a cab and an open bed.
function parkedCar(model, position, yaw, paint, type) {
  model.frame(position, [0, yaw, 0], () => {
    const { body } = model, color = hex(paint), glass = hex('#2d3943'), tyre = hex('#1c1c1d'), chrome = hex('#b7b9b8');
    body.box([0, .63, 0], [4.6, .6, 1.84], color);
    for (const x of [-2.3, 2.3]) body.box([x, .5, 0], [.1, .2, 1.76], chrome);
    for (const side of [-1, 1]) {
      body.box([2.31, .78, side * .6], [.04, .14, .34], hex('#efe9d2')); body.box([-2.31, .8, side * .66], [.04, .14, .28], hex('#9c2f28'));
      for (const x of [1.5, -1.45]) body.limb([x, .34, side * .76], [x, .34, side * .99], .34, .34, tyre, 8);
    }
    if (type === 'pickup') {
      body.box([.55, 1.3, 0], [1.6, .5, 1.76], glass); body.box([.6, 1.6, 0], [1.75, .1, 1.76], color); body.box([1.3, 1.1, 0], [.16, .36, 1.76], color);
      for (const side of [-1, 1]) body.box([-1.35, 1.1, side * .86], [1.9, .36, .1], color);
      body.box([-2.25, 1.1, 0], [.1, .36, 1.74], color); body.box([-1.35, .94, 0], [1.9, .02, 1.64], hex('#2a2a2a'));
    } else {
      const length = type === 'wagon' ? 2.9 : 2.3, cx = type === 'wagon' ? -.45 : -.2;
      body.box([cx, 1.2, 0], [length, .56, 1.66], glass); body.box([cx, 1.5, 0], [length - .1, .08, 1.62], color);
    }
  });
}
function lampPost(model, x, z, reach) {
  const { body, glow } = model, pole = hex('#3c4044');
  body.box([x, .3, z], [.5, .6, .5], CONCRETE);
  body.limb([x, .55, z], [x, 6.3, z], .1, .07, pole, 6);
  body.beam([x, 6.25, z], [x + reach, 6.25, z], .09, .09, pole);
  body.box([x + reach * 1.1, 6.2, z], [.8, .2, .42], pole);
  glow.box([x + reach * 1.1, 6.08, z], [.64, .05, .3], hex('#ffe2a4'));
}
// A broad live oak hung with moss, `size` about 1 for a 13 m crown.
function liveOak(model, [x, z], size, seed) {
  const { body } = model, r = i => randomAt(seed * 71 + i, 5231), greens = ['#546849', '#60754f', '#4d6044', '#697952'].map(hex);
  const bark = y => hex('#3d332b').lerp(hex('#6a5b4d'), smoothstep(0, 5, y));
  body.lathe([[-.3, size, x, z], [.6, .72 * size, x, z], [2.4, .6 * size, x, z], [3.4 * size, .52 * size, x, z]], 8, bark, (a, y) => 1 + .16 * (1 - smoothstep(0, 1, y)) * Math.cos(a * 4 + seed));
  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * TAU + r(i) * .9, reach = (4.2 + r(10 + i) * 2.6) * size, rise = (2.2 + r(20 + i) * 2.2) * size, from = [x, 3.1 * size, z];
    const elbow = [x + Math.cos(angle) * reach * .55, from[1] + rise * .4, z + Math.sin(angle) * reach * .55], tip = [x + Math.cos(angle) * reach, from[1] + rise, z + Math.sin(angle) * reach];
    body.limb(from, elbow, .42 * size, .3 * size, bark(3), 6); body.limb(elbow, tip, .3 * size, .12 * size, bark(5), 5);
  }
  // A broad dome of clumps, wider than it is tall, fringed with moss.
  for (let i = 0; i < 13; i++) {
    const angle = i * 2.399963 + seed, t = Math.sqrt((i + .5) / 13), d = t * 6.2 * size, y = (7.6 - t * 2.4 + (r(40 + i) - .5) * .8) * size, s = (2.2 + r(50 + i)) * size;
    const center = [x + Math.cos(angle) * d, y, z + Math.sin(angle) * d];
    body.lobe(center, [s, s * .66, s], seed * 19 + i, greens[i % 4], 1);
    if (t > .5) for (let k = 0; k < 2; k++) {
      const a = angle + (r(60 + i * 2 + k) - .5) * 1.4;
      body.moss([center[0] + Math.cos(a) * s * .7, y - s * .35, center[2] + Math.sin(a) * s * .7], (1.2 + r(70 + i * 2 + k) * 2) * size, .12 * size, seed * 131 + i * 2 + k, MOSS[(i + k) % 3]);
    }
  }
}

function roadsideChapel() {
  const model = new Model(), { body } = model, r = i => randomAt(i, 5202);
  // The tower front stands 3 m behind the lot, the floor raised on its plinth.
  const scale = 1.15, floor = .8;
  model.frame([3 + 8.2 * scale, floor, 0], [0, -Math.PI / 2, 0], () => chapelBuilding(model, -floor / scale), scale);

  // The lot: two rows of stalls either side of an aisle, the drive crossing
  // the road-side row. y is a hair above the lawn.
  const [x0, x1, z0, z1] = [-16.4, -.2, -17.5, 17.5], y = .05, [d0, d1] = CHAPEL_DRIVE;
  const flat = (a, b, c, d, color, lift = 0) => body.quad([a[0], y + lift, a[1]], [b[0], y + lift, b[1]], [c[0], y + lift, c[1]], [d[0], y + lift, d[1]], color, [0, -5, 0]);
  flat([x0, z0], [x1, z0], [x1, z1], [x0, z1], ASPHALT);
  // The drive to the road is built per site (see chapelDrive), so it follows the bend.
  // Stall lines, wheel stops and the accessible stall by the walk.
  const line = (from, to, z, color = PAINT) => flat([from, z - .06], [to, z - .06], [to, z + .06], [from, z + .06], color, .012);
  const stop = (x, z) => body.box([x, y + .1, z], [.22, .16, 1.7], CONCRETE);
  const rowA = [], rowB = [];
  for (let k = 0; k <= 8; k++) rowA.push(-17.1 + k * 2.7);
  rowA.push(13.9, 16.6);
  for (let k = 0; k <= 5; k++) rowB.push(1.8 + k * 2.7, -(1.8 + k * 2.7));
  rowA.forEach(z => line(-16.1, -11, z));
  rowB.forEach(z => line(-5.6, -.5, z, z > 0 && z < 5 ? hex('#3f72c2') : PAINT));
  for (let k = 0; k < 8; k++) stop(-15.6, -15.75 + k * 2.7);
  stop(-15.6, 15.25);
  for (let k = 0; k < 5; k++) for (const side of [-1, 1]) stop(-.9, side * (3.15 + k * 2.7));
  flat([-5.2, 2.35], [-.7, 2.35], [-.7, 3.95], [-5.2, 3.95], hex('#3f72c2'), .008);
  body.limb([.25, 0, 3.15], [.25, 2.1, 3.15], .04, .04, hex('#8e9092'), 4); body.box([.25, 2.05, 3.15], [.04, .45, .38], hex('#2f64b8'));
  // Curbs round the lot, open to the drive and the walk.
  const curb = (a, b) => body.beam([a[0], y + .09, a[1]], [b[0], y + .09, b[1]], .24, .18, CONCRETE);
  curb([x0 - .12, z0 - .12], [x0 - .12, d0]); curb([x0 - .12, d1], [x0 - .12, z1 + .12]);
  curb([x1 + .12, z0 - .12], [x1 + .12, -1.4]); curb([x1 + .12, 1.4], [x1 + .12, z1 + .12]);
  curb([x0 - .12, z0 - .12], [x1 + .12, z0 - .12]); curb([x0 - .12, z1 + .12], [x1 + .12, z1 + .12]);
  flat([x1, -1.3], [3.2, -1.3], [3.2, 1.3], [x1, 1.3], hex('#bcb8ad'), .02);
  for (const [x, z] of [[-17.2, -12], [-17.2, 2.5]]) lampPost(model, x, z, 1.4);
  for (const [x, z] of [[.6, -10.5], [.6, 10.5]]) lampPost(model, x, z, -1.4);
  // Evening service: most of the chapel side is taken.
  parkedCar(model, [-2.95, y, 5.85], 0, '#3f5d78', 'sedan');
  parkedCar(model, [-2.95, y, 11.25], 0, '#8a2f2a', 'pickup');
  parkedCar(model, [-2.95, y, -3.15], 0, '#c9c1ab', 'wagon');
  parkedCar(model, [-2.95, y, -8.55], 0, '#2f4a3a', 'sedan');
  parkedCar(model, [-2.95, y, -13.95], .03, '#6d6f73', 'sedan');
  parkedCar(model, [-13.6, y, -7.65], Math.PI, '#e3e0d6', 'pickup');
  parkedCar(model, [-13.6, y, 15.25], Math.PI + .04, '#7a4d2f', 'sedan');

  // The sign at the entrance, facing the road, in a brick planter.
  model.frame([-20.4, 0, 16.4], [0, 0, 0], () => {
    body.box([0, .28, 0], [1, .56, 3.4], PLINTH);
    for (let i = 0; i < 12; i++) body.cone([(r(10 + i) - .5) * .6, .56, -1.5 + i * .27], .14, .22, 5, hex(['#d86c7c', '#f0d36a', '#ece7da', '#b0558f'][i % 4]), 5300 + i);
    for (const z of [-1.2, 1.2]) body.box([0, 1.45, z], [.16, 1.8, .16], TRIM);
    body.box([0, 1.85, 0], [.18, 1.15, 2.7], TRIM);
    body.box([0, 2.5, 0], [.36, .14, 3], hex('#3f5a47'));
    for (const side of [-1, 1]) [[2.12, 1.9], [1.86, 1.3], [1.6, 1.7]].forEach(([height, length]) => body.box([side * .1, height, 0], [.02, .12, length], hex('#2a2d33')));
    body.beam([0, 2.55, 0], [0, 3.25, 0], .1, .1, TRIM, [1, 0, 0]); body.beam([0, 3, -.24], [0, 3, .24], .08, .08, TRIM, [1, 0, 0]);
  });

  // The churchyard beside the nave, fenced, with its gate toward the lot.
  const WHITEWASH = hex('#e0dcd1'), STONE = hex('#b3b1a7');
  for (const [x, z, yaw, i] of [[12.2, 17.4, -Math.PI / 2 + .04, 0], [16.8, 12.6, -Math.PI / 2 - .03, 1], [21.4, 17.8, -Math.PI / 2 + .06, 2]]) {
    model.frame([x, 0, z], [0, yaw, 0], () => {
      body.box([0, .2, 0], [1.9, .4, 3], STONE.clone().multiplyScalar(.9));
      body.box([0, .9, 0], [1.4, 1, 2.55], WHITEWASH.clone().multiplyScalar(.95 + i * .02));
      body.box([0, 1.46, 0], [1.6, .12, 2.75], WHITEWASH);
      body.roof([0, 1.52, 0], 1.3, 2.5, .5, .08, WHITEWASH.clone().multiplyScalar(.92));
      body.box([0, 2.3, 1.05], [.12, .8, .12], WHITEWASH); body.box([0, 2.45, 1.05], [.5, .1, .1], WHITEWASH);
    });
  }
  const headstone = (x, z, yaw, i) => model.frame([x, 0, z], [(r(120 + i) - .5) * .08, yaw, (r(130 + i) - .5) * .1], () => {
    const color = STONE.clone().multiplyScalar(.88 + r(140 + i) * .18);
    body.box([0, .4, 0], [.74, .9, .16], color);
    const arch = Array.from({ length: 7 }, (_, k) => [Math.cos(k / 6 * Math.PI) * .37, .85 + Math.sin(k / 6 * Math.PI) * .3]);
    for (const d of [-.08, .08]) body.fan(arch.map(([ax, ay]) => [ax, ay, d]), color, [0, .85, -d * 10]);
    for (let k = 0; k < 6; k++) body.quad([arch[k][0], arch[k][1], -.08], [arch[k + 1][0], arch[k + 1][1], -.08], [arch[k + 1][0], arch[k + 1][1], .08], [arch[k][0], arch[k][1], .08], color, [0, .85, 0]);
  });
  [[10.2, 10.4], [13.8, 10.2], [20.2, 10.6], [23.6, 11], [10.4, 20.2], [15.6, 20.4], [18.8, 15.2], [23.8, 14.8]].forEach(([x, z], i) => headstone(x, z, Math.PI / 2 + (r(150 + i) - .5) * .2, i));
  for (const [x, z] of [[13.2, 14.2], [23.2, 20.4]]) model.frame([x, 0, z], [0, Math.PI / 2, 0], () => {
    body.box([0, .9, 0], [.18, 1.8, .18], STONE); body.box([0, 1.35, 0], [.9, .16, .16], STONE);
  });
  const fence = [[8, 16.2], [8, 21.8], [25.4, 21.8], [25.4, 8.2], [8, 8.2], [8, 13.2]];
  for (let leg = 0; leg < fence.length - 1; leg++) {
    const [ax, az] = fence[leg], [bx, bz] = fence[leg + 1], length = Math.hypot(bx - ax, bz - az), posts = Math.round(length / .55);
    model.frame([ax, 0, az], [0, Math.atan2(-(bz - az), bx - ax), 0], () => {
      for (let p = 0; p <= posts; p++) {
        const t = p / posts * length;
        body.box([t, .6, 0], [.08, 1.2, .08], IRON); body.cone([t, 1.2, 0], .07, .2, 4, IRON, 2000 + p);
      }
      body.box([length / 2, 1.05, 0], [length, .06, .06], IRON); body.box([length / 2, .25, 0], [length, .06, .06], IRON);
    });
  }
  for (const z of [13, 16.4]) { body.box([8, .8, z], [.5, 1.6, .5], PLINTH); body.box([8, 1.66, z], [.62, .12, .62], CONCRETE); }

  // Live oaks shade the lot and the lawn; shrubs soften the plinth.
  liveOak(model, [-12.5, -23.4], 1, 3); liveOak(model, [25.5, -12.5], 1.15, 4); liveOak(model, [3.6, 21.8], .85, 5);
  const shrub = hex('#4b6a3e');
  for (let i = 0; i < 12; i++) {
    const x = 7.4 + i * 1.2 + (r(200 + i) - .5) * .4, z = (i % 2 ? 1 : -1) * (4.9 + r(210 + i) * .4), size = .7 + r(220 + i) * .35;
    body.lobe([x, size * .45, z], [size, size * .75, size], 5400 + i, shrub.clone().multiplyScalar(.9 + r(230 + i) * .2));
  }
  for (const z of [-2.2, 2.2]) body.lobe([2.2, .5, z], [.8, .6, .8], 5420 + z, shrub);
  // No reflection: the chapel stands back from the water on its lawn.
  const { body: shell, glow } = model.build();
  return { body: shell, glow };
}

// ---------------------------------------------------------------------------
// Paddlewheel riverboat: a three-deck sternwheeler moored for the evening,
// every window lit and strings of lamps run from the jackstaff over the
// feathered stacks to the stern. Her wheel turns over slowly in the dark water.
function riverboat() {
  const model = new Model(), { body, glow } = model, r = i => randomAt(i, 5301);
  const WHITE = hex('#ebe7dc'), TRIM = hex('#a8372c'), DECK = hex('#80705e'), ROOF = hex('#a39c8e'), BLACK = hex('#222326'), GOLD = hex('#d6a849');
  const BOOT = hex('#3c2a25'), WOOD = hex('#5c4a3b'), GLASS = hex('#2f4150');
  const LAMP = ['#ffcf7a', '#ffc46a', '#ffd990'].map(hex), BULB = hex('#ffe6ae');
  // A row of windows on the wall at `x`, a few dark.
  const windows = (count, from, to, y, height, width, x, seed) => {
    for (let i = 0; i < count; i++) {
      const z = lerp(from, to, (i + .5) / count), lit = r(seed + i) > .14, face = x + Math.sign(x) * .03;
      (lit ? glow : body).box([face, y, z], [.05, height, width], lit ? LAMP[i % 3] : GLASS);
      body.box([x + Math.sign(x) * .05, y + height / 2 + .1, z], [.08, .12, width + .16], TRIM);
    }
  };
  // Hull: a raked bow and square stern, sheer rising forward.
  const stations = [-20.2, -19.7, -18.8, -17.5, -16, -14.2, -12, -6, 0, 6, 11, 14].map(z => {
    const t = Math.min(1, Math.max(0, (-12 - z) / 8.2));
    return { z, half: 4.6 * (1 - t ** 2.2) ** .55 + .04, deck: 1.05 + .55 * t ** 1.5 };
  });
  const profile = ({ half, deck }) => [[-half, deck, WHITE], [-half, .38, TRIM], [-half, .12, BOOT], [-half * .97, -.55, BOOT], [-half * .86, -1.1, BOOT],
    [half * .86, -1.1, BOOT], [half * .97, -.55, BOOT], [half, .12, TRIM], [half, .38, WHITE], [half, deck, WHITE]];
  for (let k = 0; k < stations.length - 1; k++) {
    const a = profile(stations[k]), b = profile(stations[k + 1]), middle = [0, 0, (stations[k].z + stations[k + 1].z) / 2];
    for (let i = 0; i < a.length - 1; i++) {
      body.quad([a[i][0], a[i][1], stations[k].z], [b[i][0], b[i][1], stations[k + 1].z], [b[i + 1][0], b[i + 1][1], stations[k + 1].z], [a[i + 1][0], a[i + 1][1], stations[k].z], a[i][2], middle);
    }
    const { z: z0, half: h0, deck: d0 } = stations[k], { z: z1, half: h1, deck: d1 } = stations[k + 1];
    if (z1 <= -12) body.quad([-h0, d0, z0], [h0, d0, z0], [h1, d1, z1], [-h1, d1, z1], DECK, [0, -3, (z0 + z1) / 2]);
  }
  body.fan(profile(stations.at(-1)).map(([x, y]) => [x, y, 14]), WHITE.clone().multiplyScalar(.9), [0, 0, 0]);
  body.beam([-4.7, 1.12, -12], [-4.7, 1.12, 14], .2, .18, WOOD); body.beam([4.7, 1.12, -12], [4.7, 1.12, 14], .2, .18, WOOD);

  // Main deck with guards, the saloon, and posts carrying the decks above.
  body.box([0, 1.15, 1], [11.2, .2, 26], DECK);
  for (const side of [-1, 1]) body.box([side * 5.55, 1, 1], [.12, .42, 26], WHITE);
  body.box([0, 2.45, .6], [8, 2.6, 21], WHITE);
  for (const side of [-1, 1]) windows(11, -9.5, 10.6, 2.6, 1.3, .9, side * 4, 20 + side * 20);
  glow.box([-.75, 2.25, -9.93], [1.1, 2, .05], LAMP[2]); glow.box([.75, 2.25, -9.93], [1.1, 2, .05], LAMP[0]);
  for (const x of [-3, 3]) glow.box([x, 2.6, -9.93], [.9, 1.2, .05], LAMP[1]);
  body.box([0, 3.45, -9.95], [3, .2, .1], TRIM);
  // Posts carrying the deck above, and a balustrade along the sides (and the
  // front, on the upper decks).
  const posts = (y0, y1, rail, front) => {
    for (let z = -12; z <= 14.01; z += 2.2) for (const side of [-1, 1]) body.box([side * 5.45, (y0 + y1) / 2, z], [.16, y1 - y0, .16], WHITE);
    for (const side of [-1, 1]) {
      body.box([side * 5.48, rail, 1], [.1, .1, 26.2], WHITE); body.box([side * 5.48, y0 + .12, 1], [.08, .08, 26.2], WHITE);
      for (let z = -11.8; z < 14; z += .44) body.box([side * 5.48, (y0 + rail) / 2 + .06, z], [.05, rail - y0 - .12, .05], WHITE);
    }
    if (!front) return;
    for (let x = -5.3; x <= 5.31; x += .44) body.box([x, (y0 + rail) / 2 + .06, -12.05], [.05, rail - y0 - .12, .05], WHITE);
    body.box([0, rail, -12.05], [10.9, .1, .1], WHITE);
  };
  // Gingerbread: a scalloped white valance under each deck edge.
  const valance = (y, z0, z1) => {
    for (const side of [-1, 1]) for (let z = z0; z < z1 - .1; z += .55) {
      const x = side * 5.62;
      body.sheet([[x, y, z], [x, y, z + .55], [x, y - .22, z + .4], [x, y - .3, z + .275], [x, y - .22, z + .15]], WHITE);
    }
  };
  posts(1.25, 3.8, 2.1, false);
  // Boiler deck, its cabin and promenade.
  const slab = (y, from, to, width, top) => {
    body.box([0, y, (from + to) / 2], [width, .22, to - from], top);
    for (const side of [-1, 1]) {
      body.box([side * (width / 2 + .02), y - .02, (from + to) / 2], [.06, .3, to - from], WHITE);
      body.box([side * (width / 2 + .05), y - .08, (from + to) / 2], [.03, .07, to - from - .2], TRIM);
    }
    body.box([0, y - .02, from - .02], [width, .3, .06], WHITE); body.box([0, y - .02, to + .02], [width, .3, .06], WHITE);
  };
  slab(3.92, -12.6, 14.2, 11.3, DECK.clone().multiplyScalar(1.08)); valance(3.78, -12, 14);
  body.box([0, 5.1, 1], [7.6, 2.2, 17], WHITE);
  for (const side of [-1, 1]) windows(9, -7, 9, 5.15, .95, .78, side * 3.8, 60 + side * 20);
  for (const x of [-2.2, -.7, .7, 2.2]) glow.box([x, 5.15, -7.53], [.75, .95, .05], LAMP[(x > 0) + 1]);
  posts(4.03, 6.3, 4.95, true);
  // Hurricane roof, the texas cabin and the pilot house.
  slab(6.4, -12.3, 13.9, 11.2, ROOF); valance(6.26, -12, 13.8);
  for (const side of [-1, 1]) {
    body.box([side * 5.5, 7, 1], [.08, .08, 25.8], WHITE);
    for (let z = -12; z <= 13.9; z += 1.1) body.box([side * 5.5, 6.78, z], [.07, .5, .07], WHITE);
  }
  // Planked roof deck, clerestories lighting the saloon below, cowl vents and benches.
  for (let x = -5.2, i = 0; x < 5.2; x += .8, i++) body.quad([x, 6.515, -12.2], [x + .8, 6.515, -12.2], [x + .8, 6.515, 13.8], [x, 6.515, 13.8], ROOF.clone().multiplyScalar(i % 2 ? .94 : 1.02), [0, 0, 0]);
  for (const [from, to] of [[-9.4, -1.6], [6.6, 12.6]]) {
    body.box([0, 6.83, (from + to) / 2], [3, .64, to - from], WHITE);
    body.box([0, 7.2, (from + to) / 2], [3.5, .1, to - from + .3], TRIM);
    for (let z = from + .5; z < to - .2; z += .95) for (const side of [-1, 1]) glow.box([side * 1.52, 6.85, z], [.04, .3, .55], LAMP[Math.abs(Math.round(z * 3)) % 3]);
  }
  for (const [x, z] of [[-1.3, -8.6], [1.3, -8.6], [-3.6, 4], [3.6, 4]]) {
    body.limb([x, 6.5, z], [x, 7.35, z], .17, .17, WHITE, 6);
    body.limb([x, 7.35, z], [x, 7.7, z - .28], .22, .34, TRIM, 8);
  }
  for (const side of [-1, 1]) for (const z of [7.2, 10.2]) {
    body.box([side * 4.6, 6.8, z], [.5, .08, 1.9], WOOD); body.box([side * 4.85, 7.05, z], [.08, .45, 1.9], WOOD);
  }
  body.box([0, 7.4, 2.4], [4.8, 1.8, 7.2], WHITE);
  for (const side of [-1, 1]) windows(4, -1, 5.8, 7.45, .8, .8, side * 2.4, 100 + side * 10);
  body.box([0, 8.35, 2.4], [5.2, .12, 7.6], ROOF);
  body.box([0, 7.4, -1.25], [3.2, .55, .06], WHITE.clone().multiplyScalar(1.02)); body.box([0, 7.4, -1.28], [2.9, .32, .04], TRIM);
  body.box([0, 9.4, .2], [3.2, 2, 2.9], WHITE);
  for (const [x, z, w, d] of [[0, -1.28, 2.6, .05], [0, 1.68, 2.6, .05], [-1.62, .2, .05, 2.3], [1.62, .2, .05, 2.3]]) body.box([x, 9.65, z], [w, .95, d], GLASS);
  for (const x of [-.65, .65]) body.box([x, 9.65, -1.31], [.08, .95, .05], WHITE);
  const hip = [[-2, 10.45, -1.8], [2, 10.45, -1.8], [2, 10.45, 2.2], [-2, 10.45, 2.2]];
  hip.forEach((p, i) => body.face(p, hip[(i + 1) % 4], [0, 11.25, .2], TRIM.clone().multiplyScalar(i % 2 ? .9 : 1.05), [0, 9, .2]));
  body.fan(hip, WHITE.clone().multiplyScalar(.7), [0, 12, .2]);
  body.limb([0, 11.2, .2], [0, 11.8, .2], .05, .02, GOLD, 4); body.bulb([0, 11.62, .2], .16, GOLD);
  body.limb([.8, 10.45, -1.2], [.8, 11, -1.2], .09, .1, GOLD, 6);

  // Twin stacks with feathered crowns and a gilded star slung between.
  for (const side of [-1, 1]) {
    const x = side * 2.4, z = -11.2;
    body.limb([x, 3.9, z], [x, 17.2, z], .56, .52, BLACK, 10);
    body.lathe([[17.1, .52, x, z], [17.35, .6, x, z], [17.9, .96, x, z]], 10, y => GOLD.clone().multiplyScalar(.85 + (y - 17) * .2));
    body.sheet(Array.from({ length: 10 }, (_, i) => [x + Math.cos(i / 10 * TAU) * .9, 17.8, z + Math.sin(i / 10 * TAU) * .9]), hex('#141414'), GOLD);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU;
      body.cone([x + Math.cos(a) * .9, 17.85, z + Math.sin(a) * .9], .1, .55, 4, GOLD, 3000 + i + side * 20, [Math.cos(a) * .12, Math.sin(a) * .12]);
    }
    body.box([x, 15.7, z], [1.15, .18, 1.15], TRIM);
  }
  body.beam([-2.4, 14.8, -11.2], [2.4, 14.8, -11.2], .14, .14, BLACK); body.beam([-2.4, 10.8, -11.2], [2.4, 10.8, -11.2], .1, .1, BLACK);
  const star = Array.from({ length: 10 }, (_, i) => { const a = Math.PI / 2 + i / 10 * TAU, d = i % 2 ? .34 : .82; return [Math.cos(a) * d, 13.5 + Math.sin(a) * d, -11.2]; });
  for (let i = 0; i < 10; i++) body.sheet([[0, 13.5, -11.2], star[i], star[(i + 1) % 10]], GOLD, GOLD.clone().multiplyScalar(.8));
  body.limb([0, 14.3, -11.2], [0, 14.75, -11.2], .03, .03, BLACK, 3);

  // Bow: capstans, a jackstaff and the landing stage slung from its mast.
  for (const x of [-1.3, 1.3]) body.limb([x, 1.3, -16.6], [x, 1.95, -16.6], .3, .26, BLACK, 8);
  body.limb([0, 1.5, -19.8], [0, 6.8, -19.8], .07, .05, WHITE, 5);
  body.sheet([[0, 6.75, -19.8], [0, 6.2, -19.8], [0, 6.5, -21.1]], TRIM);
  body.limb([0, 1.3, -15.2], [0, 9.8, -15.2], .17, .12, WHITE, 6); body.bulb([0, 9.85, -15.2], .2, GOLD);
  const lift = .42, stageEnd = [0, 2.3 + 8.4 * Math.sin(lift), -15.8 - 8.4 * Math.cos(lift)];
  model.frame([0, 2.3, -15.8], [lift, 0, 0], () => {
    body.box([0, 0, -4.2], [1.6, .14, 8.4], DECK);
    for (const x of [-.8, .8]) {
      body.box([x, .75, -4.2], [.08, .08, 8.4], WHITE);
      for (let z = -.3; z > -8.4; z -= 1.05) body.box([x, .38, z], [.07, .75, .07], WHITE);
    }
  });
  for (const x of [-.75, .75]) body.limb([0, 9.6, -15.2], [x, stageEnd[1] + .8, stageEnd[2] + .3], .025, .025, hex('#3b3631'), 3);
  const bowRail = stations.filter(s => s.z <= -12);
  for (const side of [-1, 1]) for (let k = 0; k < bowRail.length - 1; k++) {
    const a = bowRail[k], b = bowRail[k + 1];
    body.beam([side * a.half * .96, a.deck + .72, a.z], [side * b.half * .96, b.deck + .72, b.z], .08, .08, WHITE);
    body.box([side * a.half * .96, a.deck + .36, a.z], [.08, .72, .08], WHITE);
  }
  // Life rings on the boiler deck rail.
  for (const [z, side] of [[-6, -1], [5, -1], [-2, 1], [9, 1]]) {
    const x = side * 5.56, center = [x, 4.95, z];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU, b = (i + 1) / 8 * TAU;
      body.limb([x, center[1] + Math.sin(a) * .36, z + Math.cos(a) * .36], [x, center[1] + Math.sin(b) * .36, z + Math.cos(b) * .36], .08, .08, i % 2 ? WHITE : TRIM, 4);
    }
  }

  // Stern: wheel beams, pitmans, the flagstaff and the wash where the wheel churns.
  for (const side of [-1, 1]) {
    const x = side * 3.75;
    body.beam([x, 1.25, 11.5], [x, 1.25, 22.5], .3, .34, WOOD);
    body.beam([side * 4.15, 2.3, 10.6], [side * 4.15, 2.9, 18.2], .2, .2, TRIM);
    body.box([x, 2.9, 18.2], [.5, .5, .6], BLACK);
    body.beam([x, 1.3, 20.2], [x, 2.7, 18.4], .24, .24, WOOD);
    body.box([x, 3.9, 13.4], [.3, 5.2, .3], WHITE);
  }
  body.beam([-3.75, 1.25, 22.5], [3.75, 1.25, 22.5], .3, .3, WOOD, [0, 1, 0]);
  body.limb([0, 6.5, 13.6], [0, 10, 13.6], .06, .04, WHITE, 5);
  body.sheet([[0, 9.95, 13.6], [0, 9.2, 13.6], [0, 9.45, 15.4]], TRIM, WHITE);
  // Churned water: pale streaks under the wheel, trailing astern.
  const wash = hex('#7d949b');
  for (let i = 0; i < 11; i++) {
    const cx = (r(400 + i) - .5) * 6, cz = 16 + r(410 + i) * 9, width = .35 + r(420 + i) * .45, length = 1.2 + r(430 + i) * 1.8;
    body.fan(Array.from({ length: 6 }, (_, k) => [cx + Math.cos(k / 6 * TAU) * width, .03, cz + Math.sin(k / 6 * TAU) * length]), wash.clone().multiplyScalar(.9 + r(440 + i) * .35 - (cz - 16) * .02), [cx, -1, cz]);
  }
  // Moored to a pair of dolphins on the road side.
  for (const [dz, cleat] of [[-13, -11.5], [9.5, 12]]) {
    for (const [ox, oz] of [[0, 0], [.42, .25], [.1, -.44]]) {
      const x = -8 + ox, z = dz + oz;
      body.limb([x, -1.6, z], [x, 2.6 + ox, z], .22, .2, WOOD, 6);
      body.limb([x, 2.6 + ox, z], [x, 2.75 + ox, z], .2, .12, hex('#8a7862'), 6);
    }
    body.limb([-7.8, 1.7, dz], [-7.8, 2, dz], .6, .6, hex('#b8a785'), 7);
    body.limb([-7.8, 2, dz], [-6.6, 1.35, lerp(dz, cleat, .4)], .035, .035, hex('#b8a785'), 3);
    body.limb([-6.6, 1.35, lerp(dz, cleat, .4)], [-5.5, 1.5, cleat], .035, .035, hex('#b8a785'), 3);
  }

  // Lamps: festoons from jackstaff to stern, and a row along each deck edge.
  const festoon = [[0, 6.85, -19.8], [0, 9.95, -15.2], [0, 14.9, -11.2], [0, 11.8, .2], [0, 10.1, 13.6]];
  const colors = ['#ffe6ae', '#ffb35c', '#ffe6ae', '#ff8a6b', '#ffe6ae', '#9fd4ff'].map(hex);
  let n = 0;
  for (let k = 0; k < festoon.length - 1; k++) {
    const a = festoon[k], b = festoon[k + 1], length = Math.hypot(b[1] - a[1], b[2] - a[2]), count = Math.round(length / 1.05);
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      glow.bulb([0, lerp(a[1], b[1], t) - Math.sin(t * Math.PI) * .07 * length, lerp(a[2], b[2], t)], .17, colors[n++ % colors.length]);
    }
  }
  for (const [y, width] of [[3.62, 11.3], [6.12, 11.2]]) {
    for (let z = -12; z <= 13.8; z += 1.2) for (const side of [-1, 1]) glow.bulb([side * (width / 2 + .1), y, z], .13, BULB);
    for (let x = -5; x <= 5.01; x += 1.25) glow.bulb([x, y, -12.7], .13, BULB);
  }
  model.silhouette.box([0, 2.4, 1], [11, 3.6, 28], WHITE);
  model.silhouette.box([0, 5.2, 1], [10.6, 2.4, 26], WHITE);
  model.silhouette.box([0, 8.4, 1.5], [4.8, 4, 7], WHITE);
  for (const x of [-2.4, 2.4]) model.silhouette.limb([x, 4, -11.2], [x, 17.5, -11.2], .6, .6, BLACK, 4);
  return model.build();
}

// Wheel spun in its own vertex shader, centred on the origin, axle along x.
function paddlewheel() {
  const wheel = new Layer([new THREE.Matrix4()]), red = hex('#b23a2c'), bucket = hex('#7c2a22'), radius = 3.5;
  for (const x of [-2.95, 0, 2.95]) for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU, b = (i + 1) / 12 * TAU, at = (angle, d) => [x, Math.sin(angle) * d, Math.cos(angle) * d];
    wheel.beam([x, 0, 0], at(a, radius), .14, .14, red, [1, 0, 0]);
    wheel.beam(at(a, radius * .96), at(b, radius * .96), .16, .16, red, [1, 0, 0]);
    if (x === 0) wheel.beam(at(a, radius * .55), at(b, radius * .55), .1, .1, red, [1, 0, 0]);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i + .5) / 12 * TAU, d = radius * .9;
    wheel.beam([-3.2, Math.sin(a) * d, Math.cos(a) * d], [3.2, Math.sin(a) * d, Math.cos(a) * d], .12, .95, bucket.clone().multiplyScalar(.9 + (i % 2) * .15), [0, Math.sin(a), Math.cos(a)]);
  }
  wheel.limb([-3.55, 0, 0], [3.55, 0, 0], .34, .34, hex('#2a2623'), 8);
  return wheel.build();
}

// Wheels turn together off the shared water clock, top toward the bow.
export const wheelMaterial = material('#ffffff', { vertexColors: true, roughness: .8 });
wheelMaterial.onBeforeCompile = shader => {
  shader.uniforms.swampTime = waterClock.time;
  shader.vertexShader = 'uniform float swampTime;\n' + shader.vertexShader;
  const spin = 'float wheelAngle = -swampTime * 0.55; mat2 wheelSpin = mat2(cos(wheelAngle), sin(wheelAngle), -sin(wheelAngle), cos(wheelAngle));';
  shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${spin}\nobjectNormal.yz = wheelSpin * objectNormal.yz;`);
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.yz = wheelSpin * transformed.yz;');
};
wheelMaterial.customProgramCacheKey = () => 'swamp-paddlewheel-v1';

const cypress = hollowCypress(), chapel = roadsideChapel(), boat = riverboat();
export const swampLandmarkGeometry = {
  'hollow-cypress': cypress, chapel, riverboat: { ...boat, wheel: paddlewheel() },
};
// Model scale, the wheel's hub, and the light each lends the scene. Light
// positions are in model space, `halo` is the strength of its glow sprite.
// The chapel keeps scale 1 so its lot and drive line up with the road.
export const SWAMP_LANDMARKS = {
  'hollow-cypress': { scale: 1.3, light: { position: [0, 1.5, .8], color: '#5fe3b6', intensity: 80, distance: 26, halo: .55 } },
  chapel: { scale: 1, light: { position: [-8, 7.5, 0], color: '#ffd08a', intensity: 130, distance: 34, halo: 0 } },
  riverboat: { scale: 1.12, wheel: [0, 2.9, 18.2], light: { position: [0, 2.6, -13.4], color: '#ffc47a', intensity: 120, distance: 34, halo: .7 } },
};
