import { roadFrame, positionAt, randomAt, smoothstep, lerp, clamp } from './route.js';

export const PLAINS_STEP = 8;
// Long, gentle swells so straights can be held and the fields read as one surface.
const swellPhase = [randomAt(0, 2701) * Math.PI * 2, randomAt(1, 2701) * Math.PI * 2];
export const plainsRoadHeight = s => 24 + 5.4 * Math.sin(s / 310 + swellPhase[0]) + 2.4 * Math.sin(s / 127 + swellPhase[1]) + .9 * Math.sin(s / 61 + swellPhase[0]);
export const plainsFrame = s => ({ ...roadFrame(s), y: plainsRoadHeight(s) });

// Creeks cross at fixed world-space intervals, independent of chunk streaming.
export const CREEK_SPACING = 896;
export const BRIDGE_HALF_LENGTH = 14;
export function plainsCreekAt(s) {
  const index = Math.round((s - 420) / CREEK_SPACING), center = 420 + index * CREEK_SPACING;
  const lean = (randomAt(index, 2711) - .5) * .4;
  // Below the road embankment. The floodplain is pulled down to this level too.
  const level = plainsRoadHeight(center) - 2.2;
  return { index, center, lean, level, start: center - BRIDGE_HALF_LENGTH, end: center + BRIDGE_HALF_LENGTH };
}
export function creekCenterS(creek, u) {
  return creek.center + u * creek.lean + 5 * Math.sin(u / 41 + creek.index) + 2.1 * Math.sin(u / 13 - creek.index * .7);
}
export function creekDistance(s, u) {
  const creek = plainsCreekAt(s);
  return Math.abs(s - creekCenterS(creek, u));
}
// The waterline sits where the carved bank crosses the creek level.
export const CREEK_WATER_HALF_WIDTH = 4.6;

