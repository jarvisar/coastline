import { roadFrame, positionAt, randomAt, smoothstep, lerp, clamp } from './route.js';

export const CITY_STEP = 8;
// Only long shallow swells, so the river can sit on one plane and the quay
// wall height changes gently.
const swellPhase = [randomAt(0, 3001) * Math.PI * 2, randomAt(1, 3001) * Math.PI * 2];
export const cityRoadHeight = s => 24 + 1.2 * Math.sin(s / 340 + swellPhase[0]) + .5 * Math.sin(s / 141 + swellPhase[1]);
export const cityFrame = s => ({ ...roadFrame(s), y: cityRoadHeight(s) });

export const PAVEMENT_LIFT = .15;
export const KERB = 6;
export const pavementHeight = s => cityRoadHeight(s) + PAVEMENT_LIFT;

// The river surface is one level plane. The quay line wanders between a
// narrow promenade and a wider embankment.
export const RIVER_LEVEL = 19.8;
export const RIVER_BED = 18.1;
export const QUAY_NEAR = 20, QUAY_FAR = 46;
const quayPhase = [randomAt(2, 3001) * Math.PI * 2, randomAt(3, 3001) * Math.PI * 2];
export function quayOffset(s) {
  const t = .5 + .32 * Math.sin(s / 241 + quayPhase[0]) + .18 * Math.sin(s / 89 + quayPhase[1]);
  return -(QUAY_NEAR + (QUAY_FAR - QUAY_NEAR) * clamp(t, 0, 1));
}
export const QUAY_WALL = 1.4;
export const FAR_BANK = -126.5, FAR_BANK_TOP = -131;
export const farBankHeight = s => cityRoadHeight(s) - .4;

// Block boundaries snap to terrain rows. Roads, pavements and lots share this grid.
export const BLOCK_SPAN = 104;
export const STREET_HALF_WIDTH = 8;
export const SIDE_ROAD_HALF_WIDTH = 5.5;
export const BANK_ROADS = [-142, -188, -245];
export const INLAND_ROADS = [{ u: 40, halfWidth: 2.65 }, { u: 87, halfWidth: 1.9 }, { u: 160, halfWidth: SIDE_ROAD_HALF_WIDTH }];
export function blockBoundary(index) { return Math.round((index * BLOCK_SPAN + 30 + randomAt(index, 3011) * 48) / CITY_STEP) * CITY_STEP; }
export function blockAt(s) {
  let index = Math.floor((s - 30) / BLOCK_SPAN);
  while (s < blockBoundary(index)) index--;
  while (s >= blockBoundary(index + 1)) index++;
  return index;
}
// Inland cross streets always reach the boulevard. Near streets also bridge the river.
export function nearStreet(index) { return randomAt(index, 3012) < .45; }
export function bankStreetRange(index) {
  // Some local streets stop at the middle avenue. Bridge streets always run through.
  return { from: !nearStreet(index) && randomAt(index, 3661) < .38 ? BANK_ROADS[1] : BANK_ROADS.at(-1),
    to: nearStreet(index) ? -5.5 : BANK_ROADS[0] };
}
export function crossStreetAt(s) {
  const index = blockAt(s), before = blockBoundary(index), after = blockBoundary(index + 1);
  return s - before < after - s ? { index, center: before } : { index: index + 1, center: after };
}
export function onCrossStreet(s, u) {
  const street = crossStreetAt(s);
  if (Math.abs(s - street.center) >= STREET_HALF_WIDTH) return false;
  if (u > 0) return u > KERB && u < 168;
  if (u <= FAR_BANK_TOP) {
    const range = bankStreetRange(street.index);
    return u > range.from - SIDE_ROAD_HALF_WIDTH && u < range.to + SIDE_ROAD_HALF_WIDTH;
  }
  return u < -KERB && nearStreet(street.index);
}

// One corridor clears the quay, bridge approaches and their furniture.
export function onRiverCrossing(s, u, margin = 0) {
  const street = crossStreetAt(s);
  return nearStreet(street.index) && Math.abs(s - street.center) < STREET_HALF_WIDTH + margin && u < -KERB && u > BANK_ROADS[0] - STREET_HALF_WIDTH - margin;
}

