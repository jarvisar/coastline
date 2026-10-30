import * as THREE from 'three';
import { CHUNK_LENGTH, randomAt } from './route.js';
import { alpineForest, alpineStretch, snowPosition, snowGroundHeight } from './snow-route.js';

const NEEDLES = ['#1f3933', '#26443b', '#1b332f', '#2c4a40'].map(color => new THREE.Color(color));
const SNOW = new THREE.Color('#c7d2df'), TRUNK = new THREE.Color('#3a3e49');

// Three stacked five-sided cones with closed undersides, so the forest needs
// no double-sided material. Snow covers the upper half of each tier, which
// reads as white rings from above and dark skirts from the road.
function forestFir(seed) {
  const positions = [], parts = [];
  const face = (a, b, c, part, hint) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (normal[0] * hint[0] + normal[1] * hint[1] + normal[2] * hint[2] < 0) [b, c] = [c, b];
    positions.push(...a, ...b, ...c); parts.push(part);
  };
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2, b = (i + 1) / 3 * Math.PI * 2, r = .035;
    const p = (angle, y) => [Math.cos(angle) * r, y, Math.sin(angle) * r];
    const out = [Math.cos(a + 1), 0, Math.sin(a + 1)];
    face(p(a, -.1), p(b, -.1), p(a, .3), 0, out); face(p(b, -.1), p(b, .3), p(a, .3), 0, out);
  }
  const lean = (randomAt(seed, 571) - .5) * .05;
  for (let tier = 0; tier < 3; tier++) {
    const bottom = .13 + tier * .23, top = tier === 2 ? 1 : bottom + .45, radius = .35 - tier * .09;
    const turn = randomAt(seed * 3 + tier, 572) * Math.PI * 2, apex = [lean * (tier + 1) / 3, top, 0];
    const ring = Array.from({ length: 5 }, (_, j) => {
      const angle = turn + j / 5 * Math.PI * 2, r = radius * (.84 + randomAt(seed * 17 + tier * 5 + j, 573) * .3);
      return [Math.cos(angle) * r, bottom + (randomAt(seed * 17 + tier * 5 + j, 574) - .5) * .04, Math.sin(angle) * r];
    });
    const coat = ring.map(p => [apex[0] + (p[0] - apex[0]) * .6, apex[1] + (p[1] - apex[1]) * .6 + .012, apex[2] + (p[2] - apex[2]) * .6]);
    const crest = [apex[0], apex[1] + .012, apex[2]];
    for (let j = 0; j < 5; j++) {
      const k = (j + 1) % 5, out = [ring[j][0] + ring[k][0], .3, ring[j][2] + ring[k][2]];
      face(apex, ring[j], ring[k], 1, out);
      // A bare face here and there keeps the coats from looking stamped.
      if (randomAt(seed * 31 + tier * 5 + j, 575) > .14) face(crest, coat[j], coat[k], 2, out);
    }
    for (let j = 1; j < 4; j++) face(ring[0], ring[j], ring[j + 1], 1, [0, -1, 0]);
  }
  return { positions, parts };
}

const FIRS = [forestFir(1), forestFir(2), forestFir(3)];

