import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.TEST_URL ?? 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
  await page.evaluate(() => window.__coastline.action('pause'));
  const results = await page.evaluate(async () => {
    const { Snowfall } = await import('/src/world/snowfall.js');
    const { Rainfall } = await import('/src/world/rainfall.js');
    const { weatherMotionGLSL } = await import('/src/world/weather-motion.js');
    // Transform feedback reads the real vertex-shader output. Synchronous
    // readback is fine in this test but must never go in the game loop.
    const gl = document.createElement('canvas').getContext('webgl2');
    const shader = (type, source) => {
      const result = gl.createShader(type); gl.shaderSource(result, source); gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
      return result;
    };
    const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      in vec3 position;
      ${weatherMotionGLSL.replace('attribute vec3', 'in vec3')}
      out vec3 result;
      void main() { result = weatherPosition(position, weatherMotion); gl_Position = vec4(result, 1.0); }
    `);
    const fragment = shader(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float; out vec4 color; void main() { color = vec4(1.0); }');
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment);
    gl.transformFeedbackVaryings(program, ['result'], gl.INTERLEAVED_ATTRIBS); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program); gl.enable(gl.RASTERIZER_DISCARD);
    const uniforms = Object.fromEntries(['weatherTime', 'weatherAnchor', 'weatherDrift', 'weatherWaves'].map(name => [name, gl.getUniformLocation(program, name)]));
    const records = [], buffers = [];
    const upload = (name, array) => {
      const buffer = gl.createBuffer(); buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
      return buffer;
    };
    const wrap = (value, size) => value - Math.floor(value / size) * size - size / 2;
    for (const Weather of [Snowfall, Rainfall]) {
      const weather = new Weather(), stride = Weather === Snowfall ? 6 : 4;
      const positions = weather.geometry.attributes.position;
      const input = upload('position', positions.array);
      upload('weatherMotion', weather.geometry.attributes.weatherMotion.array);
      const output = gl.createBuffer(); buffers.push(output);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, output);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, positions.array.byteLength, gl.STREAM_READ);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
      const actual = new Float32Array(positions.array.length);
      let maxError = 0, compared = 0;
      for (const anchor of [{ x: 12, y: 67, z: -1023 }, { x: 14, y: 67.3, z: -1025 }, { x: -1000021, y: 7003, z: 1000025 }]) {
        for (const time of [0, 12, 255.999, 256, 256.001, 3600, 86400, 1000000, 12]) {
          weather.update(time, anchor, Math.floor(-anchor.z / 1024) * 1024);
          gl.bindBuffer(gl.ARRAY_BUFFER, input); gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions.array);
          const u = weather.motion.uniforms;
          gl.uniform1f(uniforms.weatherTime, u.weatherTime.value);
          gl.uniform3fv(uniforms.weatherAnchor, u.weatherAnchor.value.toArray());
          gl.uniform2fv(uniforms.weatherDrift, u.weatherDrift.value.toArray());
          gl.uniform4fv(uniforms.weatherWaves, u.weatherWaves.value.toArray());
          gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, positions.count); gl.endTransformFeedback();
          gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, output); gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, actual);
          for (let i = 0; i < positions.count; i++) {
            const n = i * stride, seeds = weather.seeds;
            // Reference CPU equations, independent of the GLSL inputs.
            const expected = [
              wrap(seeds[n] + (stride === 6 ? time * .8 + Math.sin(time * .55 + seeds[n + 4]) * seeds[n + 5] * 2.1 : 0) - anchor.x, 300),
              wrap(seeds[n + 1] - time * seeds[n + 3] - anchor.y, 200),
              wrap(seeds[n + 2] + (stride === 6 ? time * .28 + Math.cos(time * .37 + seeds[n + 4]) * seeds[n + 5] : 0) - anchor.z, 360),
            ];
            for (let axis = 0; axis < 3; axis++) {
              const difference = Math.abs(expected[axis] - actual[i * 3 + axis]);
              maxError = Math.max(maxError, Math.min(difference, Math.abs([300, 200, 360][axis] - difference))); compared++;
            }
          }
        }
      }
      records.push({ weather: Weather.name, maxError, compared }); weather.dispose();
    }
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return records;
  });
  for (const result of results) assert.ok(result.maxError < .003, `${result.weather}: GPU motion diverged by ${result.maxError} meters`);
  // Run the full PointsMaterial shader with fog and both camera projections.
  for (const id of ['snow', 'city']) {
    await page.evaluate(id => window.__coastline.changeJourney(id), id);
    await page.evaluate(() => {
      const a = window.__coastline;
      for (let i = 0; i < 6; i++) { a.action('view'); a.world.animate(256.001, a.vehicle); a.rendering.render(); }
      const { renderer, scene, ambientOcclusion } = a.rendering;
      const render = renderer.render.bind(renderer);
      let depthChecked = false;
      renderer.render = (...args) => {
        if (scene.overrideMaterial === ambientOcclusion.depthMaterial) {
          const particles = a.world.snowfall?.points ?? a.world.rainfall?.points;
          if (!particles || particles.visible) throw new Error('Transparent weather must stay out of the AO depth pass');
          depthChecked = true;
        }
        return render(...args);
      };
      try {
        a.graphics.toggleAmbientOcclusion(); a.rendering.render();
        if (!depthChecked) throw new Error('AO depth pass was not checked');
      } finally { renderer.render = render; a.graphics.toggleAmbientOcclusion(); }
    });
  }
  assert.deepEqual(errors, []);
  await mkdir('.artifacts/performance', { recursive: true });
  await writeFile('.artifacts/performance/weather.json', JSON.stringify({ passed: true, results }, null, 2));
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); }
