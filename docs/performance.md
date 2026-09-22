# Performance work

The September 2026 pass targets startup work, steady-state CPU work and low-end
GPU cost. Physics, collision geometry, scenery placement and input behavior stay
the same. Basic quality deliberately uses simpler shadow filtering; the other
presets retain their existing appearance.

## Research and plan

The audit first checked the existing worker generation, instancing, adaptive
resolution, resource disposal and paused rendering. Those were already present.
The implementation plan was:

1. Capture fixed-seed scenes and run the existing tests before editing.
2. Move unselected routes' procedural assets out of page and worker startup.
3. Stop invalidating static scenery transforms every frame, preserving origin
   rebasing and animated instance buffers.
4. Reduce offscreen geometry and shadow fragment work without changing gameplay.
5. Validate worker parity, graphics settings, mobile input, AO, VR and offline
   production builds, then record reproducible measurements.

The relevant primary references were:

- [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices):
  batch work, budget pixels and memory, and avoid synchronous GPU queries in the
  frame loop. Smaller batches trade better culling for more draw calls.
- [Three.js Object3D](https://threejs.org/docs/pages/Object3D.html): local and world
  matrix updates are separate responsibilities. Disabling local updates on
  children alone does not stop an auto-updated ancestor from forcing world updates.
- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html):
  instancing reduces submission cost; conservative bounds must cover all instances.
- [MDN dynamic import](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import):
  load and evaluate optional modules when needed, with explicit failure handling.

The installed Three.js r186 source was also checked before changing the shadow
path: PCF samples native depth textures, so scenery depth materials do not need
to pack depth into an unused RGBA color output.

## Changes

- `world/scenery.js` shares lazy route loaders between the main thread and worker.
  Route metadata and driving math stay available immediately. Importing a route
  registers its materials before worker buffers are reconstructed. Failed loads
  leave the current route intact, and concurrent requests share one promise.
- The worker builds asynchronously and Vite emits ES module worker chunks. The
  PWA still precaches every emitted file, including unvisited routes. Thus this
  reduces initial evaluation and required startup code, not total offline storage.
- The stationary scene root no longer invalidates every descendant each frame.
  Chunk roots update their matrices only on attachment or an origin shift.
  Vehicles, cameras, weather, shader animations and moving instances remain live.
- Unpacking worker instances adopts the transferred matrix buffers directly,
  without allocating and initializing another full set of identity matrices first.
- Static scenery batches try a centered enclosing sphere in addition to Three's
  placement-order bound. Both contain every transformed geometry sphere. The
  smaller is chosen before any batch animation padding is applied. Scene and
  shadow culling can then reject more invisible geometry without extra meshes.
- Scenery depth materials skip unused packed-color output and color writes.
- Basic uses one hardware-filtered shadow comparison instead of nine texture
  reads per sun-shadow lookup. Its edges are simpler. A uniform selects the
  filter, so switching quality does not require another shader variant.

## Measurements

Same seed (`4817`), route position (`384`), animation time (`12`), Balanced
quality, 640 × 480 CSS viewport and 1× display density, using Chrome/SwiftShader.

| Measurement | Before | After |
| --- | ---: | ---: |
| Initial Pacific Coast page JS, including shared and route imports | 1,316 kB | 985 kB |
| Same page JS, gzip | 446 kB | 321 kB |
| Initial worker JS, including its shared and route imports | 616 kB | 269 kB |
| Static world-matrix multiplications per unchanged frame | 58–474 | 0 |
| Basic sun-shadow texture reads per lookup | 9 | 1 |

These are code/work counts, not a claimed phone FPS increase. The startup figures
include the selected route's dependencies, rather than just the smaller entry
file. The browser's offline installer may download other routes in the background.

| Route | Submitted triangles before | After | Draw calls before | After |
| --- | ---: | ---: | ---: | ---: |
| Coast | 341,686 | 337,446 | 262 | 261 |
| Desert | 556,589 | 556,589 | 332 | 332 |
| Alpine | 316,315 | 321,473 | 343 | 348 |
| Jungle | 1,257,655 | 1,201,047 | 479 | 462 |
| Plains | 513,493 | 510,289 | 447 | 442 |
| City | 495,558 | 491,862 | 312 | 310 |
| Volcanic | 460,718 | 460,718 | 104 | 104 |

These counts include shadow rendering. Culling benefits depend on the pose: a
smaller sphere has a different center and can still intersect more planes in
some views, as in this Alpine sample. All seven final Balanced captures are
pixel-identical to their baseline images. Basic's filter change is intentional.

An experiment halving the spatial batch span was rejected: in this Jungle sample
it added 162 draw calls to save about 16% of triangles. That tradeoff was not a
clear improvement for devices limited by draw submission.

## Verification and reproduction

The unit suite has 358 passing tests, including new coverage for lazy scenery
initialization, invalid requests, bound containment, static matrices, origin
shifts and new chunk attachment. Existing worker tests compare rendered pixels
and exercise streaming, reversing, disposal and synchronous fallback.

With the development server running:

```sh
npm test
npm run build
npm run test:performance
npm run profile:performance
npm run test:worker
npm run test:graphics
npm run test:mobile
npm run test:ao
npm run test:vr
node scripts/pwa-test.mjs
```

`TEST_URL` selects a development server. The profiler accepts `PROFILE_LABEL`
(a separate artifact folder), `PROFILE_QUALITY` (`high`, `balanced`, `smooth`,
`basic`), `PROFILE_MOBILE=1` (390 × 844 CSS pixels at 3× density), and `CHROME_PATH`.
It writes per-route images and work counts under `.artifacts/performance/`.
Transform timings are diagnostic and include instrumentation overhead; do not
treat them as end-to-end frame times.

The browser checks cover paused redraws and context restoration; density and
quality changes at 1×, 2× and 3×; touch cancellation and rotation; AO; and emulated
stereo VR. The PWA check builds both `/` and `/coastline/` deployments and visits
all six initially unvisited routes while offline, requiring actual worker output.

Physical low-end Android/iOS devices and sustained thermal behavior were not
measured. A hardware follow-up should record frame-time percentiles and memory
during long drives, route changes, portrait/landscape rotation and AO on/off,
especially in the Jungle and Alpine routes. Desktop GPU and SwiftShader results
cannot establish a mobile FPS guarantee.
