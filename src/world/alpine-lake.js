import * as THREE from 'three';
import { joinCoplanarFaces } from './surface-joins.js';
import { registerChunkResources } from './chunk-resources.js';
import { CHUNK_LENGTH, randomAt, smoothstep, fieldNoise } from './route.js';
import { alpineLake, alpineStretch, snowPosition, LAKE_LEVEL } from './snow-route.js';
import { plantFir, surfaceHeights } from './alpine-forest.js';

export const lakeClock = { value: 0 };
const water = new THREE.MeshStandardMaterial({ color: '#396d7e', roughness: .36, metalness: .18,
  emissive: '#264b60', emissiveIntensity: .36 });
const ice = new THREE.MeshStandardMaterial({ color: '#8aafbb', roughness: .48, metalness: .08, flatShading: true });
const noise = /* glsl */`
  float lakeHash(vec2 p) { return fract(sin(dot(mod(p, 256.0), vec2(127.1, 311.7))) * 43758.5453); }
  float lakeNoise(vec2 p) {
    vec2 cell = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(lakeHash(cell), lakeHash(cell + vec2(1.0, 0.0)), f.x),
      mix(lakeHash(cell + vec2(0.0, 1.0)), lakeHash(cell + vec2(1.0)), f.x), f.y);
  }
`;
water.onBeforeCompile = shader => {
  shader.uniforms.lakeTime = lakeClock;
  shader.vertexShader = 'attribute vec3 lakeCoord; varying vec3 vLakeCoord;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLakeCoord = lakeCoord;');
  shader.fragmentShader = 'uniform float lakeTime; varying vec3 vLakeCoord;\n' + noise + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
    #include <color_fragment>
    vec2 p = vLakeCoord.xy;
    float ripple = sin(p.y * 1.35 + p.x * 0.24 + lakeNoise(p * 0.1) * 5.0 - lakeTime * 0.52);
    float patches = smoothstep(0.38, 0.78, lakeNoise(p * 0.19 + vec2(lakeTime * 0.015, 0.0)));
    float sheen = pow(max(0.0, sin(p.x * 0.018 + p.y * 0.006 + 1.2)), 5.0);
    float glint = pow(max(0.0, ripple), 22.0) * patches * (0.2 + sheen * 0.8);
    // Darker near the shore. Phases use route coordinates, never chunk IDs.
    float reflection = exp(-vLakeCoord.z * 0.09) * (0.5 + lakeNoise(vec2(p.y * 0.045, 3.7)) * 0.5);
    diffuseColor.rgb *= 1.0 - reflection * 0.55;
    diffuseColor.rgb += vec3(0.11, 0.17, 0.19) * (glint * 0.75 + sheen * 0.13);
  `);
};
water.customProgramCacheKey = () => 'alpine-lake-v1';

const mist = new THREE.MeshBasicMaterial({ color: '#8ba5b4', transparent: true, opacity: .14,
  depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
mist.onBeforeCompile = shader => {
  shader.uniforms.lakeTime = lakeClock;
  shader.vertexShader = 'attribute vec3 lakeCoord; varying vec3 vLakeCoord;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLakeCoord = lakeCoord;');
  shader.fragmentShader = 'uniform float lakeTime; varying vec3 vLakeCoord;\n' + noise + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
    #include <color_fragment>
    float wisp = lakeNoise(vLakeCoord.xy * vec2(0.045, 0.025) + vec2(lakeTime * 0.012, lakeTime * 0.004));
    diffuseColor.a *= smoothstep(0.42, 0.76, wisp) * smoothstep(0.0, 12.0, vLakeCoord.z);
  `);
};
mist.customProgramCacheKey = () => 'alpine-lake-mist-v1';
// Shelf ice and islets share one vertex-coloured material.
const shelf = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, flatShading: true });
registerChunkResources('lake', { water, ice, mist, shelf });

