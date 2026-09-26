import { resolveWorldSeed, workerSeed } from './generation.js';

export const SEED = workerSeed ?? resolveWorldSeed(globalThis.location?.search);
export const CHUNK_LENGTH = 128;
export const TERRAIN_STEP = 8;
export const ROAD_HALF_WIDTH = 5.5;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function randomAt(a, b = 0, seed = SEED) {
  let n = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed, 144269);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function seededRandom(seed) {
  let i = 0;
  return () => randomAt(seed, i++);
}

// Seeded spans only ever lengthen, so bends stay gentle enough for terrain
// normals and lane assist.
const bends = [130, 60, 260].map((span, i) => ({ span: span * (1 + randomAt(i, 1901) * .35), phase: randomAt(i, 1902) * Math.PI * 2 }));
const hills = [173, 83].map((span, i) => ({ span: span * (1 + randomAt(i, 1903) * .35), phase: randomAt(i, 1904) * Math.PI * 2 }));
export function roadX(s) { return 27 * Math.sin(s / bends[0].span + bends[0].phase) + 24 * Math.sin(s / bends[1].span + bends[1].phase) + 6 * Math.sin(s / bends[2].span + bends[2].phase); }
export function roadDerivative(s) { return 27 / bends[0].span * Math.cos(s / bends[0].span + bends[0].phase) + 24 / bends[1].span * Math.cos(s / bends[1].span + bends[1].phase) + 6 / bends[2].span * Math.cos(s / bends[2].span + bends[2].phase); }
export function roadHeight(s) { return 24 + 6 * Math.sin(s / hills[0].span + hills[0].phase) + 3 * Math.sin(s / hills[1].span + hills[1].phase); }

export function journeyStart(routeNumber) {
  // Distance is tracked separately from s, so it starts at zero wherever we spawn.
  return { s: Math.floor((randomAt(routeNumber, 1910) - .5) * 40000), distance: 0 };
}
function drivingCoastOffset(s) { return -28 - 8 * Math.sin(s / 107 + .8) - 4 * Math.sin(s / 43) - 3 * Math.sin(s / 23 + 2); }
function coastNoise(s, span, salt) {
  const cell = Math.floor(s / span), t = smoothstep(0, 1, s / span - cell);
  return lerp(randomAt(cell, salt), randomAt(cell + 1, salt), t);
}
export function headlandCenter(index) { return index * 176 + 50 + randomAt(index, 1601) * 60; }
export function headlandAmount(s) {
  const cell = Math.floor(s / 176);
  let amount = 0;
  for (let i = cell - 1; i <= cell + 1; i++) {
    const center = headlandCenter(i);
    const span = s < center ? 38 + randomAt(i, 1602) * 28 : 45 + randomAt(i, 1603) * 30;
    const profile = 1 - smoothstep(.05, 1, Math.abs(s - center) / span);
    amount = Math.max(amount, profile * (30 + randomAt(i, 1604) * 24));
  }
  return amount;
}
export function coastOffset(s) { return drivingCoastOffset(s) - headlandAmount(s); }
export function overlookAt(s) {
  const index = Math.round((s - 80) / 1936);
  const center = headlandCenter(index * 11 + Math.floor(randomAt(index, 1861) * 3) - 1);
  return { index, center, enabled: randomAt(index, 1862) > .244 && Math.abs(center - bridgeAt(center).center) > 105 };
}
export function overlookWidth(s) {
  const overlook = overlookAt(s);
  return 6.05 + (overlook.enabled ? 10 * (1 - smoothstep(12, 32, Math.abs(s - overlook.center))) : 0);
}
export function beachWidth(s) {
  const cell = Math.floor(s / 176);
  let pocket = 0;
  for (let i = cell - 1; i <= cell + 1; i++) {
    const left = headlandCenter(i), right = headlandCenter(i + 1);
    const center = lerp(left, right, .43 + randomAt(i, 1661) * .14);
    const span = (s < center ? center - left : right - center) * (.83 + randomAt(i, 1662) * .1);
    const profile = 1 - smoothstep(.06, 1, Math.abs(s - center) / span);
    pocket = Math.max(pocket, profile * (19 + randomAt(i, 1663) * 8));
  }
  return 5.8 + coastNoise(s, 83, 1664) * 2 + pocket * .86;
}
export function shorelineOffset(s) { return coastOffset(s) - 10 - beachWidth(s) - 2.4; }

