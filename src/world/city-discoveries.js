import { blockBoundary, blockAt, crossStreetAt, nearStreet, quayOffset, STREET_HALF_WIDTH, FAR_BANK_TOP, BANDS, BANK_BANDS } from './city-route.js';
import { createDiscoverySchedule } from './discovery-schedule.js';

// Rough miles between sightings of each kind. Lower is more frequent.
// Infinity disables a kind. About 2.5 miles combined.
export const CITY_DISCOVERY_MILES = {
  'river-bridge': 7.5, // Side street crossing the river.
  square: 7.5, // Park and fountain.
  'clock-tower': 7.5, // Church.
};
const schedule = createDiscoverySchedule(CITY_DISCOVERY_MILES,
  { 'river-bridge': 1, square: 1, 'clock-tower': 1 }, 3101, districtSite);
export const CITY_DISCOVERY_SPACING = schedule.spacing;

function districtSite(kind, index, desired) {
  let site = null;
  if (kind === 'river-bridge') {
    // Continues a side street that already reaches the quay.
    const nearest = crossStreetAt(desired).index;
    for (const offset of [0, 1, -1, 2, -2, 3, -3]) {
      const street = nearest + offset;
      if (!nearStreet(street)) continue;
      const s = blockBoundary(street);
      site = { kind, index, street, s, u: (quayOffset(s) + FAR_BANK_TOP) / 2, side: -1, halfS: STREET_HALF_WIDTH, u0: BANK_BANDS[1].back - 4, u1: -6.6 };
      break;
    }
  } else if (kind === 'square') {
    // Needs a long block. Two building rows give way to lawn.
    for (const offset of [0, 1, -1, 2, -2]) {
      const block = blockAt(desired) + offset, start = blockBoundary(block), end = blockBoundary(block + 1);
      if (end - start < 96) continue;
      const s = (start + end) / 2;
      site = { kind, index, block, s, u: (BANDS[0].front + BANDS[1].back) / 2, side: 1, halfS: (end - start) / 2 - STREET_HALF_WIDTH - 2, u0: BANDS[0].front - 1, u1: BANDS[1].back + 2 };
      break;
    }
  } else {
    // Church on the block's first lot, by the side street.
    const block = blockAt(desired), start = blockBoundary(block);
    const s = start + STREET_HALF_WIDTH + 3 + 14;
    site = { kind, index, block, s, u: BANDS[0].front + 13, side: 1, halfS: 10, u0: BANDS[0].front - 1, u1: BANDS[0].front + 27 };
  }
  return site;
}

export const cityDiscoveries = schedule.discoveries;

// True when the point or lot is outside every site's rectangle.
export function cityDiscoveryClears(s, u, discoveries, radius = 0) {
  return discoveries.every(site => !(Math.abs(s - site.s) < site.halfS + radius && u > site.u0 - radius && u < site.u1 + radius));
}
export function cityLotClears(s0, s1, u0, u1, discoveries) {
  return discoveries.every(site => s1 <= site.s - site.halfS || s0 >= site.s + site.halfS || u1 <= site.u0 || u0 >= site.u1);
}

// Split the frontage around sites before laying out lots. Rejecting whole
// overlapping lots leaves empty ground beside small landmarks.
export function cityBuildingSpans(s0, s1, u0, u1, discoveries) {
  let spans = [{ s0, s1 }];
  for (const site of discoveries) {
    if (u1 <= site.u0 || u0 >= site.u1) continue;
    const from = site.s - site.halfS - .7, to = site.s + site.halfS + .7;
    spans = spans.flatMap(span => {
      if (span.s1 <= from || span.s0 >= to) return [span];
      return [{ s0: span.s0, s1: Math.min(span.s1, from) }, { s0: Math.max(span.s0, to), s1: span.s1 }]
        .filter(part => part.s1 - part.s0 > 9);
    });
  }
  return spans;
}
