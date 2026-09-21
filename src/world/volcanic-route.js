import { roadFrame, roadHeight, positionAt, randomAt, smoothstep, lerp } from './route.js';

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
export function riftProfile(s, side) {
  const phase = side < 0 ? .8 : 3.4;
  const near = (side < 0 ? 29 : 48) + 9 * Math.sin(s / 94 + phase)
    + (side < 0 ? 13 : 19) * terrace(s, 7101 + side) + 14 * terrace(s, 7111 + side, 24);
  // An open basin on the camera's side, a shallow perched creek on the right.
  const width = side < 0 ? 88 + 30 * Math.sin(s / 117 + phase) ** 2 + 34 * terrace(s, 7104 + side) + 9 * terrace(s, 7114 + side, 24)
    : 13 + 3 * Math.sin(s / 117 + phase) ** 2 + 5 * terrace(s, 7104 + side);
  return { near, far: near + width, level: side < 0 ? roadHeight(s) - 8 : shelfHeight(s, near, near) - .45,
    rise: (side < 0 ? 12 : 18) + (side < 0 ? 18 : 20) * terrace(s, 7107 + side) };
}

// Two uplifted benches with short, steep scarps. Keep their breakpoints in
// the mesh as well as the height sampler: extra elevation alone makes hills.
export function shelfSteps(s, side) {
  const { near } = riftProfile(s, side);
  return shelfBreaks(s, side, near);
}
function shelfBreaks(s, side, near) {
  const toe = side > 0 ? Math.min(near - 19, 18 + 13 * terrace(s, 7154, 48)) : lerp(17, near - 2, .24);
  const upper = lerp(toe + 3, near - 2, .4 + .18 * terrace(s + 32, 7155, 64));
  return { toe, upper };
}

// The right creek inherits the height of this uncut shelf. Keeping that
// elevation separate from incision prevents tributaries becoming deep slots.
function shelfHeight(s, u, near) {
  const d = Math.abs(u), side = Math.sign(u), { toe, upper } = shelfBreaks(s, side, near);
  const ash = (.7 * Math.sin(s / 17 + u / 11) + .45 * Math.sin(s / 7 - u / 9)) * smoothstep(7, 17, d);
  const join = smoothstep(.24, .65, terrace(s, 7174, 144));
  const fold = (1.7 * Math.sin(s / 37 + d / 62) + 1.2 * Math.sin(s / 79 - d / 43)) * smoothstep(toe, toe + 3, d);
  const ledge = side > 0
    ? (4.5 + 6.5 * uplift(s, 7151, 64)) * smoothstep(toe, toe + 2.6, d)
      + (6 + 10 * uplift(s + 16, 7152, 96)) * join * smoothstep(upper, upper + 2.6, d) + fold
    : (2 + 8 * terrace(s, 7153, 64)) * smoothstep(toe, Math.min(toe + 3, near), d);
  return roadHeight(s) + ash * .55 + ledge;
}

function bankSteps(s, side) {
  // Fault traces wander independently, so their shelves broaden, narrow and
  // curl into one another instead of repeating parallel contour bands.
  const lower = 16 + 16 * terrace(s + 40, 7171 + side, 80);
  const upper = 52 + 24 * terrace(s - 24, 7181 + side, 96);
  return { lower, upper };
}

