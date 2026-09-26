import * as THREE from 'three';
import { birdFlightGLSL } from './bird-flight.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { randomAt } from './route.js';
import { waterClock } from './water.js';

const up = new THREE.Vector3(0, 1, 0);

// Unit-height trees. Crown shading is baked into vertex colours so a
// per-instance tint still reads as foliage.
function plainsTree(seed, kind) {
  const bark = [], leaves = [];
  // Closed cylinders that overrun the joint so segments overlap and forks
  // show no holes.
  const branch = (from, to, bottom, top = bottom * .66) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(top, bottom, direction.length() + bottom * 1.6, 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize()));
    g.translate(...a.add(b).multiplyScalar(.5).toArray()); bark.push(g);
  };
  const lobe = (center, size, angle, salt) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(size[0] * (.9 + randomAt(salt, seed + 931) * .2), size[1], size[0] * (.9 + randomAt(salt, seed + 932) * .2));
    g.rotateY(angle); g.translate(...center);
    const colors = [], normals = g.attributes.normal;
    for (let j = 0; j < normals.count; j += 3) {
      const upward = (normals.getY(j) + normals.getY(j + 1) + normals.getY(j + 2)) / 3;
      const shade = .66 + Math.max(0, upward) * .36 + randomAt(j, salt + seed * 7 + 933) * .05;
      for (let k = 0; k < 3; k++) colors.push(shade, shade, shade * .97);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    leaves.push(g);
  };
  const onTrunk = (line, height) => {
    for (let i = 0; i < line.length - 1; i++) {
      const [a, b] = [line[i], line[i + 1]];
      if (height > b[1] && i < line.length - 2) continue;
      const t = Math.max(0, Math.min(1, (height - a[1]) / (b[1] - a[1])));
      return [a[0] + (b[0] - a[0]) * t, height, a[2] + (b[2] - a[2]) * t];
    }
    return line.at(-1);
  };
  if (kind === 'poplar') {
    const line = [[0, -.1, 0], [.01, .46, 0], [.02, .88, 0]];
    branch(line[0], line[1], .05, .038); branch(line[1], line[2], .038, .022);
    lobe([0, .38, 0], [.2, .24], 0, 1); lobe([.01, .6, 0], [.18, .22], 1.1, 2); lobe([.02, .82, 0], [.13, .19], 2.3, 3);
  } else if (kind === 'willow') {
    const line = [[0, -.1, 0], [.12, .3, .04], [.22, .54, .02]];
    branch(line[0], line[1], .075, .055); branch(line[1], line[2], .055, .035);
    for (let i = 0; i < 5; i++) {
      const angle = i * 1.26 + randomAt(i, seed + 941) * .5, r = .24 + randomAt(i, seed + 942) * .14;
      const root = onTrunk(line, .38 + randomAt(i, seed + 945) * .1);
      const tip = [.2 + Math.cos(angle) * r, .5 + randomAt(i, seed + 943) * .12, Math.sin(angle) * r];
      branch(root, tip, .03, .02);
      lobe(tip, [.3, .17], angle, i + 10);
    }
    lobe([.2, .66, 0], [.3, .16], .7, 20);
  } else {
    const lean = .16, line = [[0, -.1, 0], [lean * .3, .32, .02], [lean, .6, -.02]];
    branch(line[0], line[1], .085, .062); branch(line[1], line[2], .062, .04);
    for (let i = 0; i < 5; i++) {
      const angle = i * 1.26 + randomAt(i, seed + 951) * .6, r = .2 + randomAt(i, seed + 952) * .16;
      const crown = [lean + Math.cos(angle) * r, .6 + randomAt(i, seed + 953) * .14, Math.sin(angle) * r * .85];
      branch(onTrunk(line, .36 + i * .04), crown, .036, .022);
      lobe(crown, [.27 + randomAt(i, seed + 954) * .1, .2 + randomAt(i, seed + 955) * .06], angle, i);
    }
    lobe([lean, .82, 0], [.3, .21], .4, 30);
  }
  const result = { bark: mergeGeometries(bark), leaves: mergeGeometries(leaves) };
  for (const part of [...bark, ...leaves]) part.dispose();
  result.bark.computeBoundingSphere(); result.leaves.computeBoundingSphere();
  return result;
}
// Two lobes only: boundary belts hold about a hundred of these.
function hedgeTree(seed) {
  const bark = [], leaves = [];
  const branch = (from, to, bottom, top) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(top, bottom, direction.length() + bottom * 1.6, 5);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize()));
    g.translate(...a.add(b).multiplyScalar(.5).toArray()); bark.push(g);
  };
  const lobe = (center, radius, squash, salt) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(radius * (.9 + randomAt(salt, seed + 971) * .25), radius * squash, radius * (.9 + randomAt(salt, seed + 972) * .25));
    g.rotateY(randomAt(salt, seed + 973) * 6.28); g.translate(...center);
    const colors = [], normals = g.attributes.normal;
    for (let j = 0; j < normals.count; j += 3) {
      const upward = (normals.getY(j) + normals.getY(j + 1) + normals.getY(j + 2)) / 3;
      const shade = .64 + Math.max(0, upward) * .38 + randomAt(j, salt + seed * 5 + 974) * .05;
      for (let k = 0; k < 3; k++) colors.push(shade, shade, shade * .97);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    leaves.push(g);
  };
  const lean = (randomAt(seed, 975) - .5) * .12;
  branch([0, -.12, 0], [lean, .44, 0], .07, .045);
  lobe([lean, .62, 0], .34 + randomAt(seed, 976) * .08, .82, 1);
  lobe([lean * 1.6 + .1, .44, .06], .24 + randomAt(seed, 977) * .06, .78, 2);
  const result = { bark: mergeGeometries(bark), leaves: mergeGeometries(leaves) };
  for (const part of [...bark, ...leaves]) part.dispose();
  result.bark.computeBoundingSphere(); result.leaves.computeBoundingSphere();
  return result;
}

