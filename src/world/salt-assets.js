import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { randomAt, smoothstep } from './route.js';
import { waterClock } from './water.js';
import { birdFlightGLSL } from './bird-flight.js';
import { SALT_HILLS } from './salt-route.js';

const up = new THREE.Vector3(0, 1, 0);

// Non-indexed with one flat colour, ready to merge with other parts.
function tinted(geometry, color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const tint = new THREE.Color(color), colors = [];
  for (let i = 0; i < g.attributes.position.count; i++) colors.push(tint.r, tint.g, tint.b);
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}
// A square rod from a to b.
function strut(a, b, width, color) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
  const g = new THREE.BoxGeometry(width, direction.length(), width);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
  g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  return tinted(g, color);
}
function blob(radius, scale, at, color, turn = 0) {
  const g = new THREE.IcosahedronGeometry(radius, 0);
  g.scale(...scale); g.rotateX(turn); g.translate(...at);
  return tinted(g, color);
}
function finish(parts) {
  const g = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  g.computeBoundingSphere();
  return g;
}

// Uneven shoulders and an offset crown give each outcrop a few broad fracture
// planes. A convex hull keeps those planes closed, including the buried base.
function boulder(seed) {
  const points = [], lean = (randomAt(seed, 4) - .5) * .48;
  for (const [ring, count, radius, height] of [[0, 7, .86, -.46], [1, 7, 1, .12], [2, 4, .55, .79]]) {
    for (let j = 0; j < count; j++) {
      const angle = (j / count + ring * .065 + (randomAt(j, seed + ring * 13) - .5) * .055) * Math.PI * 2;
      const r = radius * (.8 + randomAt(j, seed + ring * 17 + 1) * .32);
      const y = height + (ring ? (randomAt(j, seed + ring * 19 + 2) - .5) * .36 : 0);
      points.push(new THREE.Vector3(Math.cos(angle) * r + lean * (y + .46), y, Math.sin(angle) * r));
    }
  }
  const g = new ConvexGeometry(points), p = g.attributes.position;
  const colors = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    normal.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    const low = (a.y + b.y + c.y) / 3, facet = randomAt(i, seed + 7);
    // Lighter tops, darker undersides, per-face mottling.
    const shade = .91 + normal.y * .07 + (facet - .5) * .045;
    const crust = 1 - smoothstep(-.4, -.24, low);
    const r = shade + crust * .2, gr = shade + crust * .22, bl = shade * .98 + crust * .28;
    for (let k = 0; k < 3; k++) colors.push(r, gr, bl);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return g;
}
export const saltBoulders = [boulder(11), boulder(23), boulder(37)];