// At most one stock pond per stretch on each side of the road.
export const POND_SPACING = 512;
const ponds = new Map();
export function stockPondAt(index, side) {
  const key = `${index},${side}`;
  if (ponds.has(key)) return ponds.get(key);
  const pond = digPond(index, side);
  if (ponds.size > 512) ponds.clear();
  ponds.set(key, pond);
  return pond;
}
function digPond(index, side) {
  const salt = side > 0 ? 2861 : 2862;
  if (randomAt(index, salt) > .54) return null;
  // Take the flattest of six near-field spots. On a slope the dam and cut get huge.
  // Near fields also have terrain columns close enough (8 to 11 m) to shape the bank.
  let best = null;
  for (let k = 0; k < 6; k++) {
    const rough = index * POND_SPACING + 60 + randomAt(index * 8 + k, salt + 1) * 390, cross = 46 + randomAt(index * 8 + k, salt + 2) * 54;
    // Keep the pond and its bank inside one chunk. It is built on that chunk's
    // facets and can't see the neighbour's.
    const chunk = Math.floor(rough / 128), s = chunk * 128 + 32 + (rough - chunk * 128) / 128 * 64;
    const radius = 11 + randomAt(index, salt + 3) * 4.5, u = side * cross;
    // Clear of the creek. The bank reaches about 1.4x the water radius and the
    // creek has its own floodplain and willows.
    if (Math.abs(s - creekCenterS(plainsCreekAt(s), u)) < radius * 1.7 + 42) continue;
    const rim = plainsBaseHeight(s, u, true), pick = j => randomAt(index, (side > 0 ? 2891 : 2892) + j);
    const pond = { index, side, s, u, radius, rim, level: rim - .25,
      stretch: 1.18 + pick(0) * .34, tilt: pick(1) * Math.PI, lobes: [pick(2), pick(3)].map(r => r * Math.PI * 2) };
    // The dam faces downhill where water would spill. Cattle drink on the opposite side.
    let low = 0, lowest = Infinity, highest = -Infinity;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, r = pondEdge(pond, a) * 1.4;
      const h = plainsBaseHeight(s + Math.cos(a) * r, u + Math.sin(a) * r, true);
      if (h < lowest) { lowest = h; low = a; }
      highest = Math.max(highest, h);
    }
    pond.dam = low;
    pond.drink = low + Math.PI + (pick(4) - .5) * 1.8;
    pond.spread = highest - lowest;
    if (!best || pond.spread < best.spread) best = pond;
  }
  return best;
}
// Pond reach by direction: an oval with the round pond's area plus 3- and 5-fold lobes.
// Odd lobe counts can't cancel the oval the way a 2-fold one could.
// The water, bank and everything on it share this outline.
export function pondEdge(pond, angle) {
  const a = angle - pond.tilt, [p, q] = pond.lobes;
  const oval = 1 / Math.sqrt(Math.cos(a) ** 2 / pond.stretch + Math.sin(a) ** 2 * pond.stretch);
  return pond.radius * oval * (1 + .09 * Math.sin(angle * 3 + p) + .05 * Math.sin(angle * 5 + q));
}
// Ground height at fraction d of the pond's reach: flat floor, steep bank, mud
// shelf, spoil crest, then down to the field. The crest is highest on the dam
// side. On the high side the pond is cut into the field instead.
// Terrain is refined under ponds so its facets can follow this profile.
export function pondCrest(pond, angle) { return .3 + .4 * (.5 + .5 * Math.cos(angle - pond.dam)); }
export function pondProfile(pond, angle, d, ground) {
  const L = pond.level;
  if (d < 1) return L - .45 - 1.1 * (1 - smoothstep(.86, 1, d));
  const shelf = L - .45 + .58 * smoothstep(1, 1.07, d);
  const top = shelf + pondCrest(pond, angle) * smoothstep(1.06, 1.16, d);
  // Where the field is above the crest, climb from the shelf as one cut face.
  const cut = smoothstep(-.3, .4, ground - (L + .13 + pondCrest(pond, angle)));
  return lerp(top, ground, lerp(smoothstep(1.16, 1.36, d), smoothstep(1.05, 1.36, d), cut));
}
export function pondsNear(s) {
  const index = Math.floor(s / POND_SPACING), result = [];
  for (let i = index - 1; i <= index + 1; i++) for (const side of [-1, 1]) { const pond = stockPondAt(i, side); if (pond) result.push(pond); }
  return result;
}
export function pondDistance(s, u) {
  let best = { pond: null, d: Infinity };
  for (const pond of pondsNear(s)) {
    const d = Math.hypot(s - pond.s, u - pond.u) / pondEdge(pond, Math.atan2(u - pond.u, s - pond.s));
    if (d < best.d) best = { pond, d };
  }
  return best;
}

// Seeded 2D value noise. Quintic easing keeps the second derivative continuous
// across cells so low sun doesn't reveal the grid.
export function plainsNoise(s, u, span, salt) {
  const x = s / span, z = u / span, i = Math.floor(x), j = Math.floor(z);
  const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
  const a = ease(x - i), b = ease(z - j);
  return lerp(lerp(randomAt(i, j + salt), randomAt(i + 1, j + salt), a),
    lerp(randomAt(i, j + 1 + salt), randomAt(i + 1, j + 1 + salt), a), b) * 2 - 1;
}

// Overlapping rounded ridges with varied shoulders and saddles.
const ridges = new Map();
function plainsRidge(index, band) {
  const key = `${index},${band}`;
  if (ridges.has(key)) return ridges.get(key);
  const seed = index * 5 + band * 733, spacing = 310 + band * 110;
  const ridge = {
    s: index * spacing + randomAt(seed, 2771) * spacing * .6,
    u: 385 + band * 145 + (randomAt(seed, 2772) - .5) * 70,
    along: 225 + band * 65 + randomAt(seed, 2773) * 75,
    across: 110 + band * 30 + randomAt(seed, 2774) * 45,
    lean: (randomAt(seed, 2775) - .5) * .65,
    height: 22 + band * 7 + randomAt(seed, 2776) * 11,
    shoulder: (randomAt(seed, 2777) - .5) * .35,
  };
  if (ridges.size >= 128) ridges.delete(ridges.keys().next().value);
  ridges.set(key, ridge);
  return ridge;
}
export function distantRise(s, u) {
  if (u <= 260) return 0;
  let hills = 0;
  for (let band = 0; band < 2; band++) {
    const spacing = 310 + band * 110, cell = Math.floor(s / spacing);
    for (let i = cell - 2; i <= cell + 2; i++) {
      const ridge = plainsRidge(i, band);
      const ds = (s - ridge.s) / ridge.along;
      const du = (u - ridge.u) / ridge.across + ds * ridge.lean;
      const radius2 = (ds / (1 + ridge.shoulder * Math.tanh(ds * 2))) ** 2 + du * du;
      hills += ridge.height * Math.max(0, 1 - radius2) ** 2;
    }
  }
  const foothills = 7 + 3 * plainsNoise(s, u, 173, 2778);
  return (hills + foothills) * smoothstep(260, 390, u);
}

