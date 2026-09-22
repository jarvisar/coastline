import * as THREE from 'three';
import { CHUNK_LENGTH, randomAt, roadFrame } from './route.js';
import { blockAt, blockBoundary, quayOffset, STREET_HALF_WIDTH } from './city-route.js';
import { cityParkingForBlock, cityParkingWidth } from './city-parking.js';
import { cityDocks } from './city-docks.js';
import { cityLotClears } from './city-discoveries.js';
import { solidSpan } from './colliders.js';

const STONE = new THREE.Color('#b6b2a0'), WOOD = new THREE.Color('#a68d68');
const IRON = new THREE.Color('#475654'), LEAF = new THREE.Color('#667f56');

export function waterfrontKioskForBlock(block) {
  const s = (blockBoundary(block) + blockBoundary(block + 1)) / 2, q = quayOffset(s);
  return randomAt(block, 3600) < .24 && q < -29 ? { s, u: (q - 12) / 2 } : null;
}

// A few composed rooms along the walk, with generous gaps between them. The
// complete footprint is decided before street furniture or trees are planted.
// Absolute block seeds and center ownership keep both directions and seams stable.
export function waterfrontSiteForBlock(block) {
  if (waterfrontKioskForBlock(block) || randomAt(block, 3740) > .7) return null;
  const from = blockBoundary(block) + STREET_HALF_WIDTH + 7, to = blockBoundary(block + 1) - STREET_HALF_WIDTH - 7;
  const s = (from + to) / 2, half = Math.min(9, (to - from) / 2 - 2);
  if (half < 6) return null;
  const samples = [s - half, s, s + half], parking = cityParkingForBlock(block);
  const u0 = Math.max(...samples.map(quayOffset)) + 4.2;
  const roadEdge = parking ? -Math.max(...samples.map(t => cityParkingWidth(t, parking))) - 3.5 : -11.8;
  const u1 = Math.min(u0 + 7.2, roadEdge);
  if (u1 - u0 < 3.6) return null;
  // Dock stairs retain their approach from the boulevard, not just a gap in
  // the railing. A mooring block remains a quieter planted stretch of the walk.
  if (cityDocks(s - half - 12, s + half + 12).some(site => site.bank === 'near')) return null;
  return { block, s, half, u0, u1, kind: u1 - u0 >= 5 && randomAt(block, 3741) < .58 ? 'pergola' : 'terrace' };
}

export function waterfrontClears(s, u, sites, radius = 0) {
  return sites.every(site => Math.abs(s - site.s) >= site.half + radius || u <= site.u0 - radius || u >= site.u1 + radius);
}

export function reserveCityWaterfront(chunk) {
  const end = chunk.start + CHUNK_LENGTH, sites = [];
  for (let block = blockAt(chunk.start - 40); block <= blockAt(end + 40); block++) {
    const site = waterfrontSiteForBlock(block);
    if (!site || !cityLotClears(site.s - site.half - 1, site.s + site.half + 1, site.u0 - 1, site.u1 + 1, chunk.discoveries)) continue;
    sites.push(site);
    const points = [];
    for (const u of [site.u0, site.u1]) {
      const edge = [];
      for (let k = 0; k <= 6; k++) edge.push(chunk.at(site.s - site.half + site.half * k / 3, u, 0));
      points.push(...(u === site.u0 ? edge : edge.reverse()));
    }
    chunk.planting.reserve(points, .55);
  }
  chunk.waterfrontSites = sites;
  chunk.features.waterfront = sites.filter(site => chunk.inChunk(site.s));
}

// All surfaces, pergola timbers and planters are baked into the promenade.
// Benches share the city's existing instances. There are no new scene objects,
// textures, lights or animation callbacks for these places.
export function buildWaterfrontPlaces(chunk) {
  const target = chunk.scenery.details;
  const patch = (s0, s1, u0, u1, color, lift = .065) => chunk.quad(target,
    [[s0, u0], [s1, u0], [s1, u1], [s0, u1]].map(([s, u]) => {
      const p = chunk.ground(s, u); p.y += lift; return p;
    }), color, [0, 1, 0]);
  function box(s0, s1, u0, u1, low, high, color, solid = false) {
    const y = chunk.ground((s0 + s1) / 2, (u0 + u1) / 2).y;
    chunk.prism(target, s0, s1, u0, u1, y + low, y + high, color);
    if (solid) solidSpan(chunk, chunk.at(s0, (u0 + u1) / 2, 0), chunk.at(s1, (u0 + u1) / 2, 0), (u1 - u0) / 2);
  }
  function planter(s0, s1, u0, u1) {
    box(s0, s1, u0, u1, -.05, .65, STONE, true);
    box(s0 + .14, s1 - .14, u0 + .14, u1 - .14, .65, 1.02, LEAF);
    // One broad flowering ribbon reads as planting, without individual petals.
    if (s1 - s0 > 2 && u1 - u0 > .7) box(s0 + .3, s1 - .3, u0 + .28, u1 - .28, 1.02, 1.12, new THREE.Color('#b5a270'));
  }
  for (const site of chunk.features.waterfront) {
    const { s, half, u0, u1, block, kind } = site, a = s - half, b = s + half;
    const pergola = kind === 'pergola', yaw = -roadFrame(s).angle;
    // Broad boards or slabs with a stone frame and open ends toward the walk.
    const count = Math.ceil(half * 2 / (pergola ? 1 : 2.2));
    for (let k = 0; k < count; k++) {
      const from = a + half * 2 * k / count, to = a + half * 2 * (k + 1) / count;
      const tint = (pergola ? WOOD : STONE).clone().multiplyScalar(.91 + randomAt(block * 31 + k, 3742) * .12);
      patch(from, to - .035, u0, u1, tint);
    }
    for (const u of [u0, u1 - .22]) patch(a, b, u, u + .22, STONE, .075);
    // The seat backs and planting face the boulevard; the open side faces water.
    for (const t of [s - half * .47, s + half * .47]) chunk.furniture('bench', t, u0 + 1.25, yaw, { lift: .065 });
    planter(a + .15, a + 1.25, u0 + 2.4, u1 - .2);
    planter(b - 1.25, b - .15, u0 + 2.4, u1 - .2);
    if (pergola) {
      const left = s - half * .53, right = s + half * .53, front = u0 + .75, back = u1 - 1;
      for (const t of [left, right]) for (const u of [front, back]) {
        box(t - .12, t + .12, u - .12, u + .12, .07, 3.15, WOOD, true);
        box(t - .17, t + .17, u - .17, u + .17, .07, .36, IRON);
      }
      // Open slats preserve the low skyline and give the rain a silhouette.
      for (const u of [front, back]) box(left - .4, right + .4, u - .13, u + .13, 3.02, 3.25, WOOD);
      for (let k = 0; k < 7; k++) {
        const t = left - .25 + (right - left + .5) * k / 6;
        box(t - .09, t + .09, front - .45, back + .45, 3.24, 3.4, WOOD.clone().multiplyScalar(1.08));
      }
      // A small climbing canopy occupies one end, leaving most of the roof open.
      box(right - 2, right + .2, back - .9, back + .35, 3.4, 3.64, LEAF);
    } else {
      // Long, low seat walls give the simpler lookout a different silhouette.
      box(s - 2.7, s + 2.7, u1 - .9, u1 - .18, .03, .5, STONE, true);
      box(s - 2.8, s + 2.8, u1 - 1, u1 - .08, .5, .61, WOOD);
      planter(s - 2.2, s + 2.2, u1 - .65, u1 - .25);
    }
    chunk.furniture('bin', b - 1.8, u0 + .8, yaw, { lift: .065 });
  }
}

