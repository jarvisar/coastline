# Audio

Sound is off by default. Press M or use the pause menu to turn it on.

`Audio settings` has sliders for master, engine, tires/wind, environment, traffic and music volume, plus three presets: Balanced, Scenic and Night drive. Set music to zero to turn it off. `Soften loud sounds` adds compression. Settings are saved locally.

## How it works

All audio is generated with the Web Audio API in [audio.js](../src/audio.js) and [src/audio/](../src/audio/). There are no sound files.

The engine follows the car's RPM and load, and tires and wind follow speed and grip. Each route has its own ambience. Traffic is panned in stereo and uses a Doppler shift. In first-person, outside sounds are muffled, except in the Formula car since it has an open cockpit.

Everything runs through one AudioContext, which fades out and suspends when you mute, pause or leave the tab. Switching cars swaps out the engine sounds, and the last three are kept cached.

## Tests

With the dev server running:

```sh
npm run test:audio
npm run review:audio
```

Reports and WAV files go to `.artifacts/audio/`. Open `.artifacts/audio/review/index.html` to compare the current sound with `HEAD` at matched volume. Set `AUDIO_BASE_REF` to compare with a different commit. Both scripts use Chrome on Windows; set `TEST_URL` to use a different server address.
