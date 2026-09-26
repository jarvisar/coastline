import { randomAt, roadFrame, positionAt } from './route.js';
import { CAUSEWAY_TOE, SHOULDER, cellSeed, cellOutline, saltPileFields } from './salt-route.js';
import { createDiscoverySchedule } from './discovery-schedule.js';

// Rough miles between sightings of each kind. Lower is more frequent.
// Infinity disables a kind. About 2.5 miles combined.
export const SALT_DISCOVERY_MILES = {
  'train-graveyard': 7.5,
  'salt-lodge': 7.5,
  'cactus-island': 7.5, // Most of them beside a lagoon.
};
const schedule = createDiscoverySchedule(SALT_DISCOVERY_MILES,
  { 'train-graveyard': 1, 'salt-lodge': 1, 'cactus-island': 1 }, 9001, districtSite);
export const SALT_DISCOVERY_SPACING = schedule.spacing;
export const saltDiscoveries = schedule.discoveries;

// Model outlines as [minX, maxX, minZ, maxZ]. Models face the road along -x
// and the approaching traffic along +z.
export const SALT_TRAIN_BOUNDS = [-5, 5, -23, 22.5];
export const SALT_LODGE_BOUNDS = [-12.2, 7.5, -7.5, 9];
// Hard-packed apron in front of the porch, where the drive from the road ends.
export const SALT_LODGE_FORECOURT = [-12.2, -6, -4, 8.6];
// Two sizes. Outlines wander up to a quarter wider than `radius`.
export const SALT_ISLANDS = [{ radius: 15.5, height: 7.4 }, { radius: 12.5, height: 6 }];
// Island paths start on one flank and climb across the face the camera sees.
// Angles run from the model's +z toward +x.
export const ISLAND_LANDING = 100 * Math.PI / 180;
const LAGOON = [-150 * Math.PI / 180, 70 * Math.PI / 180];
// The isometric camera looks from here, so islands turn their path toward it.
const CAMERA_YAW = Math.atan2(-220, 260);

// World x/z back to road s/u by fixed-point iteration.
function routeCoordinates(x, z, s, u) {
  for (let i = 0; i < 12; i++) {
    const p = positionAt(s, u, 0);
    s += p.z - z; u += x - p.x;
  }
  return { s, u };
}
// Model x/z to world offsets from the site, including the left-hand mirror.
export function saltModelOffset(site, x, z) {
  x *= site.flip[0]; z *= site.flip[1];
  const cos = Math.cos(site.yaw), sin = Math.sin(site.yaw);
  return { x: x * cos + z * sin, z: z * cos - x * sin };
}
// Route-space box around a model rectangle, with a margin.
function routeBox(site, [minX, maxX, minZ, maxZ], margin) {
  const root = positionAt(site.s, site.u, 0), corners = [];
  for (const x of [minX, maxX]) for (const z of [minZ, maxZ]) {
    const offset = saltModelOffset(site, x, z);
    corners.push(routeCoordinates(root.x + offset.x, root.z + offset.z, site.s, site.u));
  }
  const s = corners.map(p => p.s), u = corners.map(p => p.u);
  const low = { s: Math.min(...s), u: Math.min(...u) }, high = { s: Math.max(...s), u: Math.max(...u) };
  return { s: (low.s + high.s) / 2, u: (low.u + high.u) / 2, halfS: (high.s - low.s) / 2 + margin, halfU: (high.u - low.u) / 2 + margin };
}
const boxesMeet = (a, b, margin = 0) => Math.abs(a.s - b.s) < a.halfS + b.halfS + margin && Math.abs(a.u - b.u) < a.halfU + b.halfU + margin;
function clearOfPiles(box) {
  return saltPileFields(box.s - box.halfS - 60, box.s + box.halfS + 60).every(field => !boxesMeet(box, {
    s: field.s, u: field.u, halfS: field.columns * field.spacing / 2 + field.rows * Math.abs(field.skew) + 1.5,
    halfU: field.rows * field.spacing / 2 + 1.5 }, 6));
}

