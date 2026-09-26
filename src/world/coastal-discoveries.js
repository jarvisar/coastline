import { randomAt, headlandCenter, coastOffset, shorelineOffset, beachWidth, bridgeAt, overlookAt, groundHeight } from './route.js';
import { createDiscoverySchedule } from './discovery-schedule.js';

// Rough miles between sightings of each kind. Lower is more frequent.
// Infinity disables a kind. About 2.5 miles combined.
export const COASTAL_DISCOVERY_MILES = {
  lighthouse: 6,
  dock: 6,
  whale: 15,
};
const schedule = createDiscoverySchedule(COASTAL_DISCOVERY_MILES,
  { lighthouse: .99, dock: .98, whale: 1 }, 2101, districtSite);
export const COASTAL_DISCOVERY_SPACING = schedule.spacing;
// Gulls are scheduled separately in environment.js / birds.js.

function clearHeadland(s) {
  const overlook = overlookAt(s);
  return coastOffset(s) < -48 && Math.abs(s - bridgeAt(s).center) > 110
    && (!overlook.enabled || Math.abs(s - overlook.center) > 110);
}
function towerSite(index, desired) {
  const first = Math.round((desired - 80) / 176);
  for (const offset of [0, -1, 1, -2, 2]) {
    const s = headlandCenter(first + offset), u = coastOffset(s) + 23;
    if (!clearHeadland(s) || u > -27) continue;
    const heights = [-5, 5].flatMap(ds => [-5, 5].map(du => groundHeight(s + ds, u + du)));
    if (Math.max(...heights) - Math.min(...heights) > 3.4) continue;
    return { kind: 'lighthouse', index, s, u, radius: 18 };
  }
  return null;
}
function dockSite(index, desired) {
  // Search for a wide beach near the district anchor. Districts can end up empty.
  const direction = randomAt(index, 2113) > .5 ? 1 : -1;
  for (const offset of [0, 64, -64, 128, -128, 192, -192]) {
    const s = desired + offset * direction;
    if (beachWidth(s) < 16) continue;
    // Needs dry sand at the shore end and a fairly straight waterline across its width.
    const shore = shorelineOffset(s);
    if ([-4, 0, 4].some(ds => groundHeight(s + ds, shore + 7) < .8
      || Math.abs(shorelineOffset(s + ds) - shore) > 2.5)) continue;
    return { kind: 'dock', index, s, u: shorelineOffset(s) + 3.5, radius: 23 };
  }
  return null;
}
function districtSite(kind, index, desired) {
  if (kind === 'lighthouse') return towerSite(index, desired);
  if (kind === 'dock') return dockSite(index, desired);
  return { kind, index, s: desired, u: shorelineOffset(desired) - 68, radius: 22 };
}

export const coastalDiscoveries = schedule.discoveries;

export function discoveryClearsPlanting(s, u, sites) {
  return sites.every(site => {
    if (site.kind === 'lighthouse') {
      const ds = Math.abs(s - site.s);
      // Clears the compound and its footpath to the road.
      return !(Math.hypot(s - site.s, u - site.u) < 18 || (ds < 4.5 && u >= site.u && u < -7));
    }
    if (site.kind === 'dock') return Math.hypot(s - site.s, u - site.u) > 24;
    return true;
  });
}
