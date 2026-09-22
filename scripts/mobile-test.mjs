import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('coastline-install-dismissed-v2', String(Date.now())));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'));
  assert.equal(await page.evaluate(() => window.__coastline.rendering.viewLabel), 'Close view', 'mobile starts in Close view');
  await page.waitForTimeout(700);
  async function checkLayout(name) {
    const issues = await page.evaluate(() => {
      const failures = [];
      // Subpixel layout reports a 44 px control as 43.999… often enough to
      // flake, so compare against the target size with a hair of tolerance.
      const TARGET = 44 - .05;
      const selectors = document.querySelector('#welcome').classList.contains('hidden') ? ['#pause', '#change-journey', '#view', '#reset', '#touch-stick'] : ['#change-journey', '#start'];
      const rects = selectors.map(selector => ({ selector, rect: document.querySelector(selector).getBoundingClientRect() }));
      for (const { selector, rect } of rects) {
        if (rect.width < TARGET || rect.height < TARGET) failures.push(`${selector} has a small touch target (${rect.width.toFixed(2)} x ${rect.height.toFixed(2)} at ${innerWidth} x ${innerHeight})`);
        if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) failures.push(`${selector} is outside viewport`);
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        if (!document.querySelector(selector).contains(hit)) failures.push(`${selector} is covered by ${hit?.outerHTML.slice(0, 100)}`);
      }
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (Math.min(a.rect.right, b.rect.right) > Math.max(a.rect.left, b.rect.left) && Math.min(a.rect.bottom, b.rect.bottom) > Math.max(a.rect.top, b.rect.top)) failures.push(`${a.selector} overlaps ${b.selector}`);
      }
      if (document.documentElement.scrollWidth > innerWidth) failures.push('horizontal overflow');
      return failures;
    });
    assert.deepEqual(issues, [], name);
    checks.push(name);
  }
  for (const [width, height] of [[390, 844], [320, 568], [360, 640], [430, 932], [667, 375], [844, 390], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    await checkLayout(`welcome ${width}x${height}`);
    await page.locator('#start').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.artifacts/mobile-welcome-${width}.png` });
    await page.locator('#change-journey').tap();
    await page.locator('[data-journey=snow].journey-card').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('[data-journey=snow].journey-card').isVisible());
    assert.ok(await page.locator('#journey-dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.screenshot({ path: `.artifacts/mobile-journeys-${width}.png` });
    await page.locator('#close-journeys').tap();
    await page.waitForFunction(() => !window.__coastline.paused);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#start').tap();
  await page.waitForTimeout(1000);
  // Starting now hands over the welcome screen's moving car. The deadzone
  // check below needs a stationary car; reset before testing joystick input.
  await page.evaluate(() => window.__coastline.action('reset'));
  await page.waitForFunction(() => !window.__coastline.changingJourney);
  // The joystick's caption is a caption: it hugs two lines, clears the stick,
  // and its dismiss button stays a 44px target while looking like a small one.
  const captionIssues = await page.evaluate(() => {
    const failures = [];
    const help = document.querySelector('#stick-help'), close = help.querySelector('.dismiss-control-help');
    const h = help.getBoundingClientRect(), c = close.getBoundingClientRect();
    const stick = document.querySelector('#touch-stick').getBoundingClientRect();
    if (h.height > 60) failures.push(`the caption is ${h.height.toFixed(1)}px tall`);
    if (h.bottom > stick.top + 1) failures.push('the caption sits over the joystick');
    if (h.right > innerWidth + 1 || h.left < 0) failures.push('the caption runs off screen');
    if (c.bottom > h.bottom || c.top < h.top) failures.push('the dismiss button escapes the caption');
    for (const [dx, dy] of [[-21, -21], [21, 21], [-21, 21], [21, -21]]) {
      const hit = document.elementFromPoint(c.left + c.width / 2 + dx, c.top + c.height / 2 + dy);
      if (!close.contains(hit) && hit !== close) failures.push(`the dismiss target misses at ${dx}, ${dy}`);
    }
    return failures;
  });
  assert.deepEqual(captionIssues, [], 'joystick caption');
  checks.push('joystick caption sizing, clearance and dismiss target');
  const client = await page.context().newCDPSession(page);
  const point = async selector => { const r = await page.locator(selector).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const center = { ...await point('#touch-stick'), id: 1 };
  const stickRadius = (await page.locator('#touch-stick').boundingBox()).width * .3;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
  await frames();
  assert.equal(await page.evaluate(() => window.__coastline.vehicle.speed), 0, 'touching the center does not accelerate');
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...center, y: center.y - stickRadius }] });
  await page.waitForFunction(() => window.__coastline.vehicle.speed > 3);
  assert.ok(await page.evaluate(() => window.__coastline.input.state.touchStick.y > .9));
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...center, x: center.x + 160 }] });
  await frames();
  assert.equal(await page.evaluate(() => window.__coastline.input.state.touchStick.x), 1, 'pointer capture tracks drags beyond the stick');
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.waitForFunction(() => window.__coastline.vehicle.speed === 0);
  assert.deepEqual(await page.evaluate(() => window.__coastline.input.state.touchStick), { x: 0, y: 0 });
  checks.push('joystick deadzone, drag outside bounds, touch cancellation and stopping');
  // A touch on open scenery summons the stick under the thumb, and release sends it home.
  const floating = { x: 120, y: 520, id: 1 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [floating] });
  await frames();
  assert.equal(await page.evaluate(() => window.__coastline.input.state.touchStick.y), 0, 'the summoned stick starts centered under the thumb');
  const summoned = await point('#touch-stick');
  assert.ok(Math.hypot(summoned.x - floating.x, summoned.y - floating.y) < 1, `the stick appears under the thumb (${summoned.x}, ${summoned.y})`);
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...floating, y: floating.y - stickRadius }] });
  await frames();
  assert.ok(await page.evaluate(() => window.__coastline.input.state.touchStick.y > .9), 'dragging the summoned stick drives');
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => window.__coastline.vehicle.speed === 0);
  await page.waitForTimeout(400);
  const home = await point('#touch-stick');
  assert.ok(Math.hypot(home.x - center.x, home.y - center.y) < 1, 'the stick returns to its resting spot');
  checks.push('floating joystick appears under the thumb and returns home on release');
  async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center, y: center.y - 30 }] });
  await frames();
  // A second finger can pause without taking over the joystick's pointer.
  const pausePoint = { ...await point('#pause'), id: 2 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center, y: center.y - 30 }, pausePoint] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pausePoint] });
  await page.waitForFunction(() => window.__coastline.paused);
  assert.equal(await page.evaluate(() => window.__coastline.input.touchStick.engaged), false);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.locator('#resume').tap();
  assert.equal(await page.evaluate(() => window.__coastline.input.state.touchStick), null, 'the reused input record reports no stick rather than a stale one');
  checks.push('second-finger pause clears joystick and prevents stale input on resume');
  await page.locator('#view').tap();
  assert.match(await page.locator('#view').getAttribute('aria-label'), /Extra close view/);
  const heldStick = { ...center, y: center.y - 30 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [heldStick] });
  await page.waitForFunction(() => window.__coastline.vehicle.speed > 1);
  const viewPoint = { ...await point('#view'), id: 2 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [heldStick, viewPoint] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [viewPoint] });
  await page.waitForFunction(() => window.__coastline.rendering.camera.isPerspectiveCamera);
  assert.match(await page.locator('#view').getAttribute('aria-label'), /Third-person view/);
  assert.ok(await page.evaluate(() => window.__coastline.input.touchStick.pointer !== null));
  const cameraRotation = await page.evaluate(() => window.__coastline.rendering.camera.quaternion.toArray());
  const startHeading = await page.evaluate(() => window.__coastline.vehicle.heading);
  assert.match(await page.locator('#touch-stick').getAttribute('aria-label'), /left and right to steer/);
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...center, x: center.x + 25, y: center.y - 25 }] });
  await page.waitForFunction(heading => window.__coastline.vehicle.heading - heading > .2, startHeading);
  const turnRotation = await page.evaluate(() => window.__coastline.rendering.camera.quaternion.toArray());
  assert.ok(Math.abs(turnRotation.reduce((dot, value, index) => dot + value * cameraRotation[index], 0)) < .999, 'camera follows while steering with the joystick held');
  const forwardSpeed = await page.evaluate(() => window.__coastline.vehicle.speed);
  const turnHeading = await page.evaluate(() => window.__coastline.vehicle.heading);
  // A full reverse input also overcomes the extra drag if the turn leaves the road.
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...center, y: center.y + stickRadius }] });
  await page.waitForFunction(speed => window.__coastline.vehicle.speed < speed, forwardSpeed);
  await page.waitForFunction(() => window.__coastline.vehicle.speed < -.5);
  assert.ok(await page.evaluate(heading => Math.cos(window.__coastline.vehicle.heading - heading) > .98, turnHeading), 'down brakes and reverses without flipping the car');
  assert.ok(await page.evaluate(() => window.__coastline.input.state.touchStick.y < -.5));
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => window.__coastline.vehicle.speed === 0);
  checks.push('second-finger view change preserves joystick; third-person steering follows smoothly, down brakes/reverses, and release stops');
  for (const [width, height] of [[390, 844], [320, 568], [667, 375], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await checkLayout(`driving ${width}x${height}`);
    const projected = await page.evaluate(() => {
      const app = window.__coastline;
      return app.vehicle.car.position.clone().project(app.rendering.camera).toArray();
    });
    assert.ok(Math.abs(projected[0]) < .9 && Math.abs(projected[1]) < .8, 'third-person car stays visible after rotation');
    await page.screenshot({ path: `.artifacts/mobile-driving-${width}.png` });
    await page.locator('#pause').tap();
    await page.locator('#resume').tap();
    assert.equal(await page.evaluate(() => window.__coastline.paused), false);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const journey of ['desert', 'snow']) {
    await page.locator('#change-journey').tap();
    await page.locator(`.journey-card[data-journey=${journey}]`).tap();
    await page.waitForFunction(id => window.__coastline.journey === id && !window.__coastline.changingJourney, journey);
    await checkLayout(`${journey} touch controls`);
    assert.equal(await page.evaluate(() => window.__coastline.rendering.camera.isPerspectiveCamera), true);
    await page.screenshot({ path: `.artifacts/mobile-${journey}-ui.png` });
  }
  await page.evaluate(() => {
    for (const [side, value] of Object.entries({ top: 44, bottom: 34, left: 0, right: 0 })) document.documentElement.style.setProperty(`--safe-${side}`, `${value}px`);
  });
  await checkLayout('portrait safe area');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    for (const [side, value] of Object.entries({ top: 0, bottom: 21, left: 44, right: 44 })) document.documentElement.style.setProperty(`--safe-${side}`, `${value}px`);
  });
  await checkLayout('landscape safe area');
  assert.deepEqual(errors, []);
  await writeFile('.artifacts/mobile-report.json', JSON.stringify({ passed: true, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally { await browser.close(); }