function districtSite(kind, index, desired) {
  const preferred = randomAt(index, 9011) < .5 ? -1 : 1, r = salt => randomAt(index, salt);
  for (const offset of [0, 90, -90, 180, -180, 270, -270]) for (const side of [preferred, -preferred]) {
    const s = desired + offset, road = -roadFrame(s).angle;
    let site;
    if (kind === 'train-graveyard') {
      // Track runs roughly along the road so the whole train reads from the car.
      site = { kind, index, s, u: side * (28 + r(9012) * 8), side, yaw: road + (r(9013) - .5) * .5, flip: [1, 1] };
      site.dry = [routeBox(site, SALT_TRAIN_BOUNDS, 3)];
      site.clear = [routeBox(site, SALT_TRAIN_BOUNDS, 1.5)];
    } else if (kind === 'salt-lodge') {
      // Mirrored on the left so the parked truck and flags stay on the side
      // facing oncoming traffic and the camera.
      site = { kind, index, s, u: side * (28 + r(9014) * 4), side, yaw: road + (side < 0 ? Math.PI : 0) + (r(9015) - .5) * .2,
        flip: [1, side < 0 ? -1 : 1], accent: Math.floor(r(9016) * 5) }; // One of the five SALT_LODGE_PAINT colours.
      const forecourt = routeBox(site, SALT_LODGE_FORECOURT, 0), reach = Math.abs(forecourt.u) - forecourt.halfU + 1.2;
      site.drive = { s: forecourt.s, from: side * SHOULDER, to: side * reach };
      const drive = { s: forecourt.s, u: side * (SHOULDER + reach) / 2, halfS: 2.6, halfU: (reach - SHOULDER) / 2 };
      site.dry = [routeBox(site, SALT_LODGE_BOUNDS, 3), { ...drive, halfS: drive.halfS + 1, halfU: drive.halfU + 1 }];
      site.clear = [routeBox(site, SALT_LODGE_BOUNDS, 1.5), drive];
    } else {
      const variant = r(9017) < .55 ? 0 : 1, { radius } = SALT_ISLANDS[variant];
      site = { kind, index, s, u: side * (radius * 1.25 + 22 + r(9018) * 12), side, variant, radius,
        yaw: CAMERA_YAW + (r(9019) - .5) * .6, flip: [side < 0 ? -1 : 1, 1], lagoon: r(9020) < .65 };
      // Keep the foot of the trail dry.
      const landing = { x: Math.sin(ISLAND_LANDING) * radius, z: Math.cos(ISLAND_LANDING) * radius };
      site.dry = [routeBox(site, [landing.x - 4, landing.x + 4, landing.z - 4, landing.z + 4], 0)];
      site.clear = [{ s, u: site.u, radius: radius * 1.3 + 4 }];
    }
    // Only the lodge drive may reach the causeway.
    const [main] = site.clear, footprint = main.halfS === undefined ? { ...main, halfS: main.radius, halfU: main.radius } : main;
    if (Math.abs(footprint.u) - footprint.halfU < CAUSEWAY_TOE + 3 || !clearOfPiles(footprint)) continue;
    return site;
  }
  return null;
}

const shapeDistance = (shape, s, u) => shape.radius !== undefined ? Math.max(0, Math.hypot(s - shape.s, u - shape.u) - shape.radius)
  : Math.hypot(Math.max(0, Math.abs(s - shape.s) - shape.halfS), Math.max(0, Math.abs(u - shape.u) - shape.halfU));
export function saltDiscoveryClears(s, u, sites, radius = 0) {
  return sites.every(site => site.clear.every(shape => shapeDistance(shape, s, u) > radius));
}

// Separating-axis test between a convex cell and a route-space box.
function cellMeetsBox(outline, box) {
  const axes = [[1, 0], [0, 1]];
  for (let j = 0; j < outline.length; j++) {
    const a = outline[j], b = outline[(j + 1) % outline.length];
    axes.push([a.u - b.u, b.s - a.s]);
  }
  for (const [ns, nu] of axes) {
    let low = Infinity, high = -Infinity;
    for (const p of outline) { const d = p.s * ns + p.u * nu; low = Math.min(low, d); high = Math.max(high, d); }
    const centre = box.s * ns + box.u * nu, reach = box.halfS * Math.abs(ns) + box.halfU * Math.abs(nu);
    if (high < centre - reach || low > centre + reach) return false;
  }
  return true;
}
// Forced pool state for a crust cell, or undefined to leave it to the terrain.
// Every cell touching a building or the train stays dry. Lagoon islands flood
// the cells between them and the camera and road, so their cacti reflect.
export function saltDiscoveryFlood(i, k, side) {
  const seed = cellSeed(i, k, side);
  let outline = null, flooded;
  for (const site of saltDiscoveries(seed.s - 140, seed.s + 140)) {
    if (Math.abs(seed.u - site.u) > 140) continue;
    outline ??= cellOutline(i, k, side);
    if (outline.length >= 3 && site.dry.some(box => cellMeetsBox(outline, box))) return false;
    if (!site.lagoon) continue;
    const root = positionAt(site.s, site.u, 0), p = positionAt(seed.s, seed.u, 0), dx = p.x - root.x, dz = p.z - root.z;
    const cos = Math.cos(site.yaw), sin = Math.sin(site.yaw);
    const x = (dx * cos - dz * sin) * site.flip[0], z = dx * sin + dz * cos, angle = Math.atan2(x, z);
    if (Math.hypot(x, z) < site.radius + 26 && angle > LAGOON[0] && angle < LAGOON[1]) flooded = true;
  }
  return flooded;
}