function fieldSwell(s, u) {
  // Warp the sample point so crests don't line up with the road or field boundaries.
  const along = s + 48 * Math.sin(u / 157 + swellPhase[0]) + 22 * Math.sin(s / 253);
  const across = u + 39 * Math.sin(s / 183 + swellPhase[1]);
  return 9.5 * plainsNoise(along, across, 190, 2703) + 4.5 * plainsNoise(along + 143, across - 87, 93, 2704)
    + .6 * plainsNoise(along, across, 42, 2705) + 2.5 * Math.sin(s / 347 - u / 263 + swellPhase[1]);
}
// Terrain without the creek: flat road reserve, a ditch each side, then fields.
// The land falls toward the camera and rises behind the road so the far side shows more ground.
export function plainsBaseHeight(s, u, beforePonds = false) {
  const h = plainsRoadHeight(s), cross = Math.abs(u);
  if (cross <= 7) return h;
  const ditch = .55 * Math.sin(Math.PI * clamp((cross - 8.2) / 5.2, 0, 1)) ** 2;
  // Near the road, subtract the swell at u = 0 so hills don't make a steep verge.
  // Full relief returns farther out.
  const swell = (fieldSwell(s, u) - fieldSwell(s, 0) * (1 - smoothstep(65, 230, cross))) * smoothstep(9, 42, cross);
  const fall = u < 0 ? 9 * smoothstep(60, 420, cross) : 0;
  const rise = u > 0 ? 6 * smoothstep(60, 300, u) : 0;
  let height = h - ditch + swell - fall + rise + distantRise(s, u);
  if (beforePonds || cross < 14 || cross > 160) return height;
  const { pond, d } = pondDistance(s, u);
  if (pond && d < 1.36) height = pondProfile(pond, Math.atan2(u - pond.u, s - pond.s), d, height);
  return height;
}
export function plainsGroundHeight(s, u) {
  const base = plainsBaseHeight(s, u);
  const creek = plainsCreekAt(s), d = Math.abs(s - creekCenterS(creek, u));
  if (d > 24) return base;
  // The floodplain drops to the creek but the road keeps its embankment,
  // so banks are steeper under the bridge.
  const bankNoise = .35 * Math.sin(s * .7 + u * .4) + .25 * Math.sin(u * 1.3);
  const plain = lerp(base, creek.level + 1.6 + bankNoise, (1 - smoothstep(8, 24, d)) * smoothstep(7, 12, Math.abs(u)));
  // Bed depth is set from the creek level, not local ground, so it can't rise
  // through the flat water where the ground swells.
  return lerp(plain, Math.min(plain, creek.level - 1.8), 1 - smoothstep(3, 8, d));
}
// Driving queries see the bridge deck; the terrain sees the channel beneath it.
export function plainsHeight(s, u) {
  return Math.abs(u) <= 7 ? plainsRoadHeight(s) : plainsGroundHeight(s, u);
}
export const plainsPosition = (s, u, y = plainsHeight(s, u)) => positionAt(s, u, y);

