// Shared by fog, sky, reflections and lighting so they agree in every camera.
export const saltPalette = {
  horizon: '#dae8ef',
  zenith: '#8cbde9',
  haze: '#eef4f5',
  cloud: '#ffffff',
  cloudShade: '#b9c8da',
  skyLight: '#e7e9ec',
  // White salt throws a lot of light back up.
  groundLight: '#f4e7d3',
  sun: '#fff0d8',
  fog: '#e3ecf0',
};

// High sun from the upper right of the overhead views, so boulder tops and
// right-hand faces light up and short shadows fall down and to the left.
export const SALT_SUN = [190, 215, -20];
export const SALT_LIGHT = { sun: 3.2, sky: 1.12 };