function coastalShoulder(s) {
  return (coastNoise(s, 83, 1611) * 14 - 5) * smoothstep(-18, -29, coastOffset(s));
}

export function cliffRib(s, height = 0) {
  // Tilted joints. Sampling one field at several heights keeps buttresses
  // connected from toe to crown.
  const cell = Math.floor(s / 38);
  let rib = 0;
  for (let i = cell - 1; i <= cell + 1; i++) {
    const center = i * 38 + 11 + randomAt(i, 1621) * 16;
    const lean = (randomAt(i, 1622) - .5) * 13;
    const width = 13 + randomAt(i, 1623) * 13;
    const distance = Math.abs(s - center - height * lean) / width;
    rib = Math.max(rib, (1 - smoothstep(.08, 1, distance)) * (.7 + randomAt(i, 1624) * .3));
  }
  return rib;
}

function cliffJoint(s, height) {
  const cell = Math.floor(s / 13);
  let joint = 0;
  for (let i = cell - 2; i <= cell + 2; i++) {
    const center = i * 13 + randomAt(i, 1651) * 7 + height * (randomAt(i, 1652) - .5) * 15;
    const width = 5 + randomAt(i, 1653) * 5;
    joint = Math.max(joint, Math.max(0, 1 - Math.abs(s - center) / width));
  }
  return joint;
}

