// Shared by fog, sky, reflections and lighting so they agree in every camera.
export const saltPalette = {
  horizon: '#dae8ef',
  zenith: '#79b5da',
  haze: '#eef4f5',
  cloud: '#ffffff',
  cloudShade: '#b9c8da',
  skyLight: '#c7dcec',
  // White salt throws a lot of light back up.
  groundLight: '#e6dccd',
  sun: '#fff1dd',
  fog: '#e3ecf0',
};

// High sun from the upper right of the overhead views, so boulder tops and
// right-hand faces light up and short shadows fall down and to the left.
export const SALT_SUN = [190, 185, -65];
export const SALT_LIGHT = { sun: 3.4, sky: 1.05 };
