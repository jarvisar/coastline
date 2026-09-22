import { joinCoplanarFaces, roofShell } from './surface-joins.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerChunkResources } from './chunk-resources.js';
import { waterClock } from './water.js';

// Bake the small details and muted colours into shared, flat-shaded meshes.
class Parts {
  constructor() { this.parts = []; }
  add(source, position, color, rotation = [0, 0, 0]) {
    // A colour in the segment-count slot yields a geometry with no vertices,
    // which merges away silently and leaves a part missing from the scene.
    if (typeof color !== 'string') throw new Error(`Part colour must be a string, got ${typeof color}`);
    if (!source.attributes.position.count) throw new Error('Part geometry has no vertices');
    let g = source;
    if (g.index) { g = source.toNonIndexed(); source.dispose(); }
    g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    g.translate(...position);
    const c = new THREE.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); this.parts.push(g);
  }
  box(p, size, color, rotation) { this.add(new THREE.BoxGeometry(...size), p, color, rotation); }
  cylinder(p, top, bottom, height, color, sides = 8, rotation) { this.add(new THREE.CylinderGeometry(top, bottom, height, sides), p, color, rotation); }
  cone(p, radius, height, color, sides = 8) { this.add(new THREE.ConeGeometry(radius, height, sides), p, color); }
  beam(a, b, width, color) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
    const g = new THREE.CylinderGeometry(width, width, direction.length(), 5);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    this.add(g, from.add(to).multiplyScalar(.5).toArray(), color);
  }
  // A closed pitched roof with a shared ridge and two gable triangles.
  // Turned, the ridge runs along x rather than z, which is how a dormer faces
  // out of the roof it stands in.
  gable(p, width, length, wallHeight, ridgeHeight, wall, roof, overhang = .35, turned = false) {
    const [x, y, z] = p, rise = ridgeHeight - wallHeight, half = width / 2;
    const eave = wallHeight - rise * overhang / half + .22;
    const shell = roofShell([[-half - overhang, eave], [0, ridgeHeight + .22], [half + overhang, eave]], length + overhang * 2);
    if (turned) shell.rotateY(Math.PI / 2);
    this.add(shell, p, roof);
    // Each end is wound to face out of the building. Wound both the same way
    // round, one of them is a back face and is culled, and the roof then
    // stands over a gable you can see the far wall through.
    const ends = [];
    for (const end of [-1, 1]) {
      const corner = (height, across) => turned ? [x + end * length / 2, height, z + across] : [x + across, height, z + end * length / 2];
      const foot = [corner(y + wallHeight, -half), corner(y + wallHeight, half)], apex = corner(y + ridgeHeight, 0);
      const swap = turned ? end > 0 : end < 0;
      ends.push(...(swap ? foot[1] : foot[0]), ...(swap ? foot[0] : foot[1]), ...apex);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(ends, 3));
    g.computeVertexNormals(); this.add(g, [0, 0, 0], wall);
  }
  // A gambrel: the barn roof that breaks halfway up, steep at the eaves and
  // shallow over the ridge. The pitches meet along shared edges.
  gambrel(p, width, length, wallHeight, kneeHeight, ridgeHeight, wall, roof, overhang = .35) {
    const [x, y, z] = p, half = width / 2, knee = half * .62;
    const eave = wallHeight - overhang * (kneeHeight - wallHeight) / (half - knee);
    this.add(roofShell([[-half - overhang, eave + .24], [-knee, kneeHeight + .24], [0, ridgeHeight + .24],
      [knee, kneeHeight + .24], [half + overhang, eave + .24]], length + overhang * 2, .24), p, roof);
    // As with the gable, each end is wound to face out of the barn.
    const ends = [];
    for (const end of [-1, 1]) {
      const zEnd = z + end * length / 2;
      for (const [ax, ay, bx, by] of [[-half, wallHeight, -knee, kneeHeight], [-knee, kneeHeight, 0, ridgeHeight],
        [0, ridgeHeight, knee, kneeHeight], [knee, kneeHeight, half, wallHeight]]) {
        const a = [x + ax, y + ay, zEnd], b = [x + bx, y + by, zEnd];
        ends.push(...(end < 0 ? a : b), ...(end < 0 ? b : a), x, y + wallHeight, zEnd);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(ends, 3));
    g.computeVertexNormals(); this.add(g, [0, 0, 0], wall);
  }
  finish() {
    const g = joinCoplanarFaces(mergeGeometries(this.parts)); this.parts.forEach(part => part.dispose());
    g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
}
const barnRed = '#a6412f', trim = '#e8e0cc', shingle = '#5e4d45', tin = '#8f9594', galvanised = '#c3c7c2', iron = '#5a5e5a';

// A gambrel barn with a sliding door, a hayloft door and a ridge vent. Local
// z runs along the ridge; the door faces -x, toward the yard.
function barn() {
  const p = new Parts();
  p.box([0, 2.2, 0], [7.4, 4.4, 12], barnRed);
  p.gambrel([0, 0, 0], 7.4, 12, 4.4, 6.6, 8.1, barnRed, shingle);
  // White corner boards and a sill band, as the reference barns carry.
  for (const z of [-6, 6]) for (const x of [-3.72, 3.72]) p.box([x, 2.2, z], [.2, 4.4, .2], trim);
  for (const x of [-3.74, 3.74]) p.box([x, .18, 0], [.16, .36, 12], trim);
  // Board-and-batten siding catches the light on the long walls.
  for (const x of [-3.73, 3.73]) for (let z = -5.5; z < 6; z += .75) {
    if (x < 0 && z > -.6 && z < 3.4) continue;
    p.box([x, 2.3, z], [.08, 4.1, .07], '#bd5940');
  }
  // A big sliding door on the yard side, with its track and a hayloft door.
  p.box([-3.76, 1.75, 1.4], [.14, 3.5, 3.6], '#38291f');
  for (const z of [-.45, 3.25]) p.box([-3.84, 1.75, z], [.07, 3.5, .2], trim);
  p.box([-3.84, 3.55, 1.4], [.07, .22, 3.9], trim);
  p.box([-3.85, 1.75, 1.4], [.08, 3.4, .12], trim);
  for (const z of [.5, 2.3]) {
    p.beam([-3.88, .16, z - .8], [-3.88, 3.3, z + .8], .045, trim);
    p.beam([-3.88, .16, z + .8], [-3.88, 3.3, z - .8], .045, trim);
  }
  // The hayloft door belongs high on the gable end, under the ridge. On the
  // side wall it stood above the eaves, hanging in the air outside the roof.
  p.box([0, 5.6, -6.05], [1.5, 1.6, .07], '#38291f');
  p.box([0, 6.52, -6.18], [1.8, .18, .32], '#6b5a4a');
  // Ridge cupola with a little vent roof.
  p.box([0, 8.45, -1], [1.3, .9, 1.7], barnRed);
  p.box([0, 8.98, -1], [1.7, .2, 2.1], shingle);
  p.box([0, 9.3, -1], [.16, .5, .16], '#5d5348');
  for (const z of [-3.6, 4.6]) p.box([3.76, 2.9, z], [.08, 1.1, 1.3], '#4b3b33');
  return p.finish();
}
// A tower silo beside the barn, with hoops, a domed cap and a ladder.
function silo() {
  const p = new Parts();
  p.cylinder([0, 5.5, 0], 2.3, 2.3, 11, galvanised, 12);
  for (let y = 1.4; y < 11; y += 2.4) p.cylinder([0, y, 0], 2.36, 2.36, .16, '#a8adaa', 12);
  p.add(new THREE.SphereGeometry(2.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), [0, 11, 0], tin);
  p.box([0, 12.8, 0], [.5, 1.4, .5], iron); p.box([0, 13.5, .7], [.12, .12, 1.6], iron);
  for (const x of [-.3, .3]) p.box([x, 5.6, 2.42], [.06, 11.2, .06], iron);
  for (let y = .6; y < 11; y += .55) p.box([0, y, 2.42], [.66, .05, .05], iron);
  return p.finish();
}
// A modest clapboard farmhouse with a porch and a chimney.
function farmhouse() {
  const p = new Parts(), wall = '#eee7d4', roofShade = '#5c5a58';
  p.box([0, 1.7, 0], [6.2, 3.4, 8], wall);
  p.gable([0, 0, 0], 6.2, 8, 3.4, 6.1, wall, roofShade);
  // Two dormers face the yard, which is what makes it read as a farmhouse
  // rather than another shed. A dormer has to clear the roof over its whole
  // footprint: set too far up the pitch, the roof closes over its inner half
  // and what is left reads as a hole punched in the slates.
  // The roof it stands in is a slab a quarter of a unit thick, lifted clear
  // of the rafter line it follows, so a dormer has to clear that surface and
  // not merely the pitch beneath it.
  // Its ridge runs out of the roof rather than along it, and it reaches far
  // enough back that the ridge dies into the pitch instead of standing a
  // second gable up out of the slates behind the window.
  for (const z of [-2.2, 2.2]) {
    p.box([-1.7, 4.45, z], [2.26, 1.6, 1.5], wall);
    p.gable([-1.7, 0, z], 1.5, 2.26, 5.25, 5.85, wall, roofShade, .12, true);
    p.box([-2.865, 4.6, z], [.06, .85, .75], '#3f5260');
  }
  p.box([1.7, 5.9, -2.4], [.72, 2.4, .72], '#96604a');
  p.box([1.7, 7.15, -2.4], [.86, .22, .86], '#7d5040');
  // A deep porch along the front, with posts and a rail. Its roof reaches
  // back to the wall and falls away from it: cut short it hung in the air
  // beside the house, and pitched the other way it climbed as it went out.
  p.box([-4.05, 1.36, 0], [2, .2, 8], '#cdc2a8'); p.box([-4.05, .78, 0], [2, .92, 8], '#b9ad92');
  p.box([-4.25, 2.84, 0], [2.54, .14, 8.2], roofShade, [0, 0, .166]);
  for (const z of [-3.6, -1.2, 1.2, 3.6]) p.box([-4.9, 2.1, z], [.14, 1.28, .14], wall);
  // Leave a real opening in the porch rail above the front steps.
  for (const [z, length] of [[-3.65, .7], [.65, 5.5]]) {
    p.box([-4.9, 1.95, z], [.1, .1, length], wall);
    for (let at = z - length / 2; at <= z + length / 2; at += .45) p.box([-4.9, 1.7, at], [.065, .5, .065], wall);
  }
  for (let k = 0; k < 4; k++) p.box([-5.2 - k * .32, .16 + (3 - k) * .17, -2.3], [.36, .32 + (3 - k) * .34, 1.7], '#b9ad92');
  p.box([-3.15, 1.6, -2.3], [.06, 2.1, .95], '#6b4f3f');
  for (const z of [.7, 2.8]) p.box([-3.15, 1.95, z], [.06, 1.1, .85], '#3f5260');
  for (const z of [-2.5, 0, 2.5]) p.box([3.15, 1.95, z], [.06, 1.1, .85], '#3f5260');
  for (const x of [-1.9, 1.9]) p.box([x, 1.95, 4.03], [.85, 1.1, .06], '#3f5260');
  for (const x of [-3.18, 3.18]) for (const z of (x < 0 ? [.7, 2.8] : [-2.5, 0, 2.5])) {
    for (const dz of [-.62, .62]) p.box([x, 1.95, z + dz], [.09, 1.25, .26], '#587166');
    p.box([x, 1.35, z], [.13, .13, 1.03], trim);
    p.box([x, 1.95, z], [.1, 1.1, .05], trim);
  }
  for (const z of [-4.02, 4.02]) for (const x of [-3.08, 3.08]) p.box([x, 1.7, z], [.16, 3.4, .14], trim);
  return p.finish();
}
// A farm windmill: a braced tower with a platform and tail vane. The rotor
// is a separate mesh that spins in its own material.
function windmillTower() {
  const p = new Parts(), corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [x, z] = corners[i], [nx, nz] = corners[(i + 1) % 4];
    p.beam([x * 1.2, 0, z * 1.2], [x * .35, 8.2, z * .35], .06, iron);
    p.box([x * 1.2, .06, z * 1.2], [.5, .24, .5], '#a89a7d');
    for (let y = 0; y < 7.5; y += 2.5) {
      const a = 1.2 - y * .104, b = 1.2 - (y + 2.5) * .104;
      p.beam([x * a, y, z * a], [nx * b, y + 2.5, nz * b], .028, iron);
      p.beam([x * b, y + 2.5, z * b], [nx * b, y + 2.5, nz * b], .036, iron);
    }
  }
  p.box([0, 7.5, 0], [1.4, .12, 1.4], '#8a7a60');
  p.beam([0, .2, 0], [0, 8.5, 0], .03, iron);
  p.beam([0, 8.65, -.35], [0, 8.65, 2.7], .055, iron);
  p.box([0, 8.85, 2.45], [.06, .95, 1.3], '#b4b39b');
  return p.finish();
}
function windmillRotor() {
  const p = new Parts();
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6, x = Math.cos(angle), y = Math.sin(angle);
    p.beam([0, 0, 0], [x * 1.9, y * 1.9, 0], .022, iron);
    p.box([x * 1.42, y * 1.42, 0], [.42, 1.08, .05], i % 3 ? '#c9c6b1' : '#a9a58f', [0, .13, angle - Math.PI / 2]);
  }
  p.cylinder([0, 0, .02], .2, .2, .2, '#8a4a38', 8, [Math.PI / 2, 0, 0]);
  return p.finish();
}
// A red tractor parked in the yard, big rear wheels and a chimney stack.
function tractor() {
  const p = new Parts(), red = '#c04532', tyre = '#33393a';
  p.box([0, .95, .2], [1.05, .7, 2.4], red);
  p.box([0, 1.25, -.95], [.9, .5, 1.1], red);
  p.box([0, 1.7, .55], [1.1, .95, 1.3], '#e0d8c4');
  p.box([0, 1.7, .55], [1.02, .7, 1.22], '#3d4f58');
  p.box([0, 2.22, .55], [1.3, .1, 1.5], red);
  p.beam([.3, 1.6, -1.2], [.3, 2.5, -1.2], .05, iron);
  for (const x of [-.72, .72]) p.cylinder([x, .78, .55], .78, .78, .42, tyre, 10, [0, 0, Math.PI / 2]);
  for (const x of [-.72, .72]) p.cylinder([x, .78, .55], .42, .42, .44, '#c9b98d', 8, [0, 0, Math.PI / 2]);
  for (const x of [-.55, .55]) p.cylinder([x, .42, -1.3], .42, .42, .3, tyre, 8, [0, 0, Math.PI / 2]);
  return p.finish();
}
// A timber field shed under a rusting tin roof: the outbuilding that stands
// in a corner of a field, well short of a farmstead.
function fieldShed() {
  const p = new Parts(), board = '#8f816b', roof = '#7f6b5b';
  p.box([0, 1.6, 0], [5.2, 3.2, 7.4], board);
  p.gable([0, 0, 0], 5.2, 7.4, 3.2, 4.7, board, roof, .3);
  p.box([-2.64, 1.35, 1.2], [.1, 2.7, 2.4], '#4a3d31');
  for (const z of [-3.7, 3.7]) for (const x of [-2.6, 2.6]) p.box([x, 1.6, z], [.16, 3.2, .16], '#a99b81');
  return p.finish();
}
// A country grain elevator: a tin-clad shed with a tall wood elevator tower
// and headhouse, a leg up its side, and two steel bins with cone roofs.
function grainElevator() {
  const p = new Parts(), clad = '#d5cfbf', wood = '#c4b9a3';
  p.box([0, 2.7, 0], [7, 5.4, 12], clad);
  p.gable([0, 0, 0], 7, 12, 5.4, 7.6, clad, tin);
  p.box([0, 11.5, -1.5], [5.4, 23, 5.4], wood);
  p.gable([0, 0, -1.5], 5.4, 5.4, 23, 25.4, wood, tin, .25);
  p.box([1.2, 26.6, -1.5], [3.2, 3.2, 3.2], clad);
  p.gable([1.2, 0, -1.5], 3.2, 3.2, 28.2, 29.6, clad, tin, .2);
  p.beam([3.4, .6, 3], [2.9, 27.8, -1.5], .32, tin);
  p.box([-4.5, 2.6, 5.2], [2.6, .2, 5], tin); for (const z of [3, 7.3]) p.box([-5.6, 1.25, z], [.16, 2.5, .16], iron);
  for (const z of [-3, 1.5]) p.box([-3.55, 2.4, z], [.08, 1.6, 1.9], '#5c5750');
  for (const x of [7.6, 14.2]) {
    p.cylinder([x, 3.8, 1], 3.2, 3.2, 7.6, galvanised, 14);
    for (let y = 1.2; y < 7.6; y += 1.8) p.cylinder([x, y, 1], 3.26, 3.26, .12, '#adb2ae', 14);
    p.cone([x, 8.6, 1], 3.3, 2, tin, 14);
    p.box([x, 9.9, 1], [.6, .8, .6], iron);
  }
  p.box([16.5, 6.4, -1.6], [.24, 1.4, 6], tin); p.beam([7.6, 9.6, 1], [14.2, 9.6, 1], .16, tin);
  p.box([3.2, 1.4, 8.6], [4.2, 2.8, 3.4], clad); p.box([3.2, 2.9, 8.6], [4.6, .2, 3.8], tin);
  return p.finish();
}
// A wind turbine: a tapered tower with its nacelle; the rotor spins separately.
function turbineTower() {
  const p = new Parts(), white = '#e7e9e4';
  p.cylinder([0, 19, 0], .78, 1.35, 38, white, 10);
  p.box([0, 38.6, -.4], [2.4, 2.3, 4.4], '#d6d9d3');
  p.cylinder([0, 38.6, -2.7], .9, 1.1, .8, '#c7cac5', 8, [Math.PI / 2, 0, 0]);
  p.box([0, .5, 0], [3.6, 1, 3.6], '#b3b0a4');
  return p.finish();
}
function turbineRotor() {
  const p = new Parts(), white = '#eceeea';
  p.cylinder([0, 0, .2], 1, 1.1, 1.2, '#d3d6d1', 8, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    const g = new THREE.BoxGeometry(1, 1, 1, 1, 4, 1).toNonIndexed();
    const position = g.attributes.position;
    // Taper and twist the blade from the root to a narrow tip.
    for (let j = 0; j < position.count; j++) {
      const y = position.getY(j) + .5, taper = 1 - y * .7, twist = y * .35;
      const x = position.getX(j) * (1.1 * taper), z = position.getZ(j) * (.32 * taper);
      position.setXYZ(j, x * Math.cos(twist) - z * Math.sin(twist), 1.1 + y * 17.4, x * Math.sin(twist) + z * Math.cos(twist));
    }
    p.add(g, [0, 0, 0], white, [0, 0, angle]);
  }
  return p.finish();
}