// Landmarks sit on world-space intervals, independent of chunk boundaries.
export function bridgeAt(s) {
  const index = Math.round((s - 148) / 896);
  const center = 148 + index * 896;
  return { index, center, start: center - 36, end: center + 36, length: 72 };
}
export function ravineAmount(s, u) {
  const bridge = bridgeAt(s);
  const along = 1 - smoothstep(22, 54, Math.abs(s - bridge.center));
  return along * (1 - smoothstep(24, 112, u));
}
export function pondAt(s) {
  const index = Math.round((s - 246) / 704);
  const center = 246 + index * 704;
  return { index, center, u: 73 + randomAt(index, 370) * 13, rs: 35 + randomAt(index, 371) * 11, ru: 20 + randomAt(index, 372) * 6, level: roadHeight(center) + 7 };
}
export function pondRadius(s, u, pond = pondAt(s)) {
  const x = (s - pond.center) / pond.rs;
  // The warp fades outside the basin so the outer slopes stay smooth.
  const bend = (.16 + randomAt(pond.index, 373) * .16) * Math.sin(x * 2.4) * (1 - smoothstep(1, 2.5, Math.abs(x)));
  const y = (u - pond.u) / pond.ru - bend;
  const angle = Math.atan2(y, x);
  return Math.hypot(x, y) / (1 + .13 * Math.sin(angle * 3 + pond.index) + .055 * Math.sin(angle * 2 + pond.index * .7));
}
function fieldNoise(s, u, span, salt) {
  const cs = Math.floor(s / span), cu = Math.floor(u / span);
  const ts = smoothstep(0, 1, s / span - cs), tu = smoothstep(0, 1, u / span - cu);
  const at = (i, j) => randomAt(i * 1031 + j, salt);
  return lerp(lerp(at(cs, cu), at(cs + 1, cu), ts), lerp(at(cs, cu + 1), at(cs + 1, cu + 1), ts), tu);
}
// Spur ridges run from a main crest toward the sea, split by canyons.
// `spur` is 1 on a crest line and 0 in a canyon.
const SPUR_SPACING = 132;
export function coastRange(s, u) {
  const rise = smoothstep(24, 160, u);
  if (rise === 0) return { height: 0, spur: 0, rise: 0 };
  const t = s + 24 * Math.sin(u / 61 + s / 410) + (fieldNoise(s, u, 97, 1741) - .5) * 30;
  const cell = Math.floor(t / SPUR_SPACING);
  let spur = 0;
  for (let i = cell - 1; i <= cell + 1; i++) {
    const center = i * SPUR_SPACING + 24 + randomAt(i, 1742) * 84;
    const half = 50 + randomAt(i, 1743) * 32, toe = 24 + randomAt(i, 1744) * 36;
    // Exponent above 1 gives sharp crests and V-shaped canyons.
    const across = Math.max(0, 1 - Math.abs(t - center) / half);
    spur = Math.max(spur, Math.pow(across, 1.4) * smoothstep(toe, toe + 40, u) * (.72 + randomAt(i, 1745) * .28));
  }
  const crestU = 165 + 22 * Math.sin(s / 263 + 1.3), summit = .7 + .6 * fieldNoise(s, 0, 160, 1746);
  const floor = rise * (16 + 12 * fieldNoise(s, u, 140, 1747));
  const ridge = spur * Math.pow(rise, .5) * (44 + 30 * summit) * (.85 + .3 * fieldNoise(s, u, 38, 1748));
  const crest = (1 - smoothstep(0, 60, Math.abs(u - crestU))) * summit * 20;
  const beyond = 1 - .35 * smoothstep(crestU + 10, crestU + 70, u);
  return { height: (floor + ridge + crest) * beyond, spur, rise };
}
export function mountainHeight(s, u) { return coastRange(s, u).height; }
export function hillsideSteepness(s) {
  return smoothstep(.35, .8, coastNoise(s, 230, 1721));
}
export function rockCover(s, u) {
  const shelter = smoothstep(1.1, 3.4, pondRadius(s, u));
  const gorge = 1 - .8 * (1 - smoothstep(46, 125, Math.abs(s - bridgeAt(s).center)));
  const { spur, rise } = coastRange(s, u);
  const crest = smoothstep(.62, .9, spur * Math.pow(rise, .6) + (fieldNoise(s, u, 42, 1703) - .5) * .3) * smoothstep(.35, .7, rise);
  const patches = smoothstep(.66, .82, fieldNoise(s, u, 48, 1701) * .8 + fieldNoise(s, u, 19, 1702) * .2) * smoothstep(60, 120, u) * spur;
  return clamp((crest + patches) * shelter * gorge, 0, 1);
}
export function coastalGrove(s, u) {
  // Trees and their understory share this field so they agree. In the range,
  // forest favours canyons and slopes facing away from the sun.
  const habitat = fieldNoise(s, u, 54, 1751) * .72 + fieldNoise(s, u, 23, 1752) * .28;
  if (u < 30) return habitat;
  const { spur, rise } = coastRange(s, u);
  // The sun is toward falling s, so a slope that climbs with s faces it.
  const sunward = clamp((coastRange(s + 5, u).height - coastRange(s - 5, u).height) / 10 * 1.8, -1, 1);
  const forest = .5 - sunward * .38 + (1 - spur) * .2 - spur * .22 + (habitat - .5) * .35;
  return lerp(habitat, forest, smoothstep(30, 85, u) * Math.min(1, rise * 4));
}
// 0 on the terrace, 1 where the coast range sets the ground colour.
export const rangeInfluence = u => smoothstep(28, 90, u);
export function wildflowers(s, u) {
  const open = (1 - smoothstep(.44, .6, coastalGrove(s, u))) * smoothstep(8.5, 15, Math.abs(u));
  const poppy = smoothstep(.57, .76, fieldNoise(s, u, 43, 1781)) * open;
  const lupine = smoothstep(.58, .78, fieldNoise(s + 17, u, 61, 1782)) * open * (1 - poppy * .8);
  const mustard = smoothstep(.6, .8, fieldNoise(s, u - 23, 79, 1783)) * open * smoothstep(24, 60, u) * (1 - Math.max(poppy, lupine) * .8);
  return { poppy, lupine, mustard };
}
export function icePlant(s) {
  return smoothstep(.45, .65, coastNoise(s, 29, 1791)) * smoothstep(.2, .5, coastNoise(s, 11, 1792));
}
export function roadFrame(s) {
  const dx = roadDerivative(s);
  const scale = Math.sqrt(1 + dx * dx);
  return { x: roadX(s), y: roadHeight(s), z: -s, nx: 1 / scale, nz: dx / scale, angle: Math.atan(dx), scale };
}
export function positionAt(s, u, height, target = {}) {
  // Hot path: skips roadFrame's unused trig and allocation.
  const dx = roadDerivative(s), scale = Math.sqrt(1 + dx * dx);
  // Compress the offset past the shoulders so wide hills can't fold over on the
  // inside of a bend. The road itself uses exact normals.
  const offset = Math.abs(u) <= 7 ? u : Math.sign(u) * (7 + 30 * Math.tanh((Math.abs(u) - 7) / 30));
  target.x = roadX(s) + u + offset * (1 / scale - 1);
  target.y = height ?? terrainHeight(s, u);
  target.z = -s + offset * (dx / scale);
  return target;
}