function conifer(seed) {
  const bark = [], leaves = [];
  const stem = new THREE.CylinderGeometry(.022, .05, 1.06, 5);
  stem.translate(0, .41, 0); bark.push(stem);
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const radius = (.30 - t * .19) * (.9 + randomAt(i, seed + 981) * .2);
    const height = .3 - t * .12;
    // Non-indexed so the per-face bake below gets three vertices per face.
    // Indexed cones leave some faces uncoloured, which draw black.
    const g = new THREE.ConeGeometry(radius, height, 7, 1).toNonIndexed();
    g.deleteAttribute('uv');
    g.rotateY(randomAt(i, seed + 982) * 6.28);
    g.translate(0, .16 + t * .68 + height * .5, 0);
    const colors = [], normals = g.attributes.normal;
    for (let j = 0; j < normals.count; j += 3) {
      const upward = (normals.getY(j) + normals.getY(j + 1) + normals.getY(j + 2)) / 3;
      const shade = .74 + Math.max(0, upward) * .26 + t * .06 + randomAt(j, seed + 983) * .04;
      for (let k = 0; k < 3; k++) colors.push(shade, shade, shade * .95);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    leaves.push(g);
  }
  const result = { bark: mergeGeometries(bark), leaves: mergeGeometries(leaves) };
  for (const part of [...bark, ...leaves]) part.dispose();
  result.bark.computeBoundingSphere(); result.leaves.computeBoundingSphere();
  return result;
}

function cypress(seed) {
  const bark = [], leaves = [];
  const stem = new THREE.CylinderGeometry(.02, .045, .42, 5);
  stem.translate(0, .09, 0); bark.push(stem);
  const lobe = (y, radius, tall, salt) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(radius * (.92 + randomAt(salt, seed + 991) * .16), tall, radius * (.92 + randomAt(salt, seed + 992) * .16));
    g.rotateY(randomAt(salt, seed + 993) * 6.28); g.translate(0, y, 0);
    const colors = [], normals = g.attributes.normal;
    for (let j = 0; j < normals.count; j += 3) {
      const upward = (normals.getY(j) + normals.getY(j + 1) + normals.getY(j + 2)) / 3;
      const shade = .7 + Math.max(0, upward) * .3 + randomAt(j, salt + seed * 3 + 994) * .05;
      for (let k = 0; k < 3; k++) colors.push(shade, shade, shade * .96);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    leaves.push(g);
  };
  lobe(.3, .17, .25, 1); lobe(.56, .15, .27, 2); lobe(.81, .11, .22, 3);
  const result = { bark: mergeGeometries(bark), leaves: mergeGeometries(leaves) };
  for (const part of [...bark, ...leaves]) part.dispose();
  result.bark.computeBoundingSphere(); result.leaves.computeBoundingSphere();
  return result;
}

export const plainsTrees = { oak: [plainsTree(1, 'oak'), plainsTree(2, 'oak')], poplar: [plainsTree(3, 'poplar'), plainsTree(4, 'poplar')], willow: [plainsTree(5, 'willow')],
  hedge: [hedgeTree(6), hedgeTree(7), hedgeTree(8)], conifer: [conifer(9), conifer(10)], cypress: [cypress(11)] };

