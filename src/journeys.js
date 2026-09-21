import { CoastalWorld } from './world/environment.js';
import { coastalDrivingRoute } from './world/route.js';
import { DesertWorld } from './world/desert.js';
import { desertDrivingRoute } from './world/desert-route.js';
import { SnowWorld } from './world/snow.js';
import { snowDrivingRoute } from './world/snow-route.js';
import { JungleWorld } from './world/jungle.js';
import { jungleDrivingRoute } from './world/jungle-route.js';
import { PlainsWorld } from './world/plains.js';
import { plainsDrivingRoute } from './world/plains-route.js';
import { CityWorld } from './world/city.js';
import { cityDrivingRoute } from './world/city-route.js';
import { VolcanicWorld } from './world/volcanic.js';
import { volcanicDrivingRoute } from './world/volcanic-route.js';

export const JOURNEYS = {
  coast: {
    title: 'Pacific Coast', label: 'PACIFIC COAST', routeNumber: '1', World: CoastalWorld, route: coastalDrivingRoute,
    introduction: 'Drive the Pacific Coast through green hills and ocean views.',
    sound: 'Ocean and engine sounds on',
    canvas: 'A low-poly coastal landscape. Drive with WASD or the arrow keys.',
  },
  desert: {
    title: 'Red Rock Desert', label: 'RED ROCK DESERT', routeNumber: '2', World: DesertWorld, route: desertDrivingRoute,
    introduction: 'Drive through sandstone canyons in the evening sun.',
    sound: 'Desert wind and engine sounds on',
    canvas: 'A continuous rocky canyon with sandstone cliffs and Joshua trees in warm evening light. Drive with WASD or the arrow keys.',
  },
  snow: {
    title: 'Midnight Alpine', label: 'MIDNIGHT ALPINE', routeNumber: '3', World: SnowWorld, route: snowDrivingRoute,
    introduction: 'Wind above a moonlit lake through snow-covered mountains.',
    sound: 'Mountain wind and engine sounds on',
    canvas: 'A snowy mountain road above a moonlit lake, with distant mountain ranges, snow-laden firs, shore cabins and warm lamps. Drive with WASD or the arrow keys.',
  },
  jungle: {
    title: 'Emerald Jungle', label: 'EMERALD JUNGLE', routeNumber: '4', World: JungleWorld, route: jungleDrivingRoute,
    introduction: 'Follow a turquoise river through dense, dripping jungle beneath the canopy.',
    sound: 'Jungle insects, birdsong and engine sounds on',
    canvas: 'A humid jungle road beneath tall emergent trees, beside a turquoise river with cascades and mossy boulders, with misty green mountains beyond. Drive with WASD or the arrow keys.',
  },
  plains: {
    title: 'Golden Plains', label: 'GOLDEN PLAINS', routeNumber: '5', World: PlainsWorld, route: plainsDrivingRoute,
    introduction: 'Roll through harvest-gold farmland under a low evening sun.',
    sound: 'Prairie wind, crickets and engine sounds on',
    canvas: 'A country road across open farmland at golden hour, between wheat fields, hay bales, fences and shelterbelts, with a creek, red barns and wind turbines. Drive with WASD or the arrow keys.',
  },
  city: {
    title: 'Rainy Downtown', label: 'RAINY DOWNTOWN', routeNumber: '6', World: CityWorld, route: cityDrivingRoute,
    introduction: 'Follow a riverside boulevard through a city in a daytime storm.',
    sound: 'Rain, traffic and engine sounds on',
    canvas: 'A wet city boulevard beside a grey river in heavy daytime rain, between rows of buildings under a stormy sky, with a skyline fading into the mist. Drive with WASD or the arrow keys.',
  },
  volcanic: {
    title: 'Volcanic Rift', label: 'VOLCANIC RIFT', routeNumber: '7', World: VolcanicWorld, route: volcanicDrivingRoute,
    introduction: 'Wind between glowing lava rivers and smoking basalt craters.',
    sound: 'Volcanic rumble, steam and engine sounds on',
    canvas: 'A winding road through dark, faceted volcanic cliffs, glowing orange lava rifts, scattered basalt boulders and smoking craters. Drive with WASD or the arrow keys.',
  },
};