export const plainsDiscoveryAssets = { barn: barn(), silo: silo(), farmhouse: farmhouse(), windmillTower: windmillTower(), windmillRotor: windmillRotor(),
  tractor: tractor(), grainElevator: grainElevator(), turbineTower: turbineTower(), turbineRotor: turbineRotor(), shed: fieldShed(), box: new THREE.BoxGeometry(1, 1, 1) };
export const plainsDiscoveryMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
export const plainsFoundationMaterial = new THREE.MeshStandardMaterial({ color: '#b1a892', roughness: 1, flatShading: true });
// Rotors turn about their own local z in the vertex shader, off the shared
// water clock, so the whole row of turbines animates in one draw call.
function rotorMaterial(rate, key) {
  const result = plainsDiscoveryMaterial.clone();
  result.onBeforeCompile = shader => {
    shader.uniforms.plainsTime = waterClock.time;
    shader.vertexShader = 'uniform float plainsTime;\n' + shader.vertexShader;
    const spin = `float angle = plainsTime * ${rate.toFixed(3)} + instanceMatrix[3].x * 0.37; float c = cos(angle), s = sin(angle); mat2 spin = mat2(c, s, -s, c);`;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${spin}\nobjectNormal.xy = spin * objectNormal.xy;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xy = spin * transformed.xy;');
  };
  result.customProgramCacheKey = () => key;
  return result;
}
export const plainsWindmillMaterial = rotorMaterial(1.1, 'plains-windmill-v1');
export const plainsTurbineMaterial = rotorMaterial(.62, 'plains-turbine-v1');
registerChunkResources('plains-discoveries', { plainsDiscoveryAssets, plainsDiscoveryMaterial, plainsFoundationMaterial, plainsWindmillMaterial, plainsTurbineMaterial });
