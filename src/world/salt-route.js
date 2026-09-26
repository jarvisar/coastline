import { roadFrame, positionAt, randomAt, smoothstep, lerp } from './route.js';

// The crust is dead level. A low causeway carries the road across it.
export const SALT_LEVEL = 22;
// Pools sit just below the crust so the polygon rims stand out of the water.
export const WATER_LEVEL = SALT_LEVEL - .05;
export const SHOULDER = 6.9;
// Where the embankment meets the crust. Salt polygons start here.
export const CAUSEWAY_TOE = 10.6;
// Polygon crust out to here on both sides, then a plain far field.
export const CELL_REACH = 420;
export const SALT_EDGES = { near: -420, far: 600 };
// Mean polygon spacing. Rows sit on a hexagonal lattice, then get jittered.
export const CELL = 22;
const ROW = CELL * .866;
export const CELL_ROWS = Math.ceil((CELL_REACH - CAUSEWAY_TOE) / ROW) + 1;

const phase = [randomAt(0, 8801) * Math.PI * 2, randomAt(1, 8801) * Math.PI * 2];
export const saltRoadHeight = s => SALT_LEVEL + .88 + .1 * Math.sin(s / 173 + phase[0]) + .06 * Math.sin(s / 61 + phase[1]);
export const saltFrame = s => ({ ...roadFrame(s), y: saltRoadHeight(s) });

// Rounded top, straight rip-rap face, soft toe.
export function saltHeight(s, u) {
  const cross = Math.abs(u);
  if (cross <= SHOULDER) return saltRoadHeight(s);
  if (cross >= CAUSEWAY_TOE) return SALT_LEVEL;
  return lerp(saltRoadHeight(s), SALT_LEVEL, smoothstep(SHOULDER, CAUSEWAY_TOE, cross));
}
export const saltPosition = (s, u, y = saltHeight(s, u)) => positionAt(s, u, y);

// Seeded 2D value noise in -1..1. Quintic easing so gradients stay smooth.
export function saltNoise(s, u, span, salt) {
  const x = s / span, z = u / span, i = Math.floor(x), j = Math.floor(z);
  const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
  const a = ease(x - i), b = ease(z - j);
  return lerp(lerp(randomAt(i, j + salt), randomAt(i + 1, j + salt), a),
    lerp(randomAt(i, j + 1 + salt), randomAt(i + 1, j + 1 + salt), a), b) * 2 - 1;
}

// 0 on dry crust, 1 across a flooded mirror lagoon. Stretches last several
// hundred metres so each one has time to be seen.
export function lagoonAmount(s) {
  const cell = Math.floor(s / 560), t = smoothstep(0, 1, s / 560 - cell);
  return smoothstep(.56, .8, lerp(randomAt(cell, 8831), randomAt(cell + 1, 8831), t));
}

// Hexagonal seed lattice per side of the road, so no cell straddles the causeway.
export function cellSeed(i, k, side) {
  const salt = side > 0 ? 8811 : 8821;
  const s = (i + (k % 2 ? .5 : 0) + (randomAt(i, k * 7 + salt) - .5) * .72) * CELL;
  const u = side * (CAUSEWAY_TOE + ROW * (k + .55) + (randomAt(i, k * 7 + salt + 1) - .5) * .62 * ROW);
  return { i, k, side, s, u };
}
export const cellKey = (i, k, side) => `${side > 0 ? 'f' : 'n'}${i},${k}`;

const floodCache = new Map();
// Pools are scattered patches of a few whole polygons, more of them along the
// wetter stretches.
export function cellFlooded(i, k, side) {
  const key = cellKey(i, k, side);
  if (floodCache.has(key)) return floodCache.get(key);
  const { s, u } = cellSeed(i, k, side), cross = Math.abs(u), lagoon = lagoonAmount(s);
  // A finer octave keeps small pools dotted through the drier stretches.
  const patch = saltNoise(s, u, 96, 8841) * .5 + saltNoise(s + 31, u, 41, 8842) * .3 + saltNoise(s - 17, u, 23, 8843) * .2;
  const jitter = (randomAt(i, k * 7 + (side > 0 ? 8813 : 8823)) - .5) * .3;
  const verge = k === 0 ? .22 : 0;
  const far = smoothstep(330, 400, cross) * .6;
  const flooded = patch + jitter + lagoon * .26 - verge - far > .33;
  if (floodCache.size > 20000) floodCache.clear();
  floodCache.set(key, flooded);
  return flooded;
}

