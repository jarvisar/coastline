# Adding a route

Each route has two parts. The road and terrain math lives in `src/world/<id>-route.js`. The scenery built from it lives in `src/world/<id>.js`. Use a short lowercase id like `swamp`.

## Road

`<id>-route.js` exports a driving route that the car, traffic and autodrive use:

```js
export const swampDrivingRoute = { frame, position, height, bridge, bounds, water };
```

`frame(s)` gives the road's centre and direction at distance `s`. `position(s, u, y)` turns road coordinates into world space, where `u` is metres across the road. `height(s, u)` is the ground height, `bounds(s)` gives the drivable `[left, right]` edges and `bridge(s)` returns the nearest bridge span. `water` is optional. Copy one of the existing routes and change it from there.

## Scenery

`<id>.js` exports a chunk and a world, built on the shared classes in [level.js](../src/world/level.js):

```js
import { LevelChunk, LevelWorld, geometryFrom, triangle, instances, matte } from './level.js';

export class SwampChunk extends LevelChunk {
  constructor(index) {
    super(index, `swamp-chunk-${index}`);
    // Build one CHUNK_LENGTH slice here.
    finalizeChunkTransforms(this.group);
  }
}

export class SwampWorld extends LevelWorld {
  constructor(scene, chunkSource = null) { super(scene, chunkSource, SwampChunk); }
  animate(time, vehicle) {}
}
```

A chunk builds one 128 m slice of road. It can run in a web worker, so it can't touch the page. Materials and geometry shared between chunks must be passed to `registerChunkResources` so the worker can refer to them by name. Geometry made for one chunk goes through `addMesh` or into `this.owned`, so it gets released with the chunk.

The world keeps the chunks around the car built. Anything that follows the car, like a sky, rain or pooled lights, goes on the world. Override `update(s)`, `animate()` and `dispose()` for those and call `super` first. A world with a sky dome or a far backdrop sets `this.backdrop = true`, so scenery hidden in the fog keeps drawing in front of it. Keep the number of lights fixed while driving: dim a light to 0 instead of hiding it, since a change in the light count recompiles every shader.

`level.js` also has `geometryFrom`, `triangle` and `instances` for building meshes and `material` and `matte` for flat-shaded materials.

Add the pair to the loaders in [scenery.js](../src/world/scenery.js).

## Registering it

- [journeys.js](../src/journeys.js): titles and text, route number, browser theme colour and `night` for dark routes.
- [rendering.js](../src/rendering.js): an entry in `ROUTE_LIGHTING` for sky, sun, exposure and fog.
- [traffic.js](../src/traffic.js): `SALT` and `DENSITY`. `FLEET` and `BEAMS` are optional.
- [cars.js](../src/cars.js): a route car with `trim: '<id>'`. The default car takes its paint. Roof kit is in [vehicle.js](../src/vehicle.js) and the chooser art in [car-art.js](../src/car-art.js).
- [audio/profiles.js](../src/audio/profiles.js) and [audio/music.js](../src/audio/music.js): engine, ambience and music. These fall back to the coast.
- [index.html](../index.html): a card in the route chooser.
- [journey.css](../src/journey.css) and [theme.css](../src/theme.css): menu colours.

The number keys only go up to 9.

## Tests

Add the id to the route lists in `tests/chunk-worker.test.js`, `tests/traffic.test.js` and `tests/performance.test.js`. The worker test then checks that the route's chunks come out the same from a worker as from the page. Add `tests/<id>.test.js` for the route itself, such as checking that terrain and road join up across chunk edges.