// Crowned for clearance with no step at either bank. Paving and railings both sample it.
export function bridgeSurfaceHeight(s, u) {
  const near = quayOffset(s) + 1.5, far = FAR_BANK_TOP - 2;
  const t = clamp((near - u) / (near - far), 0, 1);
  return lerp(pavementHeight(s), farBankHeight(s), t) - PAVEMENT_LIFT + .075 + .5 * Math.sin(Math.PI * t);
}

// Streets are cut a kerb into the ground. Buildings and pavements keep cityGroundHeight.
export function cityStreetHeight(s, u) {
  return cityGroundHeight(s, u) - PAVEMENT_LIFT * clamp((Math.abs(u) - KERB) / .6, 0, 1) + .075;
}
export function cityRoadbedHeight(s, u) {
  const street = crossStreetAt(s);
  const bankStreet = bankStreetRange(street.index);
  const halfWidth = Math.abs(u) <= 8 ? STREET_HALF_WIDTH : SIDE_ROAD_HALF_WIDTH;
  const across = Math.abs(s - street.center) <= halfWidth &&
    ((u >= KERB && u <= 168) || (u <= bankStreet.to + SIDE_ROAD_HALF_WIDTH && u <= FAR_BANK_TOP && u >= bankStreet.from - SIDE_ROAD_HALF_WIDTH) ||
      (nearStreet(street.index) && u <= -KERB && u >= quayOffset(s)));
  const along = [...INLAND_ROADS, ...BANK_ROADS.map(u => ({ u, halfWidth: SIDE_ROAD_HALF_WIDTH }))]
    .some(road => Math.abs(u - road.u) <= road.halfWidth + .001);
  return across || along ? cityStreetHeight(s, u) - .075 : cityGroundHeight(s, u);
}

// Building bands with an alley between each pair.
export const BANDS = [{ front: 14, back: 36 }, { front: 44, back: 84 }, { front: 90, back: 150 }];
export const SKYLINE_FROM = 182;
export const BANK_BANDS = [{ front: -153, back: -178 }, { front: -199, back: -235 }];

// Seven columns follow the quay: two into the river, the wall foot and top,
// and three across the promenade. The rest are fixed offsets.
const RIVER_COLUMNS = [-420, -370, -325, -285, -260, -253, -250.5, -245, -239.5, -237, -235, -220, -206, -199, -196, -193.5, -188, -182.5, -180, -178, -166, -153, -150, -147.5, -142, -136.5, -134, FAR_BANK_TOP, FAR_BANK, -120, -108, -94, -80, -64];
const FAR_COLUMNS = [KERB, 6.6, 9.5, 13, 16, 20, 25, 30, 36, 37.35, 40, 42.65, 44, 50, 58, 67, 77, 84, 85.1, 87, 88.9, 90, 98, 108, 120, 134, 150, 154.5, 160, 165.5, 168, 182, 200, 222, 248, 278, 312, 350, 392, 440, 495, 555];
const QUAY_COLUMNS = 7;
export const CITY_COLUMN_COUNT = RIVER_COLUMNS.length + QUAY_COLUMNS + 2 + 1 + FAR_COLUMNS.length;
export function cityColumns(s) {
  const q = quayOffset(s), promenade = -6.6 - q;
  return [...RIVER_COLUMNS, q - 14, q - 7, q - QUAY_WALL, q, q + promenade * .28, q + promenade * .55, q + promenade * .8, -6.6, -KERB, 0, ...FAR_COLUMNS];
}

