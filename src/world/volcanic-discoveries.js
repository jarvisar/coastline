import { CHUNK_LENGTH, randomAt } from './route.js';
import { creekSection, riftProfile, shelfSteps, shelfFault, volcanicNaturalTerrainHeight as volcanicHeight, volcanicCrossing, crossingChannel } from './volcanic-route.js';
import { createDiscoverySchedule } from './discovery-schedule.js';
import { volcanicPlatformLayout } from './volcanic-discovery-platforms.js';

// Rough miles between sightings of each kind. Lower is more frequent.
// Infinity disables a kind. About 2.5 miles combined.
export const VOLCANIC_DISCOVERY_MILES = {
  'geothermal-station': 9,
  'abandoned-mine': 11.25,
  'research-camp': 9,
  'basalt-arch': 11.25,
};
const schedule = createDiscoverySchedule(VOLCANIC_DISCOVERY_MILES,
  { 'geothermal-station': .84, 'abandoned-mine': 1, 'research-camp': .7, 'basalt-arch': 1 }, 81200, (...args) => {
    const site=districtSite(...args);
    return site ? {...site,platform:volcanicPlatformLayout(site,volcanicHeight)} : null;
  });
export const VOLCANIC_DISCOVERY_SPACING = schedule.spacing;
export const volcanicDiscoveries = schedule.discoveries;

function districtSite(kind, index, desired) {
  // Keep the destination in its owning chunk; buildings avoid river bridges.
  const center = Math.floor(desired / CHUNK_LENGTH) * CHUNK_LENGTH + 52 + randomAt(index, 81204) * 23;
  const preferredSide = randomAt(index, 81203) < .5 ? -1 : 1;
  if (kind === 'basalt-arch' && randomAt(index,81208) >= .3) {
    // Arch over the river beside the road; its span runs along the road.
    const crossing = volcanicCrossing(desired), u = preferredSide*(27 + randomAt(index,81209)*8);
    const s = crossingChannel(crossing,u).s;
    return {kind,index,s,u,side:preferredSide,halfS:27,halfU:10,turn:Math.PI/2};
  }
  for (const offset of [0, 128, -128, 256, -256, 384, -384, 512, -512, 16, -16, 144, -144, 272, -272, 400, -400]) {
    const s = center + offset;
    if (Math.abs(s - volcanicCrossing(s).centre) < 105) continue;
    if (kind === 'abandoned-mine') {
      // Entrance sits in a shelf scarp: rear in basalt, spoil terrace on the open face.
      const side = preferredSide;
      const near = Math.min(...Array.from({length:17},(_,i)=>riftProfile(s-16+i*2,-1).near));
      const toe = Math.min(...Array.from({length:15},(_,i)=>shelfSteps(s-14+i*2,1).toe));
      const u = side > 0 ? toe - .8 : -near + 18.1;
      if (Math.abs(u)<25) continue;
      let dry = true;
      for(let ds=-14;ds<=14;ds+=2)for(let du=-15;du<=13;du+=2) {
        const t=s+ds,v=u+du,creek=creekSection(t);
        if(v < -riftProfile(t,-1).near+3 || (v>0 && (v>creek.u-creek.width/2-2 || shelfFault(t,v)>.04))) dry=false;
      }
      if(!dry)continue;
      const heights = [-10, 0, 10].map(ds => volcanicHeight(s + ds, u));
      if (Math.max(...heights) - Math.min(...heights) > 3.5) continue;
      return { kind, index, s, u, side, halfS: 17, halfU: 15 };
    }
    if (kind === 'basalt-arch') {
      return {kind,index,s,u:0,side:1,halfS:14,halfU:26,roadSpanning:true};
    }
    const halfU = kind === 'research-camp' ? 10 : 9;
    const halfS = 14;
    const firstSide = preferredSide;
    for (const side of [firstSide, -firstSide]) for (const distance of [22, 25, 28, 35, 43]) {
      const u = side * (distance + (randomAt(index,81206)-.5)*3);
      // Sample the interior too. Corners alone can straddle a narrow scarp or
      // miss a lava spillway through the camp.
      const samples = [];
      for (let ds = -halfS; ds <= halfS; ds += 2) for (let du = -halfU; du <= halfU; du += 2) samples.push([s + ds, u + du]);
      if (samples.some(([t, v]) => Math.abs(v) < 11 || Math.abs(v) > riftProfile(t, side).near - 3
        || (side > 0 && shelfFault(t, v) > .04))) continue;
      const heights = samples.map(([t, v]) => volcanicHeight(t, v));
      if (Math.max(...heights) - Math.min(...heights) > 4) continue;
      return { kind, index, s, u, side, halfS, halfU };
    }
  }
  return null;
}

export function volcanicDiscoveryClears(s, u, sites, radius = 0) {
  return sites.every(site => Math.abs(s - site.s) >= site.halfS + radius + 3 || Math.abs(u - site.u) >= site.halfU + radius + 3);
}