function baseTerrainHeight(s, u, radius) {
  const h = roadHeight(s);
  const coast = coastOffset(s);
  const ripple = Math.sin(s * .095 + u * .11) * .7 + Math.sin(s * .043 - u * .18) * .6;
  const beach = coast - 10 - beachWidth(s);
  if (u < beach - 7) return -3.2;
  if (u < beach) return lerp(-3.2, 1.2, smoothstep(beach - 7, beach, u));
  if (u < coast - 10) return 1.2;
  if (u < coast) return lerp(1.2, h + 1.2 + ripple + coastalShoulder(s), smoothstep(coast - 10, coast, u));
  if (u < -7) {
    const shelf = h + (1.2 + ripple) * smoothstep(-7, coast, u)
      + (u < -18 ? coastalShoulder(s) * smoothstep(-18, Math.min(-18.01, coast), u) : 0);
    // Overlook aprons flatten to road height and blend back into the bluff.
    const overlook = overlookAt(s);
    const apron = overlook.enabled ? 1 - smoothstep(32, 48, Math.abs(s - overlook.center)) : 0;
    return lerp(shelf, h, apron * (1 - smoothstep(20, 25, -u)) * smoothstep(coast, coast + 6, u));
  }
  if (u < 7) return h;
  // Hills ease off around ponds so the water doesn't sit in a crater.
  const shelter = smoothstep(1.1, 3.4, radius);
  // Keep the ridge back from each viaduct so the inlet stays a shallow gorge.
  const gorge = 1 - .8 * (1 - smoothstep(46, 125, Math.abs(s - bridgeAt(s).center)));
  const inland = Math.max(smoothstep(12, 110, u), hillsideSteepness(s) * .7 * shelter * smoothstep(20, 88, u));
  const hill = 13 + 23 * fieldNoise(s, u, 115, 1731) + 12 * fieldNoise(s + u * .4, u, 67, 1732);
  const knolls = (fieldNoise(s, u, 29, 1733) - .5) * 7 * smoothstep(16, 50, u) * shelter;
  return h + inland * hill * gorge + ripple * smoothstep(7, 26, u) + knolls + mountainHeight(s, u) * shelter * gorge;
}
export function groundHeight(s, u) {
  const pond = pondAt(s), radius = pondRadius(s, u, pond);
  let height = baseTerrainHeight(s, u, radius);
  if (radius < 2.3) {
    // The dry bank is wider than a coarse terrain edge so no face cuts through the rim.
    const basin = pond.level - 3.4 + 5.6 * smoothstep(.3, 1.18, radius);
    // Uphill bank rises toward the ridge; the seaward side stays low.
    const bank = smoothstep(.86, 1.5, radius) * smoothstep(pond.u - 8, pond.u + 40, u) * 2.3;
    height = lerp(basin + bank, height, smoothstep(1.35, 2.3, radius));
  }
  const ravine = ravineAmount(s, u) * smoothstep(1.65, 2.3, radius);
  height = lerp(height, Math.min(height, -1.5 + smoothstep(20, 100, u) * 49), ravine);
  return height;
}
export function terrainHeight(s, u) {
  // Driving sees the bridge deck; scenery uses groundHeight for the inlet below.
  if (Math.abs(u) <= 7) return roadHeight(s);
  return groundHeight(s, u);
}

