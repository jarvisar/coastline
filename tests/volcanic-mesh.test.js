import test from 'node:test';
import assert from 'node:assert/strict';
import { VolcanicChunk } from '../src/world/volcanic.js';
import { seededRandom } from '../src/world/route.js';
import { riftProfile } from '../src/world/volcanic-route.js';

// A shared edge must run in opposite directions in its two faces. Per-face
// normal checks miss the back-face slits this catches.
function meshEdges(positions) {
  const edges = new Map();
  for (let i = 0; i < positions.length; i += 9) {
    const keys = [0, 3, 6].map(k => Array.from(positions.slice(i + k, i + k + 3), v => v.toFixed(4)).join(','));
    for (let k = 0; k < 3; k++) {
      const a = keys[k], b = keys[(k + 1) % 3];
      assert.notEqual(a, b, 'a face has no collapsed edges');
      const key = [a, b].sort().join('/'), edge = edges.get(key) ?? { count: 0, winding: 0 };
      edge.count++; edge.winding += a < b ? 1 : -1; edges.set(key, edge);
    }
  }
  return edges;
}

test('basalt shells remain closed and consistently wound at small and large scales', () => {
  for (const side of [-1, 1]) for (let seed = 0; seed < 48; seed++) {
    const random = seededRandom(seed + 92400), count = 5 + seed % 6;
    const radius = 1.4 + random() * 24, height = .7 + random() ** 2 * 40;
    const s = (seed - 24) * 128, d = 60 + random() * 100;
    const outline = Array.from({ length: count }, (_, k) => {
      const angle = k / count * Math.PI * 2, reach = radius * (.85 + random() * .15);
      return [s + Math.cos(angle) * reach * 1.4, d + Math.sin(angle) * reach];
    });
    // Drive the real builder without streaming a whole world.
    const chunk = Object.create(VolcanicChunk.prototype);
    chunk.start = s; chunk.rock = { positions: [], colors: [], heat: [] };
    chunk.block(outline, side, 10, height, random, false);
    const positions = chunk.rock.positions;
    assert.ok(positions.every(Number.isFinite));
    for (const edge of meshEdges(positions).values()) {
      assert.equal(edge.count, 2, `open shell: side ${side}, seed ${seed}`);
      assert.equal(edge.winding, 0, `inverted face: side ${side}, seed ${seed}`);
    }
    let volume = 0;
    for (let i = 0; i < positions.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(i, i + 9);
      volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    assert.ok(volume > 0, 'the closed shell faces outward');
  }
});

test('volcanic terrain has no folded shared edges on bends or between dense and coarse chunks', () => {
  for (const index of [-9, -1, 0, 1, 4, 5, 6, 10, 65]) {
    const chunk = new VolcanicChunk(index);
    try {
      for (const edge of meshEdges(chunk.terrain.geometry.attributes.position.array).values()) {
        assert.ok(edge.count <= 2, `overlapping terrain in chunk ${index}`);
        if (edge.count === 2) assert.equal(edge.winding, 0, `folded terrain in chunk ${index}`);
      }
    } finally { chunk.dispose(); }
  }
});

test('wide basalt islands stay rooted below the sloping lava at every foot vertex', () => {
  for (let s = -1000; s < 1000; s += 125) {
    const chunk = Object.create(VolcanicChunk.prototype), coordinates = new Map();
    const key = (x, z) => `${x.toFixed(5)},${z.toFixed(5)}`;
    chunk.start = s;
    chunk.at = (...args) => {
      const p = VolcanicChunk.prototype.at.apply(chunk, args);
      coordinates.set(key(p.x, p.z), p.s); return p;
    };
    for (const name of ['rock', 'lava', 'glow']) chunk[name] = { positions: [], colors: [], heat: [] };
    const count = 8, { near, far, level } = riftProfile(s, -1), d = (near + far) / 2;
    const outline = Array.from({ length: count }, (_, k) => {
      const a = k / count * Math.PI * 2;
      return [s + Math.cos(a) * 36, d + Math.sin(a) * 18];
    });
    chunk.block(outline, -1, level, 7, seededRandom(s + 93500));
    const positions = chunk.rock.positions;
    // Four wall bands precede alternating top and bottom cap triangles.
    for (let i = count * 8 * 9 + 9; i < positions.length; i += 18) for (let k = 0; k < 9; k += 3) {
      const [x, y, z] = positions.slice(i + k, i + k + 3), at = coordinates.get(key(x, z));
      assert.ok(Number.isFinite(at));
      assert.ok(y <= riftProfile(at, -1).level - 1.49, `exposed island underside at ${at}`);
    }
  }
});
