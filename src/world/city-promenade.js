import * as THREE from 'three';
import { CHUNK_LENGTH, randomAt, roadFrame } from './route.js';
import { blockAt, blockBoundary, crossStreetAt, nearStreet, onCrossStreet, STREET_HALF_WIDTH, pavementHeight, quayOffset, QUAY_WALL, RIVER_LEVEL, RIVER_BED } from './city-route.js';
import { cityParkingForBlock, cityParkingAt, cityParkingWidth } from './city-parking.js';
import { buildWaterfrontGarden } from './city-gardens.js';
import { buildWaterfrontPlaces, waterfrontKioskForBlock, buildWaterfrontCafe, quayLifeRing } from './city-waterfront.js';
import { dockRailingSpans } from './city-docks.js';

const STONE = new THREE.Color('#aaa99e'), JOINT = new THREE.Color('#80888b');
const GRASS = ['#6b8058', '#71865e', '#627951'];

// Paving samples the real ground at its corners. Larger props belong to a
// chunk by the global street grid.
export function buildPromenade(chunk) {
  const { details, boxes } = chunk.scenery;
  const end = chunk.start + CHUNK_LENGTH;
  const patch = (s0, s1, u0, u1, color, lift = .022) => {
    const points = [[s0, u0], [s1, u0], [s1, u1], [s0, u1]].map(([s, u]) => {
      const p = chunk.ground(s, u); p.y += lift; return p;
    });
    chunk.quad(details, points, color, [0, 1, 0]);
  };
  const bed = (s0, s1, u0, u1, seed) => {
    const y = Math.min(...[[s0, u0], [s1, u0], [s0, u1], [s1, u1]].map(([s, u]) => chunk.ground(s, u).y));
    chunk.prism(details, s0, s1, u0, u1, y - .12, y + .33, STONE);
    chunk.prism(details, s0 + .3, s1 - .3, u0 + .3, u1 - .3, y + .32, y + .38, new THREE.Color(GRASS[Math.abs(seed) % GRASS.length]));
    return y + .38;
  };

  for (let s = chunk.start; s < end; s += 8) {
    const t = Math.min(s + 8, end), q0 = quayOffset(s), q1 = quayOffset(t);
    const nearCrossing = Math.abs(s - crossStreetAt(s).center) < STREET_HALF_WIDTH;
    if (!nearCrossing) {
      patch(s, s + .055, q0 + 1.4, cityParkingAt(s) ? -cityParkingWidth(s) - .5 : -6.75, JOINT);
      patch(s, s + .055, 6.75, 13.8, JOINT);
    }
    for (const u of [-13.9, -9.2, 9.2]) if (!onCrossStreet(s + 4, u) && !(u < 0 && cityParkingAt(s + 4) && -u < cityParkingWidth(s + 4) + .5)) patch(s, t, u, u + .045, JOINT);
    const street = crossStreetAt(s + 4);
    const spans = nearStreet(street.index) ? [[s, Math.min(t, street.center - STREET_HALF_WIDTH)], [Math.max(s, street.center + STREET_HALF_WIDTH), t]] : [[s, t]];
    for (const [from, to] of spans.flatMap(([a, b]) => b > a ? dockRailingSpans(a, b) : [])) {
      if (to <= from) continue;
      const coping = [[from, -.12], [to, -.12], [to, 1.25], [from, 1.25]]
        .map(([a, offset]) => chunk.at(a, quayOffset(a) + offset, pavementHeight(a) + .075));
      chunk.quad(details, coping, STONE, [0, 1, 0]);
      const riverwalk = (a, b, near, far, color, lift) => chunk.quad(details,
        [[a, near], [b, near], [b, far], [a, far]].map(([t, offset]) => {
          const p = chunk.ground(t, quayOffset(t) + offset); p.y += lift; return p;
        }), color, [0, 1, 0]);
      riverwalk(from, to, 1.3, 3.9, new THREE.Color('#a6a799').multiplyScalar(s % 16 === 0 ? 1 : .96), .038);
      riverwalk(from, to, 3.9, 4.12, STONE, .043);
      riverwalk(from, Math.min(from + .07, to), 1.3, 3.9, JOINT, .044);
    }
    const waterline = (s, q, y) => {
      const height = chunk.ground(s, q).y;
      return chunk.at(s, q - QUAY_WALL * (height - y) / (height - RIVER_BED) - .025, y);
    };
    const wet = [waterline(s, q0, RIVER_LEVEL + .04), waterline(t, q1, RIVER_LEVEL + .04), waterline(t, q1, RIVER_LEVEL + .62), waterline(s, q0, RIVER_LEVEL + .62)];
    chunk.quad(details, wet, new THREE.Color('#596663'), [-1, 0, 0]);
    // Masonry courses on the quay wall, each panel following the sloped face.
    const wallTop = Math.min(pavementHeight(s), pavementHeight(t)) - .24;
    for (let row = 0; RIVER_LEVEL + .72 + row * .95 < wallTop; row++) {
      const low = RIVER_LEVEL + .72 + row * .95, high = Math.min(low + .89, wallTop);
      for (let tile = s - (row % 2) * 2; tile < t; tile += 4) {
        const a = Math.max(s, tile + .035), b = Math.min(t, tile + 3.965);
        if (b <= a) continue;
        const tint = new THREE.Color('#8d8d82').multiplyScalar(.95 + randomAt(tile, 3750 + row) * .09);
        chunk.quad(details, [waterline(a, quayOffset(a), low), waterline(b, quayOffset(b), low),
          waterline(b, quayOffset(b), high), waterline(a, quayOffset(a), high)], tint, [-1, 0, 0]);
      }
    }
    if (s % 16 === 0 && chunk.clearAt(s, q0, 1)) {
      const height = chunk.ground(s, q0).y;
      chunk.prism(details, s - .36, s + .36, q0 - 1.35, q0 + .4, RIVER_LEVEL - .12, height + .1, new THREE.Color('#96968d'));
    }
  }

  // Garden islands keep 6 m clear of every cross street.
  for (let block = blockAt(chunk.start - 80); block <= blockAt(end + 80); block++) {
    if (waterfrontKioskForBlock(block)) continue;
    const from = blockBoundary(block) + STREET_HALF_WIDTH + 6, to = blockBoundary(block + 1) - STREET_HALF_WIDTH - 6;
    const count = Math.max(1, Math.floor((to - from) / 44));
    for (let k = 0; k < count; k++) {
      const s = from + (to - from) * (k + .5) / count, q = quayOffset(s), n = block * 3 + k;
      const parking = cityParkingForBlock(block), shift = parking ? 6 : 0;
      let u0 = Math.max(q + (parking || q < -35 ? 12 : 4.5), -28) - shift;
      const u1 = -14.5 - shift, half = Math.min(11, ((to - from) / count - 8) / 2);
      // Push gardens back behind any waterfront site they would overlap.
      for (const site of chunk.waterfrontSites) if (Math.abs(site.s - s) < site.half + half + 1) u0 = Math.max(u0, site.u1 + 2.4);
      if (!chunk.inChunk(s) || u1 - u0 < 2.2 || !chunk.clearAt(s, (u0 + u1) / 2, half + 2)) continue;
      buildWaterfrontGarden(chunk, s, u0, u1, half, n);
    }
  }

  buildWaterfrontPlaces(chunk);

  // Kiosk props stay low so they don't block the view of the lane.
  for (let block = blockAt(chunk.start - 80); block <= blockAt(end + 80); block++) {
    const site = waterfrontKioskForBlock(block);
    if (!site || !chunk.inChunk(site.s) || !chunk.clearAt(site.s, site.u, 7)) continue;
    const { s, u } = site, yaw = -roadFrame(s).angle;
    patch(s - 5.5, s + 5.5, u - 4.3, u + 4.3, new THREE.Color('#999c94'));
    buildWaterfrontCafe(chunk, site, block);
    chunk.furniture('kiosk', s, u, yaw);
    for (const ds of [-4, 4]) {
      chunk.furniture('bench', s + ds, u - 1.4, yaw);
      bed(s + ds - .8, s + ds + .8, u + 1.4, u + 3, block);
      chunk.tree(s + ds, u + 2.2, 3.8, '#72865b', yaw);
    }
    chunk.furniture('bin', s + 3.6, u - 3, yaw);
  }

  // Pit surrounds come from the placed trees so they can't drift from them.
  for (const items of chunk.scenery.bark.values()) for (const item of items) {
    if (!item.pit) continue;
    const [x, y, z] = item.p;
    const matrixYaw = item.r[1];
    boxes.push({ p: [x, y + .16, z], scale: [1.85, .15, 1.85], r: [0, matrixYaw, 0], color: '#a8a797' });
    boxes.push({ p: [x, y + .25, z], scale: [1.55, .06, 1.55], r: [0, matrixYaw, 0], color: '#536249' });
  }
  // Road drains are built in city-roads, so none are added here.
  for (let n = Math.floor(chunk.start / 80); n * 80 + 24 < end; n++) {
    const s = n * 80 + 24, u = quayOffset(s) + .6;
    if (!chunk.inChunk(s) || !chunk.clearAt(s, u, 2) || dockRailingSpans(s - 1, s + 1).reduce((sum, [a, b]) => sum + b - a, 0) < 2 - 1e-6) continue;
    quayLifeRing(chunk, s, u, pavementHeight(s) + 1.25);
  }
}
