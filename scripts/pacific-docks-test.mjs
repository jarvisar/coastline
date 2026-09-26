import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = process.env.TEST_ARTIFACT_DIR || '.artifacts/pacific-docks';
await mkdir(directory, {recursive: true});
const browser = await chromium.launch({executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const errors = [], records = [];
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const url = new URL(process.env.TEST_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('seed', process.env.TEST_WORLD_SEED || '4817');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'), {timeout: 120000});
  await page.addStyleTag({content: '#app > :not(#scene), #pwa-install-invitation {display:none !important;}'});
  const sites = await page.evaluate(async () => {
    const {coastalDiscoveries} = await import('/src/world/coastal-discoveries.js');
    const {shorelineOffset} = await import('/src/world/route.js');
    const docks = coastalDiscoveries(-100000, 100000).filter(site => site.kind === 'dock').sort((a,b) => Math.abs(a.s) - Math.abs(b.s)).slice(0, 3);
    // Also revisit the original inlet beach, though its dock has moved.
    return [...docks, {kind: 'original-beach', index: 0, s: -3394, u: shorelineOffset(-3394) + 9}];
  });
  assert.equal(sites.length, 4);
  for (const site of sites) {
    records.push(await page.evaluate(async site => {
      const a = window.__coastline, {positionAt, bridgeAt} = await import('/src/world/route.js');
      if (!a.paused) await a.action('pause');
      a.vehicle.s = site.s; a.vehicle.reset(); a.world.update(site.s); a.vehicle.render(1, a.world.origin);
      a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.world.animate(8.5);
      const p = positionAt(site.s, site.u, 1), camera = a.rendering.camera, height = 60, aspect = innerWidth / innerHeight;
      camera.left = -height * aspect / 2; camera.right = height * aspect / 2; camera.top = height / 2; camera.bottom = -height / 2;
      camera.position.set(p.x - 80, p.y + 85, p.z + a.world.origin + 100); camera.lookAt(p.x, p.y, p.z + a.world.origin);
      camera.updateProjectionMatrix(); a.rendering.render();
      return {...site, inletDistance: Math.abs(site.s - bridgeAt(site.s).center), chunks: a.world.chunks.size, resident: a.graphics.settings.chunks.behind + a.graphics.settings.chunks.ahead + 1,
        copies: [...a.world.chunks.values()].flatMap(chunk => chunk.features.discoveries || []).filter(other => other.kind === site.kind && other.index === site.index).length};
    }, site));
    assert.equal(records.at(-1).chunks, records.at(-1).resident);
    if (site.kind === 'dock') assert.equal(records.at(-1).copies, 1);
    await page.screenshot({path: `${directory}/${site.kind}-${site.index}.png`});
  }
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report.json`, JSON.stringify({passed: true, records, errors}, null, 2));
  console.log(JSON.stringify({passed: true, records}, null, 2));
} finally { await browser.close(); }