// All chunk boundaries sample the same global rows, including their vertex jitter.
export function terrainColumns(s) {
  const c = coastOffset(s);
  const b = c - 10 - beachWidth(s);
  // Kept independent of the sand coves so their width doesn't reshape the rock foot.
  const toeSpread = Math.min(4.5, 1.2 + 8 * smoothstep(-.15, .85, Math.sin(s / 137 + 1.1)) * (1 - headlandAmount(s) / 44));
  const foot = c - 10 - toeSpread * cliffRib(s);
  const crown = c - cliffRib(s, 1) * 3.6;
  const lower = lerp(foot, crown, .16 + (1 - cliffJoint(s, .3)) * .22);
  const upper = lerp(foot, crown, .56 + (1 - cliffJoint(s, .75)) * .24);
  // A fixed shelf row flattens the turnout apron without vertices jumping
  // between rows at its tapered ends.
  const shelf = (Math.max(crown, -31) - 7) / 2;
  return [-420, -300, b - 90, b - 35, b - 17, b - 7, b, foot, lower, upper, crown, shelf, -7, 0, 7, ...Array.from({ length: 23 }, (_, i) => 14 + i * 12)];
}
export function terrainVertex(row, column) {
  if (column === 6.5) {
    // Extra beach row, lerped from its neighbours so it stays joined to both.
    const shore = terrainVertex(row, 6), foot = terrainVertex(row, 7);
    const t = .5 + (randomAt(row, 2241) - .5) * .16;
    const p = {column};
    for (const axis of ['x', 'z', 's', 'u']) p[axis] = lerp(shore[axis], foot[axis], t);
    p.y = groundHeight(p.s, p.u);
    return p;
  }
  if (column > 10 && column < 11) {
    // Fractional columns facet the bluff top so triangles don't stretch from
    // the crown to the apron.
    const left = terrainVertex(row, 10), right = {};
    const low = terrainVertex(Math.floor(row), 11), high = terrainVertex(Math.ceil(row), 11);
    for (const axis of ['x', 'y', 'z', 's', 'u']) right[axis] = lerp(low[axis], high[axis], row - Math.floor(row));
    const t = column - 10;
    const blend = t + (randomAt(row, Math.round(column * 10) + 1841) - .5) * .055 * Math.sin(t * Math.PI);
    const s = lerp(left.s, right.s, blend), u = lerp(left.u, right.u, blend);
    // Lerp projected x/z too. Separate jitter can invert narrow cells where a
    // headland recedes fast.
    const p = { x: lerp(left.x, right.x, blend), z: lerp(left.z, right.z, blend), y: groundHeight(s, u) };
    // Carry crown relief onto the turf, fading out before the apron.
    const crownRelief = left.y - groundHeight(left.s, coastOffset(left.s));
    p.y += crownRelief * (1 - smoothstep(0, .7, t));
    return { ...p, s, u, column };
  }
  if (column === 9.5) {
    const face = terrainVertex(row, 9), rim = terrainVertex(row, 10);
    // Turf lip over the crest: wider in recesses, thinner and steeper on ribs.
    const exposure = cliffRib(rim.s, 1);
    const t = .18 + exposure * .46 + coastNoise(rim.s, 17, 1691) * .12;
    const drop = .4 + exposure * 1.2 + coastNoise(rim.s, 23, 1692) * .9;
    const p = { column };
    for (const axis of ['x', 'y', 'z', 's', 'u']) p[axis] = lerp(face[axis], rim[axis], t);
    const detail = (1 - ravineAmount(p.s, p.u)) * smoothstep(1.05, 1.65, pondRadius(p.s, p.u));
    p.y = lerp(p.y, Math.max(p.y, rim.y - drop), detail);
    return p;
  }
  const baseS = row * TERRAIN_STEP;
  const seedRow = Number.isInteger(row) ? row : row * 2 + 1048576;
  // Skip the extra cliff column so road and inland seeds stay unchanged.
  const seedColumn = column > 8 ? column - 1 : column;
  const cliff = column >= 6 && column <= 10;
  const along = lerp(randomAt(Math.floor(row), 7), randomAt(Math.ceil(row), 7), row - Math.floor(row));
  const jitter = cliff ? (along - .5) * 4.2
    : (randomAt(seedRow, seedColumn) - .5) * 5.6;
  const pondJitter = column >= 15 ? lerp(.55, 1, smoothstep(1.2, 2.2, pondRadius(baseS, terrainColumns(baseS)[column]))) : 1;
  const s = baseS + pondJitter * ((column > 2 && (column < 12 || column > 14)) ? jitter : 0);
  const columns = terrainColumns(s);
  let u = columns[column];
  if (column >= 7 && column <= 10) u += (randomAt(seedRow + 218, seedColumn) - .5) * (column === 10 ? .8 : column === 7 ? .4 : .9);
  if (column >= 15) u += (randomAt(seedRow + 991, seedColumn) - .5) * Math.min(8, (u - 7) * .26) * pondJitter;
  const p = positionAt(s, u, groundHeight(s, u));
  const detail = smoothstep(1.05, 1.65, pondRadius(s, u)) * (1 - ravineAmount(s, u));
  if (column >= 7 && column <= 10) {
    const height = (column - 7) / 3, rib = cliffRib(s, height);
    const top = groundHeight(s, coastOffset(s));
    const crown = top + (cliffRib(s, 1) * 5.5 - 2 + (coastNoise(s, 19, 1631) - .5) * 3) * smoothstep(-18, -29, coastOffset(s));
    const fracture = coastNoise(s, 23, 1632);
    // Stagger break heights so no seam runs continuously along the wall.
    const lower = .24 + fracture * .2 + rib * .07;
    const upper = .65 + coastNoise(s, 29, 1633) * .18;
    const fraction = column === 7 ? 0 : column === 8 ? lower : column === 9 ? upper : 1;
    p.y = lerp(p.y, lerp(1.2, crown, fraction), detail);
    p.y += (randomAt(seedRow, seedColumn + 500) - .5) * (column === 7 ? .6 : 1.4) * detail;
    if (column === 10) {
      const hollow = (1 - rib) * smoothstep(.2, .8, coastNoise(s, 29, 1693));
      p.y -= hollow * 2.6 * detail;
    }
  }
  if (column >= 17) p.y += (randomAt(seedRow, seedColumn + 700) - .5) * (column > 19 ? 2.2 : 1.2) * detail;
  return { ...p, s, u, column };
}

