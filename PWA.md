# Install the website

Open [Coastline](https://jarvisar.github.io/coastline/):

- **iPhone / iPad:** in Safari, tap **Share → Add to Home Screen**. Leave **Open as Web App** enabled if shown.
- **Android:** in Chrome, choose **Install app** or **Add to Home screen**.
- **Desktop Chrome / Edge:** use the install icon in the address bar or browser menu.

The title screen and pause menu also have an install button.

All seven routes work offline after the first load finishes installing the service worker and cache. Close all Coastline tabs and app windows, then reopen to apply an update. Clearing browser storage requires another online load. Driving progress resets when you reload.

Fullscreen support varies by browser. Some keep system bars visible or require a tap first.

## Hosting

Run `npm run build` and deploy `dist/` to an HTTPS host. For a subdirectory:

```sh
npm run build -- --base=/coastline/
```

Only production builds register the service worker. Test with `npm run preview` on localhost, using a separate port from the dev server. Phone installation needs HTTPS.

Keep `sw.js` at a stable URL with `Cache-Control: no-cache`. The [PWA plugin](scripts/pwa-plugin.mjs) builds the offline cache list, including the chunk worker.

## Assets and tests

Use `node scripts/pwa-icons.mjs` to regenerate icons from the favicon and `node scripts/pwa-screenshots.mjs` to refresh install screenshots.

```sh
node scripts/pwa-test.mjs
node scripts/pwa-banner-test.mjs
node scripts/fullscreen-test.mjs
```

These check installation, offline use, updates, subdirectory hosting, and fullscreen. The PWA test creates builds and browser profiles under `.artifacts/`. It uses Windows Chrome or Playwright Chromium elsewhere. Set `CHROME_PATH` to use another executable.
