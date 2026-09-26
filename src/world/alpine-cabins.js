import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { randomAt } from './route.js';
import { alpineLake, snowHeight, snowPosition } from './snow-route.js';

export const CABIN_SPACING = 512;
// The shore is steep, so each cabin searches its stretch for the flattest spot
// near the water.
const cabinSlope = (s, u) => Math.max(Math.abs(snowHeight(s, u + 3) - snowHeight(s, u - 3)) / 6,
  Math.abs(snowHeight(s + 3, u) - snowHeight(s - 3, u)) / 6);
// Cached because scenery placement queries it for every tree and boulder.
const cabins = new Map();
export function alpineCabin(index) {
  if (cabins.has(index)) return cabins.get(index);
  const anchor = index * CABIN_SPACING + 54 + randomAt(index, 884) * 44;
  let best = null;
  // Coarse sweep, then a fine one around the best result.
  const survey = (from, to, stepS, fromU, toU, stepU) => {
    for (let ds = from; ds <= to; ds += stepS) {
      const s = anchor + ds;
      for (let du = fromU; du <= toU; du += stepU) {
        const u = alpineLake(s).near + du;
        // Stay clear of the shoreline 4 m either side too.
        if ([-4, 4].some(step => u - 2.5 <= alpineLake(s + step).near)) continue;
        const score = cabinSlope(s, u) + Math.abs(ds) * .002 + du * .01;
        if (!best || score < best.score) best = { s, u, ds, du, score };
      }
    }
  };
  survey(-44, 44, 8, 4, 11, 1.5);
  const { ds, du } = best;
  survey(Math.max(-44, ds - 6), Math.min(44, ds + 6), 2, Math.max(4, du - 1.5), Math.min(11, du + 1.5), .5);
  const cabin = { s: best.s, u: best.u, y: snowHeight(best.s, best.u) + .25, slope: cabinSlope(best.s, best.u) };
  cabins.set(index, cabin);
  if (cabins.size > 128) cabins.delete(cabins.keys().next().value);
  return cabin;
}
export function nearCabin(s, u) {
  const cabin = alpineCabin(Math.floor(s / CABIN_SPACING));
  return Math.abs(s - cabin.s) < 10 && Math.abs(u - cabin.u) < 8;
}

const wood = new THREE.MeshStandardMaterial({ color: '#665048', roughness: .92, flatShading: true });
const snow = new THREE.MeshStandardMaterial({ color: '#c7d2df', roughness: .95 });
const dark = new THREE.MeshStandardMaterial({ color: '#303c44', roughness: .8 });
const glass = new THREE.MeshBasicMaterial({ color: '#ffc27b', toneMapped: false });
const box = new THREE.BoxGeometry(1, 1, 1);
const vertices = [
  -1,0,1, 1,0,1, 0,1,1, 1,0,-1, -1,0,-1, 0,1,-1,
  -1,0,-1, -1,0,1, 0,1,1, -1,0,-1, 0,1,1, 0,1,-1,
  1,0,1, 1,0,-1, 0,1,-1, 1,0,1, 0,1,-1, 0,1,1,
];
const gable = new THREE.BufferGeometry(); gable.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); gable.computeVertexNormals();
registerChunkResources('cabins', { wood, snow, dark, glass, box, gable });

export function buildAlpineCabin(index, start) {
  const cabin = alpineCabin(index), p = snowPosition(cabin.s, cabin.u, cabin.y);
  const group = new THREE.Group(); group.name = 'lakeside-cabin'; group.position.set(p.x, p.y, p.z + start);
  const batches = new Map(), transform = new THREE.Object3D();
  const part = (mat, position, scale, rotation = 0, geo = box) => {
    transform.position.set(...position); transform.scale.set(...scale); transform.rotation.set(0, 0, rotation); transform.updateMatrix();
    if (geo === box) {
      if (!batches.has(mat)) batches.set(mat, []);
      batches.get(mat).push(transform.matrix.clone());
    } else {
      const mesh = new THREE.Mesh(geo, mat); mesh.applyMatrix4(transform.matrix);
      mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    }
  };
  part(wood, [0, 1.5, 0], [4.8, 3, 6]); part(wood, [0, 3, 0], [2.4, 2.15, 3], 0, gable);
  for (const side of [-1, 1]) part(snow, [side * 1.55, 4.05, 0], [4, .28, 7.1], side * -.64);
  part(dark, [1.35, 5.1, -.8], [.65, 2.05, .7]);
  for (const z of [-1.45, 1.45]) {
    part(glass, [-2.415, 1.65, z], [.025, 1.15, 1.1]);
    part(wood, [-2.44, 1.65, z], [.035, 1.2, .075]);
  }
  part(glass, [0, 3.6, 3.025], [.85, .7, .025]);
  part(wood, [0, .9, 3.025], [.95, 1.8, .05]);
  // Each corner post reaches its own ground height so the downhill side doesn't float.
  for (const x of [-1.9, 1.9]) for (const z of [-2.5, 2.5]) {
    const foot = Math.min(snowHeight(cabin.s - z, cabin.u + x), cabin.y) - .45;
    part(wood, [x, (foot - cabin.y) / 2, z], [.26, cabin.y - foot, .26]);
  }
  for (const [mat, matrices] of batches) {
    const mesh = new THREE.InstancedMesh(box, mat, matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.castShadow = mat !== glass; mesh.receiveShadow = mat !== glass; mesh.computeBoundingSphere(); group.add(mesh);
  }
  return group;
}
