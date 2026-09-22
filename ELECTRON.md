# Desktop app

Download the Electron app from [Releases](https://github.com/jarvisar/coastline/releases):

- **Windows:** installer (`-setup.exe`) or portable app (`-portable.exe`).
- **Linux / Steam Deck:** AppImage.
- **macOS:** DMG or ZIP; `arm64` for Apple silicon, `x64` for Intel.

Builds are unsigned. Windows may need **More info → Run anyway**; macOS may need right-click → **Open**. On Linux, run `chmod +x Coastline-*.AppImage` first.

The Windows installer and AppImage versions download updates at launch and install them when you quit. Portable Windows and macOS builds show a **Get version** button instead.

The app starts fullscreen. Use F, F11, Alt+Enter, LB / L1, or the pause menu to toggle it. Escape opens menus. F12 opens DevTools.

## Run from source

Requires Node.js 22.12 or newer.

```sh
npm install
npm run electron:dev
```

This starts Vite and Electron with hot reload. Use `npm run electron:start` for a production build, or `npm run electron:dev -- --url=http://127.0.0.1:5173` for an existing dev server.

## Launch options

Pass these to the executable, Steam launch options, or after `npm run electron:dev --`.

| Flag | Environment variable | Effect |
| --- | --- | --- |
| `--fullscreen` / `--windowed` | `COASTLINE_FULLSCREEN=1` / `0` | Starting window mode; defaults to fullscreen |
| `--seed=<n>` | | Open a specific world |
| `--software-gl` | `COASTLINE_SOFTWARE_GL=1` | Test GPU problems with SwiftShader; runs slowly |
| `--no-update` | `COASTLINE_NO_UPDATE=1` | Skip the launch update check |
| `--devtools` | `COASTLINE_DEVTOOLS=1` | Open DevTools |
| `--dev-url=<url>` | `COASTLINE_DEV_URL` | Load a dev server |
| | `COASTLINE_USER_DATA=<dir>` | Use a separate profile directory |
| `--help` | | Print options |

Profiles are in `%APPDATA%\Coastline` (Windows), `~/.config/Coastline` (Linux), or `~/Library/Application Support/Coastline` (macOS). Delete `window-state.json` there to reset window size and position.

## Steam Deck

1. In Desktop Mode, download the AppImage and mark it executable under **Properties → Permissions**.
2. Open it once to check it runs.
3. In Steam, choose **Games → Add a Non-Steam Game → Browse**. Select **All Files** and add the AppImage.
4. Set the controller layout to **Gamepad** or **Gamepad with Joystick Trackpad**.
5. Launch from the **Non-Steam** tab in Game Mode. Use **Exit Game** in the Steam menu to quit.

See [controls](README.md#controls). Add flags such as `--windowed` or `--seed=4817` under Steam's **Properties → Launch Options**.

## Build

Commands rebuild the game into `dist-electron/` and write packages to `release/`.

| Command | Output |
| --- | --- |
| `npm run electron:pack` | Unpacked app for the current OS |
| `npm run electron:build` | Packages for the current OS |
| `npm run electron:build:win` | Windows x64 installer and portable app |
| `npm run electron:build:linux` | Linux x64 AppImage |
| `npm run electron:build:mac` | macOS arm64 and x64 DMG and ZIP |
| `npm run electron:icons` | Regenerate icons from `public/favicon.svg` |

Build macOS packages on macOS. Build the AppImage on Linux or WSL. For WSL, use a separate checkout with Node installed inside WSL:

```sh
git clone https://github.com/jarvisar/coastline.git ~/coastline
cd ~/coastline
npm ci
npm run electron:build:linux
```

Package settings are in [builder.config.cjs](electron/builder.config.cjs).

## Releases

The [desktop workflow](.github/workflows/desktop.yml) tests pushes to `main` and pull requests. A `v*` tag builds and publishes packages for all three platforms. Manual runs upload artifacts without publishing.

To publish a patch release:

```sh
npm version patch
git push --follow-tags
```

Keep `latest.yml`, `latest-linux.yml`, `latest-mac.yml`, and installer `.blockmap` files in releases; automatic updates need them. Drafts and pre-releases don't reach the updater.

The macOS smoke test doesn't block releases because its CI runner hasn't loaded WebGL reliably.

## Development and tests

[main.js](electron/main.js) serves `dist-electron/` at `app://coastline/`. The sandboxed renderer uses a [preload bridge](electron/preload.cjs) for fullscreen, Escape, and updates. PWA scripts are disabled. External links open in the system browser.

Update the protocol handler and MIME table when changing asset paths or extensions, and `WEB_ONLY_SCRIPTS` when renaming PWA scripts. Regenerate icons after changing the favicon.

Test the current source:

```sh
npm run test:electron -- --build
```

Test a packaged app:

```sh
npm run electron:pack
npm run test:electron -- --packaged
```

Tests cover loading, workers, storage, controls, fullscreen, and routes. Reports go to `.artifacts/electron/`. Add `--windowed` to test windowed startup. Tests disable updates and use the installed Electron package.

## Troubleshooting

- **Missing web build:** run `npm run electron:web` or `npm run electron:dev`.
- **Black window:** check F12 for WebGL errors. Try `--software-gl`.
- **Electron prints a Node version:** unset `ELECTRON_RUN_AS_NODE` or use the repo's launch scripts.
- **Linux sandbox error:** try `--no-sandbox` if user namespaces are blocked.
- **Missing FUSE:** run `./Coastline-*.AppImage --appimage-extract`, then `squashfs-root/coastline`.
- **macOS blocks the app:** for the downloaded app, run `xattr -cr /Applications/Coastline.app`.
- **Windows packaging fails with `EPERM` during rename:** use the repo's build scripts and config.
- **No sound:** press M or enable sound in the pause menu.
