import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  // US formatting must stay consistent even when the browser uses another locale.
  const page = await browser.newPage({ locale: 'de-DE', viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
  assert.equal(await page.locator('html').getAttribute('lang'), 'en-US');
  assert.match(await page.locator('.location-sub').textContent(), /mi driven$/);
  // The readout is only visible on the pause screen.
  await page.evaluate(() => window.__coastline.action('pause'));
  assert.equal(await page.locator('.location').isVisible(), true);
  for (const [distance, expected] of [[0, '0.0'], [1609.344, '1.0'], [804.672, '0.5'], [1986638.3616, '1,234.4']]) {
    await page.evaluate(distance => { window.__coastline.vehicle.distance = distance; }, distance);
    await page.waitForFunction(expected => document.querySelector('#distance').textContent === expected, expected);
  }
  const names = { desert: 'RED ROCK DESERT', snow: 'MIDNIGHT ALPINE', jungle: 'EMERALD JUNGLE', plains: 'GOLDEN PLAINS', city: 'RAINY DOWNTOWN', coast: 'PACIFIC COAST' };
  for (const id of ['desert', 'snow', 'jungle', 'plains', 'city', 'coast']) {
    await page.locator('#change-journey').click();
    await page.locator(`[data-journey="${id}"]`).click();
    await page.waitForFunction(id => window.__coastline.journey === id && !window.__coastline.changingJourney, id);
    assert.equal(await page.locator('.location-title').textContent(), names[id]);
    assert.equal(await page.locator('#distance').textContent(), id === 'coast' ? '1,234.4' : '0.0');
  }
  assert.deepEqual(errors, []);
  console.log('Passed: miles, US number formatting, the route the pause readout names, and restored mileage across all routes.');
} finally {
  await browser.close();
}