function pebble() {
  const g = new THREE.IcosahedronGeometry(1, 0), p = g.attributes.position, offsets = new Map(), colors = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 1e3)},${Math.round(p.getY(i) * 1e3)},${Math.round(p.getZ(i) * 1e3)}`;
    if (!offsets.has(key)) offsets.set(key, .82 + randomAt(offsets.size, 8905) * .36);
    const wear = offsets.get(key);
    p.setXYZ(i, p.getX(i) * wear, Math.max(-.45, p.getY(i) * wear * .7), p.getZ(i) * wear);
  }
  g.computeVertexNormals();
  for (let i = 0; i < p.count; i += 3) { const shade = .88 + randomAt(i, 8906) * .14; for (let k = 0; k < 3; k++) colors.push(shade, shade, shade); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return g;
}
export const saltPebble = pebble();

// Crust heaped up around a boulder's base: a low faceted mound, open at the top
// where the rock sits.
function apron() {
  const positions = [], colors = [], sides = 11;
  const ring = (radius, y, salt) => Array.from({ length: sides }, (_, i) => {
    const angle = i / sides * Math.PI * 2, r = radius * (.84 + randomAt(i, salt) * .32);
    return [Math.cos(angle) * r, y, Math.sin(angle) * r];
  });
  const outer = ring(1, 0, 8911), middle = ring(.78, .07, 8912), inner = ring(.58, .12, 8913);
  const face = (a, b, c, shade) => {
    // Upward winding.
    if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) { positions.push(...p); colors.push(shade, shade, shade * 1.01); }
  };
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides, shade = 1.02 + randomAt(i, 8914) * .04;
    face(outer[i], outer[j], middle[i], shade); face(outer[j], middle[j], middle[i], shade);
    face(middle[i], middle[j], inner[i], shade + .02); face(middle[j], inner[j], inner[i], shade + .02);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
export const saltApron = apron();

// Tola: a spiky dome of dry blades, dark at the root and bleached at the tips.
function tola() {
  const positions = [], colors = [];
  for (let i = 0; i < 38; i++) {
    const angle = i * 2.399963, tilt = .2 + randomAt(i, 8921) * 1.05, length = .38 + randomAt(i, 8922) * .5;
    const x = Math.cos(angle), z = Math.sin(angle), base = .07;
    const tip = [x * Math.sin(tilt) * length, Math.cos(tilt) * length + .02, z * Math.sin(tilt) * length];
    const width = .045 + randomAt(i, 8923) * .02;
    const left = [x * base - z * width, 0, z * base + x * width], right = [x * base + z * width, 0, z * base - x * width];
    const light = .92 + randomAt(i, 8924) * .16;
    for (const [p, shade] of [[left, .52], [right, .52], [tip, light], [right, .52], [left, .52], [tip, light]]) {
      positions.push(...p); colors.push(shade, shade * .97, shade * .9);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  // Blades are drawn from both sides, so light them all from above.
  const normals = g.attributes.normal;
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
  g.computeBoundingSphere();
  return g;
}
export const saltTola = tola();

// Hills out on the flat, at unit radius with the foot buried below the crust.
// Rings of [outline share, height share] climb from a low drift of crust at the
// foot to an apex, a flat cap or a crater. Faces are coloured by height and
// slope: scree on gentle slopes, bare rock or bedded strata on steep ones.
const HILLS = {
  knoll: { sides: 13, rings: [[1.16, -.03], [1, .04], [.82, .3], [.58, .62], [.32, .88]], top: 'apex',
    rock: ['#a77665', '#9c6c5c'], scree: ['#c29c7e', '#ba9476'] },
  ridge: { sides: 16, rings: [[1.14, -.03], [1, .04], [.8, .32], [.56, .66], [.3, .9], [.12, 1]], top: 'apex',
    rock: ['#8c6e69', '#806560'], scree: ['#b09280', '#a88a79'] },
  cone: { sides: 14, rings: [[1.16, -.03], [1, .04], [.78, .3], [.56, .62], [.38, .9], [.31, 1], [.17, .84]], top: 'floor', floor: .78,
    rock: ['#6f504a', '#775349'], scree: ['#8d6a5d', '#86655a'], rim: ['#a65f47', '#ad6449'] },
  // Cliff rings from `cliff` up share one outline, so the walls stay sheer.
  mesa: { sides: 12, rings: [[1.18, -.03], [1, .04], [.9, .15], [.8, .28], [.78, .52], [.76, .78], [.74, 1]], top: 'cap', cliff: 3,
    strata: ['#c99a72', '#b5805f', '#d2a67e', '#bd8967'], scree: ['#c9a27e', '#c29a77'], cap: ['#b98b67', '#c09270'] },
};
function hillShape(kind, height, seed) {
  const spec = HILLS[kind], { sides, rings } = spec, rand = (a, b) => randomAt(a, seed + b);
  const phase = [0, 1, 2].map(k => rand(k, 1) * Math.PI * 2);
  const wobble = angle => 1 + .1 * Math.sin(2 * angle + phase[0]) + .06 * Math.sin(3 * angle + phase[1]) + .035 * Math.sin(5 * angle + phase[2]);
  // An off-centre summit makes one flank steeper. Ridges stretch along x.
  const summit = [(rand(0, 2) - .5) * .3, (rand(1, 2) - .5) * .3];
  const stretch = kind === 'ridge' ? [1.8, .74] : [1, 1];
  // Each column keeps one bearing and spread all the way up, so no face can overhang.
  const columns = Array.from({ length: sides }, (_, i) => ({ angle: (i + (rand(i, 10) - .5) * .4) / sides * Math.PI * 2, spread: 1 + (rand(i, 11) - .5) * .1 }));
  const cliff = j => spec.cliff !== undefined && j >= spec.cliff;
  const grid = rings.map(([t, y], j) => columns.map(({ angle, spread }, i) => {
    const r = wobble(angle) * t * (j ? spread : 1) * (j < 2 || cliff(j) ? 1 : 1 + (rand(i, 20 + j) - .5) * .08), lean = Math.max(0, 1 - t);
    // Ridges get a serrated crest, slopes a little roughness.
    const rough = j < 2 || cliff(j) ? 0 : (rand(i, 30 + j) - .5) * .1 + (kind === 'ridge' ? Math.sin(angle * 3 + phase[2]) * .08 * y : 0);
    return [(Math.sin(angle) * r + summit[0] * lean) * stretch[0], Math.min(1, y + rough) * height, (Math.cos(angle) * r + summit[1] * lean) * stretch[1]];
  }));
  // Scale the plan so the base meets the crust inside the unit outline that
  // SALT_HILLS parts cover. Only the low drift of crust reaches past it.
  const base = Math.max(...grid[1].map(([x, , z]) => Math.hypot(x / stretch[0], z / stretch[1])));
  for (const ring of grid) for (const p of ring) { p[0] /= base; p[2] /= base; }
  const centre = [summit[0] * stretch[0] / base, (spec.top === 'floor' ? spec.floor : 1) * height, summit[1] * stretch[1] / base];
  const triangles = [];
  for (let j = 0; j < grid.length; j++) for (let i = 0; i < sides; i++) {
    const a = grid[j][i], b = grid[j][(i + 1) % sides];
    if (j === grid.length - 1) { triangles.push([a, b, centre, j]); continue; }
    const c = grid[j + 1][i], d = grid[j + 1][(i + 1) % sides];
    triangles.push(...((i + j) % 2 ? [[a, b, c, j], [b, d, c, j]] : [[a, b, d, j], [a, d, c, j]]));
  }
  const positions = [], colors = [], foot = [], normal = new THREE.Vector3(), edge = new THREE.Vector3(), tint = new THREE.Color();
  const offset = Math.floor(rand(3, 4) * 4);
  triangles.forEach(([a, b, c, ring], n) => {
    // Upward winding: every face of a height field points up.
    if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) < 0) [b, c] = [c, b];
    normal.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(edge.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])).normalize();
    const steep = normal.y < .86, pick = list => list[Math.floor(rand(n, 40) * list.length) % list.length];
    let hex;
    if (ring === 0) hex = '#ffffff';
    else if (kind === 'mesa') hex = ring >= rings.length - 1 ? pick(spec.cap) : ring < spec.cliff ? pick(spec.scree) : spec.strata[(ring + offset) % spec.strata.length];
    else if (kind === 'cone' && ring >= rings.length - 3) hex = pick(spec.rim);
    else hex = steep ? pick(spec.rock) : pick(spec.scree);
    tint.set(hex).multiplyScalar(.9 + normal.y * .08 + (rand(n, 41) - .5) * .025);
    for (const p of [a, b, c]) { positions.push(...p); colors.push(tint.r, tint.g, tint.b); foot.push(ring === 0 ? 1 : 0); }
  });
  // The foot takes the crust colour where the hill is placed. Talus blocks take the hill's rock colour.
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), foot: new Uint8Array(foot),
    rock: (spec.rock ?? spec.strata).map(hex => new THREE.Color(hex)) };
}
export const saltHillShapes = SALT_HILLS.map(({ kind, height }, n) => [0, 1].map(k => hillShape(kind, height, 9301 + n * 31 + k * 7)));

// Hand-raked salt cone: bright top, greyer where it stands in the brine.
function saltCone() {
  const g = new THREE.CylinderGeometry(.07, 1, 1, 8, 2, true).toNonIndexed(), p = g.attributes.position, offsets = new Map(), colors = [];
  g.deleteAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 1e3)},${Math.round(p.getY(i) * 1e3)},${Math.round(p.getZ(i) * 1e3)}`;
    if (!offsets.has(key)) offsets.set(key, [(randomAt(offsets.size, 8931) - .5) * .16, (randomAt(offsets.size, 8932) - .5) * .12]);
    const [spread, lift] = offsets.get(key), y = p.getY(i);
    p.setXYZ(i, p.getX(i) * (1 + spread), y + .5 + (y > -.4 && y < .4 ? lift : 0), p.getZ(i) * (1 + spread));
  }
  g.computeVertexNormals();
  for (let i = 0; i < p.count; i += 3) {
    const low = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, shade = .9 + .12 * smoothstep(0, .6, low) + randomAt(i, 8933) * .03;
    for (let k = 0; k < 3; k++) colors.push(shade, shade, shade * 1.01);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return g;
}
export const saltPile = saltCone();

