import * as THREE from 'three';
import { randomAt, lerp, smoothstep, clamp, roadHeight } from './route.js';

// Dry ash, oxidised fines and exposed basalt are separate deposits. Their
// colours stay muted so the molten rock remains the brightest part of the scene.
const ash = new THREE.Color('#504b50');
const weathered = new THREE.Color('#62595a');
const basalt = new THREE.Color('#363b45');
const cinder = new THREE.Color('#493d3e');
const shoulder = new THREE.Color('#6c605b');

// Continuous world-space fields: deposits keep their identity through chunk
// boundaries and origin shifts, with smaller patches nested in broad ash beds.
function field(s, u, along, across, salt) {
  const x = s / along, z = u / across, i = Math.floor(x), j = Math.floor(z);
  const a = smoothstep(0, 1, x - i), b = smoothstep(0, 1, z - j);
  return lerp(lerp(randomAt(i, j * 37 + salt), randomAt(i + 1, j * 37 + salt), a),
    lerp(randomAt(i, (j + 1) * 37 + salt), randomAt(i + 1, (j + 1) * 37 + salt), a), b);
}

export function ashDeposit(s, u) {
  return field(s + u * .45, u, 29, 19, 80300) * .68 + field(s, u, 10, 8, 80301) * .32;
}

export function groundColor(p) {
  const d = Math.abs(p.u), deposit = ashDeposit(p.s, p.u);
  const exposed = field(p.s - p.u * .3, p.u, 17, 12, 80302);
  const detail = field(p.s, p.u, 5, 4, 80303);
  const elevation = clamp((p.y - roadHeight(p.s)) / 25, 0, 1);
  const color = ash.clone().lerp(weathered, smoothstep(.36, .75, deposit) * .75);
  color.lerp(basalt, smoothstep(.44, .77, exposed) * (.7 + elevation * .2));
  color.lerp(cinder, (1 - smoothstep(.22, .5, deposit)) * .3);
  // Windblown fines gather beside the tarmac, with an irregular outer edge.
  const edge = 8.2 + field(p.s, Math.sign(p.u) * 5, 13, 10, 80304) * 4;
  const dust = (1 - smoothstep(6.2, edge, d)) * (.7 + deposit * .2);
  color.lerp(shoulder, dust);
  return color.multiplyScalar(.96 + detail * .08);
}

export function shoulderColor(p) {
  return shoulder.clone().lerp(ash, .16 + ashDeposit(p.s, p.u) * .23);
}

export const screeColors = ['#302e32', '#423b3a', '#58504a', '#746454', '#49454a'].map(c => new THREE.Color(c));
export const screeBedColor = new THREE.Color('#332e2e');