const ICE_SNOW = new THREE.Color('#c0ccda'), ICE_BARE = new THREE.Color('#90abbb'), ICE_THIN = new THREE.Color('#5b7a89');
const ISLE_ROCK = new THREE.Color('#7d899d'), ISLE_FOOT = new THREE.Color('#5c6577'), ISLE_SNOW = new THREE.Color('#c6d2e0');
const ICE_ROW = 4, ICE_LIFT = .12, SHELF_COLUMNS = 10;

// Shelf ice grows out from both shores in frozen stretches and nearly closes
// over the lake in the coldest, always leaving an open lead between the two
// shelves. Rows follow route position, so neighbouring chunks share edges.
export function lakeShelves(s) {
  const lake = alpineLake(s), amount = alpineStretch(s).ice, width = lake.near - lake.far;
  if (amount < .03) return { near: 0, far: 0 };
  const row = Math.round(s / ICE_ROW), jitter = salt => (randomAt(row, salt) - .5) * (1.5 + amount * 4);
  const near = width * .62 * amount * (.8 + .2 * Math.sin(s / 29)) + jitter(7331);
  const lead = 4 + 7 * (.5 + .5 * Math.sin(s / 53 + 1.7)) + randomAt(row, 7332) * 2;
  const far = Math.min(width * .5 * amount * (.8 + .2 * Math.sin(s / 37 + 2.3)) + jitter(7333), width - near - lead);
  return { near: Math.max(0, near), far: Math.max(0, far) };
}

// Bare blue ice under drifts of snow, dark along the shore crack. Coloured per
// vertex so the drifts have soft outlines, while the open edge stays crisp.
function iceColor(s, u, column, toEdge) {
  if (column < 2) return ICE_THIN;
  const drift = smoothstep(.38, .6, fieldNoise(s, u, 24, 7341)) * smoothstep(0, 6, toEdge);
  return new THREE.Color().lerpColors(ICE_BARE, ICE_SNOW, drift);
}

