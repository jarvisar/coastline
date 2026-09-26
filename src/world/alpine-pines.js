import * as THREE from 'three';
import { randomAt } from './route.js';

function geometry(vertices) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}

function fir(seed) {
  const needles = [], snow = [];
  const face = (target, a, b, c) => target.push(...a, ...c, ...b);
  const blend = (a, b, t, lift = 0) => a.map((v, i) => v + (b[i] - v) * t + (i === 1 ? lift : 0));
  for (let layer = 0; layer < 5; layer++) {
    const branches = 5 + (layer + seed) % 2;
    for (let j = 0; j < branches; j++) {
      const id = layer * 13 + j + seed * 109;
      const angle = j / branches * Math.PI * 2 + layer * 2.4 + seed;
      const length = (.29 - layer * .047) * (.77 + randomAt(id, 551) * .38);
      const y = .2 + layer * .16 + (randomAt(id, 552) - .5) * .03;
      const lean = y * .027 * (seed % 2 ? 1 : -1);
      const p = (radius, height, sideways = 0) => [Math.cos(angle) * radius - Math.sin(angle) * sideways + lean,
        height, Math.sin(angle) * radius + Math.cos(angle) * sideways];
      const root = p(0, y + .12), ridge = p(length * .38, y + .075);
      const left = p(length * .7, y - .015, length * .34), right = p(length * .7, y - .015, -length * .34);
      const tip = p(length, y - .052);
      face(needles, root, ridge, left); face(needles, root, right, ridge);
      face(needles, ridge, tip, left); face(needles, ridge, right, tip);
      if (randomAt(id, 553) > .16) {
        const top = blend(root, ridge, .35, .014), crest = blend(root, ridge, .92, .02);
        const a = blend(ridge, left, .7 + randomAt(id, 554) * .18, .012);
        const b = blend(ridge, right, .6 + randomAt(id, 555) * .22, .012);
        const end = blend(ridge, tip, .64 + randomAt(id, 556) * .21, .01);
        face(snow, top, crest, a); face(snow, top, b, crest);
        face(snow, crest, end, a); face(snow, crest, b, end);
      }
    }
  }
  for (let j = 0; j < 5; j++) {
    const a = j * Math.PI * 2 / 5, b = (j + 1) * Math.PI * 2 / 5;
    face(needles, [.025, 1.05, 0], [Math.cos(a) * .055, .8, Math.sin(a) * .055], [Math.cos(b) * .055, .8, Math.sin(b) * .055]);
    face(snow, [.025, 1.06, 0], [Math.cos(a) * .042, .87, Math.sin(a) * .042], [Math.cos(b) * .042, .87, Math.sin(b) * .042]);
  }
  return { needles: geometry(needles), snow: geometry(snow) };
}

export const alpinePines = [fir(1), fir(2)];
