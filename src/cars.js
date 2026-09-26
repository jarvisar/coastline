import { TRAFFIC_MODELS, SPORTS_MODEL } from './traffic-models.js';
import { FORMULA_SHAPE } from './formula-model.js';
import { SPECIAL_SHAPES } from './special-models.js';

// Width and length are the original collision footprint. The other fields are
// only for the chooser artwork.
export const CLASSIC_SHAPE = {
  name: 'classic', width: 2, length: 3.92, cabin: [1.77, .81, 1.9], cabinZ: .12,
  cabinY: 1.165, wheelRadius: .48, wheelZ: 1.195,
};

const shape = name => TRAFFIC_MODELS.find(spec => spec.name === name);

// Only the default car takes its paint from the route.
export const ROUTE_PAINT = { coast: '#d96143', desert: '#78977b', snow: '#9fc4d5', jungle: '#e0b44a', plains: '#4f8f8b', city: '#7a3b47', volcanic: '#abb5a3' };

// Road cars stay within about 10% of the coastal wagon. The coupe, formula
// and specials are the deliberate exceptions.
//
//   topSpeed            m/s at full throttle
//   offRoad             top speed off the tarmac, roughly two thirds of topSpeed
//   acceleration        m/s^2 at full throttle
//   braking             m/s^2 on the brakes
//   grip                steering rate relative to the coastal wagon
//
// Mass comes from the footprint (see impact.js) unless `mass` is given in tonnes.
const BASE = { topSpeed: 28, acceleration: 11.3, braking: 20, grip: 1, offRoad: 18.5 };

export const CARS = {
  auto: {
    name: 'Default',
    // No portrait or meters in the chooser. This card follows the route.
    plain: true, kind: 'classic', trim: null, paint: '#d96143', shape: CLASSIC_SHAPE, stats: BASE,
  },
  coast: {
    name: 'Coastline Wagon', kind: 'classic', trim: 'coast', paint: '#d96143', shape: CLASSIC_SHAPE, stats: BASE,
  },
  desert: {
    name: 'Canyon Runner', kind: 'classic', trim: 'desert', paint: '#78977b', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 27.2, acceleration: 11, braking: 19.4, grip: .97, offRoad: 19 },
  },
  snow: {
    name: 'Alpine Tourer', kind: 'classic', trim: 'snow', paint: '#9fc4d5', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 27.4, acceleration: 10.9, braking: 21, grip: 1.06, offRoad: 18.4 },
  },
  jungle: {
    name: 'Jungle Expedition', kind: 'classic', trim: 'jungle', paint: '#e0b44a', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 26.6, acceleration: 11.5, braking: 19.2, grip: .96, offRoad: 18.6 },
  },
  plains: {
    name: 'Prairie Cruiser', kind: 'classic', trim: 'plains', paint: '#4f8f8b', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 27.8, acceleration: 11.2, braking: 19.8, grip: .99, offRoad: 18.8 },
  },
  city: {
    name: 'Rain Commuter', kind: 'classic', trim: 'city', paint: '#7a3b47', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 26.4, acceleration: 11.8, braking: 20.4, grip: 1.02, offRoad: 17.6 },
  },
  hatchback: {
    name: 'City Hatch', kind: 'built', paint: '#6fa9c2', shape: shape('hatchback'),
    stats: { topSpeed: 26.2, acceleration: 12.1, braking: 20.6, grip: 1.1, offRoad: 16.8 },
  },
  sedan: {
    name: 'Highway Sedan', kind: 'built', paint: '#e7e3d5', shape: shape('sedan'),
    stats: { topSpeed: 28.6, acceleration: 11.1, braking: 20.2, grip: 1.01, offRoad: 18 },
  },
  wagon: {
    name: 'Estate Wagon', kind: 'built', paint: '#5f7a5a', shape: shape('wagon'),
    stats: { topSpeed: 28, acceleration: 10.7, braking: 19.6, grip: .97, offRoad: 18.3 },
  },
  pickup: {
    name: 'Work Pickup', kind: 'built', paint: '#b06a3a', shape: shape('pickup'),
    stats: { topSpeed: 26.4, acceleration: 10.3, braking: 18.6, grip: .92, offRoad: 18.4 },
  },
  van: {
    name: 'Delivery Van', kind: 'built', paint: '#9aa6ad', shape: shape('van'),
    stats: { topSpeed: 27, acceleration: 9.9, braking: 18.8, grip: .9, offRoad: 16.7 },
  },
  sports: {
    name: 'Cape GT', kind: 'built', paint: '#b8232f', shape: SPORTS_MODEL,
    stats: { topSpeed: 33, acceleration: 13.5, braking: 23, grip: 1.14, offRoad: 20.1 },
  },
  buggy: {
    name: 'Sandpiper Buggy', mass: .7, kind: 'special', paint: '#e2a23b', shape: SPECIAL_SHAPES.buggy,
    stats: { topSpeed: 25.5, acceleration: 14.5, braking: 19, grip: 1.12, offRoad: 23.5 },
  },
  monster: {
    name: 'Boulder King', mass: 4.5, kind: 'special', paint: '#3f7fb5', shape: SPECIAL_SHAPES.monster,
    stats: { topSpeed: 23.5, acceleration: 10.4, braking: 16.5, grip: .8, offRoad: 21.5 },
  },
  hotrod: {
    name: 'Salt Flat Special', kind: 'special', paint: '#1f2326', shape: SPECIAL_SHAPES.hotrod,
    stats: { topSpeed: 37, acceleration: 17.5, braking: 17, grip: .86, offRoad: 20.5 },
  },
  rig: {
    name: 'Long Hauler', mass: 8, kind: 'special', paint: '#a3312c', shape: SPECIAL_SHAPES.rig,
    stats: { topSpeed: 27, acceleration: 8.6, braking: 15.5, grip: .78, offRoad: 16.2 },
  },
  micro: {
    name: 'Pocket Bubble', kind: 'special', paint: '#8fcfc0', shape: SPECIAL_SHAPES.micro,
    stats: { topSpeed: 21.5, acceleration: 12.6, braking: 22, grip: 1.26, offRoad: 13.2 },
  },
  formula: {
    name: 'Apex Formula', mass: .8, kind: 'formula', paint: '#d8452f', shape: FORMULA_SHAPE,
    // 112 mph. Acceleration has to beat air drag at that speed.
    stats: { topSpeed: 50, acceleration: 40, braking: 30, grip: 1.32, offRoad: 20 },
  },
};