function makeGeometry(vertices, coords, colors) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (coords) g.setAttribute('lakeCoord', new THREE.Float32BufferAttribute(coords, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}

export function buildAlpineLake(start) {
  const vertices = [], coords = [], frozen = [], sheet = { positions: [], colors: [] }, floes = [];
  const point = (s, u, lift = 0) => {
    const lake = alpineLake(s), p = snowPosition(s, u, LAKE_LEVEL + lift);
    return { ...p, z: p.z + start, s, u, bank: Math.max(0, Math.min(u - lake.far, lake.near - u)) };
  };
  const triangle = (target, a, b, c, uv = null) => {
    if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) { target.push(p.x, p.y, p.z); if (uv) uv.push(p.u, p.s, p.bank); }
  };
  const shaded = (a, b, c) => {
    if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) { sheet.positions.push(p.x, p.y, p.z); sheet.colors.push(p.color.r, p.color.g, p.color.b); }
  };
  const tinted = (a, b, c, color) => { a.color = b.color = c.color = color; shaded(a, b, c); };
  const columns = [0, .035, .12, .3, .5, .7, .88, .965, 1];
  for (let s = start; s < start + CHUNK_LENGTH; s += 4) {
    const at = (t, fraction) => { const lake = alpineLake(t); return point(t, lake.far + (lake.near - lake.far) * fraction); };
    for (let col = 0; col < columns.length - 1; col++) {
      const a = at(s, columns[col]), b = at(s + 4, columns[col]), c = at(s, columns[col + 1]), d = at(s + 4, columns[col + 1]);
      triangle(vertices, a, b, c, coords); triangle(vertices, b, d, c, coords);
    }
    const shelves = [lakeShelves(s), lakeShelves(s + 4)];
    for (const side of ['near', 'far']) {
      const sign = side === 'near' ? -1 : 1;
      const shelved = Math.max(shelves[0][side], shelves[1][side]) >= 2.5;
      // The shelf covers the rim, so only one of them is built.
      if (!shelved) {
        const rim = (t, inside) => {
          const lake = alpineLake(t);
          const width = .7 + 2.2 * smoothstep(-.5, .9, Math.sin(t / 13 + (side === 'near' ? 0 : 2)))
            + randomAt(t / 4, 820) * 1.5;
          return point(t, lake[side] + sign * (inside ? width : .4), .055);
        };
        triangle(frozen, rim(s, false), rim(s + 4, false), rim(s, true));
        triangle(frozen, rim(s + 4, false), rim(s + 4, true), rim(s, true));
      }
      if (!shelved) continue;
      // Columns start just ashore, step over the shore crack, then spread to the edge.
      const vertex = (t, k, width) => {
        width = Math.max(.5, width);
        const crack = Math.min(2.2, width * .25);
        const reach = k === 0 ? -.3 : k === 1 ? crack : crack + (width - crack) * (k - 1) / (SHELF_COLUMNS - 1);
        const p = point(t, alpineLake(t)[side] + sign * reach, ICE_LIFT);
        p.color = iceColor(p.s, p.u, k, width - reach);
        return p;
      };
      for (let k = 0; k < SHELF_COLUMNS; k++) {
        const a = vertex(s, k, shelves[0][side]), b = vertex(s + 4, k, shelves[1][side]);
        const c = vertex(s, k + 1, shelves[0][side]), d = vertex(s + 4, k + 1, shelves[1][side]);
        shaded(a, b, c); shaded(b, d, c);
      }
    }
    // Loose floes drift in the open water past the shelf edge, clear of the
    // shelves and of each other.
    const row = Math.round(s / ICE_ROW), amount = alpineStretch(s).ice;
    if (amount > .15 && randomAt(row, 7351) < amount * .6) {
      const lake = alpineLake(s), t = s + randomAt(row, 7352) * 4, gap = 2 + randomAt(row, 7353) * 12;
      const radius = .9 + randomAt(row, 7354) * 2.6 * (.5 + amount), reach = radius * 1.2;
      const shelves = [t - reach, t, t + reach].map(lakeShelves);
      const u = lake.near - Math.max(...shelves.map(shelf => shelf.near)) - gap - reach;
      const farEdge = lake.far + Math.max(...shelves.map(shelf => shelf.far));
      if (u - reach > farEdge + 1.5 && t - reach > start && t + reach < start + CHUNK_LENGTH
        && floes.every(floe => Math.hypot(floe.t - t, floe.u - u) > floe.reach + reach + .5)) {
        floes.push({ t, u, reach });
        const center = point(t, u, ICE_LIFT - .02), sides = 5 + (row & 1), ring = [];
        for (let j = 0; j < sides; j++) {
          const angle = (j + randomAt(row, 7355 + j) * .4) / sides * Math.PI * 2, r = radius * (.7 + randomAt(row, 7362 + j) * .45);
          ring.push(point(t + Math.sin(angle) * r, u + Math.cos(angle) * r, ICE_LIFT - .02));
        }
        const color = randomAt(row, 7369) > .45 ? ICE_SNOW : ICE_BARE;
        for (let j = 0; j < sides; j++) tinted(center, ring[j], ring[(j + 1) % sides], color);
      }
    }
  }
  for (let i = 0; i < 10; i++) {
    const seed = start + i, s = start + 5 + randomAt(seed, 825) * (CHUNK_LENGTH - 10);
    const u = alpineLake(s).near - 5 - randomAt(seed, 826) * 9;
    const radius = .6 + randomAt(seed, 827) * 1.6, center = point(s, u, .075), ring = [];
    // Under the shelf these would only flicker through it.
    if (lakeShelves(s).near > alpineLake(s).near - u + radius) continue;
    for (let j = 0; j < 5; j++) {
      const angle = j / 5 * Math.PI * 2, r = radius * (.7 + randomAt(seed, j + 829) * .4);
      ring.push(point(s + Math.sin(angle) * r, u + Math.cos(angle) * r, .075));
    }
    for (let j = 0; j < 5; j++) triangle(frozen, center, ring[j], ring[(j + 1) % 5]);
  }
  const surface = makeGeometry(vertices, coords), haze = surface.clone(); haze.translate(0, 3.8, 0);
  const parts = [{ geometry: surface, material: water, name: 'alpine-lake' }, { geometry: haze, material: mist, name: 'lake-mist' }];
  if (frozen.length) parts.push({ geometry: joinCoplanarFaces(makeGeometry(frozen)), material: ice, name: 'shore-ice' });
  if (sheet.positions.length) parts.push({ geometry: makeGeometry(sheet.positions, null, sheet.colors), material: shelf, name: 'lake-shelf-ice' });
  const islet = buildIslet(start, point);
  if (islet) parts.push({ geometry: makeGeometry(islet.positions, null, islet.colors), material: shelf, name: 'lake-islet', shadows: true });
  return parts;
}