// Wading flamingos, about 1.6 m tall. One stands on a single leg, the other feeds
// with its head in the water.
const pink = '#ec7a8e', paler = '#f191a0', deepPink = '#d9486a', leg = '#d65a74', black = '#241f21', beak = '#f1d6d4';
function flamingo(feeding) {
  const parts = [
    strut([-.05, 0, .02], [-.05, .43, .05], .026, leg), strut([-.05, .43, .05], [-.04, .84, .02], .03, leg),
    blob(1, [.2, .17, .37], [0, .93, .02], pink, -.14),
    blob(1, [.15, .09, .24], [0, 1.0, .12], deepPink, -.2),
    blob(1, [.1, .06, .14], [0, .99, .36], black, -.35),
  ];
  // A folded leg tucked under the body, or both legs down while feeding.
  if (feeding) parts.push(strut([.05, 0, -.02], [.05, .43, .02], .026, leg), strut([.05, .43, .02], [.04, .84, .02], .03, leg));
  else parts.push(strut([.05, .84, .02], [.07, .62, .14], .03, leg), strut([.07, .62, .14], [.06, .7, -.06], .026, leg));
  const neck = feeding
    ? [[0, .98, -.28], [0, 1.12, -.46], [0, 1.05, -.62], [0, .78, -.7], [0, .44, -.66], [0, .18, -.6]]
    : [[0, .98, -.28], [0, 1.17, -.38], [0, 1.33, -.31], [0, 1.46, -.2], [0, 1.57, -.24], [0, 1.61, -.33]];
  for (let i = 0; i < neck.length - 1; i++) parts.push(strut(neck[i], neck[i + 1], .05 - i * .003, i < 2 ? pink : paler));
  const head = neck.at(-1);
  parts.push(blob(1, [.05, .05, .065], head, paler));
  const tip = feeding ? [[head[0], head[1] - .06, head[2] - .02], [head[0], head[1] - .13, head[2] + .02]]
    : [[head[0], head[1] - .03, head[2] - .08], [head[0], head[1] - .09, head[2] - .1]];
  parts.push(strut(head, tip[0], .028, beak), strut(tip[0], tip[1], .024, black));
  return finish(parts);
}
export const flamingoStanding = flamingo(false);
export const flamingoFeeding = flamingo(true);