// Fields are rows along the road, each cut into bands at its own offsets so
// boundaries stagger instead of forming a grid. Boundaries are lines in (s, u).
// Row length is kept close to band depth so fields are squarish, not strips.
export const FIELD_SPAN = 136;
export const ROAD_RESERVE = 13;
// Snapped to terrain rows so the colour change between fields follows facet edges.
export function fieldBoundary(index) { return Math.round((index * FIELD_SPAN + 40 + randomAt(index, 2721) * 56) / PLAINS_STEP) * PLAINS_STEP; }
export function fieldRowAt(s) {
  let index = Math.floor((s - 40) / FIELD_SPAN);
  if (s < fieldBoundary(index)) index--;
  return index;
}
const BAND_EDGES = [ROAD_RESERVE, 84, 164, 268, 400];
// Cached because every clearance test along a row reads them.
const bandRows = new Map();
export function fieldBands(row, side) {
  const key = row * 2 + (side > 0 ? 1 : 0);
  if (bandRows.has(key)) return bandRows.get(key);
  const bands = BAND_EDGES.map((u, k) => {
    if (k === 0) return u;
    const target = u + (randomAt(row * 2 + (side > 0 ? 1 : 0), 2731 + k) - .5) * u * .2;
    // The near side's terrain ends sooner than the far side's.
    const columns = PLAINS_COLUMNS.filter(column => column > ROAD_RESERVE && column <= (side > 0 ? 568 : 400));
    return columns.reduce((best, column) => Math.abs(column - target) < Math.abs(best - target) ? column : best, Infinity);
  });
  bandRows.set(key, bands);
  if (bandRows.size > 512) bandRows.delete(bandRows.keys().next().value);
  return bands;
}
const CROPS = ['wheat', 'stubble', 'ploughed', 'pasture', 'hay'];
export function fieldAt(s, u) {
  const cross = Math.abs(u);
  if (cross < ROAD_RESERVE) return null;
  const row = fieldRowAt(s), side = u < 0 ? -1 : 1, bands = fieldBands(row, side);
  let band = 0;
  while (band < bands.length - 1 && cross >= bands[band + 1]) band++;
  const seed = row * 8 + band, salt = side > 0 ? 2741 : 2751, r = randomAt(seed, salt);
  // Ploughed is the only dark field in the palette, so keep it rare.
  const kind = band >= 4 ? 'pasture' : CROPS[r < .32 ? 0 : r < .55 ? 1 : r < .62 ? 2 : r < .83 ? 3 : 4];
  return { row, band, side, kind, seed, salt, rows: randomAt(seed, salt + 1) < .5 ? 'along' : 'across',
    from: bands[band], to: bands[band + 1] ?? 600, start: fieldBoundary(row), end: fieldBoundary(row + 1) };
}
// Row boundaries cross the whole view, so only they get tall shelterbelts.
export function rowBoundaryKind(row, side) {
  const r = randomAt(row, side > 0 ? 2781 : 2782);
  return r < .14 ? null : r < .44 ? 'fence' : r < .56 ? 'hedge' : r < .84 ? 'treeline' : 'shelterbelt';
}
export function bandBoundaryKind(row, side, band) {
  const r = randomAt(row * 4 + band, side > 0 ? 2783 : 2784);
  // Some band edges are just a change of crop.
  return r < .3 ? null : r < .62 ? 'fence' : r < .74 ? 'hedge' : 'treeline';
}
// Distance to the nearest fenced, hedged or treed boundary.
// The terrain shades this strip as bare headland.
export const BOUNDARY_LINE = 2.2;
export function headlandDistance(s, u, field) {
  const { row, side, band } = field, bands = fieldBands(row, side), cross = Math.abs(u);
  let d = 99;
  if (band < 4 && cross < 330) {
    if (rowBoundaryKind(row, side)) d = Math.min(d, Math.abs(s - field.start - BOUNDARY_LINE));
    if (rowBoundaryKind(row + 1, side)) d = Math.min(d, Math.abs(s - field.end - BOUNDARY_LINE));
  }
  if (band > 0 && band < 4 && bandBoundaryKind(row, side, band)) d = Math.min(d, Math.abs(cross - bands[band]));
  if (band < 3 && bandBoundaryKind(row, side, band + 1)) d = Math.min(d, Math.abs(cross - bands[band + 1]));
  return d;
}
// Stone piles cleared off the fields, and a stock pond in some pastures.
export function fieldCorner(row, side, band) {
  return randomAt(row * 4 + band, side > 0 ? 2791 : 2792) < .232;
}
export function roadsideFence(row, side) { return randomAt(row, side > 0 ? 2785 : 2786) > .35; }
// A gate and mailbox in a few rows, roughly one every few hundred metres.
export function farmGate(row, side) {
  // Per-row chance, tuned for 136 m rows. Rescale it if FIELD_SPAN changes.
  if (randomAt(row, side > 0 ? 2787 : 2788) > .124) return null;
  const start = fieldBoundary(row), end = fieldBoundary(row + 1);
  const s = Math.round(start + 18 + randomAt(row, side > 0 ? 2789 : 2790) * (end - start - 36));
  // Only some gates have a worn track across the field behind them.
  const worn = randomAt(row, side > 0 ? 2857 : 2858) < .34;
  const far = randomAt(row, side > 0 ? 2871 : 2872), bands = fieldBands(row, side);
  const reach = bands[far < .5 ? 1 : far < .76 ? 2 : far < .92 ? 3 : 4] - 6;
  return { s, side, worn, reach, shed: randomAt(row, side > 0 ? 2873 : 2874) < .45 };
}
// A worn track's corridor. Boundaries stop either side of it and nothing is planted in it.
export function farmTrackClears(s, u, radius = 0) {
  const cross = Math.abs(u);
  if (cross < ROAD_RESERVE - 4) return true;
  const gate = farmGate(fieldRowAt(s), u < 0 ? -1 : 1);
  if (!gate || !gate.worn || cross > gate.reach + 2) return true;
  return Math.abs(s - gate.s) > 5 + radius;
}

