import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const stage = process.argv[2] || 'after';
const directory = `.artifacts/pacific/${stage}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  const url = new URL(process.env.TEST_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('seed', process.env.TEST_WORLD_SEED || '4817');
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'), { timeout: 120000 });
  await page.click('#start');
  for (const [name, s, view] of [['cove', 24, 'Medium view'], ['bridge', 148, 'Scenic view'], ['headland', 500, 'Scenic view'], ['overlook', 600, 'Close view'], ['driving', 500, 'Third-person view'], ['reverse', -1200, 'Medium view']]) {
    const record = await page.evaluate(async ({s, view}) => {
      const a = window.__coastline;
      if (!a.paused) await a.action('pause');
      // Like a route change, wait for the workers so the edge chunks aren't left out.
      a.vehicle.s = s; a.vehicle.reset(); await a.world.chunkSource.prepare(s); a.world.update(s); a.vehicle.render(1, a.world.origin); a.rendering.snap();
      a.traffic.render(1, a.world.origin);
      for (let i = 0; i < 5 && a.rendering.viewLabel !== view; i++) a.rendering.toggleView();
      a.rendering.update(a.vehicle.car, 10, a.world.origin); a.world.animate(2.2);
      a.rendering.render();
      return { name: view, s, chunks: a.world.chunks.size, ...a.rendering.renderer.info.render, memory: {...a.rendering.renderer.info.memory} };
    }, {s, view});
    // Capture the canvas alone so the pause panel doesn't obscure the scenery.
    await page.addStyleTag({content: '#app > :not(#scene) { display: none !important; }'});
    await page.screenshot({path: `${directory}/${name}.png`});
    assert.equal(record.chunks, 9);
    assert.ok(record.triangles > 50000, 'scenery must remain visible after changing origin');
    assert.ok(record.memory.geometries < 190, 'streaming must keep owned geometry bounded');
    assert.equal(record.memory.textures, 10, 'the coast needs no additional texture allocations');
    records.push(record);
  }
  const mobile = await browser.newPage({viewport: {width: 390, height: 844}, deviceScaleFactor: 1, isMobile: true, hasTouch: true});
  mobile.on('pageerror', e => errors.push(e.message));
  await mobile.goto(url.href);
  await mobile.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'), {timeout: 120000});
  await mobile.click('#start');
  await mobile.waitForTimeout(600);
  await mobile.evaluate(async () => {
    const a = window.__coastline;
    if (!a.paused) await a.action('pause');
    a.vehicle.s = 600; a.vehicle.reset(); a.world.update(600); a.vehicle.render(1, a.world.origin);
    a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.render();
    document.querySelector('#pause-overlay').hidden = true;
  });
  await mobile.screenshot({path: `${directory}/mobile.png`});
  await mobile.addStyleTag({content: '#app > :not(#scene) { display: none !important; }'});
  await mobile.screenshot({path: `${directory}/mobile-scene.png`});
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report.json`, JSON.stringify({errors, records}, null, 2));
  console.log(JSON.stringify({errors, records}, null, 2));
} finally { await browser.close(); }