// Round bale on its side, axis along x.
function bale() {
  const g = new THREE.CylinderGeometry(.75, .75, 1.3, 10, 1).toNonIndexed();
  g.deleteAttribute('uv'); g.rotateZ(Math.PI / 2);
  const colors = [], positions = g.attributes.position, normals = g.attributes.normal;
  for (let i = 0; i < positions.count; i += 3) {
    const nx = (normals.getX(i) + normals.getX(i + 1) + normals.getX(i + 2)) / 3;
    const end = Math.abs(nx) > .5;
    const band = Math.floor(Math.atan2(positions.getY(i), positions.getZ(i)) / Math.PI * 5 + 5) % 3 === 0;
    const shade = end ? .8 : band ? .93 : 1;
    for (let k = 0; k < 3; k++) colors.push(shade, shade * (end ? .95 : 1), shade * .92);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
export const baleGeometry = bale();
function squareBale() {
  const g = new THREE.BoxGeometry(1.6, .8, 1.1).toNonIndexed();
  g.deleteAttribute('uv');
  const colors = [], normals = g.attributes.normal;
  for (let i = 0; i < normals.count; i += 3) {
    const end = Math.abs(normals.getX(i)) > .5, top = normals.getY(i) > .5;
    const shade = top ? 1 : end ? .78 : .9;
    for (let k = 0; k < 3; k++) colors.push(shade, shade * (end ? .95 : 1), shade * .9);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return g;
}
export const squareBaleGeometry = squareBale();

// Head and legs are darker than the flank so a per-instance coat tint still
// reads as a cow.
function cow() {
  const parts = [];
  const box = (size, position, shade) => {
    const g = new THREE.BoxGeometry(...size).toNonIndexed(); g.deleteAttribute('uv'); g.translate(...position);
    const colors = new Float32Array(g.attributes.position.count * 3).fill(shade);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); parts.push(g);
  };
  box([.95, .78, 1.75], [0, 1.02, 0], 1);
  box([.5, .46, .62], [0, 1.22, -1.08], .82);
  box([.62, .12, .12], [0, 1.48, -1.02], .55);
  for (const x of [-.3, .3]) for (const z of [-.62, .62]) box([.19, .66, .19], [x, .33, z], .78);
  box([.08, .5, .08], [0, .95, .9], .6);
  // Dark patches let one mesh read as a Holstein or a brown cow by tint.
  // Each patch sits slightly proud and off every other face plane to avoid z-fighting.
  box([.99, .38, .52], [0, 1.24, -.34], .3);
  box([.982, .3, .4], [0, .86, .5], .34);
  box([.56, .32, .3], [0, 1.285, .74], .32);
  const g = mergeGeometries(parts); parts.forEach(part => part.dispose());
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
export const cowGeometry = cow();

function rushes() {
  const positions = [];
  for (let i = 0; i < 11; i++) {
    const angle = i * 2.399963, x = Math.cos(angle), z = Math.sin(angle);
    const height = .7 + randomAt(i, 962) * .6, bend = .18 + randomAt(i, 963) * .22;
    positions.push(-z * .04, 0, x * .04, x * bend * .5, height * .72, z * bend * .5, z * .04, 0, -x * .04,
      z * .04, 0, -x * .04, x * bend * .5, height * .72, z * bend * .5, x * bend, height, z * bend);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
export const rushGeometry = rushes();

// Emits each face twice, wound both ways, with a mostly upward normal.
// DoubleSide would flip the back normal toward the ground and turn half of
// every tuft near-black under a low sun.
function standingFoliage(positions, colors) {
  const points = [], shades = [], normals = [];
  for (let face = 0; face < positions.length / 9; face++) {
    const corner = k => positions.slice(face * 9 + k * 3, face * 9 + k * 3 + 3);
    const [a, b, c] = [corner(0), corner(1), corner(2)];
    const u = b.map((value, k) => value - a[k]), v = c.map((value, k) => value - a[k]);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...cross) || 1, lean = .25;
    const tilted = [cross[0] / length * lean, cross[1] / length * lean + 1, cross[2] / length * lean];
    const scale = Math.hypot(...tilted), normal = tilted.map(value => value / scale);
    for (const point of [a, b, c, a, c, b]) points.push(...point);
    for (let k = 0; k < 6; k++) normals.push(...normal);
    if (colors) shades.push(...colors.slice(face * 9, face * 9 + 9), ...colors.slice(face * 9, face * 9 + 9));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(shades.length ? shades : new Array(points.length).fill(1), 3));
  g.computeBoundingSphere(); return g;
}

function stalks() {
  const positions = [], colors = [];
  const face = (a, b, c, shades) => { positions.push(...a, ...b, ...c); for (const shade of shades) colors.push(shade, shade, shade * .96); };
  for (let i = 0; i < 6; i++) {
    const angle = i * 2.399963 + .7, x = Math.cos(angle), z = Math.sin(angle);
    const height = .85 + randomAt(i, 966) * .45, bend = .12 + randomAt(i, 967) * .16, spread = .1 + randomAt(i, 968) * .16;
    const bx = x * spread, bz = z * spread;
    const root = [.82, .82], mid = [.93, .93], tip = [1];
    face([bx - z * .04, 0, bz + x * .04], [bx + x * bend * .5, height * .7, bz + z * bend * .5], [bx + z * .04, 0, bz - x * .04], [root[0], mid[0], root[1]]);
    face([bx + z * .04, 0, bz - x * .04], [bx + x * bend * .5, height * .7, bz + z * bend * .5], [bx + x * bend, height, bz + z * bend], [root[0], mid[0], tip[0]]);
  }
  return standingFoliage(positions, colors);
}
export const stalkGeometry = stalks();

// The ear is baked into vertex colours so a per-instance gold still reads as
// grain over straw.
function wheatStalks() {
  const positions = [], colors = [];
  // Kept bright. Stalks are hair-thin and a dark bake reads as black specks.
  const straw = [.9, .88, .74], grain = [1, .98, .87];
  const face = (a, b, c, shade) => { positions.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) colors.push(...shade); };
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.399963 + .4, x = Math.cos(angle), z = Math.sin(angle);
    const height = 1.05 + randomAt(i, 976) * .45, lean = .06 + randomAt(i, 977) * .13, spread = .08 + randomAt(i, 978) * .18;
    const bx = x * spread, bz = z * spread, px = -z, pz = x;
    // Vertex pair at height fraction t, w either side of the stalk.
    const at = (t, w) => {
      const y = t * height, along = lean * t * t;
      return [[bx + x * along - px * w, y, bz + z * along - pz * w], [bx + x * along + px * w, y, bz + z * along + pz * w]];
    };
    const shoulder = .6;
    const [b0, b1] = at(0, .032), [s0, s1] = at(shoulder, .026);
    face(b0, b1, s0, straw); face(b1, s1, s0, straw);
    // Ear is one tapered quad so each stalk stays four faces.
    const [e0, e1] = at(shoulder, .058), [t0, t1] = at(1, .013);
    face(e0, e1, t0, grain); face(e1, t1, t0, grain);
  }
  return standingFoliage(positions, colors);
}
export const wheatGeometry = wheatStalks();

// Crows fly in the vertex shader off the shared water clock: one draw call,
// no per-frame CPU work, and they pause with the scene.
export const crowGeometry = new THREE.BufferGeometry();
crowGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
  0, 0, -.38, -.65, .08, 0, -.1, 0, .3, -.65, .08, 0, -1.5, -.12, .45, -.1, 0, .3,
  0, 0, -.38, .1, 0, .3, .65, .08, 0, .65, .08, 0, .1, 0, .3, 1.5, -.12, .45,
  -.13, 0, .2, .13, 0, .2, 0, 0, .68,
].map(v => v * .72), 3));
crowGeometry.computeVertexNormals(); crowGeometry.computeBoundingSphere();
export const crowMaterial = new THREE.MeshBasicMaterial({ color: '#2b2622', side: THREE.DoubleSide, toneMapped: false });
crowMaterial.onBeforeCompile = shader => {
  shader.uniforms.plainsTime = waterClock.time;
  shader.vertexShader = 'uniform float plainsTime;\n' + birdFlightGLSL + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
    #include <begin_vertex>
    float seed = dot(instanceMatrix[3].xz, vec2(0.37, 0.23)) + float(gl_InstanceID) * 17.0;
    float phase = birdHash(seed + 5.0) * 6.2831853;
    float flap = birdBeat(plainsTime, seed, 6.2);
    transformed.y += abs(position.x) * (0.1 + flap * 0.3);
    float orbit = plainsTime * mix(0.17, 0.24, birdHash(seed + 6.0)) + phase;
    vec2 radius = vec2(11.0, 13.0) * mix(0.85, 1.05, birdHash(seed + 7.0));
    transformed = birdFrame(orbit, radius, phase) * transformed;
    transformed += birdOrbit(orbit, radius, phase);
  `);
};
crowMaterial.customProgramCacheKey = () => 'plains-crows-v3';
