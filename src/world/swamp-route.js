import { roadFrame, positionAt, randomAt, smoothstep, lerp } from './route.js';
import { swampClearing, swampPad } from './swamp-discoveries.js';

export const SWAMP_STEP = 4;
// The whole basin shares one still water level. The causeway sits a little above it.
export const WATER_LEVEL = 0;

// Smooth 2D value noise.
export function swampNoise(s, u, span, salt) {
  const cs = Math.floor(s / span), cu = Math.floor(u / span);
  const ts = smoothstep(0, 1, s / span - cs), tu = smoothstep(0, 1, u / span - cu);
  const at = (i, j) => randomAt(i * 1031 + j, salt);
  return lerp(lerp(at(cs, cu), at(cs + 1, cu), ts), lerp(at(cs, cu + 1), at(cs + 1, cu + 1), ts), tu);
}
export function swampRibbon(s, span, salt) {
  const cell = Math.floor(s / span), t = smoothstep(0, 1, s / span - cell);
  return lerp(randomAt(cell, salt), randomAt(cell + 1, salt), t);
}

// Bayou channels cross under a short concrete bridge at world-space intervals.
export const BAYOU_SPACING = 1152;
export function swampBridgeAt(s) {
  const index = Math.round((s - 640) / BAYOU_SPACING);
  const center = 640 + index * BAYOU_SPACING + Math.round((randomAt(index, 3001) - .5) * 160);
  const lean = (randomAt(index, 3002) - .5) * .5, width = 11 + randomAt(index, 3003) * 4;
  const half = Math.ceil(width + 8);
  return { index, center, lean, width, half, start: center - half, end: center + half };
}
export function bayouCenter(bridge, u) {
  return bridge.center + u * bridge.lean * smoothstep(0, 40, Math.abs(u)) + 9 * Math.sin(u / 57 + bridge.index) * smoothstep(10, 60, Math.abs(u)) + 3 * Math.sin(u / 23 - bridge.index);
}
export function bayouHalfWidth(bridge, u) {
  return bridge.width + 5 * Math.sin(u / 71 + bridge.index * 1.7) ** 2 * smoothstep(20, 80, Math.abs(u)) + Math.abs(u) * .03;
}
// 1 in the open channel, fading to 0 across its reedy banks.
export function bayouAmount(s, u) {
  const bridge = swampBridgeAt(s);
  if (Math.abs(s - bridge.center) > 260) return 0;
  const distance = Math.abs(s - bayouCenter(bridge, u)), half = bayouHalfWidth(bridge, u);
  return 1 - smoothstep(half * .7, half + 16, distance);
}
// 1 between the abutments, where the deck spans open water.
export function bridgeSpan(s) {
  const bridge = swampBridgeAt(s);
  return 1 - smoothstep(bridge.half - 6, bridge.half - 2, Math.abs(s - bridge.center));
}
export function onBridge(s, margin = 0) {
  const bridge = swampBridgeAt(s);
  return Math.abs(s - bridge.center) < bridge.half + margin;
}

const phase = [randomAt(0, 3011) * Math.PI * 2, randomAt(1, 3011) * Math.PI * 2];
// Nearly level, with a gentle rise over each bridge.
export function swampRoadHeight(s) {
  const bridge = swampBridgeAt(s), hump = 1 - smoothstep(bridge.half - 4, bridge.half + 55, Math.abs(s - bridge.center));
  return 2.45 + .22 * Math.sin(s / 233 + phase[0]) + .12 * Math.sin(s / 97 + phase[1]) + 1.05 * smoothstep(0, 1, hump);
}
export const swampFrame = s => ({ ...roadFrame(s), y: swampRoadHeight(s) });

// Waterline distance from the centre line for each side of the causeway.
export function bankEdge(s, side) {
  return 11.1 + 1.4 * swampRibbon(s, 23, side > 0 ? 3031 : 3032) + .5 * Math.sin(s / 7.3 + side);
}

