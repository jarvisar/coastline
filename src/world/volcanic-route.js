import { roadFrame, roadHeight, positionAt, randomAt, smoothstep, lerp } from './route.js';
import { volcanicDiscoveries } from './volcanic-discoveries.js';
import { volcanicPlatformHeight } from './volcanic-discovery-platforms.js';

export const VOLCANIC_STEP = 8;
// Columns on one side of the road count outward from the centre line. These two
// are the crests of the near and far cliffs; the chunk builder shades by them.
export const SHELF_EDGE = 13, PLATEAU_EDGE = 21;

function terrace(s, salt, span = 48) {
  const cell = Math.floor(s / span);
  return lerp(randomAt(cell, salt), randomAt(cell + 1, salt), smoothstep(.2, .8, s / span - cell));
}
function uplift(s, salt, span = 64) {
  const cell = Math.floor(s / span);
  return lerp(randomAt(cell, salt), randomAt(cell + 1, salt), smoothstep(.28, .58, s / span - cell));
}

// Two lava courses flank a continuous, driveable shelf. Their widths and cliffs
// wander independently; all samples use world coordinates across chunk seams.
// A short, abrupt terrace on top of the broad one breaks each cliff line into
// angular buttresses and recesses instead of one smooth ribbon.
function riftShape(s, side) {
  if (side > 0) {
    const { u } = creekLayout(s);
    // These bounds locate the supporting shelf, not an excavated channel.
    return { near: u - 9, far: u + 9, rise: 18 + 20 * terrace(s, 7108) };
  }
  const near = 29 + 9 * Math.sin(s / 94 + .8) + 13 * terrace(s, 7100) + 14 * terrace(s, 7110, 24);
  const width = 88 + 30 * Math.sin(s / 117 + .8) ** 2 + 34 * terrace(s, 7103) + 9 * terrace(s, 7113, 24);
  return { near, far: near + width, rise: 12 + 18 * terrace(s, 7106) };
}

export function riftProfile(s, side) {
  const shape = riftShape(s, side);
  const level = side < 0 ? roadHeight(s) - 8 : creekLayout(s).level;
  return { ...shape, level };
}

// Two uplifted benches with short, steep scarps. Keep their breakpoints in
// the mesh as well as the height sampler: extra elevation alone makes hills.
export function shelfSteps(s, side) {
  const { near } = riftShape(s, side);
  return shelfBreaks(s, side, near);
}
function shelfBreaks(s, side, near) {
  const toe = side > 0 ? Math.min(near - 19, 18 + 13 * terrace(s, 7154, 48)) : lerp(17, near - 2, .24);
  const upper = lerp(toe + 3, near - 2, .4 + .18 * terrace(s + 32, 7155, 64));
  return { toe, upper };
}

// The near shelf above the left basin retains its exposed scarp.
function shelfHeight(s, u, near) {
  const d = Math.abs(u), side = Math.sign(u), { toe } = shelfBreaks(s, side, near);
  const ash = (.7 * Math.sin(s / 17 + u / 11) + .45 * Math.sin(s / 7 - u / 9)) * smoothstep(7, 17, d);
  const ledge = (2 + 8 * terrace(s, 7153, 64)) * smoothstep(toe, Math.min(toe + 3, near), d);
  return roadHeight(s) + ash * .55 + ledge;
}

function bankSteps(s, side) {
  // Fault traces wander independently, so their shelves broaden, narrow and
  // curl into one another instead of repeating parallel contour bands.
  const lower = 16 + 16 * terrace(s + 40, 7171 + side, 80);
  const upper = 52 + 24 * terrace(s - 24, 7181 + side, 96);
  return { lower, upper };
}

// A shared layout gives the creek and its supporting shelf the same gentle
// grade. Long wavelengths keep all height changes gradual, including where
// the stream turns across the hill. No pre-existing cliff is draped in lava.
function creekLayout(s) {
  const u = 60 + 5 * Math.sin(s / 109 + 3.4) + 5 * Math.sin(s / 37 + 1.1) + 2.5 * Math.sin(s / 17 + .4);
  const height = 14 + 5 * Math.sin(s / 151 + .3) + 2 * Math.sin(s / 67 + 2.1);
  return { u, level: roadHeight(s) + height + .075 };
}