export function terrainCell(row, col, vertex = terrainVertex) {
  const a = vertex(row, col), b = vertex(row + 1, col);
  const c = vertex(row, col + 1), d = vertex(row + 1, col + 1);
  // Extra faces go to cliff joints. Transition triangles stitch them into the
  // coarse beach and meadow with no T-junctions.
  if (col === 6) {
    const m = vertex(row + .5, 7);
    const splitA = Math.hypot(c.x - a.x, c.z - a.z) > 14;
    const splitB = Math.hypot(d.x - b.x, d.z - b.z) > 14;
    const e = splitA && vertex(row, 6.5), f = splitB && vertex(row + 1, 6.5);
    if (e && f) {
      const beach = randomAt(row, 2242) > .5 ? [[a, b, e], [b, f, e]] : [[a, b, f], [a, f, e]];
      return [...beach, [e, f, m], [e, m, c], [f, d, m]];
    }
    if (e) return [[a, b, e], [b, m, e], [e, m, c], [b, d, m]];
    if (f) return [[a, b, f], [a, f, m], [a, m, c], [f, d, m]];
    return [[a, b, m], [a, m, c], [b, d, m]];
  }
  if (col === 10) {
    const columns = [10, 10.2, 10.4, 10.6, 10.8, 11];
    const triangles = [];
    // Carry the cliff's half-row joints across the bluff, then stitch them
    // into the coarse roadside row.
    for (let i = 0; i < columns.length - 2; i++) for (const offset of [0, .5]) {
      const p = vertex(row + offset, columns[i]), q = vertex(row + offset + .5, columns[i]);
      const r = vertex(row + offset, columns[i + 1]), t = vertex(row + offset + .5, columns[i + 1]);
      triangles.push(...(randomAt(row * 2 + offset * 2, i + 1851) > .5 ? [[p, q, r], [q, t, r]] : [[p, q, t], [p, t, r]]));
    }
    const p = vertex(row, 10.8), q = vertex(row + .5, 10.8), r = vertex(row + 1, 10.8);
    triangles.push([p, q, c], [q, d, c], [q, r, d]);
    return triangles;
  }
  if (col >= 7 && col <= 9) {
    const e = vertex(row + .5, col), f = vertex(row + .5, col + 1);
    if (col === 9) {
      const lipA = vertex(row, 9.5), lipB = vertex(row + .5, 9.5), lipC = vertex(row + 1, 9.5);
      const stone = [[a, e, lipA], [e, lipB, lipA], [e, b, lipC], [e, lipC, lipB]];
      const turf = [[lipA, lipB, c], [lipB, f, c], [lipB, lipC, d], [lipB, d, f]];
      for (const tri of turf) tri.rimTurf = true;
      return [...stone, ...turf];
    }
    return (row + col) % 2 ? [[a, e, c], [e, f, c], [e, b, d], [e, d, f]]
      : [[a, e, f], [a, f, c], [e, b, f], [b, d, f]];
  }
  const seedCol = col > 8 ? col - 1 : col;
  const triangles = (row + seedCol) % 2 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
  return triangles;
}

