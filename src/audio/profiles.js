// Engine sound is separate from handling. The default car sounds like its journey.
// Garage cars keep their own voice everywhere.
const tourer = { idle: 820, redline: 4200, cylinders: 4, gearing: 1, body: 1, rasp: .65, intake: .6, harmonics: [1, .52, .28, .16, .09, .055, .025] };
const voice = changes => ({ ...tourer, ...changes });
export const ENGINES = {
  coast: voice({}),
  desert: voice({ idle: 730, cylinders: 6, gearing: .88, body: 1.35, rasp: .8 }),
  snow: voice({ idle: 780, gearing: .95, rasp: .4, intake: .4 }),
  jungle: voice({ idle: 710, redline: 3700, gearing: .83, body: 1.5, rasp: .9 }),
  plains: voice({ idle: 740, cylinders: 6, gearing: .9, body: 1.2, rasp: .5 }),
  city: voice({ idle: 850, body: .8, rasp: .35, intake: .4 }),
  volcanic: voice({ idle: 710, cylinders: 6, gearing: .88, body: 1.4, rasp: .8 }),
  salt: voice({ idle: 760, cylinders: 6, gearing: .92, body: 1.25, rasp: .55 }),
  swamp: voice({ idle: 690, cylinders: 6, gearing: .86, body: 1.45, rasp: .75, intake: .5 }),
  hatchback: voice({ idle: 920, gearing: 1.2, body: .6, rasp: .85, intake: .9, harmonics: [1, .35, .42, .15, .13, .06] }),
  sedan: voice({ idle: 720, cylinders: 6, gearing: .95, rasp: .35, harmonics: [1, .25, .15, .08, .04] }),
  wagon: voice({ idle: 780, body: 1.2, rasp: .55 }),
  pickup: voice({ idle: 640, cylinders: 8, gearing: .78, body: 1.8, rasp: 1.1, harmonics: [1, .7, .22, .3, .12, .1, .05] }),
  van: voice({ idle: 680, redline: 3500, gearing: .8, body: 1.5, rasp: 1.2, intake: .3 }),
  sports: voice({ idle: 980, redline: 6500, cylinders: 6, gearing: 1.55, body: .85, rasp: 1, intake: 1.4, harmonics: [1, .6, .38, .26, .18, .12, .075, .04] }),
  // `open` means no cabin, so first person hears it unfiltered.
  formula: voice({ idle: 1800, redline: 12500, cylinders: 8, gearing: 3.1, body: .5, rasp: .9, intake: 1.8, harmonics: [1, .48, .24, .13, .06, .03], open: true }),
  buggy: voice({ idle: 900, redline: 5200, gearing: 1.25, body: .7, rasp: 1.3, intake: 1.1, harmonics: [1, .45, .5, .2, .18, .08], open: true }),
  monster: voice({ idle: 700, redline: 4800, cylinders: 8, gearing: .95, body: 1.9, rasp: 1.35, intake: 1.2, harmonics: [1, .72, .25, .32, .14, .1, .05] }),
  hotrod: voice({ idle: 760, redline: 6200, cylinders: 8, gearing: 1.25, body: 1.6, rasp: 1.4, intake: 1.7, harmonics: [1, .75, .3, .34, .16, .12, .07, .04], open: true }),
  rig: voice({ idle: 600, redline: 2300, cylinders: 6, gearing: .42, body: 2, rasp: .9, intake: .25, harmonics: [1, .8, .35, .3, .1, .05] }),
  micro: voice({ idle: 1100, redline: 6000, gearing: 1.7, body: .45, rasp: 1.1, intake: .7, harmonics: [1, .3, .5, .12, .2, .05] }),
};
export const engineFor = (car, journey = 'coast') => ENGINES[car === 'auto' ? journey : car] ?? ENGINES.coast;

