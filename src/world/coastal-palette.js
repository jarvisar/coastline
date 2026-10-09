// Shared by the lighting, sky, water and baked terrain shading so they agree.
export const coastPalette = {
  horizon: '#cfe3ee',
  zenith: '#4f8fd0',
  haze: '#eef3f2',
  skyLight: '#a9cdee',
  groundLight: '#978d68',
  sun: '#ffe8c6',
  fog: '#c4dcea',
};

// Late afternoon sun over the sea, from the left of the overhead views. Cliff
// buttresses and hills get a lit and a shaded side, and shadows fall to the right.
// From the road it hangs ahead and to the left, over the water.
export const COAST_SUN = [-213, 150, -87];
export const COAST_LIGHT = { sun: 3.2, sky: 1.4, exposure: 1.07 };
