import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Frame times while autodriving each route on the real GPU, with each slow
// frame's likely cause: a shader link, a chunk arriving, a big upload or a GC.
// Run it on a quiet machine. PROFILE_THROTTLE slows the CPU like a phone, but
// Chrome's throttling adds long frames of its own, so trust only the medians then.
const label = process.env.PROFILE_LABEL ?? 'current';
assert.match(label, /^[a-z0-9-]+$/i);
const quality = process.env.PROFILE_QUALITY ?? 'balanced';
assert.ok(['high', 'balanced', 'smooth', 'basic'].includes(quality));
const seconds = Number(process.env.PROFILE_SECONDS ?? 20), throttle = Number(process.env.PROFILE_THROTTLE ?? 1);
const mobile = process.env.PROFILE_MOBILE === '1';
const routes = (process.env.PROFILE_ROUTES ?? 'coast,desert,snow,jungle,plains,city,volcanic,salt,swamp').split(',');
const directory = `.artifacts/performance/${label}`;
await mkdir(directory, { recursive: true });

function instrument({ quality, journey }) {
  localStorage.setItem('coastline.graphics', JSON.stringify({ mode: quality }));
  localStorage.setItem('coastline-journey', journey);
  const zero = () => ({ links: 0, uploads: 0, arrivals: 0 });
  const profile = window.__frameProfile = { recording: false, frames: [], counts: zero() };
  const gl = WebGL2RenderingContext.prototype, link = gl.linkProgram, bufferData = gl.bufferData;
  gl.linkProgram = function (...args) { profile.counts.links++; return link.apply(this, args); };
  gl.bufferData = function (...args) { profile.counts.uploads += args[1]?.byteLength ?? 0; return bufferData.apply(this, args); };
  const requestFrame = window.requestAnimationFrame.bind(window);
  // Three.js drives its loop through requestAnimationFrame, so time its callback.
  window.requestAnimationFrame = callback => requestFrame(time => {
    if (!profile.recording || callback.name !== 'onAnimationFrame') { callback(time); return; }
    const heap = performance.memory.usedJSHeapSize, start = performance.now();
    callback(time);
    const duration = performance.now() - start, { renderer } = window.__coastline.rendering;
    profile.frames.push({ time, duration, gc: performance.memory.usedJSHeapSize < heap - 262144, calls: renderer.info.render.calls, ...profile.counts });
    profile.counts = zero();
  });
  profile.start = () => {
    const a = window.__coastline, source = a.world.chunkSource, take = source.take.bind(source);
    source.take = index => { profile.counts.arrivals++; return take(index); };
    profile.counts = zero(); profile.recording = true;
  };
}

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
});
const records = [];
try {
  for (const journey of routes) {
    const context = await browser.newContext(mobile
      ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(instrument, { quality, journey });
    const url = new URL(process.env.TEST_URL ?? 'http://127.0.0.1:5173');
    url.searchParams.set('seed', '4817');
    await page.goto(url.href);
    await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded') && !window.__coastline.changingJourney, null, { timeout: 120000 });
    const cdp = await context.newCDPSession(page);
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.evaluate(() => window.__coastline.action('autodrive'));
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.__frameProfile.start());
    await page.waitForTimeout(seconds * 1000);
    const frames = await page.evaluate(() => { window.__frameProfile.recording = false; return window.__frameProfile.frames; });
    const durations = frames.map(frame => frame.duration), median = percentile(durations, .5);
    // A hitch takes twice the usual frame and at least 6 ms more.
    const hitches = frames.filter(frame => frame.duration > Math.max(median * 2, median + 6));
    const cause = frame => [frame.links && 'shader link', frame.arrivals && 'chunk', frame.uploads > 262144 && `${Math.round(frame.uploads / 1024)} KB upload`, frame.gc && 'GC'].filter(Boolean).join(', ') || 'unknown';
    const round = value => Math.round(value * 10) / 10;
    const record = { journey, median: round(median), p99: round(percentile(durations, .99)), max: round(Math.max(...durations)),
      calls: percentile(frames.map(frame => frame.calls), .5), hitches: hitches.length,
      links: frames.reduce((sum, frame) => sum + frame.links, 0),
      worst: [...hitches].sort((a, b) => b.duration - a.duration).slice(0, 5).map(frame => `${round(frame.duration)} ms (${cause(frame)})`), errors };
    records.push(record);
    console.log(JSON.stringify(record));
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${directory}/frames.json`, JSON.stringify({ quality, mobile, throttle, seconds, records }, null, 2));
console.table(records.map(({ journey, median, p99, max, calls, hitches, links }) => ({ journey, median, p99, max, calls, hitches, links })));
assert.deepEqual(records.flatMap(record => record.errors), []);
