import test from 'node:test';
import assert from 'node:assert/strict';
import { Color } from 'three';
import { FlowSurface, FlowCoverage } from '../src/world/volcanic-flow.js';

const point = (s, u) => ({ s, u, x: s, y: .2 * s + .1 * u, z: u });
const rectangle = (s0, u0, s1, u1) => [point(s0, u0), point(s1, u0), point(s1, u1), point(s0, u1)];
const area = polygon => Math.abs(polygon.reduce((sum, p, i) => {
  const q = polygon[(i + 1) % polygon.length]; return sum + p.s * q.u - q.s * p.u;
}, 0)) / 2;
const totalArea = polygons => polygons.reduce((sum, p) => sum + area(p), 0);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} differs from ${b}`);
function terrain() {
  const surface = new FlowSurface(8, -Infinity), [a, b, c, d] = rectangle(0, 0, 20, 20);
  surface.add(a, b, c); surface.add(a, c, d); return surface;
}

test('zero-width stream tips never fill their surrounding terrain facets', () => {
  const surface = terrain(), coverage = new FlowCoverage();
  for (const outline of [[], [point(5, 5)], [point(5, 5), point(5, 5), point(8, 8)],
    [point(5, 5), point(8, 8), point(11, 11)], rectangle(5, 5, 5, 12)]) {
    assert.deepEqual(surface.project(outline), []);
    assert.deepEqual(coverage.subtract(outline), []);
    coverage.add(outline);
  }
  assert.equal(coverage.rows.size, 0);
  // A real tapered tip still draws, even though two of its corners coincide.
  const tip = [point(5, 5), point(5, 5), point(8, 5.1), point(8, 4.9)];
  near(totalArea(surface.project(tip)), .3);
});

test('projection preserves narrow footprints and the actual sloping terrain in either winding', () => {
  for (const outline of [rectangle(3, 4, 17, 4.05), rectangle(3, 4, 17, 4.05).reverse()]) {
    const projected = terrain().project(outline);
    near(totalArea(projected), .7);
    for (const polygon of projected) for (const p of polygon) {
      assert.ok(p.s >= 3 - 1e-8 && p.s <= 17 + 1e-8 && p.u >= 4 - 1e-8 && p.u <= 4.05 + 1e-8);
      near(p.y, .2 * p.s + .1 * p.u + .075);
    }
  }
});

test('nearly coincident closing vertices cannot cut triangular holes from a channel', () => {
  const triangle = [point(8, 4), point(4, 8), point(9, 8)];
  const clipped = [{ ...triangle[0], u: 4 + 4e-15 }, ...triangle.slice(1), triangle[0]];
  near(totalArea(terrain().project(clipped)), area(triangle));
  const coverage = new FlowCoverage();
  for (const piece of coverage.subtract(clipped)) near(totalArea(terrain().project(piece)), area(triangle));
});

test('joining streams occupy their union exactly once, regardless of winding or build order', () => {
  const main = rectangle(0, 4, 10, 6), tributary = rectangle(4, 0, 6, 5);
  for (const paths of [[main, tributary], [tributary, main], [main.toReversed(), tributary.toReversed()]]) {
    const coverage = new FlowCoverage(), pieces = [];
    for (const path of paths) { pieces.push(...coverage.subtract(path)); coverage.add(path); }
    near(totalArea(pieces), 28);
    assert.deepEqual(coverage.subtract(rectangle(4.2, 4.2, 5.8, 4.8)), [], 'the confluence is already filled');
    near(totalArea(coverage.subtract(rectangle(2, 0, 3, 3))), 3, 'unrelated ground stays outside the mask');
  }
});

test('junction clipping preserves the height and fading light of a crossing crack', () => {
  const coverage = new FlowCoverage(); coverage.add(rectangle(4, 0, 6, 10));
  const crack = rectangle(0, 4, 10, 6).map(p => ({ ...p, light: new Color(p.s / 10, p.u / 10, 0) }));
  const pieces = coverage.subtract(crack);
  near(totalArea(pieces), 16);
  for (const polygon of pieces) for (const p of polygon) {
    near(p.x, p.s); near(p.z, p.u); near(p.y, .2 * p.s + .1 * p.u);
    near(p.light.r, p.s / 10); near(p.light.g, p.u / 10);
    assert.ok(p.s <= 4 + 1e-8 || p.s >= 6 - 1e-8);
  }
});
