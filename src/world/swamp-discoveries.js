import { randomAt, roadFrame, positionAt, smoothstep } from './route.js';
import { swampBridgeAt, swampRoadHeight } from './swamp-route.js';
import { createDiscoverySchedule } from './discovery-schedule.js';

// Average driven miles between encounters. Lower is more frequent and Infinity
// disables a kind, including its clearing, lights and fireflies. About 2.5 miles combined.
export const SWAMP_DISCOVERY_MILES = {
  'fishing-camp': 10,
  'hollow-cypress': 10,
  chapel: 10, // With its lot, drive and churchyard.
  riverboat: 10,
};
const schedule = createDiscoverySchedule(SWAMP_DISCOVERY_MILES,
  { 'fishing-camp': 1, 'hollow-cypress': 1, chapel: 1, riverboat: 1 }, 3021, landmarkSite);
export const SWAMP_DISCOVERY_SPACING = schedule.spacing;
export const swampDiscoveries = schedule.discoveries;

// The chapel's model frame starts this far from the centre line, square to the
// road, so its drive meets the shoulder. Model x runs away from the road and z
// back toward oncoming traffic. The pad is the raised lawn as
// [minX, maxX, minZ, maxZ], and the drive leaves the road between two z.
export const CHAPEL_SETBACK = 30;
export const CHAPEL_PAD = [-26, 28, -26, 24];
export const CHAPEL_DRIVE = [5.4, 13.6];
// The fill slopes down to the swamp over PAD_BANK, and its far corners are
// rounded off. The road side stays square against the causeway.
const PAD_BANK = 8, PAD_CORNER = 11;

// The isometric camera looks from here. The hollow tree turns its opening toward it.
const CAMERA_YAW = Math.atan2(-220, 260);
// Footprints are a point, or a line along the road `half` either side for the
// long ones. `radius` keeps trees and reeds back, `core` also keeps lilies out
// of hulls and roots, and `water` fades the islands out between two distances.
// Tall landmarks stand farther out on the camera's side of the road, and the
// chapel always faces the camera across it.
const LAYOUT = {
  'fishing-camp': { half: 0, radius: 18, core: 0, water: [9, 26], clearing: .3, far: [32, 49], near: [32, 49], share: .62 },
  'hollow-cypress': { half: 0, radius: 30, core: 13, water: [24, 46], clearing: .5, far: [52, 60], near: [70, 76], share: .75 },
  chapel: { half: 24, radius: 28, core: 28, water: [30, 46], clearing: .35, far: [32, 32], near: [32, 32], share: 1 },
  riverboat: { half: 21, radius: 12, core: 8, water: [11, 26], clearing: .5, far: [35, 41], near: [35, 41], share: .7 },
};
// Farthest any footprint and its clearing reach along the road.
const REACH = 80;

function landmarkSite(kind, index, desired) {
  const r = salt => randomAt(index, salt), layout = LAYOUT[kind], side = r(3023) < layout.share ? 1 : -1;
  const [low, high] = side > 0 ? layout.far : layout.near;
  // Move a landmark along the bank if it would meet a bridge.
  // Placement never asks the ground sampler, which itself clears these sites.
  for (const offset of [0, 130, -130, 260, -260]) {
    const s = desired + offset;
    if (Math.abs(s - swampBridgeAt(s).center) < 120 + layout.half) continue;
    const u = side * (low + r(3024) * (high - low)), { half, core, water, clearing } = layout;
    // Trees between the camera and a near-side landmark would hide it.
    const radius = layout.radius + (side < 0 && kind !== 'fishing-camp' ? 12 : 0);
    const site = { kind, index, s, u, side, half, radius, core, water, clearing };
    if (kind === 'fishing-camp') return { ...site, yaw: (r(3025) - .5) * .5, floor: 1.6 + r(3026) * .5 };
    // The others use yaw as the model's own turn. They face the camera along
    // -x and +z, so the paddlewheel greets oncoming drivers.
    if (kind === 'hollow-cypress') return { ...site, yaw: CAMERA_YAW + (r(3027) - .5) * .5 };
    const frame = roadFrame(s);
    if (kind === 'riverboat') return { ...site, yaw: -frame.angle + (r(3027) - .5) * .08 };
    // The lawn sits level with the verge, a little below the road. The drive
    // leaves the road where the lot's edge squares back onto it.
    const level = swampRoadHeight(s) - .35, origin = [frame.x + CHAPEL_SETBACK * frame.nx, level, frame.z + CHAPEL_SETBACK * frame.nz];
    const drive = CHAPEL_DRIVE.map(z => chapelDriveEnd({ origin, yaw: -frame.angle, s }, z)).sort((a, b) => a - b);
    return { ...site, u: CHAPEL_SETBACK + 2, yaw: -frame.angle, level, origin, drive };
  }
  return null;
}

