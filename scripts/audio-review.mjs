import { chromium } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Listening comparison against the audio code at AUDIO_BASE_REF (default HEAD).
// Both versions drive the same stretch of road with the same inputs, and each
// clip is played back at a matched RMS.
const root = '.artifacts/audio/review';
const ref = process.env.AUDIO_BASE_REF || 'HEAD';
await rm(`${root}/legacy`, { recursive: true, force: true });
await mkdir(`${root}/legacy/audio`, { recursive: true });
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, 'src/audio.js', 'src/audio/'], { encoding: 'utf8' }).split('\n').filter(file => file.endsWith('.js'));
for (const file of files) await writeFile(`${root}/legacy/${file.slice('src/'.length)}`, execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' }));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__coastline);
  await page.evaluate(() => window.__coastline.action('pause'));
  const cases = [
    { id: 'engine', journey: 'coast', solo: ['engine'] },
    { id: 'drive', journey: 'coast' },
    ...['coast', 'desert', 'snow', 'jungle', 'plains', 'city', 'volcanic', 'salt', 'swamp'].map(journey => ({ id: journey, journey, solo: ['ambience'], cruise: true })),
    { id: 'storm', journey: 'city', solo: ['ambience'], cruise: true, lightning: 3 },
    { id: 'bridge', journey: 'coast', solo: ['road'], cruise: true, bridge: true },
    { id: 'music', journey: 'plains', solo: ['music'], cruise: true },
  ];
  const renders = [];
  for (const item of cases) for (const version of ['before', 'after']) {
    const result = await page.evaluate(async ({ item, version }) => {
      const path = version === 'before' ? '/.artifacts/audio/review/legacy' : '/src';
      const { DriveAudio } = await import(`${path}/audio.js`);
      const { createSoundGraph } = await import(`${path}/audio/synthesis.js`);
      const { JOURNEYS } = await import('/src/journeys.js');
      const { journeyStart } = await import('/src/world/route.js');
      const rate = 24000, seconds = 18, ctx = new OfflineAudioContext(2, rate * seconds, rate);
      const audio = new DriveAudio(); audio.context = ctx; audio.graph = createSoundGraph(ctx); audio.enabled = true;
      audio.mix = { master: .72, engine: .8, road: .7, ambience: .85, traffic: .65, music: item.solo?.includes('music') ? .7 : 0, night: false };
      audio.setJourney(item.journey); audio.syncOutput();
      await audio.graph.ready;
      const route = JOURNEYS[item.journey].route;
      let s = journeyStart(Number(JOURNEYS[item.journey].routeNumber)).s;
      if (item.bridge) s = route.bridge(s + 200).start - 100;
      const player = { carId: 'auto', route, s, u: 2.4, heading: 0, speed: 0, groundedPosition: { x: 0, y: 0, z: 0 } };
      const scene = { player, traffic: { enabled: false, vehicles: [] }, interior: false, heading: 0, lightning: 0 };
      const tick = () => {
        const t = ctx.currentTime;
        const speed = item.cruise ? 20 : t < 2 ? 0 : t < 9 ? (t - 2) * 4 : t < 12 ? 28 : t < 15 ? Math.max(0, 28 - (t - 12) * 10) : -Math.min(5, (t - 15) * 3);
        player.speed = speed; player.s += speed / 30;
        const p = route.position(player.s, player.u, route.height(player.s, player.u));
        player.heading = scene.heading = route.frame(player.s).angle; player.groundedPosition = { x: p.x, y: p.y, z: p.z };
        scene.lightning = item.lightning && t >= item.lightning && t < item.lightning + .25 ? .8 : 0;
        audio.update({ speed, throttle: item.cruise ? .3 : t > 2 && t < 9 || t >= 15 ? 1 : 0, brake: !item.cruise && t >= 12 && t < 15 ? 1 : 0, offRoad: !item.cruise && t >= 10 && t < 12 ? 1 : 0 }, 1 / 30, true, scene);
        if (item.solo) for (const [channel, param] of Object.entries(audio.graph.buses)) if (!item.solo.includes(channel)) { param.cancelScheduledValues(t); param.setValueAtTime(0, t); }
        if (t > 17) audio.graph.master.setTargetAtTime(0, t, .12);
      };
      tick();
      const steps = [];
      for (let t = 1 / 30; t < seconds - .05; t += 1 / 30) steps.push(ctx.suspend(t).then(() => { tick(); return ctx.resume(); }));
      const buffer = await ctx.startRendering(); await Promise.all(steps);
      audio.graph.dispose();
      const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
      let energy = 0, peak = 0;
      for (const channel of channels) for (const value of channel) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
      const rms = Math.sqrt(energy / (buffer.length * 2)), gain = Math.min(.045 / Math.max(.00001, rms), .9 / Math.max(.00001, peak));
      const bytes = new Uint8Array(buffer.length * 4), view = new DataView(bytes.buffer);
      for (let i = 0; i < buffer.length; i++) for (let ch = 0; ch < 2; ch++) view.setInt16((i * 2 + ch) * 2, Math.round(channels[ch][i] * gain * 32767), true);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
      return { id: item.id, version, rate, rms, peak, gain, pcm: btoa(binary) };
    }, { item, version });
    const data = Buffer.from(result.pcm, 'base64'), header = Buffer.alloc(44);
    header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
    header.writeUInt32LE(result.rate, 24); header.writeUInt32LE(result.rate * 4, 28);
    header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
    await writeFile(`${root}/${result.id}-${result.version}.wav`, Buffer.concat([header, data]));
    delete result.pcm; renders.push(result);
  }
  await writeFile(`${root}/levels.json`, JSON.stringify(renders, null, 2));
  const labels = { engine: 'Engine', drive: 'Driving', coast: 'Pacific Coast', desert: 'Red Rock Desert', snow: 'Midnight Alpine', jungle: 'Emerald Jungle', plains: 'Golden Plains', city: 'Rainy Downtown', volcanic: 'Volcanic Rift', salt: 'Salt Flats', swamp: 'Cypress Swamp', storm: 'Thunder', bridge: 'Bridge', music: 'Music' };
  const sections = Object.entries(labels).map(([id, label]) => `<section><h2>${label}</h2>${renders.filter(r => r.id === id).map(r => `<article><label for="${id}-${r.version}">${r.version === 'before' ? 'Before' : 'After'}</label><audio id="${id}-${r.version}" controls preload="none" src="${id}-${r.version}.wav"></audio></article>`).join('')}</section>`).join('');
  await writeFile(`${root}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Audio comparison</title>
    <style>body{font:16px system-ui;background:#edf0e6;color:#25473e;max-width:820px;margin:40px auto;padding:0 20px}h1{font-weight:500}p{line-height:1.6}section{border-top:1px solid #bccbbf;padding:20px 0}h2{font-size:19px}article{display:inline-flex;flex-direction:column;gap:10px;margin:0 15px 15px 0}audio{max-width:100%}</style>
    <h1>Audio comparison</h1><p>Same stretch of road and the same inputs, at matched volume.</p>
    ${sections}<script>document.addEventListener('play',event=>{for(const player of document.querySelectorAll('audio'))if(player!==event.target)player.pause()},true)</script></html>`);
  console.log(`Listening comparisons: ${root}/index.html`);
  console.log(JSON.stringify(renders.map(({ id, version, rms, peak }) => ({ id, version, rms: +rms.toFixed(4), peak: +peak.toFixed(3) }))));
} finally { await browser.close(); }