export const CAR_IDS = Object.keys(CARS);
export const DEFAULT_CAR = 'auto';
export const carEntry = id => CARS[id] ?? CARS[DEFAULT_CAR];

// Kept here because the off-road resistance below is sized against them.
export const DRAG = { rolling: .7, air: .0095 };

// Derived figures scale from the original car's proportions.
export function carStats(id) {
  const { topSpeed, acceleration, braking, grip, offRoad } = carEntry(id).stats;
  return {
    topSpeed, acceleration, braking, grip, offRoad,
    reverseSpeed: topSpeed * .25,
    launch: acceleration * 1.68,   // Pulling out of a reverse roll.
    creep: braking * .325,         // Brake pedal used as reverse throttle.
    handbrake: braking * 1.35,
    touchBraking: braking * 1.2,
    // Full throttle settles exactly at offRoad without any speed clamp.
    loose: Math.max(0, acceleration - DRAG.rolling - DRAG.air * offRoad * offRoad),
  };
}

// Ranges sit just outside the road cars so the slowest still shows a bar and
// each special nearly fills its own. The formula racer pegs the first three by design.
const METERS = [
  { label: 'Top speed', key: 'topSpeed', low: 20, high: 38 },
  { label: 'Acceleration', key: 'acceleration', low: 7.5, high: 18.5 },
  { label: 'Handling', key: 'grip', low: .72, high: 1.3 },
  { label: 'Off road', key: 'offRoad', low: 12, high: 24.5 },
];
export function carMeters(id) {
  const stats = carEntry(id).stats;
  return METERS.map(({ label, key, low, high }) => ({ label, level: Math.round(Math.min(1, Math.max(.06, (stats[key] - low) / (high - low))) * 100) }));
}