export function volcanicColumns(s) {
  const sideColumns = side => {
    const { near, far } = riftProfile(s, side);
    const { toe, upper } = shelfSteps(s, side);
    const bank = bankSteps(s, side);
    const shelf = side > 0 ? [toe, toe + .8, toe + 2.6, toe + 3.2, upper, upper + .8, upper + 2.6, near - 3.2, near - 1.2]
      : [.12, .24, .34, .42, .52, .62, .74, .86, .96].map(t => lerp(17, near, t));
    return [5.5, 7, 11, 17, ...shelf, near, near + 1.5, near + 4.5, near + 6,
      (near + far) / 2, far - 6, far - 4.5, far - 1.5, far, far + 8, far + bank.lower, far + bank.lower + 4,
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
  const near = riftProfile(centre, 1).near;
  const end = branch ? near - 18 - randomAt(cell, 7162) * 8 : 27 + randomAt(cell, 7161) * 7;
  const s = centre + (branch ? Math.sin(u / 11) * 2 : Math.sin((u - end) / 9) * 2.2);
  const t = smoothstep(end, near, u), pool = Math.exp(-((u - end - 3.5) / 3.3) ** 2);
  const width = (branch ? .55 : .8) + t * (branch ? .65 : 1.2) + pool * (branch ? 1.2 : 2.3);
  return { s, end, near, width: width * smoothstep(end - 1, end + 1.8, u) };
}

export function shelfFault(s, u) {
  if (u <= 25) return 0;
  let amount = 0;
  for (const branch of [false, true]) {
    const cell = Math.round((s - (branch ? 88 : 24)) / 128), flow = shelfFlow(cell, branch, u);
    amount = Math.max(amount, (1 - smoothstep(flow.width / 2, flow.width / 2 + 1.1, Math.abs(s - flow.s))) * smoothstep(flow.end - 1, flow.end + 1.8, u));
  }
  return amount;
}

export function volcanicHeight(s, u) {
  const d = Math.abs(u), road = roadHeight(s);
  if (d <= 7) return road;
  const side = Math.sign(u), { near, far, level, rise } = riftProfile(s, side), bed = level - (side > 0 ? .35 : 1.8);
  const shoulder = shelfHeight(s, u, near) - .45 * shelfFault(s, u);
  if (d < near) return shoulder;
  if (d < near + WALL_RUN) return lerp(shoulder, bed, wall(d - near));
  if (d < far - WALL_RUN) return bed;
  // The far bank climbs away from the road in broad steps, higher on the side
  // behind the road than on the side the overhead camera looks across.
  const bank = bankSteps(s, side), out = d - far;
  const climb = (side < 0 ? 8 : 16) * (.5 + uplift(s, 7121 + side, 64)) * smoothstep(bank.lower, bank.lower + 4, out)
    + (side < 0 ? 6 : 18) * (.4 + uplift(s + 24, 7131 + side, 96))
      * smoothstep(.18, .7, terrace(s + 64, 7184 + side, 160)) * smoothstep(bank.upper, bank.upper + 5, out);
  const plateau = road + rise + climb + 2.1 * Math.sin(s / 47 + u / 59) + .8 * Math.sin(s / 24 + u / 19);
  // A low cooling bank touches the perched flow. The mountain rises beyond
  // it, leaving room for gravel bars and boulders beside the lava.
  const bankHeight = side > 0 ? lerp(level + .7, Math.max(level + .7, plateau), smoothstep(0, bank.lower, out)) : plateau;
  return d < far ? lerp(bankHeight, bed, wall(far - d)) : bankHeight;
}

export function volcanicPosition(s, u, height = volcanicHeight(s, u)) { return positionAt(s, u, height); }

export function volcanicVertex(row, column) {
  const base = volcanicColumns(row * VOLCANIC_STEP), centre = (base.length - 1) / 2, band = Math.abs(column - centre) - 1;
  const road = Math.abs(base[column]) <= 7;
  const s = row * VOLCANIC_STEP + (road ? 0 : (randomAt(row, column + 7120) - .5) * 3);
  const columns = volcanicColumns(s), gap = Math.min(columns[column] - (columns[column - 1] ?? columns[column] - 20), (columns[column + 1] ?? columns[column] + 20) - columns[column]);
  const u = columns[column] + (road ? 0 : (randomAt(row, column + 7140) - .5) * Math.min(5, gap * .3));
  // Cliff rows keep the height designed for their column, so sideways jitter
  // facets the face without sliding a crest vertex down to the lava.
  const cliff = band >= 4;
  return { ...volcanicPosition(s, u, volcanicHeight(s, cliff ? columns[column] : u)), s, u, band };
}

export const volcanicDrivingRoute = {
  frame: roadFrame, position: volcanicPosition, height: volcanicHeight,
  // Allow room for the car's full footprint before a steep roadside scarp.
  bounds: s => [-shelfSteps(s, -1).toe + 3, shelfSteps(s, 1).toe - 3],
  // The existing impassable-surface check also keeps tires out of molten rock.
  water: (s, u) => {
    const { near, far, level } = riftProfile(s, Math.sign(u) || 1);
    return (Math.abs(u) > near + 1 && Math.abs(u) < far + 2)
      || (u > 25 && u < near && shelfFault(s, u) > .35);
  },
};
