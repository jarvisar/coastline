import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.TEST_URL ?? 'http://127.0.0.1:5173/?seed=4817');
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'));
  await page.click('#start');
  // Load each flock in its scene so the real materials compile.
  for (const [journey, s, name] of [['coast', 64, 'coastal-gulls'], ['plains', 176, 'plains-crows'], ['jungle', 64, 'jungle-parrots']]) {
    await page.evaluate(async ({ journey, s }) => {
      const app = window.__coastline;
      await app.changeJourney(journey);
      if (app.paused) await app.action('pause');
      app.vehicle.s = s; app.vehicle.reset(); app.rendering.snap();
    }, { journey, s });
    await page.waitForFunction(name => !!window.__coastline.rendering.scene.getObjectByName(name), name);
    await page.waitForTimeout(500);
  }
  // Run the flight GLSL through transform feedback to check orientation and flap timing.
  const result = await page.evaluate(async () => {
    const { birdFlightGLSL } = await import('/src/world/bird-flight.js');
    const gl = document.createElement('canvas').getContext('webgl2');
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      ${birdFlightGLSL}
      uniform float time;
      uniform vec2 radius;
      out vec4 state;
      out vec3 forward;
      out vec3 velocity;
      void main() {
        float seed = float(gl_VertexID);
        float phase = birdHash(seed + 5.0) * 6.2831853;
        float orbit = time * mix(0.13, 0.24, birdHash(seed + 6.0)) + phase;
        state = vec4(birdOrbit(orbit, radius, phase), birdBeat(time, seed, 6.2));
        forward = birdFrame(orbit, radius, phase) * vec3(0.0, 0.0, -1.0);
        velocity = normalize(birdOrbit(orbit + 0.001, radius, phase) - birdOrbit(orbit - 0.001, radius, phase));
        gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
      }`], [gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      out vec4 color;
      void main() { color = vec4(1.0); }`]]) {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.transformFeedbackVaryings(program, ['state', 'forward', 'velocity'], gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program); gl.bindVertexArray(gl.createVertexArray());
    const buffer = gl.createBuffer(), data = new Float32Array(8 * 10);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buffer);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, data.byteLength, gl.DYNAMIC_READ);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffer);
    gl.enable(gl.RASTERIZER_DISCARD);
    const traces = Array.from({ length: 8 }, () => []);
    let minimumAlignment = 1, mixedGlidingFrames = 0;
    for (const radius of [[8, 14], [11, 13]]) {
      gl.uniform2fv(gl.getUniformLocation(program, 'radius'), radius);
      for (let frame = 0; frame < 160; frame++) {
        gl.uniform1f(gl.getUniformLocation(program, 'time'), frame * .2);
        gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, 8); gl.endTransformFeedback();
        gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, data);
        const beats = [];
        for (let i = 0; i < 8; i++) {
          const k = i * 10;
          const alignment = data[k + 4] * data[k + 7] + data[k + 5] * data[k + 8] + data[k + 6] * data[k + 9];
          minimumAlignment = Math.min(minimumAlignment, alignment);
          beats.push(Math.abs(data[k + 3])); traces[i].push(data[k + 3]);
        }
        if (beats.some(beat => beat < .005) && beats.some(beat => beat > .4)) mixedGlidingFrames++;
      }
    }
    let minimumBeatDifference = Infinity;
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      const difference = traces[i].reduce((sum, value, frame) => sum + Math.abs(value - traces[j][frame]), 0) / traces[i].length;
      minimumBeatDifference = Math.min(minimumBeatDifference, difference);
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { minimumAlignment, mixedGlidingFrames, minimumBeatDifference };
  });
  assert.ok(result.minimumAlignment > .999, 'birds must face the tangent of their flight path');
  assert.ok(result.minimumBeatDifference > .15, 'each bird needs a visibly distinct flap rhythm');
  assert.ok(result.mixedGlidingFrames > 100, 'some birds should glide while others flap');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, ...result }));
} finally { await browser.close(); }
