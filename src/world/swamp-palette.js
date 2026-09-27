// Blue hour over the basin. Rendering reads these without loading the scenery.
export const swampPalette = {
  horizon: '#3c5265',
  fog: '#4b6377',
  skyLight: '#b3c9df',
  groundLight: '#35443c',
  sun: '#d1deeb',
};
export const SWAMP_LIGHT = { sky: 1.6, sun: 1.1, exposure: 1.04 };
// High and behind the far side, so trunks throw short shadows toward the camera.
export const SWAMP_SUN = [-120, 230, -60];
