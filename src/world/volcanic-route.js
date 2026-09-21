import { roadFrame, roadHeight, positionAt, randomAt, smoothstep, lerp } from './route.js';

export const VOLCANIC_STEP = 8;
// Columns on one side of the road count outward from the centre line. These two
// are the crests of the near and far cliffs; the chunk builder shades by them.
export const SHELF_EDGE = 9, PLATEAU_EDGE = 17;

function terrace(s, salt, span = 48) {
  const cell = Math.floor(s / span);
  return lerp(randomAt(cell, salt), randomAt(cell + 1, salt), smoothstep(.2, .8, s / span - cell));
}

// Two faults flank a continuous, driveable shelf. Their widths and cliffs
// wander independently; all samples use world coordinates across chunk seams.
// A short, abrupt terrace on top of the broad one breaks each cliff line into
// angular buttresses and recesses instead of one smooth ribbon.
export function riftProfile(s, side) {
  const phase = side < 0 ? .8 : 3.4;
  const near = (side < 0 ? 29 : 55) + (side < 0 ? 9 : 13) * Math.sin(s / 94 + phase)
    + (side < 0 ? 13 : 22) * terrace(s, 7101 + side) + 14 * terrace(s, 7111 + side, 24);
  // One open basin on the camera's side, a thin creek between the right ridges.
  // The six-metre banks leave only 1–9 metres of open lava in that creek.
  const width = side < 0 ? 62 + 30 * Math.sin(s / 117 + phase) ** 2 + 30 * terrace(s, 7104 + side) + 9 * terrace(s, 7114 + side, 24)
    : 13 + 3 * Math.sin(s / 117 + phase) ** 2 + 5 * terrace(s, 7104 + side);
  return { near, far: near + width, level: roadHeight(s) - (side < 0 ? 8 : 4.5),
    rise: (side < 0 ? 5 : 12) + (side < 0 ? 15 : 16) * terrace(s, 7107 + side) };
}

export function volcanicColumns(s) {
  const sideColumns = side => {
    const { near, far } = riftProfile(s, side);
    const toe = Math.max(23, near * .48);
    return [5.5, 7, 11, 17, side > 0 ? toe : lerp(17, near - 2, .38), side > 0 ? toe + 6 : lerp(17, near - 2, .76),
      side > 0 ? lerp(toe + 6, near - 2, .4) : lerp(17, near - 2, .84), side > 0 ? lerp(toe + 6, near - 2, .72) : lerp(17, near - 2, .92), near - 2, near, near + 1.5, near + 4.5, near + 6,
      (near + far) / 2, far - 6, far - 4.5, far - 1.5, far, far + 5, far + 14, far + 28, far + 48,
      ...[.2, .45, .72, 1].map(t => lerp(far + 48, 400, t))];
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

// Short tributaries split the right terraces, ending above a generous strip
// of solid ground beside the road. Their centres align with terrain rows.
export function shelfFault(s, u) {
  if (u <= 25) return 0;
  const cell = Math.round((s - 24) / 128), centre = cell * 128 + 24;
  const end = 27 + randomAt(cell, 7161) * 7;
  const bend = Math.sin((u - end) / 9) * 2.2;
  const width = lerp(7, 10, smoothstep(end, end + 30, u));
  return (1 - smoothstep(3.5, width, Math.abs(s - centre - bend))) * smoothstep(end, end + 7, u);
}

export function volcanicHeight(s, u) {
  const d = Math.abs(u), road = roadHeight(s);
  if (d <= 7) return road;
  const side = Math.sign(u), { near, far, level, rise } = riftProfile(s, side), bed = level - 1.8;
  const ash = (.7 * Math.sin(s / 17 + u / 11) + .45 * Math.sin(s / 7 - u / 9)) * smoothstep(7, 17, d);
  // A row of broken, blunt summits rises on the right, then steps down toward
  // the creek. The opposite shelf stays low, exposing the raised lava basin.
  const ridge = side > 0 ? (10 + 20 * terrace(s, 7151, 64) + 11 * terrace(s, 7152, 24)) : 0;
  const toe = Math.max(23, near * .48);
  const summit = lerp(toe + 6, near - 2, .4);
  const slope = d < summit ? smoothstep(toe, summit, d) : lerp(1, .4, smoothstep(summit, near, d));
  const shoulder = lerp(road + ash + ridge * slope, bed, shelfFault(s, u));
  if (d < near) return shoulder;
  if (d < near + WALL_RUN) return lerp(shoulder, bed, wall(d - near));
  if (d < far - WALL_RUN) return bed;
  // The far bank climbs away from the road in broad steps, higher on the side
  // behind the road than on the side the overhead camera looks across.
  const out = d - far, climb = side < 0 ? 7 * smoothstep(12, 170, out) * (.35 + terrace(s + out * .6, 7121 + side, 96))
    : 52 * smoothstep(5, 65, out) * (.4 + terrace(s + out * .6, 7121 + side, 64))
      + 16 * Math.sin(s / 23 + out / 17) ** 2 * smoothstep(14, 50, out);
  const plateau = road + rise + climb + 2.2 * Math.sin(s / 24 + u / 19) + 1.3 * Math.sin(s / 11 - u / 13) * smoothstep(0, 16, out);
  return d < far ? lerp(plateau, bed, wall(far - d)) : plateau;
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
  const cliff = band >= SHELF_EDGE && band <= PLATEAU_EDGE;
  return { ...volcanicPosition(s, u, volcanicHeight(s, cliff ? columns[column] : u)), s, u, band };
}

export const volcanicDrivingRoute = {
  frame: roadFrame, position: volcanicPosition, height: volcanicHeight,
  bounds: s => [-riftProfile(s, -1).near + 3, Math.min(24, Math.max(23, riftProfile(s, 1).near * .48) - 3)],
  // The existing impassable-surface check also keeps tires out of molten rock.
  water: (s, u) => {
    const { near, far, level } = riftProfile(s, Math.sign(u) || 1);
    return (Math.abs(u) > near + 1 && Math.abs(u) < far + 2)
      || (u > 25 && u < near && volcanicHeight(s, u) < level + .5);
  },
};
