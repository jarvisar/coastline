import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

// All routes share a seed, road position, camera angle and full landscape framing.
const routes = ['coast', 'desert', 'snow', 'jungle', 'plains', 'city', 'volcanic', 'salt'];
const position = Number(process.env.POSITION ?? -1100);
if (!Number.isFinite(position)) throw new Error('POSITION must be a finite road distance.');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, process.env.OUTPUT ?? 'showcase/scene-slices.png');
const seed = process.env.SEED ?? '4817';
if (!/^\d+$/.test(seed) || Number(seed) > 0xffffffff) throw new Error('SEED must be an unsigned 32-bit integer.');
const width = 3840, height = 2160, sliceWidth = width / routes.length;
const padding = 432;
const server = await createServer({ root, server: { port: 0, host: '127.0.0.1' } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
      : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: sliceWidth, height: height + padding * 2 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('coastline.graphics', JSON.stringify({ mode: 'high', level: 'high', density: 1, ambientOcclusion: true }));
    localStorage.setItem('coastline-journey', 'coast');
    localStorage.setItem('coastline-install-dismissed-v2', String(Date.now()));
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=${seed}`);
  await page.waitForFunction(() => window.__coastline && !window.__coastline.changingJourney && document.querySelector('#loading.loaded'));
  await page.click('#start');
  await page.evaluate(() => { if (!window.__coastline.paused) window.__coastline.action('pause'); });
  const images = [];
  for (const [index, route] of routes.entries()) {
    images.push(await page.evaluate(async ({ route, index, position, width, height, sliceWidth, padding }) => {
      const a = window.__coastline;
      await a.changeJourney(route);
      if (!a.paused) a.action('pause');
      await a.world.chunkSource.prepare(position);
      a.world.update(position);
      a.vehicle.s = position; a.vehicle.reset(); a.vehicle.render(1, a.world.origin);
      a.traffic.reset(a.vehicle.route, position, route); a.traffic.render(1, a.world.origin);
      for (let i = 0; a.rendering.viewLabel !== 'Scenic view' && i < 6; i++) a.rendering.toggleView();
      a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.resize();
      a.world.animate(8.5, a.vehicle);
      const Vector3 = a.rendering.camera.position.constructor;
      const point = s => {
        const p = a.vehicle.route.position(s, 0);
        return new Vector3(p.x, p.y, p.z + a.world.origin);
      };
      // Each route renders its own slice of one shared scenic window.
      const target = point(position).add(new Vector3(-24, 0, -46));
      const offset = new Vector3(-220, 245, 260);
      const camera = a.rendering.camera;
      camera.up.set(0, 1, 0);
      camera.position.copy(target).add(offset); camera.lookAt(target);
      const worldHeight = 235, worldWidth = worldHeight * width / height;
      camera.left = -worldWidth / 2; camera.right = worldWidth / 2;
      camera.top = worldHeight / 2; camera.bottom = -camera.top;
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      camera.userData.focusDistance = offset.length();
      const curve = [];
      for (let s = position - 900; s <= position + 900; s += .5) {
        const p = point(s).project(camera);
        curve.push({ x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 });
      }
      curve.sort((a, b) => a.x - b.x);
      const worldSliceWidth = worldWidth * sliceWidth / width;
      camera.left = -worldWidth / 2 + index * worldSliceWidth;
      camera.right = camera.left + worldSliceWidth;
      camera.top = worldHeight * (.5 + padding / height); camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
      const { fitSunShadow } = await import('/src/shadows.js');
      const sun = a.rendering.scene.children.find(object => object.isDirectionalLight);
      fitSunShadow(camera, sun, target.y, a.world.origin);
      // Read the canvas straight after rendering, with no UI.
      a.rendering.render();
      return { src: a.rendering.renderer.domElement.toDataURL('image/png'), curve };
    }, { route, index, position, width, height, sliceWidth, padding }));
    console.log(`Captured ${route}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const composite = await browser.newPage();
  const result = await composite.evaluate(async ({ images, width, height, sliceWidth, padding }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const roadY = (curve, x) => {
      let lo = 0, hi = curve.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (curve[mid].x < x) lo = mid; else hi = mid; }
      const a = curve[lo], b = curve[hi];
      return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
    };
    let maxShift = 0;
    for (const [i, capture] of images.entries()) {
      const img = new Image(); img.src = capture.src; await img.decode();
      if (img.width !== sliceWidth || img.height !== height + padding * 2) throw new Error('Unexpected capture dimensions');
      // Same seed means same bends. Shift each column vertically to cancel
      // per-route road elevation.
      for (let x = 0; x < sliceWidth; x++) {
        const globalX = i * sliceWidth + x;
        const shift = roadY(capture.curve, globalX + .5) - roadY(images[0].curve, globalX + .5);
        maxShift = Math.max(maxShift, Math.abs(shift));
        if (Math.abs(shift) > padding) throw new Error('Elevation correction exceeds capture padding');
        ctx.drawImage(img, x, padding + shift, 1, height, globalX, 0, 1, height);
      }
    }
    const preview = document.createElement('canvas'); preview.width = 1792; preview.height = 1008;
    preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
    return { png: canvas.toDataURL('image/png').split(',')[1], preview: preview.toDataURL('image/png').split(',')[1], maxShift };
  }, { images, width, height, sliceWidth, padding });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(result.png, 'base64'));
  await writeFile(output.replace(/\.png$/i, '') + '-preview.png', Buffer.from(result.preview, 'base64'));
  console.log(`Maximum elevation correction: ${result.maxShift.toFixed(1)} px`);
  console.log(`Saved ${width}×${height} image: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
