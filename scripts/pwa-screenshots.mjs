import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
    : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  await mkdir(new URL('../public/screenshots/', import.meta.url), { recursive: true });
  // The wide screenshot is the route slices preview from showcase-slices.mjs.
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.addInitScript(() => localStorage.setItem('coastline-install-dismissed-v2', String(Date.now())));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
  await page.locator('#loading').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await page.screenshot({ path: fileURLToPath(new URL('../public/screenshots/mobile.jpg', import.meta.url)), type: 'jpeg', quality: 85 });
} finally { await browser.close(); await server.close(); }