// In flight: neck stretched ahead, legs trailing, black-edged wings. Faces -Z.
function flyingFlamingo() {
  const parts = [
    blob(1, [.16, .14, .42], [0, 0, 0], pink),
    strut([0, .02, -.3], [0, .06, -.95], .045, paler), blob(1, [.05, .05, .07], [0, .06, -.98], paler),
    strut([0, .05, -1.02], [0, .01, -1.12], .026, black),
    strut([-.04, -.03, .3], [-.03, -.05, 1.15], .022, leg), strut([.04, -.03, .3], [.03, -.05, 1.15], .022, leg),
  ];
  const wing = side => {
    const positions = [], colors = [];
    const root = [[side * .12, .02, -.16], [side * .12, .02, .2]], elbow = [[side * .62, .05, -.08], [side * .6, .05, .22]], tip = [side * 1.2, .06, .12];
    // Both windings, so the underside shows during the downstroke.
    const face = (a, b, c, color) => {
      const tint = new THREE.Color(color);
      for (const p of [a, b, c, a, c, b]) { positions.push(...p); colors.push(tint.r, tint.g, tint.b); }
    };
    face(root[0], root[1], elbow[0], pink); face(root[1], elbow[1], elbow[0], deepPink);
    face(elbow[0], elbow[1], tip, black);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  };
  return finish([...parts, wing(-1), wing(1)]);
}
export const flamingoFlying = flyingFlamingo();

// A skein circles over the lagoon in the vertex shader: no CPU work per frame,
// and it pauses with the scene. Each bird trails the one ahead on the loop.
export const flightMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
flightMaterial.onBeforeCompile = shader => {
  shader.uniforms.flightTime = waterClock.time;
  shader.vertexShader = 'uniform float flightTime;\n' + birdFlightGLSL + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
    #include <begin_vertex>
    float flock = dot(floor(instanceMatrix[3].xz), vec2(0.37, 0.23));
    float seed = flock + float(gl_InstanceID) * 3.1;
    float flap = birdBeat(flightTime, seed, 3.4);
    transformed.y += max(0.0, abs(position.x) - 0.14) * flap * 0.55;
    float orbit = flightTime * 0.055 + birdHash(flock + 9.0) * 6.2831853 - float(gl_InstanceID) * 0.075;
    vec2 radius = vec2(64.0, 46.0);
    float phase = birdHash(flock + 5.0) * 6.2831853;
    transformed = birdFrame(orbit, radius, phase) * transformed;
    transformed += birdOrbit(orbit, radius, phase) * vec3(1.0, 2.5, 1.0);
  `);
};
flightMaterial.customProgramCacheKey = () => 'salt-flamingo-flight-v1';

export const postGeometry = new THREE.BoxGeometry(1, 1, 1);
