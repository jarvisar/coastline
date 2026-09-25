# Desktop App

Download from [Releases](https://github.com/jarvisar/coastline/releases):

- Windows: installer (`-setup.exe`) or portable app (`-portable.exe`)
- Linux / Steam Deck: AppImage
- macOS: `.dmg` or `.zip`, `arm64` for Apple silicon or `x64` for Intel

The builds aren't code-signed. On Windows, click More info → Run anyway. On macOS, right-click the app and choose Open, or run `xattr -cr /Applications/Coastline.app`. On Linux, run `chmod +x Coastline-*.AppImage` first.

The Windows installer and AppImage check for updates at launch and install them when you quit. The portable exe and macOS app show a link when an update is available.

The app starts in fullscreen. Use F, F11, Alt+Enter, LB or the pause menu to toggle it. F12 opens DevTools.

## Steam Deck

1. In Desktop Mode, download the AppImage and mark it executable under Properties → Permissions.
2. Open it once to make sure it runs.
3. In Steam, go to Games → Add a Non-Steam Game → Browse. Select All Files and add the AppImage.
4. Set the controller layout to Gamepad or Gamepad with Joystick Trackpad.
5. Launch it from the Non-Steam tab in Game Mode. Use Exit Game in the Steam menu to quit.

Launch options like `--windowed` or `--seed=4817` go under Properties → Launch Options.

## Launch options

| Flag | Environment variable | Effect |
| --- | --- | --- |
| `--fullscreen` / `--windowed` | `COASTLINE_FULLSCREEN=1` / `0` | Start fullscreen (default) or windowed |
| `--seed=<n>` | | Open a specific world |
| `--software-gl` | `COASTLINE_SOFTWARE_GL=1` | Render on the CPU with SwiftShader, for GPU problems |
| `--no-update` | `COASTLINE_NO_UPDATE=1` | Skip the update check |
| `--devtools` | `COASTLINE_DEVTOOLS=1` | Open DevTools |
| `--dev-url=<url>` | `COASTLINE_DEV_URL` | Load a dev server |
| | `COASTLINE_USER_DATA=<dir>` | Use a separate profile folder |
| `--help` | | Print options |

Settings are stored in `%APPDATA%\Coastline` on Windows, `~/.config/Coastline` on Linux and `~/Library/Application Support/Coastline` on macOS. Delete `window-state.json` to reset the window size and position.

## Running from source

Requires [Node.js](https://nodejs.org/) 22.12+.

```sh
npm install
npm run electron:dev     # Vite + Electron with hot reload
npm run electron:start   # production build
```

To use a dev server that's already running, pass `-- --url=http://127.0.0.1:5173` to `electron:dev`.

The app serves `dist-electron/` from `app://coastline/` ([main.js](electron/main.js)). The renderer is sandboxed and goes through a [preload script](electron/preload.cjs) for fullscreen, Escape and updates. PWA scripts are disabled and external links open in your browser. If you change asset paths or file types, update the protocol handler and MIME table in `main.js`. If you rename the PWA scripts, update `WEB_ONLY_SCRIPTS`.

## Building

These rebuild the game into `dist-electron/` and write packages to `release/`.

| Command | Output |
| --- | --- |
| `npm run electron:pack` | Unpacked app for the current OS |
| `npm run electron:build` | Packages for the current OS |
| `npm run electron:build:win` | Windows installer and portable exe |
| `npm run electron:build:linux` | Linux AppImage |
| `npm run electron:build:mac` | macOS DMG and ZIP |
| `npm run electron:icons` | Regenerate icons from `public/favicon.svg` |

macOS packages have to be built on a Mac and the AppImage on Linux or WSL. For WSL, use a separate clone with Node installed inside WSL:

```sh
git clone https://github.com/jarvisar/coastline.git ~/coastline
cd ~/coastline
npm ci
npm run electron:build:linux
```

Package settings are in [builder.config.cjs](electron/builder.config.cjs).

## Testing

```sh
npm run test:electron -- --build      # test the current source
npm run electron:pack
npm run test:electron -- --packaged   # test the packaged app
```

Covers loading, workers, storage, controls, fullscreen and routes. Add `--windowed` to test windowed startup. Reports go to `.artifacts/electron/`.

## Releasing

The [desktop workflow](.github/workflows/desktop.yml) runs tests on pushes to `main` and pull requests. Pushing a `v*` tag builds and publishes packages for all three platforms.

```sh
npm version patch
git push --follow-tags
```

Don't delete the `latest*.yml` or `.blockmap` files from a release, since the updater needs them. Drafts and pre-releases aren't picked up by the updater. The macOS smoke test doesn't block releases because WebGL doesn't load reliably on the CI runner.

## Troubleshooting

- Missing web build: run `npm run electron:web` or `npm run electron:dev`.
- Black window: check F12 for WebGL errors, or try `--software-gl`.
- Electron prints a Node version: unset `ELECTRON_RUN_AS_NODE`.
- Linux sandbox error: try `--no-sandbox`.
- Missing FUSE: run `./Coastline-*.AppImage --appimage-extract`, then `squashfs-root/coastline`.
- Windows packaging fails with `EPERM`: use the npm scripts above instead of calling electron-builder directly.
- No sound: press M or turn sound on in the pause menu.
