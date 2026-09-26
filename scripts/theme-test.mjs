import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
const routes = ['coast', 'desert', 'snow', 'jungle', 'plains', 'city', 'volcanic'];
const records = [], errors = [];
await mkdir('.artifacts/themes', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('coastline-journey', 'volcanic'));
    await page.goto(`${url}/?seed=4817`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__coastline && !window.__coastline.changingJourney && document.querySelector('#loading.loaded'));
    await page.click('#start');
    await page.evaluate(() => window.__coastline.action('pause'));
    // Check text contrast against both black and white backdrops so no passing
    // scenery can hide it.
    for (const route of routes) {
      await page.evaluate(route => window.__coastline.changeJourney(route), route);
      await page.waitForFunction(() => !window.__coastline.changingJourney);
      for (const state of ['garage', 'routes', 'pause', 'driving', 'menu']) {
        // Dialog close events restore the pause state asynchronously, so wait
        // two frames before setting up the next state.
        await page.evaluate(() => { for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.evaluate(({ route, state }) => {
          if (!window.__coastline.paused) window.__coastline.action('pause');
          document.querySelector('#welcome').classList.toggle('hidden', state !== 'menu');
          document.querySelector('#pause-overlay').hidden = state !== 'pause';
          document.querySelector('#pause-overlay').scrollTop = 0;
          for (const id of ['graphics-settings', 'audio-mixer']) document.getElementById(id).hidden = false;
          for (const id of ['graphics-toggle', 'audio-mixer-toggle']) document.getElementById(id).setAttribute('aria-expanded', 'true');
          if (state === 'garage' || state === 'routes') {
            const dialog = document.getElementById(state === 'garage' ? 'car-dialog' : 'journey-dialog');
            dialog.showModal(); dialog.scrollTop = 0;
          }
          const toast = document.querySelector('#toast'); toast.textContent = 'Camera view changed'; toast.classList.toggle('show', state === 'driving');
        }, { route, state });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const audit = async (interaction = '') => {
          const result = await page.evaluate(state => {
            const root = document.querySelector(state === 'garage' ? '#car-dialog' : state === 'routes' ? '#journey-dialog'
              : state === 'pause' ? '#pause-overlay' : state === 'menu' ? '#welcome' : '#app');
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const color = css => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const p = ctx.getImageData(0, 0, 1, 1).data; return [p[0], p[1], p[2], p[3] / 255]; };
            const over = (a, b) => [0, 1, 2].map(i => a[i] * a[3] + b[i] * (1 - a[3]));
            const luminance = rgb => rgb.reduce((sum, value, i) => { const n = value / 255; return sum + [0.2126, 0.7152, 0.0722][i] * (n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); }, 0);
            const contrast = (a, b) => { const l = [luminance(a), luminance(b)]; return (Math.max(...l) + .05) / (Math.min(...l) + .05); };
            const samples = [], failures = [], seen = new Set();
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode, element = node.parentElement;
              if (!node.textContent.trim() || seen.has(element) || element.closest('svg,script,style,[hidden],#welcome .menu-brand,.loading,#scene')) continue;
              if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.closest('button:disabled')) continue;
              const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
              // #app holds hidden panels too; only audit HUD text.
              if (state === 'driving' && !element.closest('.drive-actions,.controls,#stick-help,#toast,#fps-counter')) continue;
              seen.add(element);
              const chain = []; let parent = element, opacity = 1;
              while (parent && parent !== document.body) { chain.unshift(parent); opacity *= Number(getComputedStyle(parent).opacity); parent = parent.parentElement; }
              let minimum = Infinity;
              for (const backdrop of [[0, 0, 0], [255, 255, 255]]) {
                let background = backdrop;
                for (const layer of chain) background = over(color(getComputedStyle(layer).backgroundColor), background);
                const foreground = color(getComputedStyle(element).color); foreground[3] *= opacity;
                minimum = Math.min(minimum, contrast(over(foreground, background), background));
              }
              const sample = { text: node.textContent.trim().slice(0, 60), selector: element.id || element.className, contrast: +minimum.toFixed(2) };
              samples.push(sample); if (minimum < 4.5) failures.push(sample);
            }
            const dialog = root.matches('dialog') ? root : null;
            const headerMatches = !dialog || getComputedStyle(dialog).backgroundColor === getComputedStyle(dialog.querySelector('.chooser-heading')).backgroundColor;
            const overflow = document.documentElement.scrollWidth > innerWidth || (dialog && dialog.scrollWidth > dialog.clientWidth + 1);
            return { samples: samples.length, minimum: Math.min(...samples.map(s => s.contrast)), failures, headerMatches, overflow: !!overflow };
          }, state);
          records.push({ route, mobile, state, interaction, ...result });
        };
        await audit();
        if (state === 'garage' || state === 'routes') {
          const dialog = state === 'garage' ? '#car-dialog' : '#journey-dialog';
          await page.locator(`${dialog} .chooser-card`).first().hover(); await audit('hover');
          await page.evaluate(dialog => { const el = document.querySelector(dialog); el.scrollTop = el.scrollHeight; }, dialog);
          await audit('scrolled');
          await page.evaluate(dialog => { document.querySelector(dialog).scrollTop = 0; }, dialog);
        }
        if (state === 'pause') {
          await page.locator('#resume').hover(); await audit('hover');
          await page.keyboard.press('Tab');
          await page.locator('#graphics-toggle').focus();
          assert.notEqual(await page.locator('#graphics-toggle').evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'keyboard focus remains visible');
          await page.evaluate(() => { document.querySelector('#pause-overlay').scrollTop = 0; });
        }
        if ((route === 'volcanic' && ['garage', 'pause', 'routes', 'driving'].includes(state)) || (!mobile && state === 'garage')) {
          await page.screenshot({ path: `.artifacts/themes/${route}-${mobile ? 'mobile' : 'desktop'}-${state}.png` });
        }
      }
    }
    await page.close();
  }
  await writeFile('.artifacts/themes/report.json', JSON.stringify({ records, errors }, null, 2));
  const failures = records.filter(r => !r.samples || r.failures.length || !r.headerMatches || r.overflow);
  console.log(JSON.stringify({ states: records.length, textSamples: records.reduce((n, r) => n + r.samples, 0), failures, errors }, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
} finally { await browser.close(); }