// 0 to 1. Land where it clears the water.
export function islandField(s, u) {
  const a = Math.abs(u);
  let n = swampNoise(s, u, 71, 3101) * .52 + swampNoise(s, u, 31, 3102) * .3 + swampNoise(s + 13, u, 13, 3103) * .18;
  // Open water beside the causeway and more forest farther out.
  n += -.17 * (1 - smoothstep(15, 46, a)) + .06 * smoothstep(110, 240, a);
  n -= .55 * bayouAmount(s, u);
  // Clear water round the camps' stilts and the other landmarks.
  return n - swampClearing(s, u);
}
export const ISLAND_THRESHOLD = .56;
export function swampFloor(s, u) {
  const n = islandField(s, u);
  const land = smoothstep(ISLAND_THRESHOLD - .09, ISLAND_THRESHOLD + .13, n);
  return lerp(-2.1, 1.05, land) + (swampNoise(s, u, 6, 3104) - .5) * .4 * land;
}

// Road, verge, riprap then the swamp floor. The profile is by distance from the
// centre line so both sides of the causeway share it.
function embankment(s, u) {
  const a = Math.abs(u), side = Math.sign(u) || 1, road = swampRoadHeight(s), bank = bankEdge(s, side);
  if (a <= 7) return road;
  if (a <= 8.4) return lerp(road - .05, road - .32, (a - 7) / 1.4);
  if (a <= 9.8) return lerp(road - .32, road - 1.05, (a - 8.4) / 1.4);
  if (a <= bank) return lerp(road - 1.05, WATER_LEVEL + .12, (a - 9.8) / (bank - 9.8));
  if (a <= bank + 1.8) return lerp(WATER_LEVEL + .12, -1, (a - bank) / 1.8);
  return -1 - smoothstep(bank + 1.8, bank + 6, a) * 1.1;
}
// Physical ground, below the bridge decks too. The chapel's fill meets the
// verge, so the road itself is never raised.
export function swampGround(s, u) {
  const floor = swampFloor(s, u), a = Math.abs(u);
  let height = a < 22 ? Math.max(embankment(s, u), floor) : floor;
  const pad = a > 7 ? swampPad(s, u) : null;
  if (pad) height = Math.max(height, lerp(height, pad.level, pad.amount));
  const span = a < 30 ? bridgeSpan(s) : 0;
  if (span > 0) height = lerp(height, Math.min(height, -2.2 + smoothstep(10, 30, a) * .3), span);
  return height;
}
// The driving surface: bridge decks where they span the water.
export function swampHeight(s, u) {
  if (Math.abs(u) <= 6.4 && onBridge(s)) return swampRoadHeight(s);
  return swampGround(s, u);
}
export const swampPosition = (s, u, y = swampHeight(s, u)) => positionAt(s, u, y);

export function swampColumns(s) {
  const near = bankEdge(s, -1), far = bankEdge(s, 1);
  const left = [-7, -8.4, -9.8, -near, -near - 1.8, -near - 4];
  for (let u = -19; u > -120; u -= 5) left.push(u);
  for (let u = -122; u > -210; u -= 8) left.push(u);
  for (let u = -214; u >= -440; u -= 14) left.push(u);
  const right = [7, 8.4, 9.8, far, far + 1.8, far + 4];
  for (let u = 19; u < 120; u += 5) right.push(u);
  for (let u = 122; u < 210; u += 8) right.push(u);
  for (let u = 214; u <= 500; u += 14) right.push(u);
  return [...left.reverse(), 0, ...right];
}
export const SWAMP_COLUMN_COUNT = swampColumns(0).length;
export function swampVertex(row, column) {
  const baseS = row * SWAMP_STEP, base = swampColumns(baseS)[column];
  const loose = Math.abs(base) > 17;
  // Jitter outside the causeway keeps the islands from following rows and columns.
  const s = baseS + (loose ? (randomAt(row, column + 3201) - .5) * 2.6 : 0);
  const columns = swampColumns(s);
  const gap = Math.min(columns[column] - (columns[column - 1] ?? columns[column] - 40), (columns[column + 1] ?? columns[column] + 40) - columns[column]);
  const u = columns[column] + (loose ? (randomAt(row, column + 3202) - .5) * gap * .8 : 0);
  const p = positionAt(s, u, swampGround(s, u));
  return { ...p, s, u, column };
}

// Water everywhere past the waterline, bridges included. The limits stay on
// ground free driving can reach, short of the riprap and the parapets.
export const swampDrivingRoute = {
  frame: swampFrame, position: swampPosition, height: swampHeight, bridge: swampBridgeAt,
  bounds: s => onBridge(s, 6) ? [-4.4, 4.4] : [-7.8, 7.8],
  water: (s, u, height) => height < WATER_LEVEL + .25,
};
