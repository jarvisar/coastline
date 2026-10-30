import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const stage = process.argv[2] || 'after';
const directory = `.artifacts/salt/${stage}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], records = [];
const shots = (process.env.SHOTS || '').split(',').filter(Boolean);
const views = [
  ['dry-scenic', 620, 'Scenic view'], ['dry-medium', 1025, 'Medium view'], ['dry-close', 2400, 'Close view'],
  ['lagoon-scenic', -5150, 'Scenic view'], ['lagoon-medium', -5150, 'Medium view'], ['dry-third', 620, 'Third-person view'],
  ['lagoon-third', -5150, 'Third-person view'], ['first', 1800, 'First-person view'], ['far-third', 9000, 'Third-person view'],
  ['far-close', 9000, 'Close view'], ['extra', 3900, 'Extra close view'],
].filter(([name]) => !shots.length || shots.includes(name));
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.addInitScript(() => {
    localStorage.setItem('coastline-journey', 'salt'); localStorage.setItem('coastline-traffic', 'false');
    localStorage.setItem('coastline.graphics', JSON.stringify({ mode: 'high', level: 'high' }));
  });
  const url = new URL(process.env.TEST_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('seed', process.env.TEST_WORLD_SEED || '4817');
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'), { timeout: 120000 });
  await page.click('#start');
  await page.addStyleTag({ content: '#app > :not(#scene) { display: none !important; }' });
  for (const [name, s, view] of views) {
    const record = await page.evaluate(async ({ s, view }) => {
      const a = window.__coastline;
      if (!a.paused) await a.action('pause');
      a.vehicle.wheelSpin = 0;
      a.vehicle.s = s; a.vehicle.reset(); await a.world.chunkSource.prepare(s); a.world.update(s); a.vehicle.render(1, a.world.origin); a.rendering.snap();
      for (let i = 0; i < 6 && a.rendering.viewLabel !== view; i++) a.rendering.toggleView();
      a.rendering.update(a.vehicle.car, 10, a.world.origin); a.world.animate(10);
      a.rendering.render();
      return { name: view, s, chunks: a.world.chunks.size, ...a.rendering.renderer.info.render, memory: { ...a.rendering.renderer.info.memory } };
    }, { s, view });
    await page.screenshot({ path: `${directory}/${name}.png` });
    records.push({ shot: name, ...record });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report.json`, JSON.stringify({ errors, records }, null, 2));
  console.log(JSON.stringify(records.map(({ shot, calls, triangles, memory }) => ({ shot, calls, triangles, geometries: memory.geometries }))));
} finally { await browser.close(); }