function hillsideHeight(s, u) {
  const creek = creekLayout(s), road = roadHeight(s), { toe, upper } = shelfBreaks(s, 1, creek.u - 9);
  const share = .4 + .08 * Math.sin(s / 73 + .5);
  const terraces = share * smoothstep(toe, toe + 2.6, u) + (1 - share) * smoothstep(upper, upper + 2.6, u);
  // Intact benches retain their sharp basalt faces. Broad saddles between
  // them carry the tributaries down gradual slopes instead of over a lip.
  let saddle = 0;
  for (const branch of [false, true]) {
    const cell = Math.round((s - (branch ? 88 : 24)) / 128), flow = shelfFlow(cell, branch, u);
    saddle = Math.max(saddle, (1 - smoothstep(3.5, 13, Math.abs(s - flow.s))) * smoothstep(flow.end - 7, flow.end - 2, u));
  }
  const rise = lerp(terraces, smoothstep(17, creek.u - 10, u), saddle);
  const ash = (.55 * Math.sin(s / 23 + u / 13) + .3 * Math.sin(s / 11 - u / 17)) * smoothstep(7, 17, u);
  const apron = road + (creek.level - .075 - road) * rise + ash * (1 - rise);
  const bank = bankSteps(s, 1), out = u - creek.u - 9;
  const hill = (6 + 8 * terrace(s + 40, 7191, 160)) * smoothstep(0, 18, out);
  const ledges = 16 * (.5 + uplift(s, 7122, 64)) * smoothstep(bank.lower, bank.lower + 4, out)
    + 18 * (.4 + uplift(s + 24, 7132, 96)) * smoothstep(.18, .7, terrace(s + 64, 7185, 160)) * smoothstep(bank.upper, bank.upper + 5, out);
  return apron + hill + ledges;
}

export function volcanicColumns(s) {
  const sideColumns = side => {
    const { near, far } = riftShape(s, side);
    const { toe, upper } = shelfSteps(s, side);
    const bank = bankSteps(s, side);
    const shelf = side > 0 ? [toe, toe + .8, toe + 2.6, toe + 3.2, upper, upper + .8, upper + 2.6, near - 3.2, near - 1.2]
      : [.12, .24, .34, .42, .52, .62, .74, .86, .96].map(t => lerp(17, near, t));
    const channel = [near, near + 1.5, near + 4.5, near + 6, (near + far) / 2, far - 6, far - 4.5, far - 1.5, far];
    return [5.5, 7, 11, 17, ...shelf, ...channel, far + 8, far + bank.lower, far + bank.lower + 4,
      far + (bank.lower + 4 + bank.upper) / 2, far + bank.upper, far + bank.upper + 5, far + bank.upper + 24,
      ...[.2, .45, .72, 1].map(t => lerp(far + bank.upper + 24, 400, t))];
  };
  return [...sideColumns(-1).reverse().map(u => -u), 0, ...sideColumns(1)];
}

// A cliff in section: a short bevelled lip, a near-vertical face, then a toe
// that runs under the lava. `t` is metres out from the cliff's upper edge.
const WALL_RUN = 6, WALL = [[0, 0], [1.5, .13], [4.5, .9], [WALL_RUN, 1]];
function wall(t) {
  for (let i = 1; i < WALL.length; i++) if (t <= WALL[i][0]) {
    return lerp(WALL[i - 1][1], WALL[i][1], (t - WALL[i - 1][0]) / (WALL[i][0] - WALL[i - 1][0]));
  }
  return 1;
}

// Shallow spillways cross the right terraces. Both dressing and collision
// use these same meandering paths; their toes stop above the roadside apron.
export function shelfFlow(cell, branch, u) {
  const centre = cell * 128 + (branch ? 88 : 24);
  const near = riftShape(centre, 1).near;
  const toe = shelfBreaks(centre, 1, near).toe;
  const end = branch ? Math.max(toe + 4, near - 14 - randomAt(cell, 7162) * 5) : Math.max(25, toe + 3);
  const s = centre + (branch ? Math.sin(u / 11) * 2 : Math.sin((u - end) / 9) * 2.2);
  const t = smoothstep(end, near, u), pool = Math.exp(-(((u - end - 2.8) / 3) ** 2));
  const width = (branch ? .4 : .7) + t * (branch ? .45 : .8) + pool * (branch ? .7 : 2.3);
  return { s, end, near, width: width * smoothstep(end - 1, end + 1.8, u) };
}

export function creekSection(s) {
  const { u, level } = creekLayout(s), grade = Math.abs(creekLayout(s + 1).level - creekLayout(s - 1).level) / 2;
  const cell = Math.floor(s / 256), centre = cell * 256 + 68 + randomAt(cell, 7195) * 112;
  const pool = Math.exp(-(((s - centre) / 15) ** 2)) * (1 - smoothstep(.055, .12, grade));
  return { u, level, width: 2.1 + .6 * Math.sin(s / 17 + .8) ** 2 + pool * 4.5 };
}

