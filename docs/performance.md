# Performance

## Loading

The world is split into chunks that are built as you drive. Chunk building runs in up to three web workers: one per spare CPU core, but only two on devices reporting under 4 GB of memory and one under 2 GB. If a worker crashes or doesn't respond for 20 seconds, it gets dropped and its job moves to another worker. Chunks are only built on the main thread if every worker has failed.

Routes are loaded when you first pick them. The installed website caches all of them for offline play.

A few other things that keep frame times down:

- Static scenery only updates its matrices when a chunk is added or the world origin shifts.
- Snow and rain are animated in shaders instead of on the CPU.
- Route shaders are compiled after the new route's lighting, fog and traffic are set up.
- The Basic preset uses a single shadow lookup instead of nine.

## Auto quality

`Auto` adjusts graphics quality while you drive to keep the frame rate at your display's refresh rate. It works out the refresh rate from the 20th-percentile frame time in 1.5 second windows, so a few dropped frames don't lower the target. The fixed presets (High, Balanced, Smooth and Basic) never change on their own. Lower presets reduce resolution, shadows and view distance.

## Profiling

With the dev server running:

```sh
npm run profile:performance
npm run profile:driving
```

Reports and screenshots go to `.artifacts/performance/`. The driving profiler records CPU time, buffer uploads and draw calls on all eight routes.

Both accept `TEST_URL`, `CHROME_PATH` and `PROFILE_LABEL` (to keep runs in separate folders). `profile:performance` also accepts `PROFILE_QUALITY` (`high`, `balanced`, `smooth` or `basic`) and `PROFILE_MOBILE=1` to simulate a phone screen.

## Tests

```sh
npm run test:performance
npm run test:worker
npm run test:graphics
npm run test:weather
npm run test:mobile
npm run test:ao
npm run test:vr
```

These cover chunk streaming, shader compilation, WebGL context loss, graphics settings, touch controls, weather, ambient occlusion and VR.