// World x/z back to road s/u by fixed-point iteration.
export function routeOf(x, z, s, u) {
  for (let i = 0; i < 30; i++) { const p = positionAt(s, u, 0); s += p.z - z; u += x - p.x; }
  return { s, u };
}
// Where the lot's road-side edge stands in the chapel model.
export const CHAPEL_LOT_EDGE = -16.38;
// Road distance where a line across the drive, `z` along the model, meets the road.
export function chapelDriveEnd(site, z) {
  const cos = Math.cos(site.yaw), sin = Math.sin(site.yaw), x = CHAPEL_LOT_EDGE;
  return routeOf(site.origin[0] + x * cos + z * sin, site.origin[2] - x * sin + z * cos, site.s - z, CHAPEL_SETBACK + x).s;
}

// Raised, level ground under the chapel, lot and lawn, banked down to the
// swamp all round. Measured in the model's frame, which drifts from road
// coordinates away from the causeway. Returns the fill height and its weight.
export function swampPad(s, u) {
  for (const site of swampDiscoveries(s - REACH, s + REACH)) {
    if (!site.origin) continue;
    const p = positionAt(s, u, 0), dx = p.x - site.origin[0], dz = p.z - site.origin[2], cos = Math.cos(site.yaw), sin = Math.sin(site.yaw);
    const x = dx * cos - dz * sin, z = dx * sin + dz * cos, [x0, x1, z0, z1] = CHAPEL_PAD;
    // Rounded rectangle, with the rounding only past the lot.
    const corner = x > 0 ? PAD_CORNER : 0;
    const d = Math.hypot(Math.max(0, x0 - x, x - x1 + corner), Math.max(0, z0 + corner - z, z - z1 + corner)) - corner;
    if (d < PAD_BANK) return { level: site.level, amount: 1 - smoothstep(0, PAD_BANK, d) };
  }
  return null;
}
// Whether the far-side guardrail opens here for a chapel drive.
export function swampDriveway(s, margin = 1.5) {
  return swampDiscoveries(s - REACH, s + REACH).some(site => site.drive && s > site.drive[0] - margin && s < site.drive[1] + margin);
}

// Distance from a landmark's footprint.
export function swampSiteDistance(site, s, u) {
  return Math.hypot(Math.max(0, Math.abs(s - site.s) - site.half), u - site.u);
}
// Adjacent chunks consult the same sites before placing trees, reeds or land.
// Everything a landmark brings, like a camp's dock and boat, shares its clearing.
export function swampDiscoveryNear(s, u, radius = 0, reach = 'radius') {
  return swampDiscoveries(s - REACH - radius, s + REACH + radius).find(site => swampSiteDistance(site, s, u) < site[reach] + radius) ?? null;
}
// How much open water each landmark carves from the islands, 0 to `clearing`.
export function swampClearing(s, u) {
  let amount = 0;
  for (const site of swampDiscoveries(s - REACH, s + REACH)) {
    amount = Math.max(amount, site.clearing * (1 - smoothstep(site.water[0], site.water[1], swampSiteDistance(site, s, u))));
  }
  return amount;
}