// One substantial cross-valley river every four chunks. The bridge belongs
// entirely to its middle chunk; the channel bends independently on each bank.
export function volcanicCrossing(s) {
  const index = Math.round((s - 64) / 512);
  const centre = index * 512 + 64 + Math.round((randomAt(index, 80700) - .5) * 8) * 2;
  const halfSpan = 16 + Math.floor(randomAt(index, 80701) * 2) * 2;
  return { index, centre, halfSpan, start: centre - halfSpan, end: centre + halfSpan };
}

export function crossingChannel(crossing, u) {
  const { centre, index } = crossing;
  const bend = (randomAt(index, 80702) - .5) * .18;
  const s = centre + u * bend + Math.sin(u / 17) * 4.8 + (1 - Math.cos(u / 8)) * 2;
  const creek = creekSection(s), basin = riftProfile(s, -1), under = roadHeight(s) - 5.4;
  const t = Math.max(0, Math.min(1, (u - 8) / (creek.u - 12)));
  // Three broken shelves carry short cascades between slower, wider reaches.
  // A little grade remains on the benches so none read as artificial steps.
  const upper = .12 * t + .88 * (.25 * smoothstep(.08, .28, t) + .44 * smoothstep(.42, .64, t) + .31 * smoothstep(.78, 1, t));
  const lower = smoothstep(3, basin.near + 2, -u);
  // The outlet stands just above the receiving basin before submerging in it;
  // two coplanar lava sheets must never compete at the mouth.
  const level = u >= 0 ? lerp(under, creek.level, upper) : lerp(under, basin.level + .15, lower);
  const neck = 9 + randomAt(index, 80703) * 2;
  const width = u >= 0 ? lerp(neck, creek.width * 1.15, smoothstep(20, creek.u, u))
    + 3.8 * Math.exp(-(((t - .35) / .105) ** 2)) + 2.5 * Math.exp(-(((t - .71) / .085) ** 2))
    : neck + lower * 3.5 + Math.sin(-u / 9) ** 2 * 1.8;
  return { s, u, level, width, source: creek.u, mouth: -basin.near - 5 };
}

// The bed, bank setbacks and scattered dressing all use this same footprint.
export function crossingInfluence(s, u, margin = 0) {
  const crossing = volcanicCrossing(s);
  if (Math.abs(s - crossing.centre) > 38 || u > 80 || u < -90) return 0;
  const channel = crossingChannel(crossing, u);
  if (u > channel.source + 1 || u < channel.mouth - 3) return 0;
  const distance = Math.abs(s - channel.s), inner = channel.width / 2 + margin;
  return 1 - smoothstep(inner, inner + 8, distance);
}

export function shelfFault(s, u) {
  if (u <= 24) return 0;
  let amount = 0;
  for (const branch of [false, true]) {
    const cell = Math.round((s - (branch ? 88 : 24)) / 128), flow = shelfFlow(cell, branch, u);
    amount = Math.max(amount, (1 - smoothstep(flow.width / 2, flow.width / 2 + 1.1, Math.abs(s - flow.s))) * smoothstep(flow.end - 1, flow.end + 1.8, u));
  }
  return amount;
}

function baseHeight(s, u) {
  const d = Math.abs(u), road = roadHeight(s);
  if (d <= 7) return road;
  if (u > 0) {
    return hillsideHeight(s, u);
  }
  const side = -1, { near, far, level, rise } = riftProfile(s, side), bed = level - 1.8;
  const shoulder = shelfHeight(s, u, near);
  if (d < near) return shoulder;
  const low = near + WALL_RUN, high = far - WALL_RUN;
  if (d < low) return lerp(shoulder, bed, wall((d - near) * WALL_RUN / (low - near)));
  if (d < high) return bed;
  // The far bank of the left basin climbs in broad, exposed steps.
  const bank = bankSteps(s, side), out = d - far;
  const climb = 8 * (.5 + uplift(s, 7121 + side, 64)) * smoothstep(bank.lower, bank.lower + 4, out)
    + 6 * (.4 + uplift(s + 24, 7131 + side, 96))
      * smoothstep(.18, .7, terrace(s + 64, 7184 + side, 160)) * smoothstep(bank.upper, bank.upper + 5, out);
  const plateau = road + rise + climb + 2.1 * Math.sin(s / 47 + u / 59) + .8 * Math.sin(s / 24 + u / 19);
  return d < far ? lerp(plateau, bed, wall(far - d)) : plateau;
}