// Some chunks hold a rocky islet out in the lake, snowed over on top, with a
// few firs where the crown is flat enough.
function buildIslet(start, point) {
  const index = Math.round(start / CHUNK_LENGTH);
  if (randomAt(index, 7361) > .45) return null;
  const radius = 7 + randomAt(index, 7362) * 13, rise = 2.2 + radius * .28 + randomAt(index, 7363) * 3;
  const s = start + radius * 1.3 + 3 + randomAt(index, 7364) * (CHUNK_LENGTH - radius * 2.6 - 6), lake = alpineLake(s);
  const u = lake.near - 30 - radius - randomAt(index, 7365) * Math.max(0, (lake.near - lake.far) * .42 - radius);
  const sides = 7, positions = [], colors = [], color = new THREE.Color();
  // Crown, shoulder, waterline and a submerged foot, each jittered.
  const rings = [[.36, .86], [.72, .4], [1, 0], [1.28, 0]].map(([reach, height], level) =>
    Array.from({ length: sides }, (_, j) => {
      const angle = (j + (randomAt(index * 13 + j, 7366 + level) - .5) * .5) / sides * Math.PI * 2;
      const r = radius * reach * (.78 + randomAt(index * 13 + j, 7370 + level) * .4);
      const y = level < 2 ? rise * height * (.8 + randomAt(index * 13 + j, 7374 + level) * .4) : level === 2 ? .3 : -1.6;
      return point(s + Math.sin(angle) * r * 1.15, u + Math.cos(angle) * r, y);
    }));
  const top = point(s + radius * .1, u, rise);
  const face = (a, b, c, level) => {
    const normal = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).cross(new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z)).normalize();
    if (normal.y < 0) { [b, c] = [c, b]; normal.negate(); }
    if (level >= 2) color.copy(ISLE_FOOT); else color.copy(normal.y > .7 - randomAt(index, 7378 + level) * .1 ? ISLE_SNOW : ISLE_ROCK);
    for (const p of [a, b, c]) { positions.push(p.x, p.y, p.z); colors.push(color.r, color.g, color.b); }
  };
  for (let j = 0; j < sides; j++) {
    const k = (j + 1) % sides;
    face(top, rings[0][j], rings[0][k], 0);
    for (let level = 0; level < 3; level++) {
      face(rings[level][j], rings[level + 1][j], rings[level][k], level);
      face(rings[level][k], rings[level + 1][j], rings[level + 1][k], level);
    }
  }
  const height = surfaceHeights(positions), trees = { positions: [], colors: [] };
  const count = 1 + Math.floor(randomAt(index, 7379) * radius * .35);
  for (let i = 0; i < count; i++) {
    const angle = randomAt(index * 7 + i, 7380) * Math.PI * 2, reach = Math.sqrt(randomAt(index * 7 + i, 7381)) * radius * .55;
    const p = point(s + Math.sin(angle) * reach, u + Math.cos(angle) * reach), y = height(p.x, p.z);
    if (y === null || y < LAKE_LEVEL + 1) continue;
    plantFir(trees, p.x, y - .2, p.z, 3.5 + randomAt(index * 7 + i, 7382) * 5, index * 31 + i);
  }
  positions.push(...trees.positions); colors.push(...trees.colors);
  return { positions, colors };
}
