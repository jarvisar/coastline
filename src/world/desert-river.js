import * as THREE from 'three';
import { CHUNK_LENGTH, roadHeight, roadFrame, randomAt, seededRandom, smoothstep } from './route.js';
import { desertBridgeAt, desertCreek, desertCreekDistance, desertPosition, insideMesa } from './desert-route.js';
import { registerChunkResources } from './chunk-resources.js';

export const desertWaterClock = { value: 0 };
const waterMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .38, metalness: .025,
  emissive: '#697c88', emissiveIntensity: .1 });
const shoreMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
const shallowWater = new THREE.Color('#bbb9ac'), shelfWater = new THREE.Color('#91a0a3'), deepWater = new THREE.Color('#6c7f8a');
const timberMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
const ironMaterial = new THREE.MeshStandardMaterial({ color: '#574c3e', roughness: .85 });
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const up = new THREE.Vector3(0, 1, 0);

waterMaterial.onBeforeCompile = shader => {
  shader.uniforms.desertWaterTime = desertWaterClock;
  shader.uniforms.desertShallow = { value: shallowWater };
  shader.uniforms.desertShelf = { value: shelfWater };
  shader.uniforms.desertDeep = { value: deepWater };
  shader.vertexShader = 'attribute vec3 riverCoord; varying vec3 vRiverCoord;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiverCoord = riverCoord;');
  shader.fragmentShader = 'uniform float desertWaterTime; uniform vec3 desertShallow; uniform vec3 desertShelf; uniform vec3 desertDeep; varying vec3 vRiverCoord;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
    #include <color_fragment>
    float s = vRiverCoord.x;
    float u = vRiverCoord.y;
    float depth = max(0., vRiverCoord.z);
    // Sand through the shallows. The reflection stays muted so water reads apart
    // from the asphalt without turning saturated blue.
    diffuseColor.rgb = mix(desertShallow, desertShelf, smoothstep(0., .36, depth));
    diffuseColor.rgb = mix(diffuseColor.rgb, desertDeep, smoothstep(.28, 1.3, depth));
    float sky = .5 + .5 * sin(s * .027 + u * .17 + sin(s * .011));
    diffuseColor.rgb += vec3(.018, .025, .031) * sky * smoothstep(.2, 1., depth);
    float phase = s * .56 + u * .25 + sin(s * .11 + u * .7);
    float ripple = pow(max(0., sin(phase + desertWaterTime * .055)), 32.);
    float riverPatch = smoothstep(.88, .99, sin(s * .13 - u * .65 + sin(s * .06)));
    float edge = smoothstep(0., .28, vRiverCoord.z);
    diffuseColor.rgb += vec3(.012, .014, .009) * ripple * riverPatch * edge;
    diffuseColor.rgb *= .998 + .002 * sin(s * .16 + u * .4 + desertWaterTime * .025);
  `);
};
waterMaterial.customProgramCacheKey = () => 'desert-creek-v3';
registerChunkResources('desert-river', { waterMaterial, shoreMaterial, timberMaterial, ironMaterial, boxGeometry });

function clipPolygon(source, distance) {
  const result = [];
  for (let i = 0; i < source.length; i++) {
    const a = source[i], b = source[(i + 1) % source.length], da = distance(a), db = distance(b);
    if (da >= 0) result.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const fraction = da / (da - db), p = {};
      for (const key of Object.keys(a)) p[key] = a[key] + (b[key] - a[key]) * fraction;
      result.push(p);
    }
  }
  return result;
}

// Clipped to the faceted ground for a clean shoreline. Adjacent chunks compute
// identical intersections.
export function buildDesertWater(chunk, triangles) {
  const positions = [], colors = [], coords = [], shores = [], shoreColors = [];
  const wetSand = new THREE.Color('#9d9985'), drySand = new THREE.Color('#ceba96');
  for (const triangle of triangles) {
    const source = triangle.map(p => {
      const creek = desertCreek(p.s), bank = creek.width + 3.8;
      return { ...p, level: creek.level, depth: creek.level - p.y,
        left: p.u - creek.center + bank, right: creek.center + bank - p.u };
    });
    // Clip to the banks first so a low hollow behind a mesa doesn't fill with water.
    const corridor = clipPolygon(clipPolygon(source, p => p.left), p => p.right);
    const water = clipPolygon(corridor, p => p.depth);
    const shoreline = clipPolygon(clipPolygon(corridor, p => -p.depth), p => p.depth + .45);
    for (const [polygon, wet] of [[water, true], [shoreline, false]]) {
      for (let i = 1; i < polygon.length - 1; i++) {
        let [a, b, c] = [polygon[0], polygon[i], polygon[i + 1]];
        if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
        for (const p of [a, b, c]) {
          if (wet) {
            positions.push(p.x, p.level + .025, p.z + chunk.start);
            const creek = desertCreek(p.s), depth = Math.max(0, p.depth);
            const tint = shallowWater.clone().lerp(deepWater, smoothstep(0, 1.3, depth));
            colors.push(tint.r, tint.g, tint.b);
            coords.push(p.s, p.u - creek.center, depth);
          } else {
            shores.push(p.x, p.y + .018, p.z + chunk.start);
            const tint = wetSand.clone().lerp(drySand, smoothstep(0, .45, -p.depth));
            shoreColors.push(tint.r, tint.g, tint.b);
          }
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('riverCoord', new THREE.Float32BufferAttribute(coords, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  chunk.addMesh(geometry, waterMaterial).name = 'desert-creek-water';
  const shoreGeometry = new THREE.BufferGeometry();
  shoreGeometry.setAttribute('position', new THREE.Float32BufferAttribute(shores, 3));
  shoreGeometry.setAttribute('color', new THREE.Float32BufferAttribute(shoreColors, 3));
  shoreGeometry.computeVertexNormals(); shoreGeometry.computeBoundingSphere();
  chunk.addMesh(shoreGeometry, shoreMaterial).name = 'desert-wet-shoreline';
}

export function buildDesertCrossing(chunk, instances, assets) {
  const timber = [], iron = [], masonry = [];
  const point = (s, u, y) => {
    const p = desertPosition(s, u, y);
    return [p.x, p.y, p.z + chunk.start];
  };
  const at = (s, u) => {
    const p = chunk.groundPosition(s, u);
    return new THREE.Vector3(p.x, p.y, p.z + chunk.start);
  };
  const bar = (list, a, b, width, depth = width, color) => {
    const direction = new THREE.Vector3().fromArray(b).sub(new THREE.Vector3().fromArray(a));
    list.push({ p: a.map((value, i) => (value + b[i]) / 2), scale: [width, direction.length(), depth],
      q: new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()), color });
  };
  const box = (list, s, u, y, scale, color) => list.push({ p: point(s, u, y), scale, r: [0, -roadFrame(s).angle, 0], color });
  const owns = s => s >= chunk.start && s < chunk.start + CHUNK_LENGTH;
  const bridge = desertBridgeAt(chunk.start + CHUNK_LENGTH / 2);
  const { start, end } = bridge;
  if (end + 8 >= chunk.start && start - 8 < chunk.start + CHUNK_LENGTH) {
    const woods = ['#a28b6c', '#ad9676', '#998063', '#b19a79', '#a38c6c', '#a18a6b'];
    const count = Math.round((end - start) / .72), pitch = (end - start) / count;
    for (let i = 0; i < count; i++) {
      const s = start + (i + .5) * pitch;
      if (!owns(s)) continue;
      const width = 12.6 + (randomAt(i, 4210) - .5) * .24;
      box(timber, s, (randomAt(i, 4211) - .5) * .1, roadHeight(s) - .065, [width, .28, pitch + .008], woods[Math.floor(randomAt(bridge.index * 100 + i, 4201) * woods.length)]);
      if (i % 3 === 0) {
        box(timber, s + .09, (randomAt(i, 4202) - .5) * 9, roadHeight(s) + .079, [1 + randomAt(i, 4203) * 2, .012, .024], '#876745');
        for (const u of [-5.6, 5.6]) box(iron, s, u, roadHeight(s) + .085, [.065, .016, .065]);
      }
    }
    const bays = 8, bayLength = (end - start) / bays;
    for (let i = 0; i <= bays; i++) {
      const s = start + i * bayLength;
      if (!owns(s)) continue;
      for (const side of [-1, 1]) {
        const u = side * 5.95;
        const postHeight = 1.62 + (randomAt(i, side + 4212) - .5) * .18;
        box(timber, s, u, roadHeight(s) + postHeight / 2 - .18, [.44, postHeight, .46], '#7d6a51');
        box(iron, s, u, roadHeight(s) + .23, [.46, .12, .48]);
        if (i === bays) continue;
        const next = s + bayLength;
        for (const h of [.48, 1.24]) {
          const lean = (randomAt(i, side + 4213) - .5) * .09;
          bar(timber, point(s, u, roadHeight(s) + h + lean), point(next, u, roadHeight(next) + h - lean), .24, .3, '#998367');
        }
        if (i === 0 || i === bays - 1) bar(timber, point(s, u, roadHeight(s) + .4), point(next, u, roadHeight(next) + 1.22), .2, .16, '#806b50');
      }
      if (i === bays) continue;
      const next = s + bayLength;
      for (const u of [-5.3, -2.5, 2.5, 5.3]) bar(timber, point(s, u, roadHeight(s) - .48), point(next, u, roadHeight(next) - .48), .36, .54, '#73583f');
    }
    for (const s of [start, end]) if (owns(s)) {
      const bottom = Math.min(...[-6, 0, 6].map(u => at(s, u).y)) - .55;
      box(masonry, s, 0, (roadHeight(s) - .3 + bottom) / 2, [12.8, Math.max(.5, roadHeight(s) - .3 - bottom), 1.4], '#b28a62');
      box(timber, s, 0, roadHeight(s) - .015, [12.65, .19, .55], '#b39570');
    }
    for (const s of [start + 10, end - 10]) if (owns(s)) {
      const top = roadHeight(s) - .8;
      box(timber, s, 0, top, [12.4, .4, .48], '#785a40');
      for (const side of [-1, 1]) {
        const footU = side * 6.15, bottom = at(s, footU).y - .5;
        bar(timber, point(s, side * 5.2, top), point(s, footU, bottom), .4, .4, '#785a40');
        bar(timber, point(s, 0, top), point(s, footU, bottom + .3), .24, .22, '#896748');
      }
    }
  }
  instances(chunk.group, boxGeometry, timberMaterial, timber, 'desert-timber-bridge');
  instances(chunk.group, boxGeometry, ironMaterial, iron, 'desert-bridge-ironwork');
  instances(chunk.group, boxGeometry, assets.rockMaterial, masonry, 'desert-bridge-abutments');

  const random = seededRandom(chunk.index + 42971);
  const gravel = [], rocks = [], grasses = [], shrubs = [], driftwood = [];
  const stoneColors = ['#bfa480', '#cbb18a', '#b49b7a', '#d3b48b'];
  const greens = ['#87925a', '#929d61', '#a2a669', '#7f8d56'];
  const clear = (s, u, radius = 1) => Math.abs(u) > 8 + radius && desertCreekDistance(s, u) > radius * .4 && !insideMesa(s, u, 1.2);
  for (let i = 0; i < 110; i++) {
    const s = chunk.start + random() * CHUNK_LENGTH, creek = desertCreek(s);
    if (Math.sin(s / 11) + Math.sin(s / 27 + .8) < -.5) continue;
    const side = i % 2 ? -1 : 1, u = creek.center + side * (creek.width + .35 + random() * 2.7);
    if (!clear(s, u, .3)) continue;
    const p = at(s, u), size = .13 + random() ** 2 * .46;
    if (p.y < creek.level - .1) continue;
    p.y += size * .2;
    gravel.push({ p: p.toArray(), scale: [size * 1.3, size * .5, size], r: [.1, random() * 6, .12], color: stoneColors[i % 4] });
    if (i % 5 === 0 && p.y > creek.level + .1) {
      const height = .65 + random() * .7;
      grasses.push({ p: at(s, u).toArray(), scale: [height * .65, height, height * .65], r: [0, random() * 6, 0], color: i % 3 ? '#95966a' : '#aaa575' });
    }
  }
  for (let i = 0; i < 13; i++) {
    const s = chunk.start + 4 + random() * (CHUNK_LENGTH - 8), creek = desertCreek(s);
    const u = creek.center + (i % 2 ? 1 : -1) * (creek.width + 1.8 + random() * 2.5);
    if (!clear(s, u, 1.2)) continue;
    const p = at(s, u), size = .7 + random() * 1.25;
    p.y += size * .2;
    rocks.push({ p: p.toArray(), scale: [size * 1.2, size * .8, size], r: [.12, random() * 6, -.1], color: stoneColors[i % 4] });
  }
  for (let i = 0; i < 7; i++) {
    const s = chunk.start + 9 + i * 16 + random() * 9, creek = desertCreek(s);
    if (Math.sin(s / 29 + .4) + Math.sin(s / 13) < -.15) continue;
    const side = Math.sign(creek.center) || -1, u = creek.center + side * (creek.width + 4.2 + random() * 1.4);
    if (!clear(s, u, 2)) continue;
    for (let j = 0; j < 4; j++) {
      const t = s + (random() - .5) * 10, v = u + (random() - .5) * 3.5;
      if (!clear(t, v, 1.3)) continue;
      const size = .8 + random() * .8;
      for (let lobe = 0; lobe < 4; lobe++) {
        const angle = lobe * 2.4 + j;
        const p = at(t + Math.cos(angle) * size * .55, v + Math.sin(angle) * size * .5);
        const height = size * (.42 + random() * .22);
        p.y += height * .62;
        shrubs.push({ p: p.toArray(), scale: [size * .75, height, size * .65], r: [.08, angle, -.06], color: greens[(j + lobe) % 4] });
      }
    }
    if (i === 2) {
      const a = at(s + 5, u - side * 1.4), b = at(s + 9, u - side * 2.1);
      a.y += .15; b.y += .15;
      bar(driftwood, a.toArray(), b.toArray(), .19, .23, '#9b896c');
    }
  }
  instances(chunk.group, assets.stoneGeometry, assets.rockMaterial, gravel, 'desert-river-shingle');
  instances(chunk.group, assets.slabGeometry, assets.rockMaterial, rocks, 'desert-river-bank-rocks');
  instances(chunk.group, assets.grassGeometry, assets.plantMaterial, grasses, 'desert-river-rushes');
  instances(chunk.group, assets.bushGeometry, assets.plantMaterial, shrubs, 'desert-river-scrub');
  instances(chunk.group, boxGeometry, timberMaterial, driftwood, 'desert-river-driftwood');
}
