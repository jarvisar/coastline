import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { randomAt, smoothstep } from './route.js';
import { waterClock } from './water.js';
import { birdFlightGLSL } from './bird-flight.js';

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

// Faceted boulders, weathered on shared vertices so they stay closed. The
// flat base sits in the crust, and a pale band of salt crystals rims it.
function boulder(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, offsets = new Map();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), key = `${Math.round(x * 1e3)},${Math.round(y * 1e3)},${Math.round(z * 1e3)}`;
    if (!offsets.has(key)) offsets.set(key, 1 + (randomAt(offsets.size, seed) - .5) * .14 + .04 * Math.sin(x * 3 + z * 2 + seed));
    const wear = offsets.get(key);
    // Rounded domes with a flat seat in the crust.
    let height = y * wear;
    if (height < -.42) height = -.42 + (height + .42) * .15;
    p.setXYZ(i, x * wear, height, z * wear * (.92 + randomAt(seed, 3) * .16));
  }
  g.computeVertexNormals();
  const colors = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    normal.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    const low = (a.y + b.y + c.y) / 3, facet = randomAt(i, seed + 7);
    // Lighter tops, darker undersides, per-face mottling.
    let shade = .9 + normal.y * .08 + (facet - .5) * .06;
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
const pink = '#f29aa7', paler = '#f6b4bd', deepPink = '#e57b90', leg = '#dd6e84', black = '#241f21', beak = '#f1d6d4';
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