// Road and gutters sit a kerb below the pavements. The far side rises gently
// so building rows step up behind each other.
export function cityGroundHeight(s, u) {
  const h = cityRoadHeight(s), cross = Math.abs(u);
  if (cross <= KERB) return h;
  if (cross < 6.6) return h + PAVEMENT_LIFT * (cross - KERB) / .6;
  const pavement = h + PAVEMENT_LIFT;
  if (u > 0) {
    const swell = .35 * smoothstep(40, 90, u) * (Math.sin(s / 57 + u / 41) + .5 * Math.sin(s / 23 - u / 31));
    return pavement + 5 * smoothstep(60, 320, u) + swell + 7 * smoothstep(300, 520, u);
  }
  const q = quayOffset(s);
  if (u >= q) return pavement;
  if (u >= q - QUAY_WALL) return lerp(pavement, RIVER_BED, (q - u) / QUAY_WALL);
  if (u > FAR_BANK) return RIVER_BED;
  const bank = farBankHeight(s);
  if (u > FAR_BANK_TOP) return lerp(RIVER_BED, bank, (FAR_BANK - u) / (FAR_BANK - FAR_BANK_TOP));
  return bank + 2 * smoothstep(-180, -420, u);
}
// Driving sees flat road everywhere the car is allowed to go.
export function cityHeight(s, u) {
  return Math.abs(u) <= KERB ? cityRoadHeight(s) : cityGroundHeight(s, u);
}
// The far bank uses its own district axes so avenues don't copy every bend of
// the road. Terrain, lots and markings all go through this map so joins match.
const bankAxes = new Map();
function bankAxis(index) {
  if (!bankAxes.has(index)) {
    const s = blockBoundary(index * 2);
    bankAxes.set(index, { s, x: roadFrame(s).x * .6 + (randomAt(index, 3662) - .5) * 28, z: (randomAt(index, 3663) - .5) * 20 });
    if (bankAxes.size > 128) bankAxes.delete(bankAxes.keys().next().value);
  }
  return bankAxes.get(index);
}
export function cityPosition(s, u, y = cityHeight(s, u)) {
  const p = positionAt(s, u, y);
  const bridgeFar = FAR_BANK_TOP - 2;
  if (u > bridgeFar && u < -QUAY_NEAR + 1.5) {
    const street = crossStreetAt(s);
    const weight = 1 - smoothstep(STREET_HALF_WIDTH, STREET_HALF_WIDTH + 12, Math.abs(s - street.center));
    if (weight > 0 && nearStreet(street.index)) {
      const near = quayOffset(s) + 1.5;
      if (u < near) {
        // Bridge spans run straight between their bank endpoints. Paving, rails
        // and supports share this map; the river bed eases back around it.
        const a = positionAt(s, near, y), b = positionAt(s, bridgeFar, y);
        const t = (near - u) / (near - bridgeFar);
        p.x = lerp(p.x, lerp(a.x, b.x, t), weight);
        p.z = lerp(p.z, lerp(a.z, b.z, t), weight);
      }
    }
  }
  if (u >= -138) return p;
  const index = Math.floor(blockAt(s) / 2), a = bankAxis(index), b = bankAxis(index + 1);
  const t = (s - a.s) / (b.s - a.s), weight = smoothstep(-138, -235, u);
  p.x = lerp(p.x, u + lerp(a.x, b.x, t), weight);
  p.z = lerp(p.z, -s + lerp(a.z, b.z, t), weight);
  return p;
}
export function cityStreetYaw(s, u) {
  const a = cityPosition(s - .5, u), b = cityPosition(s + .5, u);
  return Math.atan2(a.x - b.x, a.z - b.z);
}

export function cityVertex(row, column) {
  const s = row * CITY_STEP, columns = cityColumns(s), base = columns[column];
  // Only the river bed and far rises are jittered. The core grid keeps straight edges.
  const loose = base < -260 || base > 170;
  const gap = Math.min(base - (columns[column - 1] ?? base - 40), (columns[column + 1] ?? base + 40) - base);
  const u = base + (loose ? (randomAt(row, column + 3021) - .5) * Math.min(6, gap * .3) : 0);
  const t = s + (loose ? (randomAt(row, column + 3022) - .5) * 3.2 : 0);
  const p = cityPosition(t, u, cityRoadbedHeight(t, u));
  if (u > 300) p.y += (randomAt(row, column + 3023) - .5) * 2.4 * smoothstep(300, 400, u);
  return { ...p, s: t, u, column };
}

export const cityDrivingRoute = {
  frame: cityFrame, position: cityPosition, height: cityHeight,
  bounds: () => [-KERB + .1, KERB - .1],
  // The river bed is the only city ground below the water surface.
  water: (s, u, height) => height < RIVER_LEVEL + .3,
};