// Heights of a triangle soup (flat x, y, z positions), so trunks meet the mesh
// even where it departs from the height function between vertices.
export function surfaceHeights(position) {
  const cells = new Map(), size = 8, key = (x, z) => `${x},${z}`;
  for (let i = 0; i < position.length; i += 9) {
    const xs = [position[i], position[i + 3], position[i + 6]], zs = [position[i + 2], position[i + 5], position[i + 8]];
    for (let x = Math.floor(Math.min(...xs) / size); x <= Math.floor(Math.max(...xs) / size); x++) {
      for (let z = Math.floor(Math.min(...zs) / size); z <= Math.floor(Math.max(...zs) / size); z++) {
        if (!cells.has(key(x, z))) cells.set(key(x, z), []);
        cells.get(key(x, z)).push(i);
      }
    }
  }
  return (px, pz) => {
    let height = null;
    for (const i of cells.get(key(Math.floor(px / size), Math.floor(pz / size))) ?? []) {
      const ax = position[i], az = position[i + 2], bx = position[i + 3], bz = position[i + 5], cx = position[i + 6], cz = position[i + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (!d) continue;
      const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
      if (w0 < -.001 || w1 < -.001 || w0 + w1 > 1.001) continue;
      const y = w0 * position[i + 1] + w1 * position[i + 4] + (1 - w0 - w1) * position[i + 7];
      if (height === null || y > height) height = y;
    }
    return height;
  };
}

// Adds one fir, standing on `base`, to a vertex-coloured triangle soup.
const color = new THREE.Color();
export function plantFir(target, x, base, z, tall, seed) {
  const fir = FIRS[Math.floor(randomAt(seed, 5805) * FIRS.length)];
  const width = tall * (.78 + randomAt(seed, 5806) * .22), angle = randomAt(seed, 5807) * Math.PI * 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const needles = NEEDLES[Math.floor(randomAt(seed, 5808) * NEEDLES.length)], snow = .93 + randomAt(seed, 5809) * .08;
  for (let i = 0; i < fir.parts.length; i++) {
    const part = fir.parts[i];
    if (part === 2) color.copy(SNOW).multiplyScalar(snow); else color.copy(part ? needles : TRUNK);
    for (let j = i * 9; j < i * 9 + 9; j += 3) {
      const px = fir.positions[j], py = fir.positions[j + 1], pz = fir.positions[j + 2];
      target.positions.push(x + (px * cos - pz * sin) * width, base + py * tall, z + (px * sin + pz * cos) * width);
      target.colors.push(color.r, color.g, color.b);
    }
  }
}

// Fills the chunk's slopes with fir groves and forest, as one vertex-coloured
// triangle soup. `clear(s, u, radius)` rules out lake, cabins, discoveries
// and landmarks.
export function buildAlpineForest(chunk, clear) {
  const height = surfaceHeights(chunk.terrain.geometry.attributes.position.array);
  const target = { positions: [], colors: [] };
  for (const [side, from, to, cell] of [['lake', -120, -12, 4.2], ['mountain', 12, 150, 4.8]]) {
    for (let row = 0; row < CHUNK_LENGTH / cell; row++) for (let col = Math.floor(from / cell); col < to / cell; col++) {
      const seed = Math.floor(chunk.start / cell) + row, salt = col * 7 + (side === 'lake' ? 0 : 3);
      const s = chunk.start + (row + .1 + randomAt(seed, salt + 5801) * .8) * cell;
      const u = (col + .1 + randomAt(seed, salt + 5802) * .8) * cell;
      if (s >= chunk.start + CHUNK_LENGTH) continue;
      const stretch = alpineStretch(s), density = alpineForest(s, u, stretch);
      if (randomAt(seed, salt + 5803) >= density) continue;
      const tall = (5.5 + randomAt(seed, salt + 5804) * 6.5) * (.8 + stretch.forest * .3), radius = tall * .3;
      if (!clear(s, u, radius)) continue;
      const p = snowPosition(s, u, 0), z = p.z + chunk.start;
      // Skip risers: the trunk would hang off one side. Samples past the
      // chunk's own terrain are left out, so seams don't leave a bare row.
      const ground = [[0, 0], [radius * .6, 0], [-radius * .6, 0], [0, radius * .6], [0, -radius * .6]]
        .map(([dx, dz]) => height(p.x + dx, z + dz)).filter(y => y !== null);
      if (!ground.length) ground.push(snowGroundHeight(s, u));
      const low = Math.min(...ground);
      if (Math.max(...ground) - low > radius * .9) continue;
      plantFir(target, p.x, low - .15, z, tall, Math.floor(randomAt(seed, salt + 5810) * 1e9));
    }
  }
  return target;
}
