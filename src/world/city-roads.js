import * as THREE from 'three';
import { CHUNK_LENGTH, roadFrame, randomAt } from './route.js';
import { blockAt, blockBoundary, crossStreetAt, nearStreet, bankStreetRange, cityStreetYaw, quayOffset, cityGroundHeight, cityRoadHeight, cityStreetHeight, pavementHeight, bridgeSurfaceHeight,
  SIDE_ROAD_HALF_WIDTH, STREET_HALF_WIDTH, BANK_ROADS, INLAND_ROADS, FAR_BANK_TOP, RIVER_BED } from './city-route.js';
import { cityDiscoveryClears } from './city-discoveries.js';

const ASPHALT = new THREE.Color('#4d5155'), WALK = new THREE.Color('#93979b'), KERB = new THREE.Color('#a4a7a9');
const WHITE = new THREE.Color('#c6cac1'), YELLOW = new THREE.Color('#bda041'), CONCRETE = new THREE.Color('#868b87');
const DECK_HALF = STREET_HALF_WIDTH, ROAD_HALF = SIDE_ROAD_HALF_WIDTH;
const groundHeight = cityStreetHeight;
const WALK_LIFT = .095;

// Split at actual junction edges, including when they fall inside a chunk.
// Midpoint-only skips leave four-metre notches and kerbs across the road.
function intervals(from, to, boundaries) {
  const cuts = [from, to, ...boundaries.filter(n => n > from && n < to)];
  for (let n = Math.ceil(from / 4) * 4; n < to; n += 4) cuts.push(n);
  const sorted = [...new Set(cuts)].sort((a, b) => a - b);
  return sorted.slice(1).map((n, i) => [sorted[i], n]);
}

export function crossRoadHeight(s, u, crossing) {
  return crossing && u >= FAR_BANK_TOP - 2 && u <= quayOffset(s) + 1.5 ? bridgeSurfaceHeight(s, u) : groundHeight(s, u);
}

