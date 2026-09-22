# Performance

## Rendering and loading

- Routes load on demand in the page and worker. The PWA caches all routes for offline use.
- Up to three workers build chunks: one per spare core, two below 4 GB of reported memory, one below 2 GB. A worker that fails or stays silent for 20 seconds is dropped alone and a timed-out job moves to another worker. Chunks are built on the page only when no worker is left.
- Static scenery matrices update on attachment or an origin shift. Moving objects still update each frame.
- Worker instances reuse transferred matrix buffers.
- Scenery batches use the smaller of two enclosing spheres for culling.
- Scenery depth materials skip unused color output. Basic uses one shadow texture lookup instead of nine.
- Snow and rain animate in vertex shaders. Particle buffers update every 256 seconds to keep long-session positions accurate. Transparent weather stays out of the AO depth pass.
- Route shaders compile after the new lighting, fog, and traffic are set up.
- Road sampling and coastal birds reuse objects and skip unused calculations.

## Auto quality and streaming

Auto detects the display's refresh rate from animation-frame timestamps. It uses the 20th-percentile interval over 1.5 seconds, so occasional dropped frames don't lower the target. The previous 60 FPS target could increase detail on a 120 Hz display despite uneven delivery. Manual presets stay fixed.

Alpine cabin light positions are generated in the worker. This removes a repeated terrain survey from the main thread during chunk changes.

Previously one worker failure or timeout disabled chunk workers for the rest of the visit. Every later chunk was then built on the main thread, which stalled a slow device for up to a second at each chunk boundary.

## Measurements

Recorded during the September 2026 changes with Chrome/SwiftShader, seed `4817`, route position `384`, animation time `12`, Balanced quality, and a 640 × 480 viewport at 1× density unless noted.

These measure code size and rendering work. Physical phones and headsets weren't measured. CPU timings exclude GPU rendering; transform timings include instrumentation overhead.

| Measurement | Before | After |
| --- | ---: | ---: |
| Initial Pacific Coast page JS, including shared and route imports | 1,316 kB | 985 kB |
| Same page JS, gzip | 446 kB | 321 kB |
| Initial worker JS, including shared and route imports | 616 kB | 269 kB |
| Static world-matrix multiplications per unchanged frame | 58–474 | 0 |
| Basic shadow texture reads per lookup | 9 | 1 |

Startup sizes exclude other routes downloaded by the offline installer.

Counts below include shadows. Culling depends on the camera position; the smaller bound increased work in this Alpine sample. All seven Balanced captures matched the baseline pixels. Basic's shadow filter changes its appearance.

| Route | Triangles before | After | Draw calls before | After |
| --- | ---: | ---: | ---: | ---: |
| Coast | 341,686 | 337,446 | 262 | 261 |
| Desert | 556,589 | 556,589 | 332 | 332 |
| Alpine | 316,315 | 321,473 | 343 | 348 |
| Jungle | 1,257,655 | 1,201,047 | 479 | 462 |
| Plains | 513,493 | 510,289 | 447 | 442 |
| City | 495,558 | 491,862 | 312 | 310 |
| Volcanic | 460,718 | 460,718 | 104 | 104 |

Halving the batch span added 162 Jungle draw calls to save about 16% of triangles, so the existing span was kept.

### Chunk streaming

Across 40 forward/reverse chunk crossings, the worst Alpine world update dropped from 716.6 ms to 0.8 ms after moving cabin light placement to the worker. Coast and Desert stayed around 1 ms. All three routes matched synchronous scenery pixels without needing a synchronous fallback.

Reproduce with `npm run test:worker` and `npm run test:graphics`.

### Weather and birds

Measured with seed `4817`, Balanced quality, and Chrome/SwiftShader after moving weather animation to shaders and reducing coastal bird CPU work:

| Measurement | Before | After |
| --- | ---: | ---: |
| Alpine animation CPU time, 300 updates | 21.5 ms | 0.8 ms |
| City animation CPU time, 300 updates | 6.5 ms | 0.3 ms |
| Alpine particle upload per ordinary frame | 16,200 bytes | 0 bytes |
| City particle upload per ordinary frame | 22,800 bytes | 0 bytes |
| Coastal animation CPU time, 300 updates | 7.3 ms | 5.8 ms |

Draw calls and triangle counts were unchanged. Six route captures matched exactly. Alpine differed in 163 color channels at particle edges: maximum 6/255, mean 0.00036/255 across the image, from GPU rounding.

`test:weather` compares shader output with the original motion equations across more than 260,000 coordinates, including large positions, long sessions, and time rebases. The recorded maximum error was below 0.001 metres.

### Pacific Coast scenery

The Pacific Coast added wildflower drifts, coastal scrub, sloops, an open-spandrel arch bridge, overlook walls, Route 1 signs, and a sky for the driving views. Measured with seed `4817`, High quality, 1440 × 1000, and Chrome/SwiftShader, using the camera positions from `scripts/pacific-review.mjs`:

| View | Draw calls before | After | Triangles before | After |
| --- | ---: | ---: | ---: | ---: |
| Medium, route position 24 | 251 | 280 | 352,363 | 471,866 |
| Scenic, position 148 | 296 | 334 | 404,764 | 554,386 |
| Close, position 600 | 219 | 250 | 288,804 | 403,804 |
| Third-person, position 500 | 252 | 288 | 310,526 | 429,784 |

Petals are flat triangles merged into one mesh per chunk and draped on the rendered terrain faces. The sky collapses under the orthographic cameras, so the overhead views don't draw it. A coastal chunk takes about 1.5 times as long to build as before; the chunk worker absorbs this during normal driving.

### Route loading

A route change waits for its resident chunks to be built. Commit `5ea95a6` ran `joinCoplanarFaces` on each Volcanic chunk's rock and lava and on City's blocks and streets. The join compared each face with every face on its plane and allocated objects and string keys per face, so those two routes took several seconds to load.

The join now reads faces into typed arrays and uses integer keys. It checks only later faces in the same 8 m cell and sizes its output before writing it. Its output is byte-identical on 121 batches captured from all seven routes. `terrainSampler` uses integer cell keys, and every route's chunks hash the same as before.

Measured in Node with seed `4817`: the time to build the nine chunks around each route's start position, best of three runs.

| Route | Before `5ea95a6` | `4f7669f` | After |
| --- | ---: | ---: | ---: |
| Volcanic | 1,511 ms | 4,290 ms | 1,596 ms |
| City | 294 ms | 2,653 ms | 638 ms |
| Desert | 749 ms | 750 ms | 749 ms |
| Coast | 187 ms | 185 ms | 324 ms |

Coast now includes the Pacific Coast scenery above, and Volcanic its added terrain and backdrop. With three worker threads, the same nine chunks built 1.4 times faster for City and twice as fast for Volcanic, best of four. That timing includes each worker's first load of the route.

## Profiling and tests

With the dev server running:

```sh
npm run profile:performance
npm run profile:driving
```

Reports and images go to `.artifacts/performance/`. The driving profiler records CPU timings, buffer uploads, and draw counts for all seven routes. Its CPU window uses 300 updates at a fixed camera position.

Both profilers accept `TEST_URL`, `CHROME_PATH`, and `PROFILE_LABEL` for separate output folders. `profile:performance` also accepts `PROFILE_QUALITY` (`high`, `balanced`, `smooth`, `basic`) and `PROFILE_MOBILE=1` (390 × 844 at 3× density).

```sh
npm test
npm run build
npm run test:performance
npm run test:worker
npm run test:graphics
npm run test:weather
npm run test:mobile
npm run test:ao
npm run test:vr
node scripts/pwa-test.mjs
```

Browser tests cover streaming, route shader compilation, context restoration, graphics settings, touch controls, weather, AO, and emulated VR. The PWA test checks offline routes at `/` and `/coastline/`.
