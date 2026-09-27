import { randomAt } from './route.js';
import { swampBridgeAt } from './swamp-route.js';
import { createDiscoverySchedule } from './discovery-schedule.js';

// Average driven miles between encounters. Infinity disables the camps,
// including their clearings and lanterns, just like the other discoveries.
export const SWAMP_DISCOVERY_MILES = { 'fishing-camp': 2.5 };
const schedule = createDiscoverySchedule(SWAMP_DISCOVERY_MILES, { 'fishing-camp': 1 }, 3021, campSite);
export const SWAMP_DISCOVERY_SPACING = schedule.spacing;
export const swampDiscoveries = schedule.discoveries;

function campSite(kind, index, desired) {
  const r = salt => randomAt(index, salt), side = r(3023) < .62 ? 1 : -1;
  // Move a camp along the bank if its intended landing meets a bridge.
  // Placement never asks the ground sampler, which itself clears these sites.
  for (const offset of [0, 130, -130, 260, -260]) {
    const s = desired + offset;
    if (Math.abs(s - swampBridgeAt(s).center) < 120) continue;
    return { kind, index, s, u: side * (32 + r(3024) * 17), side,
      yaw: (r(3025) - .5) * .5, floor: 1.6 + r(3026) * .5, radius: 18 };
  }
  return null;
}

// Adjacent chunks consult the same sites before placing trees, reeds or land.
// The complete porch, dock and boat share their parent's clearing.
export function swampDiscoveryNear(s, u, radius = 0) {
  const reach = 18 + radius;
  return swampDiscoveries(s - reach, s + reach).find(site => Math.hypot(s - site.s, u - site.u) < site.radius + radius) ?? null;
}
