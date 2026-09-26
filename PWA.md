# Installing the Website

The [website](https://jarvisar.github.io/coastline/) can be installed like a regular app:

- iPhone / iPad: in Safari, tap Share → Add to Home Screen. Leave Open as Web App on if it shows up.
- Android: in Chrome, tap Install app or Add to Home screen.
- Desktop Chrome / Edge: click the install icon in the address bar or use the browser menu.

The title screen and pause menu also have an install button.

All eight routes work offline once the first visit finishes caching. To get an update, close every Coastline tab and window and reopen it. If you clear your browser storage, you'll need to load it online again. Fullscreen depends on the browser; some keep the system bars visible or need a tap first.

## Hosting

Run `npm run build` and upload `dist/` to any HTTPS host. For a subfolder:

```sh
npm run build -- --base=/coastline/
```

The service worker only registers in production builds. To test it locally, use `npm run preview` on a different port from the dev server. Installing on a phone needs HTTPS.

Serve `sw.js` from the same URL every time with `Cache-Control: no-cache`. The offline file list is built by [pwa-plugin.mjs](scripts/pwa-plugin.mjs).

## Icons and tests

`node scripts/pwa-icons.mjs` regenerates the icons from the favicon and `node scripts/pwa-screenshots.mjs` updates the install screenshots.

```sh
node scripts/pwa-test.mjs
node scripts/pwa-banner-test.mjs
node scripts/fullscreen-test.mjs
```

These check installing, offline play, updates, subfolder hosting and fullscreen. They use Chrome on Windows or Playwright's Chromium elsewhere; set `CHROME_PATH` to use a different browser. Output goes to `.artifacts/`.