// Voronoi outline of one cell in route space. Each vertex carries `edge`, the
// neighbour across the edge that starts at it: a cell key, 'toe' or 'far'.
function clip(outline, mx, my, nx, ny, label) {
  const kept = [], depth = p => (p.s - mx) * nx + (p.u - my) * ny;
  for (let k = 0; k < outline.length; k++) {
    const a = outline[k], b = outline[(k + 1) % outline.length], da = depth(a), db = depth(b);
    if (da <= 0) kept.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      kept.push({ s: a.s + (b.s - a.s) * t, u: a.u + (b.u - a.u) * t, edge: da <= 0 ? label : a.edge });
    }
  }
  return kept;
}
export function saltCell(i, k, side) {
  const seed = cellSeed(i, k, side), reach = CELL * 1.7;
  let outline = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ s: seed.s + a * reach, u: seed.u + b * reach, edge: null }));
  for (let dk = -2; dk <= 2; dk++) for (let di = -2; di <= 2; di++) {
    if ((!di && !dk) || k + dk < 0) continue;
    const other = cellSeed(i + di, k + dk, side), ns = other.s - seed.s, nu = other.u - seed.u, length = Math.hypot(ns, nu);
    outline = clip(outline, (seed.s + other.s) / 2, (seed.u + other.u) / 2, ns / length, nu / length, cellKey(i + di, k + dk, side));
  }
  outline = clip(outline, 0, side * CAUSEWAY_TOE, 0, -side, 'toe');
  outline = clip(outline, 0, side * CELL_REACH, 0, side, 'far');
  return { ...seed, key: cellKey(i, k, side), flooded: cellFlooded(i, k, side), outline };
}
// Floods for a key produced by saltCell. Boundaries never flood.
export function keyFlooded(key) {
  if (key === 'toe' || key === 'far' || key === null) return false;
  const side = key[0] === 'f' ? 1 : -1, [i, k] = key.slice(1).split(',').map(Number);
  return cellFlooded(i, k, side);
}
export const cellRowOf = u => Math.round((Math.abs(u) - CAUSEWAY_TOE) / ROW - .55);

// Lattice cells whose seeds could lie within `radius` of a point.
export function cellsNear(s, u, radius) {
  const side = u < 0 ? -1 : 1, cells = [], rows = Math.ceil(radius / ROW) + 2, row = cellRowOf(u);
  for (let k = Math.max(0, row - rows); k <= Math.min(CELL_ROWS, row + rows); k++) {
    const first = Math.floor((s - radius) / CELL) - 2, last = Math.ceil((s + radius) / CELL) + 2;
    for (let i = first; i <= last; i++) {
      const seed = cellSeed(i, k, side);
      if (Math.hypot(seed.s - s, seed.u - u) <= radius) cells.push(seed);
    }
  }
  return cells;
}
// The cell whose seed is nearest, which is the Voronoi cell holding the point.
export function cellAt(s, u) {
  if (Math.abs(u) < CAUSEWAY_TOE || Math.abs(u) > CELL_REACH) return null;
  let best = null, distance = Infinity;
  for (const seed of cellsNear(s, u, CELL * 1.5)) {
    const d = Math.hypot(seed.s - s, seed.u - u);
    if (d < distance) { distance = d; best = seed; }
  }
  return best;
}
export function inPool(s, u) {
  const cell = cellAt(s, u);
  return Boolean(cell && cellFlooded(cell.i, cell.k, cell.side));
}
// Any pool within reach, used to decide what needs a reflection.
export function poolNear(s, u, radius) {
  if (Math.abs(u) + radius < CAUSEWAY_TOE) return false;
  return cellsNear(s, u, radius + CELL).some(seed => cellFlooded(seed.i, seed.k, seed.side));
}

// Boulder groups on a world-space schedule: small groups every few dozen
// metres beside the causeway, and bigger outcrops further out on the flat.
export const CLUSTER_SPACING = 34;
export function saltClusters(from, to) {
  const clusters = [];
  for (let c = Math.floor(from / CLUSTER_SPACING) - 1; c * CLUSTER_SPACING <= to; c++) {
    for (const lane of [0, 1, 2]) {
      const salt = 8851 + lane * 11;
      if (randomAt(c, salt) > [.8, .8, .3][lane]) continue;
      const s = c * CLUSTER_SPACING + randomAt(c, salt + 1) * CLUSTER_SPACING;
      if (s < from || s >= to) continue;
      const side = lane === 2 ? (randomAt(c, salt + 2) < .5 ? -1 : 1) : lane ? 1 : -1;
      const near = lane < 2, r = randomAt(c, salt + 4);
      const u = side * (near ? 15 + randomAt(c, salt + 3) ** 1.5 * 34 : 45 + randomAt(c, salt + 3) ** 1.2 * 220);
      const hero = near ? 2.3 + r * 2.8 : r < .3 ? 5.5 + randomAt(c, salt + 5) * 3.5 : 3 + randomAt(c, salt + 5) * 2.8;
      clusters.push({ index: c * 3 + lane, s, u, hero, pieces: near ? Math.floor(randomAt(c, salt + 6) * 4) : 3 + Math.floor(randomAt(c, salt + 6) * 5),
        heading: randomAt(c, salt + 7) * Math.PI * 2 });
    }
  }
  return clusters;
}

// Rows of hand-raked salt cones, roughly one field per 700 m.
export const PILE_SPACING = 700;
export function saltPileFields(from, to) {
  const fields = [];
  for (let f = Math.floor(from / PILE_SPACING) - 1; f * PILE_SPACING <= to; f++) {
    if (randomAt(f, 8871) > .45) continue;
    const s = f * PILE_SPACING + 120 + randomAt(f, 8872) * 420;
    if (s < from || s >= to) continue;
    const side = randomAt(f, 8873) < .6 ? 1 : -1;
    fields.push({ index: f, s, u: side * (30 + randomAt(f, 8874) * 46), side, rows: 3 + Math.floor(randomAt(f, 8875) * 3),
      columns: 6 + Math.floor(randomAt(f, 8876) * 6), spacing: 3.3 + randomAt(f, 8877) * .6, skew: (randomAt(f, 8878) - .5) * .5 });
  }
  return fields;
}

export const saltDrivingRoute = {
  frame: saltFrame, position: saltPosition, height: saltHeight,
  bounds: () => [-11.5, 11.5],
  // Pools are ankle deep, so the whole flat is open to free driving.
  water: () => false,
  // Hard crust barely slows the car down off the causeway.
  looseness: .45,
};
