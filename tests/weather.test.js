import test from 'node:test';
import assert from 'node:assert/strict';
import { Snowfall } from '../src/world/snowfall.js';
import { Rainfall } from '../src/world/rainfall.js';
import { weatherPositions } from './weather-positions.js';

for (const Weather of [Snowfall, Rainfall]) {
  test(`${Weather.name} keeps buffers resident and rebases long-running motion without jumps`, () => {
    const weather = new Weather(), anchor = { x: 12, y: 67, z: -1000025 };
    try {
      const position = weather.geometry.attributes.position, version = position.version;
      for (let i = 0; i < 240; i++) weather.update(i / 120, anchor, 999424);
      assert.equal(position.version, version, 'ordinary frames must not upload particle positions');
      weather.update(255.999, anchor, 999424); const before = weatherPositions(weather);
      weather.update(256.001, anchor, 999424); const after = weatherPositions(weather);
      assert.equal(position.version, version + 1, 'fall-time rebase updates once');
      for (let i = 0; i < before.length; i++) {
        const size = [300, 200, 360][i % 3], difference = Math.abs(before[i] - after[i]);
        assert.ok(Math.min(difference, size - difference) < .07, 'epoch rollover must not jump');
      }
      const expected = after.slice();
      weather.update(1000000, anchor, 999424); weather.update(256.001, anchor, 999424);
      assert.deepEqual(weatherPositions(weather), expected, 'time reset restores the same particles');
    } finally { weather.dispose(); }
  });
}