// Route sounds. `bed` is low wind (the ocean on the coast) and `gust` is how
// much it varies. `air` is a higher noise layer. `water` plays near water or
// lava and `chorus` is an insect or frog loop. `calls` are [kind, weight,
// level, nearest m, farthest m], one every `interval` seconds, with `space`
// as their reverb. `enclosure` is a minimum for the echo level and `echo` is
// its [delay, feedback].
export const AMBIENCE = {
  coast: { bed: .36, low: 420, gust: .2, air: .014, high: 2600, water: 'surf', waterLevel: .4, rough: 1100,
    calls: [['gull', 1, .55, 25, 110]], interval: [6, 14],
    space: { decay: 1.3, damping: 4500, echoes: [[.11, .1]] }, echo: [.14, .1] },
  desert: { bed: .095, low: 560, gust: .55, air: .019, high: 3200, water: 'stream', waterLevel: .07, rough: 1700,
    calls: [['wren', 3, .45, 30, 90], ['raven', 2, .5, 40, 160], ['hawk', 1, .4, 80, 260]], interval: [9, 20],
    space: { decay: 2.2, damping: 3800, echoes: [[.16, .3], [.38, .18], [.71, .1]] }, echo: [.19, .18] },
  snow: { bed: .06, low: 300, gust: .45, air: .011, high: 1800, water: 'lap', waterLevel: .055, rough: 620,
    calls: [['owl', 6, .5, 40, 180], ['howl', 1, .35, 400, 900]], interval: [14, 28],
    space: { decay: 2.8, damping: 2800, echoes: [[.4, .18], [1.1, .1]] }, echo: [.32, .12] },
  jungle: { bed: .055, low: 380, gust: .25, air: .014, high: 3000, water: 'river', waterLevel: .095, chorus: 'jungle', chorusLevel: .095, rough: 870,
    calls: [['piha', 3, .45, 30, 120], ['trill', 3, .35, 15, 70], ['squawk', 2, .4, 25, 110], ['drip', 1, .25, 3, 12]], interval: [3, 8],
    space: { decay: 1.5, damping: 3500, echoes: [[.05, .15], [.09, .1]] }, echo: [.07, .15], enclosure: .3 },
  plains: { bed: .08, low: 420, gust: .5, air: .027, high: 1900, water: 'stream', waterLevel: .07, chorus: 'crickets', chorusLevel: .07, rough: 1200,
    calls: [['meadowlark', 4, .45, 30, 110], ['bobwhite', 2, .4, 40, 140], ['crow', 2, .4, 60, 220]], interval: [8, 16],
    space: { decay: .9, damping: 5000 }, echo: [.12, .05] },
  city: { bed: .08, low: 260, gust: .15, air: .034, high: 4200, rain: .35, rough: 1000,
    calls: [['drip', 1, .4, 3, 20]], interval: [1.5, 4.5],
    space: { decay: 1.8, damping: 5000, echoes: [[.023, .25], [.041, .2], [.067, .16], [.097, .12], [.13, .1]] }, echo: [.045, .3], enclosure: .6 },
  volcanic: { bed: .19, low: 120, gust: .4, air: .016, high: 1300, water: 'lava', waterLevel: .16, rough: 1500,
    calls: [['steam', 4, .35, 30, 120], ['rumble', 2, .7, 200, 600], ['clatter', 2, .4, 25, 90]], interval: [5, 12],
    space: { decay: 2.4, damping: 2500, echoes: [[.21, .22], [.52, .14]] }, echo: [.22, .16] },
  salt: { bed: .12, low: 500, gust: .35, air: .011, high: 2400, rough: 1900,
    calls: [['flamingo', 3, .55, 50, 220], ['stilt', 2, .35, 25, 90]], interval: [8, 18],
    space: { decay: .8, damping: 6000 }, echo: [.1, 0] },
  swamp: { bed: .035, low: 300, gust: .25, air: .006, high: 1700, water: 'lap', waterLevel: .05, chorus: 'swamp', chorusLevel: .07, rough: 760,
    calls: [['bullfrog', 4, .55, 15, 80], ['greenfrog', 3, .45, 8, 40], ['barredowl', 2, .45, 60, 220], ['heron', 1, .4, 30, 120], ['splash', 1, .35, 10, 50]], interval: [2.5, 6],
    space: { decay: 1.7, damping: 3200, echoes: [[.11, .12]] }, echo: [.09, .1] },
};

export const MIX_PRESETS = {
  balanced: { master: .72, engine: .8, road: .7, ambience: .85, traffic: .65, music: 0, night: false },
  scenic: { master: .72, engine: .42, road: .5, ambience: 1, traffic: .45, music: .32, night: false },
  night: { master: .55, engine: .6, road: .45, ambience: .65, traffic: .4, music: .22, night: true },
};
export const MIX_CHANNELS = ['master', 'engine', 'road', 'ambience', 'traffic', 'music'];
export function sanitizeMix(value) {
  const mix = { ...MIX_PRESETS.balanced };
  if (!value || typeof value !== 'object') return mix;
  for (const channel of MIX_CHANNELS) if (typeof value[channel] === 'number' && Number.isFinite(value[channel])) mix[channel] = Math.max(0, Math.min(1, value[channel]));
  if (typeof value.night === 'boolean') mix.night = value.night;
  return mix;
}