// Ocean-side guardrail. Scenery and driving both read this so the car hits
// exactly the rails it can see. `coastOffset` is closed form, which keeps this
// cheap enough for every physics step.
export const GUARDRAIL_OFFSET = -6.65;
// The car's centre stops with its flank against the rail.
export const GUARDRAIL_STOP = GUARDRAIL_OFFSET + 1.05;
export const GUARDRAIL_SEGMENT = 4;
function guardrailBeam(middle) {
  // Check both ends so no beam overhangs a viaduct deck or overlook apron.
  const half = GUARDRAIL_SEGMENT / 2;
  let bridgeDistance = Infinity, apron = 0;
  for (const s of [middle - half, middle + half]) {
    bridgeDistance = Math.min(bridgeDistance, Math.abs(s - bridgeAt(s).center));
    apron = Math.max(apron, overlookWidth(s));
  }
  if (bridgeDistance < 49 || apron > 6.2) return false;
  return bridgeDistance <= 64 || coastOffset(middle) >= -35;
}
export function coastalGuardrail(s) {
  // Answer for the whole beam covering s so scenery and collision match exactly.
  const middle = Math.floor(s / GUARDRAIL_SEGMENT) * GUARDRAIL_SEGMENT + GUARDRAIL_SEGMENT / 2;
  // Skip lone beams, which look like stray metal.
  return guardrailBeam(middle)
    && (guardrailBeam(middle - GUARDRAIL_SEGMENT) || guardrailBeam(middle + GUARDRAIL_SEGMENT));
}

// Free-roam limits from the centre line. The cliff term in bounds() can cut
// the ocean side shorter.
export const COAST_VERGE = { ocean: 18, inland: 22 };

export const coastalDrivingRoute = {
  frame: roadFrame,
  position: positionAt,
  height: terrainHeight,
  bounds(s) {
    if (Math.abs(s - bridgeAt(s).center) < 49) return [-4.65, 4.65];
    // Never nearer the cliff edge than 6 m.
    const open = Math.max(drivingCoastOffset(s) + 6, -COAST_VERGE.ocean);
    // A rail is a hard stop; without one the limit stays soft.
    return [coastalGuardrail(s) ? Math.max(open, GUARDRAIL_STOP) : open, COAST_VERGE.inland];
  },
  // Sea counts from slightly above the waterline so the car stops on wet sand.
  // Ponds count inside their basin.
  water(s, u, height) {
    if (height < .35) return true;
    const pond = pondAt(s);
    return height < pond.level + .3 && pondRadius(s, u, pond) < 1.2;
  },
};