export function buildWaterfrontCafe(chunk, site, seed) {
  const { s, u } = site, target = chunk.scenery.details;
  const front = Math.max(u - 7.1, ...[s - 5.5, s, s + 5.5].map(t => quayOffset(t) + 4.3));
  if (u - front < 4.5) return;
  const ground = (s, u, lift) => { const p = chunk.ground(s, u); p.y += lift; return p; };
  for (let k = 0; k < 5; k++) {
    const a = s - 5.5 + k * 2.2;
    chunk.quad(target, [[a, front], [a + 2.16, front], [a + 2.16, u - 2.3], [a, u - 2.3]].map(([s, u]) => ground(s, u, .045)),
      STONE.clone().multiplyScalar(k % 2 ? .92 : 1), [0, 1, 0]);
  }
  const tableU = front + 1.8, color = new THREE.Color(randomAt(seed, 3744) < .5 ? '#638d83' : '#b58e67');
  for (const [index, t] of [s - 3.6, s + 3.6].entries()) {
    const y = chunk.ground(t, tableU).y;
    chunk.prism(target, t - .1, t + .1, tableU - .1, tableU + .1, y, y + .85, IRON);
    chunk.prism(target, t - .72, t + .72, tableU - .65, tableU + .65, y + .8, y + .94, WOOD);
    solidSpan(chunk, chunk.at(t - .72, tableU, 0), chunk.at(t + .72, tableU, 0), .65);
    for (const side of [-1, 1]) {
      const v = tableU + side * 1.2;
      chunk.prism(target, t - .32, t + .32, v - .25, v + .25, y, y + .46, IRON);
      chunk.prism(target, t - .38, t + .38, v - .31, v + .31, y + .46, y + .55, WOOD);
      solidSpan(chunk, chunk.at(t - .38, v, 0), chunk.at(t + .38, v, 0), .31);
    }
    if (index !== 0) continue;
    // Eight broad fabric facets give the coffee stand a recognizable silhouette.
    chunk.prism(target, t - .055, t + .055, tableU - .055, tableU + .055, y + .9, y + 3.1, STONE);
    const peak = chunk.at(t, tableU, y + 3.2), radius = 1.65;
    for (let k = 0; k < 8; k++) {
      const angle = k * Math.PI / 4, next = (k + 1) * Math.PI / 4;
      const a = chunk.at(t + Math.cos(angle) * radius, tableU + Math.sin(angle) * radius, y + 2.72);
      const b = chunk.at(t + Math.cos(next) * radius, tableU + Math.sin(next) * radius, y + 2.72);
      const tint = k % 2 ? color : color.clone().lerp(STONE, .3);
      chunk.quad(target, [a, b, peak, peak], tint, [0, 1, 0]);
      chunk.quad(target, [{ ...a, y: a.y - .18 }, { ...b, y: b.y - .18 }, b, a], tint, [Math.sin(angle + Math.PI / 8), 0, -Math.cos(angle + Math.PI / 8)]);
    }
  }
}

// A simple nautical accent, built as an eight-sided ring against its cabinet.
// It uses the same opaque vertex-colour batch as the masonry around it.
export function quayLifeRing(chunk, s, u, y, facing = -1) {
  const target = chunk.scenery.details, cream = new THREE.Color('#d4cbb1'), orange = new THREE.Color('#b9714c');
  chunk.prism(target, s - .52, s + .52, u - .12, u + .12, y - .61, y + .61, IRON);
  const point = (angle, r) => chunk.at(s + Math.cos(angle) * r, u + facing * .145, y + Math.sin(angle) * r);
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, b = (k + 1) * Math.PI / 4;
    chunk.quad(target, [point(a, .43), point(b, .43), point(b, .25), point(a, .25)], k % 2 ? cream : orange, [facing, 0, 0]);
  }
}
