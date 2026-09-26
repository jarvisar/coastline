import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.artifacts/responsive', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [], errors = [];
const sizes = {
  touch: [[320, 480], [320, 568], [360, 640], [390, 844], [430, 932], [480, 320], [568, 320], [667, 375], [740, 360], [844, 390], [932, 430], [600, 960], [768, 1024], [820, 1180], [1024, 768], [1280, 800]],
  mouse: [[640, 480], [800, 600], [1024, 768], [1280, 720], [1440, 900], [1920, 1080], [2560, 1440]],
};
try {
  for (const [mode, viewports] of Object.entries(sizes)) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: mode === 'touch', isMobile: mode === 'touch', reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('coastline-install-dismissed-v2', String(Date.now())));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
    await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
    // Freeze world animation for the layout audit.
    await page.evaluate(() => window.__coastline.action('pause'));
    async function showState(state) {
      await page.evaluate(state => {
        const welcome = document.querySelector('#welcome'), pause = document.querySelector('#pause-overlay');
        const dialog = document.querySelector('#journey-dialog'), garage = document.querySelector('#car-dialog');
        for (const open of [dialog, garage]) if (open.open) open.close();
        welcome.classList.toggle('hidden', state !== 'menu');
        pause.hidden = state !== 'pause';
        document.querySelector('#pause').setAttribute('aria-pressed', String(state === 'pause'));
        if (state === 'chooser') dialog.showModal();
        if (state === 'garage') garage.showModal();
        welcome.scrollTop = 0; pause.scrollTop = 0; dialog.scrollTop = 0; garage.scrollTop = 0;
      }, state);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    async function audit(name, state) {
      const issues = await page.evaluate(state => {
        const issues = [];
        const visible = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
        const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        const dialogState = state === 'chooser' || state === 'garage';
        const panel = state === 'garage' ? '#car-dialog' : '#journey-dialog';
        const selectors = dialogState
          ? [`${panel} .chooser-heading`, `${panel} .chooser-title`, `${panel} .garage-title`, `${panel} .chooser-intro`, `${panel} .chooser-options`, `${panel} .chooser-note`]
          : ['.brand', '#change-journey', '#pause', '.controls', '.location', '#touch-stick', '#stick-help', ...(state === 'menu' ? ['#welcome'] : [])];
        const items = selectors.map(selector => ({ selector, element: document.querySelector(selector) })).filter(item => visible(item.element)).map(item => ({ ...item, rect: rect(item.element) }));
        for (let i = 0; i < items.length; i++) {
          const a = items[i];
          if (!dialogState && (a.rect.left < -1 || a.rect.right > innerWidth + 1 || a.rect.top < -1 || a.rect.bottom > innerHeight + 1)) issues.push(`${a.selector} outside viewport`);
          for (const b of items.slice(i + 1)) if (!a.element.contains(b.element) && !b.element.contains(a.element) && overlaps(a.rect, b.rect)) issues.push(`${a.selector} overlaps ${b.selector}`);
        }
        // Sound and fullscreen live on the pause screen.
        const buttons = state === 'menu' ? ['#start', '#change-journey'] : state === 'pause' ? ['#resume', '#change-car', '#sound', '#fullscreen', '#change-journey', '#pause'] : state === 'chooser' ? ['#close-journeys'] : state === 'garage' ? ['#close-cars'] : ['#view', '#reset', '#pause', '#change-journey'];
        for (const selector of buttons) {
          const el = document.querySelector(selector);
          if (document.body.dataset.controller === 'true' && ['#view', '#reset', '#pause', '#change-journey'].includes(selector)) continue;
          if (!visible(el)) { issues.push(`${selector} required action hidden`); continue; }
          // Long panels scroll, so check each control once scrolled into view.
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const r = rect(el), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!el.contains(hit)) issues.push(`${selector} covered or clipped by ${hit?.id || hit?.className}`);
          if (r.width < 43 || r.height < 43) issues.push(`${selector} target below 44px`);
        }
        for (const selector of ['#welcome', '#journey-dialog', '#car-dialog', '#pause-overlay']) {
          const el = document.querySelector(selector);
          if (visible(el) && el.scrollWidth > el.clientWidth + 1) issues.push(`${selector} horizontal overflow`);
        }
        // The route readout only shows on the pause screen.
        if (state === 'pause') {
          const location = document.querySelector('.location');
          if (!visible(location)) issues.push('pause readout missing');
          else {
            const title = document.querySelector('.location-title').getBoundingClientRect();
            if (document.querySelector('.location-sub').getBoundingClientRect().top < title.bottom - 1) issues.push('distance is not below the route');
            if (overlaps(rect(location), rect(document.querySelector('#resume')))) issues.push('the readout covers Resume');
          }
        }
        if (state === 'driving') {
          if (visible(document.querySelector('.location'))) issues.push('the drive still shows a readout');
          const stick = document.querySelector('#touch-stick');
          // At 320 px the stick is wider than half the viewport, so test its centre.
          const stickRect = visible(stick) && rect(stick);
          if (stickRect && stickRect.left + stickRect.width / 2 < innerWidth / 2) issues.push('joystick is not on the right');
          if (stickRect && stickRect.right > innerWidth - 4) issues.push('joystick runs past the right edge');
        }
        if (document.documentElement.scrollWidth > innerWidth) issues.push('page horizontal overflow');
        return issues;
      }, state);
      results.push({ name, issues });
      if (!process.env.SKIP_SCREENSHOTS && (issues.length || /320x480|390x844|568x320|800x600|1440x900|notched|controller|install-help/.test(name))) await page.screenshot({ path: `.artifacts/responsive/latest-${name}.png` });
    }
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      for (const state of ['menu', 'driving', 'pause', 'chooser', 'garage']) {
        await showState(state);
        await audit(`${mode}-${width}x${height}-${state}`, state);
      }
    }
    const variants = mode === 'touch' ? [
      { width: 390, height: 844, safe: { top: 44, bottom: 34 }, name: 'notched-portrait' },
      { width: 844, height: 390, safe: { left: 44, right: 44, bottom: 21 }, name: 'notched-landscape' },
      { width: 568, height: 320, safe: { left: 44, right: 44, bottom: 21 }, name: 'small-notched-landscape' },
      { width: 390, height: 844, controller: true, name: 'controller-portrait' },
      { width: 568, height: 320, controller: true, name: 'controller-landscape' },
      { width: 320, height: 480, dismissed: true, name: 'help-dismissed-small' },
      { width: 568, height: 320, expanded: true, name: 'install-help-landscape' },
      { width: 390, height: 844, expanded: true, name: 'install-help-portrait' },
    ] : [
      { width: 800, height: 600, dismissed: true, name: 'help-dismissed-desktop' },
      { width: 640, height: 480, expanded: true, name: 'install-help-desktop' },
    ];
    for (const variant of variants) {
      await page.setViewportSize({ width: variant.width, height: variant.height });
      await page.evaluate(variant => {
        for (const side of ['top', 'bottom', 'left', 'right']) document.documentElement.style.setProperty(`--safe-${side}`, `${variant.safe?.[side] || 0}px`);
        document.body.dataset.controller = String(Boolean(variant.controller));
        document.body.dataset.controlHelpDismissed = String(Boolean(variant.dismissed));
        document.body.dataset.journey = variant.controller ? 'desert' : 'snow';
        document.querySelector('.location-title').textContent = 'MIDNIGHT ALPINE';
        document.querySelector('#distance').textContent = '999,999.9';
        for (const help of document.querySelectorAll('.pwa-install-help')) {
          help.hidden = !variant.expanded;
          help.textContent = 'On iPhone or iPad, open this page in Safari, tap Share, then Add to Home Screen. Keep Open as Web App on if shown, then tap Add.';
        }
      }, variant);
      for (const state of ['menu', 'driving', 'pause', 'chooser', 'garage']) {
        await showState(state);
        await audit(`${mode}-${variant.name}-${state}`, state);
      }
      for (const [panel, closer] of [['#journey-dialog', '#close-journeys'], ['#car-dialog', '#close-cars']]) {
        await showState(panel === '#car-dialog' ? 'garage' : 'chooser');
        await page.locator(`${panel} .chooser-card`).last().scrollIntoViewIfNeeded();
        const close = page.locator(closer);
        assert.ok(await close.isVisible());
        await close.click();
      }
    }
    await page.close();
  }
  await writeFile('.artifacts/responsive/report.json', JSON.stringify({ results, errors }, null, 2));
  const failed = results.filter(result => result.issues.length);
  console.log(JSON.stringify({ cases: results.length, failures: failed, errors }, null, 2));
  if (!process.env.AUDIT_ONLY) { assert.deepEqual(failed, []); assert.deepEqual(errors, []); }
} finally { await browser.close(); }