export function volcanicNaturalTerrainHeight(s, u) {
  const base = baseHeight(s, u), crossing = volcanicCrossing(s);
  if (Math.abs(s - crossing.centre) > 38 || u > 80 || u < -90) return base;
  const channel = crossingChannel(crossing, u);
  if (u > channel.source || u < channel.mouth) return base;
  const side = Math.sign(s - channel.s) || 1, distance = Math.abs(s - channel.s);
  // A broad molten floor, a steep broken bank, then a worn outer shoulder.
  // The last few metres meet the original creek shelf without cutting it down.
  const inner = channel.width / 2 + .65 + .4 * Math.sin(u * .41 + side * 2);
  const outer = inner + 5.5 + Math.sin(u * .23 + side * 1.8 + crossing.index) * 1.5 + Math.sin(u * .63) * .7;
  const cut = 1 - (.76 * smoothstep(inner, inner + 3.3, distance) + .24 * smoothstep(inner + 3.3, outer, distance));
  const sourceFade = 1 - smoothstep(channel.source - 7, channel.source, u);
  return lerp(base, Math.min(base, channel.level - .075), cut * sourceFade);
}

const discoveryTerrainCache = new Map();
function platformTerrain(s,u,natural) {
  if(Math.abs(u)<=7 || Math.abs(u)>85)return natural;
  const cell=Math.floor(s/128);
  if(!discoveryTerrainCache.has(cell)) {
    discoveryTerrainCache.set(cell,volcanicDiscoveries(cell*128-64,(cell+1)*128+64).filter(site=>site.platform));
    if(discoveryTerrainCache.size>128)discoveryTerrainCache.delete(discoveryTerrainCache.keys().next().value);
  }
  const sites=discoveryTerrainCache.get(cell);
  if(!sites.length)return natural;
  // Preserve the road, open lava channels and the original basin cliff lip.
  const near=riftProfile(s,Math.sign(u)).near;
  const protection=smoothstep(7,11,Math.abs(u))*(1-smoothstep(near-5,near-1,Math.abs(u)));
  return volcanicPlatformHeight(s,u,natural,sites,protection);
}

export function volcanicTerrainHeight(s,u) {
  return platformTerrain(s,u,volcanicNaturalTerrainHeight(s,u));
}

export function volcanicHeight(s, u) {
  // Driving samples the deck; the terrain mesh continues through the open
  // channel underneath it. This also keeps lane-assisted traffic level.
  if (Math.abs(u) <= 7) return roadHeight(s);
  return volcanicTerrainHeight(s, u);
}

export function volcanicPosition(s, u, height = volcanicHeight(s, u)) { return positionAt(s, u, height); }

export function volcanicVertex(row, column, jitter = 3) {
  const base = volcanicColumns(row * VOLCANIC_STEP), centre = (base.length - 1) / 2, band = Math.abs(column - centre) - 1;
  const road = Math.abs(base[column]) <= 7;
  const s = row * VOLCANIC_STEP + (road ? 0 : (randomAt(row, column + 7120) - .5) * jitter);
  const columns = volcanicColumns(s), gap = Math.min(columns[column] - (columns[column - 1] ?? columns[column] - 20), (columns[column + 1] ?? columns[column] + 20) - columns[column]);
  const u = columns[column] + (road ? 0 : (randomAt(row, column + 7140) - .5) * Math.min(5, gap * .3));
  // Cliff rows keep the height designed for their column, so sideways jitter
  // facets the face without sliding a crest vertex down to the lava.
  const cliff = band >= 4 && crossingInfluence(s, u, 4) < .01;
  const natural=volcanicNaturalTerrainHeight(s,cliff?columns[column]:u);
  return { ...volcanicPosition(s, u, platformTerrain(s,u,natural)), s, u, band };
}

export const volcanicDrivingRoute = {
  frame: roadFrame, position: volcanicPosition, height: volcanicHeight,
  // Allow room for the car's full footprint before a steep roadside scarp.
  bounds: s => {
    const bridge = volcanicCrossing(s);
    return s > bridge.start - 2 && s < bridge.end + 2 ? [-7, 7] : [-shelfSteps(s, -1).toe + 3, shelfSteps(s, 1).toe - 3];
  },
  // The existing impassable-surface check also keeps tires out of molten rock.
  water: (s, u) => {
    if (Math.abs(u) <= 7) return false;
    if (crossingInfluence(s, u) > .9) return true;
    if (u > 0) {
      const creek = creekSection(s);
      return Math.abs(u - creek.u) < creek.width / 2 + 1
        || (u > 18 && u < creek.u && shelfFault(s, u) > .35);
    }
    const { near, far } = riftProfile(s, Math.sign(u) || 1);
    return Math.abs(u) > near + 1 && Math.abs(u) < far + 2;
  },
};
