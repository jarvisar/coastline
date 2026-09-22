# Audio

Press **M** or use the pause menu to turn sound on. It starts off.

**Audio settings** has master, engine, tires/wind, environment, traffic, and music volumes. Choose **Balanced**, **Scenic**, or **Night drive**, then adjust the sliders. Settings are saved locally. Set music to zero to turn it off. **Soften loud sounds** adds compression.

Use arrow keys or Home/End on sliders. On a controller, use up/down to select and left/right to adjust. The VR menu can cycle presets.

## Implementation

Audio is generated with Web Audio in [src/audio.js](../src/audio.js) and [src/audio/](../src/audio/).

Engine sound follows the car, RPM, and load. Tires and wind follow speed and grip. Each route has its own ambience; traffic uses stereo panning and Doppler shift. First-person filters exterior sound except in the open-cockpit Formula car.

Sound uses one AudioContext. Mute, pause, and focus loss fade and suspend it. Car changes replace the engine sources; up to three generated engine banks stay cached.

## Tests

With the dev server running:

```sh
npm run test:audio
npm run review:audio
```

Reports and WAV previews go to `.artifacts/audio/`. Listen to volume-matched comparisons at `.artifacts/audio/review/index.html`. The review compares against `HEAD`; set `AUDIO_BASE_REF` to use another revision.

Both scripts use Windows Chrome. Set `TEST_URL` to use another server address.
