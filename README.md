# Coastline

![Coastline routes: coast, desert, alpine, jungle, plains, and volcanic rift](showcase/scene-slices.png)

Endless driving game built with [Three.js](https://threejs.org/). Supports keyboard, touch, controllers, and browser VR.

[Play in your browser](https://jarvisar.github.io/coastline/) or download a [desktop build](https://github.com/jarvisar/coastline/releases).

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open the URL printed by Vite. Use the Network URL to play on a phone on the same Wi-Fi. Allow Node through the Windows firewall for private networks if prompted.

Use `npm run build` to build and `npm run preview` to preview.

## Controls

Controller buttons use Xbox / PlayStation names.

| Action | Keyboard | Controller |
| --- | --- | --- |
| Accelerate | W / ↑ | RT / R2, or A / Cross |
| Brake, then reverse | S / ↓ | LT / L2, or B / Circle |
| Steer | A D / ← → | Left stick / D-pad left and right |
| Strong brake | Space | — |
| Change view | V | X / Square |
| Autodrive | H | D-pad Up |
| Pause / resume | P / Escape | Start / Menu / Options |
| Garage | C / G | Left stick press (L3) |
| Next route | N | RB / R1 |
| Choose route | 1–7 | Select / Back / View |
| Reset | R | Y / Triangle |
| Sound | M | Pause menu |
| Soft shading | O | Pause menu |
| Fullscreen | F | LB / L1 |
| FPS counter | F3 | Right stick press (R3) |

Numpad 8 / 2 / 4 / 6 also work for driving. Press V to cycle through four overhead views, third-person, and first-person.

Press H to follow the road automatically. Steering, accelerating, or braking turns autodrive off.

In controller menus, use the D-pad or stick to move, A / Cross to select, and B / Circle to go back. Press a button if the browser hasn't detected the controller. Disconnecting it or leaving the tab pauses the game.

On touchscreens, tap **Let's drive** and drag the joystick where you want to go. Drag farther to go faster; release to stop. In first-person and third-person, push up to accelerate, left/right to steer, and down to brake or reverse.

## Routes and cars

Use **Change Route** or press **1–7**:

1. Pacific Coast
2. Red Rock Desert
3. Midnight Alpine
4. Emerald Jungle
5. Golden Plains
6. Rainy Downtown
7. Volcanic Rift

Each route keeps your position and mileage until you reload. Reset starts the current route in a new area. Add `?seed=4817` to the URL to revisit or share a world; seeds accept unsigned 32-bit integers.

Open **Garage** to change cars or paint. **Default** uses the route's car. Car choice is saved; paint applies to all cars and resets on reload. Cars handle differently and lose speed and grip off-road.

For rainbow paint, enter **↑ ↑ ↓ ↓ ← → ← → B A** while driving. On a controller, use the D-pad, then B / Circle and A / Cross. Enter it again to restore your paint.

## Settings

Open the pause menu for traffic, sound, fullscreen, and graphics settings.

**Auto** adjusts graphics quality while driving. High, Balanced, Smooth, and Basic use fixed levels. Lower levels reduce resolution, shadows, and view distance. The pixel-density slider adjusts resolution separately. Multisampling changes apply after reloading.

**Soft shading** adds ambient occlusion. It starts off and is saved separately from graphics quality. Use `?ao=0` to disable it for a visit.

Sound starts off. Press **M** to enable it. **Audio settings** has channel volumes, presets, and music.

## VR

Open the HTTPS site in the Quest browser and choose **Enter VR**. Local headset development needs HTTPS with a trusted certificate. VR requires the browser build and immersive WebXR support.

- **Left stick:** steer. The right stick works if it's the only controller connected.
- **Right trigger:** accelerate. **Left trigger:** brake, then reverse. **Either grip:** strong brake.
- **A:** change view. **B / left stick press:** pause or resume.
- **X:** reset. **Y:** exit VR. **Right stick press:** recenter.

VR starts in third-person. In menus, use stick up/down and A, or point and pull a trigger. B goes back. Exiting VR pauses the game. Custom paint entry uses the regular page.

## Development

Regenerate the six-slice route image with `npm run showcase:slices`. It starts its own server and captures coast, desert, alpine, jungle, plains, and volcanic scenery into `showcase/scene-slices.png` (3840 × 2160, 16:9, no UI), plus `scene-slices-preview.png`. All six captures use the normal scenic camera angle and different slices of one shared landscape view. A common seed preserves the road bends; small vertical adjustments to screenshot columns compensate for the routes' different elevations. Game geometry is unchanged.

Set `SEED` to change the world (default `4817`), `POSITION` to choose another stretch of road (default `-1100`), or `OUTPUT` to change the PNG destination. The default seed and position keep the diagonal road visible across all six slices. Chrome uses the standard Windows location; set `CHROME_PATH` for another installation, or install Playwright Chromium with `npx playwright install chromium` on other platforms.

Scenery is in [src/world/](src/world/), driving in [vehicle.js](src/vehicle.js), and scene setup in [main.js](src/main.js). Geometry and audio are generated in code.

Run `npm test` for unit tests. With the dev server running, use `npm run test:browser` for driving and streaming checks. Other tests are in [package.json](package.json).

Browser scripts generally use Chrome at the standard Windows path. Set `TEST_URL` to use another server address. Reports go to `.artifacts/`.

- [Desktop app and Steam Deck](ELECTRON.md)
- [Install the website / offline use](PWA.md)
- [Audio](docs/audio.md)
- [Discovery frequency](docs/discoveries.md)
- [Performance](docs/performance.md)