// All the secondary roads share one asphalt/marking mesh. Their sidewalks
// and bridge masonry join the promenade batch; railings reuse the box batch.
export function buildCityRoads(chunk) {
  const { streets, details, boxes } = chunk.scenery, end = chunk.start + CHUNK_LENGTH;
  function patch(target, s0, s1, u0, u1, color, height = groundHeight, lift = 0) {
    s0 = Math.max(s0, chunk.start); s1 = Math.min(s1, end);
    if (s1 <= s0 || u1 <= u0) return;
    // Subdivision follows the same curved frame as the buildings and terrain.
    const step = Math.max(Math.abs(u0), Math.abs(u1)) <= 8 ? 2 : 4;
    for (let s = s0; s < s1;) {
      const t = Math.min(Math.floor(s / step) * step + step, s1);
      chunk.quad(target, [[s, u0], [t, u0], [t, u1], [s, u1]].map(([a, b]) => chunk.at(a, b, height(a, b) + lift)), color, [0, 1, 0]);
      s = t;
    }
  }

  function laneArrow(s, u, direction, height = groundHeight, lift = .028) {
    if (!chunk.inChunk(s)) return;
    const point = (along, across) => chunk.at(s + along * direction, u + across, height(s + along * direction, u + across) + lift);
    chunk.quad(streets, [point(-1.8, -.17), point(.55, -.17), point(.55, .17), point(-1.8, .17)], WHITE, [0, 1, 0]);
    const tip = point(1.7, 0);
    chunk.quad(streets, [point(.35, -.85), point(.35, .85), tip, tip], WHITE, [0, 1, 0]);
  }

  const roads = [...INLAND_ROADS, ...BANK_ROADS.map(u => ({ u, halfWidth: ROAD_HALF }))];
  const landDiscoveries = chunk.discoveries.filter(site => site.kind !== 'river-bridge');
  const first = blockAt(chunk.start - 24), last = blockAt(end + 24) + 1;
  const centers = Array.from({ length: last - first + 1 }, (_, i) => blockBoundary(first + i));
  // Quiet asphalt repairs and slotted kerb drains add scale close to the car.
  // Flush, opaque polygons share the existing road batch and never add solids.
  const repair = new THREE.Color('#55595b'), drain = new THREE.Color('#333e43'), slots = new THREE.Color('#707a7b');
  for (let n = Math.floor((chunk.start - 3) / 32); n * 32 < end + 3; n++) {
    const s = n * 32 + 5;
    if (Math.abs(s - crossStreetAt(s).center) < 18) continue;
    for (const side of [-1, 1]) {
      const u = side * 5.65;
      patch(streets, s - .65, s + .65, u - .2, u + .2, drain, cityRoadHeight, .092);
      for (let k = 0; k < 4; k++) patch(streets, s - .48 + k * .29, s - .4 + k * .29, u - .17, u + .17, slots, cityRoadHeight, .095);
    }
    if (randomAt(n, 3656) < .42) {
      const u = randomAt(n, 3657) < .5 ? -2.8 : 2.8;
      patch(streets, s - 2.2, s + .8, u - .7, u + .6, repair, cityRoadHeight, .084);
    }
  }
  for (const { u, halfWidth: w } of roads) {
    const walk = u > 0 && u < 100 ? 1 : 2.5;
    const boundaries = centers.flatMap(s => [s - ROAD_HALF, s + ROAD_HALF, s - 9, s + 9]);
    for (const [s, t] of intervals(chunk.start, end, boundaries)) {
      const mid = (s + t) / 2, crossStreet = crossStreetAt(mid), distance = Math.abs(mid - crossStreet.center);
      const range = u < 0 ? bankStreetRange(crossStreet.index) : { from: 5.5, to: 160 };
      if (!cityDiscoveryClears(mid, u, landDiscoveries, w)) continue;
      const meetsStreet = u >= range.from && u <= range.to, junction = meetsStreet && distance < ROAD_HALF;
      patch(streets, s, t, u - w, u + w, ASPHALT);
      for (const side of [-1, 1]) {
        // The closed side of a T junction keeps its pavement and edge line.
        // In particular a river-facing kerb must never open into the water.
        const armExists = side < 0 ? u > range.from : u < range.to;
        if (junction && armExists) continue;
        const edge = u + side * w;
        patch(details, s, t, side < 0 ? edge - walk : edge, side < 0 ? edge : edge + walk, WALK, groundHeight, WALK_LIFT);
        patch(details, s, t, edge - .1, edge + .1, KERB, groundHeight, WALK_LIFT + .004);
        if (w > 3) patch(streets, s, t, u + side * (w - .45) - .065, u + side * (w - .45) + .065, WHITE, groundHeight, .014);
      }
      if (w > 3 && (!meetsStreet || distance > 9) && Math.floor(mid / 4) % 2 === 0) patch(streets, s, Math.min(s + 3.6, t), u - .08, u + .08, YELLOW, groundHeight, .017);
    }
  }

  for (let index = first; index <= last; index++) {
    const s = blockBoundary(index), crossing = nearStreet(index);
    if (s + STREET_HALF_WIDTH < chunk.start || s - STREET_HALF_WIDTH > end) continue;
    const height = (t, u) => crossRoadHeight(t, u, crossing);
    const bankRange = bankStreetRange(index), ranges = [[5.5, 160], [bankRange.from, bankRange.to]];
    for (const direction of [-1, 1]) {
      const approach = s - direction * 21;
      laneArrow(approach, direction * 2.8, direction, cityRoadHeight, .092);
      const stop = s - direction * 13.5, u = direction * 2.8;
      patch(streets, stop - .17, stop + .17, u - 2.2, u + 2.2, WHITE, cityRoadHeight, .092);
      for (const avenue of BANK_ROADS.slice(0, 2)) {
        if (avenue < bankRange.from || avenue > bankRange.to) continue;
        laneArrow(s - direction * 15, avenue + direction * 2.6, direction);
      }
    }
    const boundaries = roads.flatMap(road => [road.u - road.halfWidth, road.u + road.halfWidth, road.u - 9, road.u + 9]);
    boundaries.push(-14, -8, 8, 14, FAR_BANK_TOP - 2, quayOffset(s) + 1.5);
    for (const [from, to] of ranges) {
      for (const [u, v] of intervals(from, to, boundaries)) {
        const mid = (u + v) / 2;
        const junction = roads.some(road => Math.abs(mid - road.u) < road.halfWidth);
        const mouth = Math.abs(mid) < 8;
        if (!junction) patch(streets, s - (mouth ? DECK_HALF : ROAD_HALF), s + (mouth ? DECK_HALF : ROAD_HALF), u, v, ASPHALT, height);
        for (const side of [-1, 1]) {
          const edge = s + side * ROAD_HALF;
          if (!junction && !mouth) {
            patch(details, side < 0 ? s - DECK_HALF : edge, side < 0 ? edge : s + DECK_HALF, u, v, WALK, height, WALK_LIFT);
            patch(details, edge - .1, edge + .1, u, v, KERB, height, WALK_LIFT + .004);
            patch(streets, s + side * (ROAD_HALF - .45) - .065, s + side * (ROAD_HALF - .45) + .065, u, v, WHITE, height, .014);
          }
        }
        const nearCrossing = Math.abs(mid) < 14 || roads.some(road => Math.abs(mid - road.u) < 9);
        if (!junction && !nearCrossing && Math.floor(mid / 4) % 2 === 0) patch(streets, s - .08, s + .08, u, Math.min(u + 3.6, v), YELLOW, height, .018);
      }
    }
    // Chamfered pavement corners turn the boulevard kerb into each side
    // street. The walking surface stays at the promenade's existing level.
    for (const direction of crossing ? [-1, 1] : [1]) for (const side of [-1, 1]) {
      // Cover the terrain row beside the road cut, so the new sidewalk
      // meets the existing promenade without a sunken strip at its back.
      const from = direction > 0 ? 6.7 : Math.max(quayOffset(s - 16), quayOffset(s), quayOffset(s + 16)) + 1.25;
      const to = direction > 0 ? 13.8 : -6.7;
      for (const [u, v] of intervals(from, to, [])) {
        patch(details, s + (side < 0 ? -16 : 8), s + (side < 0 ? -8 : 16), u, v, WALK, cityGroundHeight, .022);
      }
      const outer = [[8, 6.05], [8, 8], [5.5, 8], [6.7, 6.05]];
      const point = ([ds, u], lift = .02) => chunk.at(s + side * ds, direction * u, pavementHeight(s + side * ds) + lift);
      // Boundary centers and the corner extent are terrain-row aligned, so
      // a corner belongs entirely to one side of a chunk seam.
      if (!chunk.inChunk(s + side * 4)) continue;
      chunk.quad(details, outer.map(p => point(p)), WALK, [0, 1, 0]);
      const a = [6.7, 6.05], b = [5.5, 8], c = [5.72, 8], d = [6.92, 6.05];
      chunk.quad(details, [a, b, c, d].map(p => point(p, .024)), KERB, [0, 1, 0]);
      chunk.quad(details, [point(a, .024), point(b, .024), point(b, -.075), point(a, -.075)], KERB, [-direction, 0, side]);
    }
    // Crosswalks across the side streets make the boulevard footpaths
    // continuous; stop bars sit just behind them in the approaching lane.
    for (const u of crossing ? [10.5, -10.5] : [10.5]) {
      for (let k = 0; k < 8; k++) patch(streets, s - 4.9 + k * 1.28, s - 4.23 + k * 1.28, u - 1.2, u + 1.2, WHITE, height, .022);
      patch(streets, u > 0 ? s - 4.9 : s + .4, u > 0 ? s - .4 : s + 4.9, u + Math.sign(u) * 2.4 - .16, u + Math.sign(u) * 2.4 + .16, WHITE, height, .023);
    }

    // Match the boulevard's zebra crossings on the opposite bank. The
    // waterfront and outer avenue have T junctions where a street terminates;
    // paint only the arms that actually exist, including bridge approaches.
    for (const u of BANK_ROADS) {
      if (u < bankRange.from || u > bankRange.to) continue;
      for (const side of [-1, 1]) {
        const along = s + side * 6.7;
        for (let k = 0; k < 8; k++) patch(streets, along - 1, along + 1, u - 4.9 + k * 1.28, u - 4.23 + k * 1.28, WHITE, groundHeight, .024);
        const armExists = side < 0 ? u > bankRange.from : u < bankRange.to;
        if (!armExists) continue;
        const across = u + side * 6.7;
        for (let k = 0; k < 8; k++) patch(streets, s - 4.9 + k * 1.28, s - 4.23 + k * 1.28, across - 1, across + 1, WHITE, height, .024);
      }
    }

    if (!crossing) continue;
    const near = quayOffset(s) + 1.5, far = FAR_BANK_TOP - 2;
    // The bridge deck and road use exactly the same height profile. Clip
    // deck faces at chunk seams, while one owner builds each set of supports.
    for (let u = far; u < near; u += 4) {
      const v = Math.min(u + 4, near);
      patch(details, s - DECK_HALF, s + DECK_HALF, u, v, CONCRETE, height, -.02);
      const a = Math.max(s - DECK_HALF, chunk.start), b = Math.min(s + DECK_HALF, end);
      if (b <= a) continue;
      for (const side of [-1, 1]) {
        const edge = s + side * DECK_HALF;
        if (edge < chunk.start || edge >= end) continue;
        chunk.quad(details, [chunk.at(edge, u, height(edge, u) - .68), chunk.at(edge, v, height(edge, v) - .68), chunk.at(edge, v, height(edge, v) + WALK_LIFT), chunk.at(edge, u, height(edge, u) + WALK_LIFT)], CONCRETE, [0, 0, -side]);
      }
      chunk.quad(details, [[a, u], [a, v], [b, v], [b, u]].map(([t, offset]) => chunk.at(t, offset, height(t, offset) - .68)), CONCRETE.clone().multiplyScalar(.7), [0, -1, 0]);
    }
    if (!chunk.inChunk(s)) continue;
    chunk.features.bridges.push({ street: index, s, near, far, halfWidth: ROAD_HALF, deckHalfWidth: DECK_HALF });
    for (const side of [-1, 1]) {
      const edge = s + side * (DECK_HALF - .3);
      const landing = quayOffset(edge) + .55;
      const railPoint = (u, lift = 0) => chunk.at(edge, u, height(edge, u) + WALK_LIFT + lift);
      for (let u = far; u < landing; u += 4) {
        const v = Math.min(u + 4, landing);
        const base = railPoint(u), top = railPoint(u, 1.04);
        chunk.beam(boxes, base, top, .085, '#414b4d');
        for (const lift of [.5, 1.02]) chunk.beam(boxes, railPoint(u, lift), railPoint(v, lift), .075, '#414b4d');
      }
      chunk.beam(boxes, railPoint(landing), railPoint(landing, 1.04), .085, '#414b4d');
    }
    for (let u = far + 13; u < near - 8; u += 26) {
      const deckY = height(s, u);
      chunk.prism(details, s - 4.6, s + 4.6, u - 1.25, u + 1.25, RIVER_BED - .4, deckY - .62, CONCRETE.clone().multiplyScalar(.91));
      for (const side of [-1, 1]) {
        const t = s + side * 6.8;
        chunk.furniture('lamp', t, u, -roadFrame(s).angle + side * Math.PI / 2, { lift: height(t, u) + WALK_LIFT - chunk.ground(t, u).y });
      }
    }
  }

  // The opposite bank is a neighbourhood, with lamps and occasional parked
  // cars along its waterfront avenue and the street behind the wharf blocks.
  for (const u of BANK_ROADS.slice(0, 2)) {
    for (let n = Math.floor(chunk.start / 28); n * 28 + 7 < end; n++) {
      const s = n * 28 + 7;
      if (!chunk.inChunk(s) || Math.abs(s - crossStreetAt(s).center) < STREET_HALF_WIDTH + 4) continue;
      chunk.furniture('lamp', s, u + 6.7, cityStreetYaw(s, u), { lift: groundHeight(s, u + 6.7) + WALK_LIFT - chunk.ground(s, u + 6.7).y });
      if (randomAt(n, Math.abs(u) + 3651) < .38) chunk.parkedCar(s, u - 4.15, cityStreetYaw(s, u), n * 13 + Math.abs(u), .075);
    }
  }
}