// Terrain columns are fixed offsets from the road. Fine near the road to keep
// the ditch crisp, coarser outward. Extra far columns stop hill facets turning into ribbons.
const PLAINS_COLUMNS = [-400, -376, -352, -330, -308, -288, -268, -252, -232, -200, -172, -148, -127, -109, -93, -79, -67, -56, -46, -37, -29, -22, -16.5, -13, -10.8, -8.6, -7,
  0, 7, 8.6, 10.8, 13, 16.5, 22, 29, 37, 46, 56, 67, 79, 93, 109, 127, 148, 172, 200, 232, 252, 268, 288, 308, 330, 352, 376, 400, 426, 452, 480, 508, 538, 568];
export { PLAINS_COLUMNS };
export const PLAINS_COLUMN_COUNT = PLAINS_COLUMNS.length;
// The creek is only ten metres across, so the rows halve around each crossing.
export function plainsRowStep(row) {
  return Math.abs(row * PLAINS_STEP - plainsCreekAt(row * PLAINS_STEP).center) <= 72 ? .5 : 1;
}
export function plainsVertex(row, column) {
  const base = PLAINS_COLUMNS[column], cross = Math.abs(base);
  const fixed = cross <= ROAD_RESERVE;
  const seedRow = Number.isInteger(row) ? row : row * 2 + 1048576;
  const s = row * PLAINS_STEP + (fixed ? 0 : (randomAt(seedRow, column + 2761) - .5) * 3.6);
  const gap = Math.min(base - (PLAINS_COLUMNS[column - 1] ?? base - 40), (PLAINS_COLUMNS[column + 1] ?? base + 40) - base);
  const u = base + (fixed ? 0 : (randomAt(seedRow, column + 2762) - .5) * Math.min(4.5, gap * .32));
  const p = plainsPosition(s, u, plainsGroundHeight(s, u));
  // Slight facet relief, small enough that fields still carry furrows. None at the water.
  const dry = smoothstep(4, 9, creekDistance(s, u));
  p.y += (randomAt(seedRow, column + 2763) - .5) * .09 * smoothstep(13, 30, cross) * dry;
  return { ...p, s, u, column };
}

export const plainsDrivingRoute = {
  frame: plainsFrame, position: plainsPosition, height: plainsHeight,
  bounds: s => {
    const creek = plainsCreekAt(s);
    if (s > creek.start - 8 && s < creek.end + 8) return [-4.8, 4.8];
    return [-11.5, 11.5];
  },
  // The creek either side of its bridge, and the stock ponds.
  water: (s, u) => Math.abs(u) > 7 && (creekDistance(s, u) < CREEK_WATER_HALF_WIDTH + 1 || pondDistance(s, u).d < 1.05),
};
