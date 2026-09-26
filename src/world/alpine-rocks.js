import * as THREE from 'three';
import { randomAt } from './route.js';

function meshGeometry(positions) {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.computeVertexNormals(); result.computeBoundingSphere(); return result;
}

// Jittered rings and an offset crown vary each stone's silhouette.
// The snow shell follows the crown so it doesn't float.
function rockVariant(seed) {
  const sides = 5 + seed % 3, rock = [], snow = [];
  const face = (target, a, b, c) => target.push(...a, ...b, ...c);
  const rings = [[-.48, .8], [.08, 1], [.76, .65]].map(([y, radius], layer) =>
    Array.from({ length: sides }, (_, i) => {
      const angle = i / sides * Math.PI * 2;
      const r = radius * (.78 + randomAt(seed * 17 + i, 381) * .4);
      return [Math.cos(angle) * r + layer * (seed % 2 ? .12 : -.08),
        y + (randomAt(seed * 17 + i, 382 + layer) - .5) * .3, Math.sin(angle) * r];
    }));
  const crown = [.12, .98, -.13];
  const snowCrown = [crown[0], crown[1] + .14, crown[2]];
  const top = rings[2].map(p => [p[0] * 1.04, p[1] + .13, p[2] * 1.04]);
  const lip = rings[2].map((p, i) => [p[0] * 1.05, p[1] - .02 - randomAt(i, seed + 411) * .14, p[2] * 1.05]);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    for (let layer = 0; layer < 2; layer++) {
      face(rock, rings[layer][i], rings[layer + 1][i], rings[layer][j]);
      face(rock, rings[layer][j], rings[layer + 1][i], rings[layer + 1][j]);
    }
    face(rock, crown, rings[2][j], rings[2][i]);
    face(rock, [0, -.56, 0], rings[0][i], rings[0][j]);
    face(snow, snowCrown, top[j], top[i]);
    face(snow, lip[i], top[i], lip[j]); face(snow, lip[j], top[i], top[j]);
  }
  return { rock: meshGeometry(rock), snow: meshGeometry(snow) };
}

export const alpineRockVariants = Array.from({ length: 4 }, (_, i) => rockVariant(i + 1));
