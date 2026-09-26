import { computeInstanceBounds } from './instance-batches.js';
import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { finalizeChunkTransforms } from './chunk-transforms.js';
import { updateResidentChunks, positionResidentChunks } from './resident.js';
import { CHUNK_LENGTH, TERRAIN_STEP, randomAt, seededRandom, roadFrame, roadX, roadHeight, coastOffset, shorelineOffset, terrainColumns, terrainCell, terrainVertex, positionAt, pondAt, pondRadius, ravineAmount, groundHeight, rockCover, cliffRib, bridgeAt, coastalGrove, rangeInfluence, wildflowers, icePlant, coastalGuardrail, GUARDRAIL_OFFSET, overlookAt, overlookWidth, clamp, lerp, smoothstep } from './route.js';
import { createWaterMaterial, createSurfMaterial, createRockWashMaterial, animateWater } from './water.js';
import { buildLandmarks } from './landmarks.js';
import { CoastalBirds } from './birds.js';
import { coastalCrags, coastalPines, coastalCypress, coastalMontereyPine, coastalScrub, coastalSedge, terrainSampler } from './coastal-assets.js';
import { coastalDiscoveries, discoveryClearsPlanting } from './coastal-discoveries.js';
import { buildCoastalDiscoveries } from './coastal-discovery-scenery.js';
import { discoveryAssets, discoveryMaterial } from './coastal-discovery-assets.js';
import { buildCoastalSea } from './coastal-sea.js';
import { CoastalSky } from './coastal-sky.js';
import { solidModel, solidPost, solidRocks, solidSpan } from './colliders.js';

const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
const waterMaterial = createWaterMaterial();
const roadMaterial = new THREE.MeshStandardMaterial({ color: '#424e58', roughness: 1 });
const shoulderMaterial = new THREE.MeshStandardMaterial({ color: '#b9b9a7', roughness: 1 });
const lineMaterial = new THREE.MeshStandardMaterial({ color: '#f3ecd2', roughness: 1 });
const centerMaterial = new THREE.MeshStandardMaterial({ color: '#ecc967', roughness: 1 });
const foamMaterial = createSurfMaterial();
const rollingSurfMaterial = createSurfMaterial(true);
const rockWashMaterial = createRockWashMaterial();
const pineMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, flatShading: true, roughness: 1 });
const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#78664a', roughness: 1 });
const rockMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1 });
const cragMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, flatShading: true, roughness: .92 });
cragMaterial.onBeforeCompile = shader => {
  shader.vertexShader = 'varying float vStoneHeight;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
    vec4 stonePosition = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      stonePosition = instanceMatrix * stonePosition;
    #endif
    vStoneHeight = (modelMatrix * stonePosition).y;
    #include <project_vertex>
  `);
  shader.fragmentShader = 'varying float vStoneHeight;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
    #include <color_fragment>
    diffuseColor.rgb *= mix(vec3(0.46, 0.57, 0.58), vec3(1.0), smoothstep(0.1, 2.5, vStoneHeight));
  `);
};
cragMaterial.customProgramCacheKey = () => 'coastal-tidal-stone-v1';
const postMaterial = new THREE.MeshStandardMaterial({ color: '#f4e9cd', roughness: 1 });
const blossomMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
const trunkGeometry = new THREE.CylinderGeometry(.16, .25, 1, 5);
const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
const postGeometry = new THREE.BoxGeometry(.22, 1.25, .25);
const capGeometry = new THREE.BoxGeometry(.235, .18, .265);
const capMaterial = new THREE.MeshStandardMaterial({ color: '#466050' });
const railGeometry = new THREE.BoxGeometry(1, 1, 1);
const railMaterial = new THREE.MeshStandardMaterial({ color: '#aeb9b8', roughness: .72, metalness: .18 });
const matrix = new THREE.Object3D();
const shades = list => list.map(color => new THREE.Color(color));
const PETALS = { poppy: shades(['#f28a1c', '#f7a12c', '#eb771a']), lupine: shades(['#6d5fd4', '#7e6fe0', '#5d5abf']), mustard: shades(['#f4d43b', '#eec72d']),
  ice: shades(['#e2559c', '#d9468e', '#ee6cab']), cream: new THREE.Color('#f4eedb'), iceYellow: new THREE.Color('#f1d24a'),
  goldfields: new THREE.Color('#e8cf4f'), radish: new THREE.Color('#d9c6d6') };
registerChunkResources('coast', { terrainMaterial, waterMaterial, roadMaterial, shoulderMaterial, lineMaterial, centerMaterial,
  foamMaterial, rollingSurfMaterial, rockWashMaterial, pineMaterial, trunkMaterial, rockMaterial, cragMaterial,
  postMaterial, capMaterial, trunkGeometry, rockGeometry, postGeometry, capGeometry,
  coastalPines, coastalCrags, coastalCypress, coastalMontereyPine, coastalScrub, coastalSedge, railGeometry, railMaterial, blossomMaterial });

function geometryFrom(positions, colors) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
function addTriangle(positions, colors, a, b, c, color, start) {
  // Surfaces are height fields, so force upward-facing winding.
  if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
  for (const p of [a, b, c]) {
    positions.push(p.x, p.y, p.z + start);
    if (colors) {
      const tint = typeof color === 'function' ? color(p) : color;
      colors.push(tint.r, tint.g, tint.b);
    }
  }
}
function makeInstances(group, geometry, material, items, shadows = true) {
  if (!items.length) return;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  items.forEach((item, i) => {
    matrix.position.set(...item.p); matrix.rotation.set(...(item.r ?? [0, 0, 0])); matrix.scale.set(...item.scale); matrix.updateMatrix(); mesh.setMatrixAt(i, matrix.matrix);
    if (item.color) mesh.setColorAt(i, new THREE.Color(item.color));
  });
  mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  computeInstanceBounds(mesh); group.add(mesh); return mesh;
}

function addRockWash(rock, phase, vertices, washCoords, shape = rockGeometry) {
  matrix.position.set(...rock.p); matrix.rotation.set(...rock.r); matrix.scale.set(...rock.scale); matrix.updateMatrix();
  const position = shape.attributes.position;
  const points = [];
  // Intersect the transformed rock with the water plane so foam meets its base.
  for (let i = 0; i < position.count; i += 3) {
    const triangle = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, i + j).applyMatrix4(matrix.matrix));
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle[edge], b = triangle[(edge + 1) % 3];
      if ((a.y > .12) === (b.y > .12)) continue;
      const p = a.clone().lerp(b, (.12 - a.y) / (b.y - a.y));
      if (!points.some(other => other.distanceToSquared(p) < .000001)) points.push(p);
    }
  }
  if (points.length < 3) return;
  const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
  points.sort((a, b) => Math.atan2(a.z - center.z, a.x - center.x) - Math.atan2(b.z - center.z, b.x - center.x));
  const pairs = points.map(p => {
    const outward = p.clone().sub(center).setY(0).normalize();
    const angle = Math.atan2(outward.z, outward.x);
    const width = (1.1 + rock.scale[0] * .32) * (1 - outward.x * .3) * (.85 + .2 * Math.sin(angle * 3 + phase));
    return [p.clone().addScaledVector(outward, -.25), p.clone().addScaledVector(outward, width)];
  });
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i], [c, d] = pairs[(i + 1) % pairs.length];
    for (const [p, edge] of [[a, 0], [c, 0], [b, 1], [b, 1], [c, 0], [d, 1]]) {
      vertices.push(p.x, .12, p.z); washCoords.push(edge, phase);
    }
  }
}

// The centre, height and rough radius of a placed rock's highest facets.
function crownOf(rock, shape) {
  matrix.position.set(...rock.p); matrix.rotation.set(...rock.r); matrix.scale.set(...rock.scale); matrix.updateMatrix();
  const position = shape.attributes.position, point = new THREE.Vector3(), points = [];
  for (let i = 0; i < position.count; i++) points.push(point.fromBufferAttribute(position, i).applyMatrix4(matrix.matrix).clone());
  const high = Math.max(...points.map(p => p.y)), cap = points.filter(p => p.y > high - rock.scale[1] * .18);
  const center = cap.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / cap.length);
  const radius = Math.max(...cap.map(p => Math.hypot(p.x - center.x, p.z - center.z)));
  return { x: center.x, y: center.y, z: center.z, radius };
}

export class CoastalChunk {
  constructor(index) {
    this.index = index; this.start = index * CHUNK_LENGTH; this.group = new THREE.Group(); this.owned = [];
    this.discoveries = coastalDiscoveries(this.start - 96, this.start + CHUNK_LENGTH + 96);
    this.buildTerrain(); this.buildWater(); this.buildRoad(); buildLandmarks(this); this.buildScenery();
    buildCoastalDiscoveries(this, this.discoveries); buildCoastalSea(this);
    if (index % 3 === 0) this.birds = new CoastalBirds(this);
    solidRocks(this, [rockGeometry, ...coastalCrags]);
    finalizeChunkTransforms(this.group);
  }
  addMesh(geometry, material, shadows = false) {
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true; mesh.castShadow = shadows; this.group.add(mesh); this.owned.push(geometry); return mesh;
  }
  buildTerrain() {
    const positions = []; const colors = [];
    const firstRow = this.start / TERRAIN_STEP;
    // Per-chunk cache of shared terrain samples, dropped once the chunk is built.
    const vertices = new Map();
    const vertex = (row, col) => {
      const key = `${row},${col}`;
      if (!vertices.has(key)) vertices.set(key, terrainVertex(row, col));
      return vertices.get(key);
    };
    const columns = terrainColumns(this.start).length;
    const meadow = new THREE.Color('#88a746'), fern = new THREE.Color('#527b3e'), dryGrass = new THREE.Color('#b7b56e');
    const stone = new THREE.Color('#c4bba5'), coolStone = new THREE.Color('#829095'), fracture = new THREE.Color('#505d63');
    const cliffStone = new THREE.Color('#d9c9ad'), coolCliff = new THREE.Color('#81929b'), dust = new THREE.Color('#b7af7c');
    const goldGrass = new THREE.Color('#c4ad5e'), poppyTurf = new THREE.Color('#a9a543'), lupineTurf = new THREE.Color('#6d8c62'), mustardTurf = new THREE.Color('#b3b24a');
    const iceLeaf = new THREE.Color('#7f9f3a'), iceRed = new THREE.Color('#98734c');
    const stoneLight = new THREE.Vector3(-190, 215, 125).normalize();
    const sunSide = new THREE.Vector2(-190, 125).normalize(), shadedTurf = new THREE.Color('#46693a');
    for (let row = firstRow; row < firstRow + CHUNK_LENGTH / TERRAIN_STEP; row++) {
      for (let col = 0; col < columns - 1; col++) {
        const seedCol = col > 8 ? col - 1 : col;
        terrainCell(row, col, vertex).forEach((tri, j) => {
          const r = randomAt(row * 2 + j, seedCol + 191);
          let color, meadowFace = false;
          const s = tri.reduce((sum, p) => sum + p.s, 0) / 3;
          const u = tri.reduce((sum, p) => sum + p.u, 0) / 3;
          const edgeA = new THREE.Vector3(tri[1].x - tri[0].x, tri[1].y - tri[0].y, tri[1].z - tri[0].z);
          const edgeB = new THREE.Vector3(tri[2].x - tri[0].x, tri[2].y - tri[0].y, tri[2].z - tri[0].z);
          const longestEdgeSq = Math.max(edgeA.lengthSq(), edgeB.lengthSq(), edgeA.clone().sub(edgeB).lengthSq());
          const normal = edgeA.cross(edgeB);
          const sliver = normal.length() < longestEdgeSq * .12;
          normal.normalize();
          if (normal.y < 0) normal.negate();
          const steep = Math.abs(normal.y) < .59;
          const y = tri.reduce((sum, p) => sum + p.y, 0) / 3;
          // Roadside greens blend into hillside colour over roughly 90 m.
          const vergeBlend = smoothstep(8, 100, Math.abs(u));
          const grassU = u * vergeBlend;
          const meadowMix = .5 + .28 * Math.sin(s / 75 + grassU / 80) + .2 * Math.sin(s / 150 - grassU / 140);
          const shoreFace = col <= 6 || (ravineAmount(s, u) > .65 && u < 35);
          // Sand only on low gentle ground. Rim turf skips steep cliff slivers.
          const sandyFace = shoreFace && normal.y > .78 && Math.max(...tri.map(p => p.y)) < 3.5;
          const grassyLedge = tri.rimTurf && normal.y > .5 && !(sliver && normal.y < .7) && ravineAmount(s, u) < .12;
          const coastalRock = col >= 7 && col <= 9 && !grassyLedge;
          const grassyShelf = col >= 10 && col <= 11 && ravineAmount(s, u) < .12;
          // Inland rock follows summits and rock patches. Elsewhere only sheer facets show.
          const cover = col >= 12 ? rockCover(s, u) : 0;
          const inlandRock = !grassyShelf && ((steep && u > coastOffset(s) - 10 && (normal.y < .44 || (ravineAmount(s, u) > .05 && normal.y < .55))) || cover + (r - .5) * .08 > .48);
          const exposure = clamp(normal.dot(stoneLight), 0, 1);
          if (sandyFace) {
            color = new THREE.Color('#e9d8b3').lerp(new THREE.Color('#94aaa1'), 1 - smoothstep(-.3, 1.5, y));
          } else if (shoreFace || coastalRock || (!grassyLedge && (col <= 9 || inlandRock))) {
            if (col <= 10) {
              // Colour by sun exposure, darker near the waterline.
              const weathering = randomAt(Math.floor((s + y * .2) / 14), 1641);
              color = fracture.clone().lerp(coolCliff, smoothstep(.02, .3, exposure));
              color.lerp(cliffStone, smoothstep(.4, .88, exposure) * .8 + weathering * .16);
              color.multiplyScalar(lerp(.8, 1, smoothstep(1.2, 4.5, y)));
            } else {
              const weathering = randomAt(Math.floor(s / 21) * 7 + Math.floor(u / 17), 1642);
              color = fracture.clone().lerp(coolStone, smoothstep(.02, .32, exposure));
              color.lerp(stone, smoothstep(.36, .9, exposure) * .78 + weathering * .12 + r * .1);
              color.multiplyScalar(.96 + .06 * smoothstep(20, 70, cover * 60 + (y - 30)));
              // Low-cover faces blend toward grass. Summits stay bare rock.
              color.lerp(dryGrass, (1 - smoothstep(.45, .85, cover)) * smoothstep(.48, .85, normal.y) * .38);
            }
          } else {
            meadowFace = true;
            // Same turf palette on both sides of the road.
            color = fern.clone().lerp(meadow, clamp(meadowMix * .7 + r * .07 + .18, 0, 1));
            const grove = lerp(coastalGrove(s, 0), coastalGrove(s, u), vergeBlend);
            color.lerp(fern, smoothstep(.34, .88, grove) * .34);
            // In the coast range, sun-facing slopes go gold and shaded ones stay green.
            const range = rangeInfluence(u);
            if (range > 0) {
              const facing = normal.x * sunSide.x + normal.z * sunSide.y;
              color.lerp(goldGrass, smoothstep(.04, .3, facing) * range * .72);
              color.lerp(shadedTurf, smoothstep(.02, .25, -facing) * range * .62);
            }
            const height = y - roadFrame(s).y;
            color.lerp(dryGrass, smoothstep(.45, .95, exposure) * smoothstep(12, 90, height) * .28);
            color.lerp(goldGrass, smoothstep(45, 100, height) * (1 - smoothstep(.38, .7, grove)) * (.16 + exposure * .2));
            // Blossoms are separate geometry. Keep this tint subtle or drifts look like bare soil.
            const bloom = wildflowers(s, u);
            color.lerp(poppyTurf, bloom.poppy * .3).lerp(lupineTurf, bloom.lupine * .3).lerp(mustardTurf, bloom.mustard * .3);
            const mat = tri.rimTurf || (col === 10 && u < coastOffset(s) + 5) ? icePlant(s) * clamp(1 - ravineAmount(s, u) * 3, 0, 1) : 0;
            color.lerp(r > .8 ? iceRed : iceLeaf, mat * (.5 + r * .12));
            if (tri.rimTurf) color.lerp(dust, smoothstep(.45, .9, cliffRib(s, 1)) * (.35 + r * .4) * (1 - mat));
          }
          // Small random variation so flat shading still defines the facets.
          color.multiplyScalar(sandyFace || meadowFace ? .985 + r * .03 : col > 9 && !steep ? .95 + r * .1 : .97 + r * .06);
          let tint = color;
          if (meadowFace && u > 7 && pondRadius(s, u) < 2.6) {
            const pond = pondAt(s);
            // Damp tint is per vertex so the bank fades smoothly, not in solid rings.
            tint = p => {
              const damp = (1 - smoothstep(.65, 2.3, pondRadius(p.s, p.u, pond)))
                * (1 - smoothstep(pond.level + .5, pond.level + 12, p.y));
              return color.clone().lerp(fern, damp * .18);
            };
          }
          addTriangle(positions, colors, ...tri, tint, this.start);
        });
      }
    }
    this.terrain = this.addMesh(geometryFrom(positions, colors), terrainMaterial, true);
    this.sampleGround = terrainSampler(this.terrain);
  }
  buildWater() {
    const positions = [], colors = [];
    const step = 16, firstRow = this.start / step;
    const seaPoint = (row, col) => {
      const s = row * step + (randomAt(row, col + 717) - .5) * 9;
      const u = -420 + col * 16 + (row % 2 === 0 ? -3 : 3) + (randomAt(row + 122, col) - .5) * 9;
      return { ...positionAt(s, u, -.05), u, s };
    };
    for (let row = firstRow; row < firstRow + CHUNK_LENGTH / step; row++) for (let col = 0; col < 32; col++) {
      const a = seaPoint(row, col), b = seaPoint(row + 1, col), c = seaPoint(row, col + 1), d = seaPoint(row + 1, col + 1);
      const triangles = randomAt(row, col + 613) > .5 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
      triangles.forEach((tri, t) => {
        const u = tri.reduce((sum, v) => sum + v.u, 0) / 3;
        const s = tri.reduce((sum, v) => sum + v.s, 0) / 3;
        const depth = clamp((shorelineOffset(s) - u) / 155, 0, 1);
        const color = new THREE.Color('#71cfc7').lerp(new THREE.Color('#277f9e'), smoothstep(0, .52, depth));
        color.lerp(new THREE.Color('#205879'), smoothstep(.28, 1, depth));
        color.multiplyScalar(.94 + randomAt(row * 2 + t, col + 819) * .13);
        addTriangle(positions, colors, ...tri, color, this.start);
      });
    }
    const ocean = this.addMesh(geometryFrom(positions, colors), waterMaterial);
    ocean.name = 'animated-ocean'; ocean.geometry.boundingSphere.radius += .5;
    for (let line = 0; line < 4; line++) {
      const foam = [], flow = [], edges = [];
      for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
        if (ravineAmount(s, 0) > .15) continue;
        if (line > 0 && randomAt(Math.floor(s / 6), line + 19) > .8) continue;
        const offset = line === 0 ? -1.1 : 16;
        const width = line === 0 ? 5.8 + Math.sin(s * .31) * 1.5 : 3.4 + Math.sin(s * .18 + line) * 1.3;
        const at = (t, du) => positionAt(t, shorelineOffset(t) - offset + Math.sin(t * .21 + line) * 1.1 + du, .17);
        const a = at(s, 0), b = at(s + 2, 0), c = at(s, -width), d = at(s + 2, -width);
        a.edge = b.edge = 0; c.edge = d.edge = 1;
        for (let triangle of [[a, c, b], [b, c, d]]) {
          const [p, q, r] = triangle;
          if ((q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z) < 0) triangle = [p, r, q];
          for (const v of triangle) { foam.push(v.x, v.y, v.z + this.start); edges.push(v.edge); }
        }
        for (let vertex = 0; vertex < 6; vertex++) flow.push(1, 0, line / 3);
      }
      const geo = geometryFrom(foam);
      geo.setAttribute('surfEdge', new THREE.Float32BufferAttribute(edges, 1));
      if (line > 0) geo.setAttribute('surfFlow', new THREE.Float32BufferAttribute(flow, 3));
      geo.boundingSphere.radius += 12;
      const surf = this.addMesh(geo, line === 0 ? foamMaterial : rollingSurfMaterial);
      surf.name = line === 0 ? 'shore-wash' : 'rolling-breakers';
    }
  }
  ribbon(ranges, lift, material, dashed = false) {
    const positions = [];
    for (const [low, high] of ranges) for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
      if (dashed && Math.floor(s / 4) % 3 === 2) continue;
      const point = (t, u) => { const f = roadFrame(t); return positionAt(t, u, f.y + lift); };
      const edge = (value, t) => typeof value === 'function' ? value(t) : value;
      const a = point(s, edge(low, s)), b = point(s + 2, edge(low, s + 2)), c = point(s, edge(high, s)), d = point(s + 2, edge(high, s + 2));
      addTriangle(positions, null, a, b, c, null, this.start); addTriangle(positions, null, b, d, c, null, this.start);
    }
    this.addMesh(geometryFrom(positions), material);
  }
  buildRoad() {
    // Shoulder wraps around the pullout rather than across its entrance.
    this.ribbon([[s => -overlookWidth(s), 6.05]], .045, shoulderMaterial);
    this.ribbon([[-5.5, 5.5]], .075, roadMaterial);
    // Matching markings share one draw call per chunk.
    this.ribbon([[-5.05, -4.89], [4.89, 5.05]], .09, lineMaterial);
    this.ribbon([[-.21, -.07], [.07, .21]], .093, centerMaterial);
    const pavement = [], markings = [];
    const point = (s, u, lift) => positionAt(s, u, roadFrame(s).y + lift);
    const strip = (array, s, low, high, endLow = low, endHigh = high, lift = .075) => {
      const a = point(s, low, lift), b = point(s + 2, endLow, lift), c = point(s, high, lift), d = point(s + 2, endHigh, lift);
      addTriangle(array, null, a, b, c, null, this.start); addTriangle(array, null, b, d, c, null, this.start);
    };
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
      const width = overlookWidth(s), endWidth = overlookWidth(s + 2);
      if (Math.max(width, endWidth) <= 6.06) continue;
      // Match the road's edge, height and sampling so there's no seam or overlap.
      strip(pavement, s, -width + .55, -5.5, -endWidth + .55, -5.5);
      if (Math.min(width, endWidth) > 15.8 && Math.floor(s / 2) % 3 === 0) {
        // Short bay dividers leave room to pull through.
        const a = point(s, -14.85, .098), b = point(s + .12, -14.85, .098);
        const c = point(s, -10.5, .098), d = point(s + .12, -10.5, .098);
        addTriangle(markings, null, a, b, c, null, this.start); addTriangle(markings, null, b, d, c, null, this.start);
      }
    }
    if (pavement.length) {
      this.addMesh(geometryFrom(pavement), roadMaterial).name = 'paved-ocean-overlook';
      this.addMesh(geometryFrom(markings), lineMaterial).name = 'overlook-parking-bays';
    }
  }
  buildScenery() {
    const random = seededRandom(this.index + 8913);
    const trunks = [], foliage = [[], []], scrub = [[], []], blooms = [], rocks = [], posts = [], caps = [], rails = [], benches = [], walls = [], shields = [], cypresses = [], monterey = [], sedges = [], stacks = [[], [], []];
    const rockWashVertices = [], rockWashCoords = [];
    const canGrow = (s, u) => !(u < 0 && u > -overlookWidth(s) - 3) && pondRadius(s, u) > 1.15 && ravineAmount(s, u) < .13 && groundHeight(s, u) > 2 && discoveryClearsPlanting(s, u, this.discoveries);
    const hillSlope = (s, u) => Math.hypot(groundHeight(s, u + 1) - groundHeight(s, u - 1), groundHeight(s + 1, u) - groundHeight(s - 1, u)) / 2;
    const green = ['#315c48', '#406747', '#52744e', '#294e40', '#607e4d', '#3e624b'];
    const uplandGreen = ['#254e40', '#305b45', '#40664b', '#29483e'];
    const bushColors = ['#6a8652', '#829357', '#547c56', '#94a365'];
    const rockColors = ['#b9b39f', '#a5b1b0', '#c7bba2', '#929fa1', '#b7b6a9'];
    const outcropColors = ['#9ca8a6', '#bab5a5', '#8c9c9d', '#acada2'];
    const planted = (s, u) => {
      const p = positionAt(s, u);
      p.y = this.sampleGround(p.x, p.z + this.start) ?? p.y;
      return p;
    };
    for (let i = 0; i < 475; i++) {
      const s = this.start + random() * CHUNK_LENGTH;
      let u = 12 + random() ** .8 * 170;
      if (i < 13) u = lerp(coastOffset(s) + 7, -13, random());
      const grove = coastalGrove(s, u);
      const upland = smoothstep(45, 85, u);
      if (grove < (u < 0 ? .58 : .51) || random() > smoothstep(.46, .71, grove)) continue;
      if (!canGrow(s, u) || rockCover(s, u) > .42 || hillSlope(s, u) > 1.35) continue;
      const p = planted(s, u);
      const maturity = u < 0 ? .7 : (.76 + smoothstep(.47, .72, grove) * .37) * (1 - rockCover(s, u) * .22);
      const size = (5.8 + random() * 6.8) * maturity;
      const y = p.y - .25; const rotation = random() * Math.PI;
      if (u < 58 && (u < 0 || i % 4 === 0)) {
        const item = { p: [p.x, y, p.z + this.start], scale: [size * .85, size, size * .85], r: [0, rotation, 0], color: green[i % green.length] };
        (u < 0 ? cypresses : monterey).push(item);
        solidModel(this, (u < 0 ? coastalCypress : coastalMontereyPine).bark, item.p, rotation, size * .85, true);
        continue;
      }
      trunks.push({ p: [p.x, y + size * .29, p.z + this.start], scale: [size * .35, size * .6, size * .35] });
      solidPost(this, p.x, p.z + this.start, size * .09);
      const palette = upland > .5 ? uplandGreen : green;
      const color = palette[Math.floor(random() * palette.length)];
      foliage[i % 2].push({ p: [p.x, y, p.z + this.start], scale: [size, size, size], r: [0, rotation, 0], color });
    }
    // Scrub grows in clumps: a lead mound plus smaller companions.
    const clumpRandom = seededRandom(this.index + 30931);
    for (let i = 0; i < 98; i++) {
      const s = this.start + random() * CHUNK_LENGTH;
      const u = i < 42 ? lerp(coastOffset(s) + 1.7, -8.5, random()) : 9.5 + random() * 91;
      if (!canGrow(s, u) || (u > 16 && coastalGrove(s, u) < .47)) continue;
      const p = planted(s, u); const size = 1 + random() * 1.9;
      const heading = random() * 6, color = bushColors[Math.floor(random() * bushColors.length)];
      scrub[i % 2].push({ p: [p.x, p.y - size * .08, p.z + this.start], scale: [size, size * .82, size], r: [0, heading, 0], color });
      const companions = i % 3 === 0 ? (clumpRandom() < .5 ? 2 : 1) : clumpRandom() < .3 ? 1 : 0;
      for (let k = 0; k < companions; k++) {
        const angle = heading + k * 2.3 + clumpRandom() * .8, reach = size * (.7 + clumpRandom() * .3);
        const t = s + Math.cos(angle) * reach, v = u + Math.sin(angle) * reach;
        if (!canGrow(t, v)) continue;
        const q = planted(t, v), small = size * (.42 + clumpRandom() * .3);
        scrub[(i + k + 1) % 2].push({ p: [q.x, q.y - small * .08, q.z + this.start], scale: [small, small * .8, small], r: [0, angle, 0], color: k ? '#99a779' : color });
      }
    }
    let seaStackTop = 0;
    for (let i = 0; i < 52; i++) {
      const s = this.start + random() * CHUNK_LENGTH;
      const sea = i < 25;
      // Keep only two sea rocks in eight so the open water isn't crowded.
      if (sea && i % 8 > 1) continue;
      const hero = sea && i % 8 === 0;
      const u = sea ? shorelineOffset(s) - (i === 0 ? 35 : 6) - random() ** 1.7 * (i === 0 ? 45 : 34) : (i < 35 ? coastOffset(s) + random() * 5 : 12 + random() * 140);
      if (sea && this.discoveries.some(site => site.kind !== 'lighthouse' && Math.hypot(s - site.s, u - site.u) < site.radius + 10)) continue;
      if (!sea && !canGrow(s, u)) continue;
      const p = planted(s, u);
      const size = sea ? (i === 0 ? 8 + random() * 2.5 : hero ? 3.2 + random() * 2.8 : .8 + random() * 2.2) : .7 + random() * 3.1;
      const height = size * (hero ? 1.1 + random() * .72 : .8 + random() * .65);
      const rock = { p: [p.x, sea ? -.8 + height * .3 : p.y + height * .28, p.z + this.start], scale: [size, height, size * (.6 + random() * .6)], r: [random() * .25, random() * 6, random() * .4], color: rockColors[Math.floor(random() * rockColors.length)] };
      if (sea) {
        const variant = Math.floor(i / 3) % 3;
        stacks[variant].push(rock);
        addRockWash(rock, randomAt(this.index, i + 503) * Math.PI * 2, rockWashVertices, rockWashCoords, coastalCrags[variant]);
        if (hero) for (let companion = 0; companion < 2; companion++) {
          // Companions share a fracture direction and overlap the stack's base.
          const angle = rock.r[1] + .7 + companion * 2.5 + randomAt(this.index * 31 + i, 614 + companion) * .5;
          const small = size * (companion === 0 ? .46 : .29);
          const radius = size * (companion === 0 ? .83 : 1.07);
          const satellite = { p: [p.x + Math.cos(angle) * radius, -.3 + small * .16, p.z + this.start + Math.sin(angle) * radius],
            scale: [small, small * (companion === 0 ? 1.65 : 1.05), small * .82],
            r: [.08, rock.r[1] + companion * .35, companion === 0 ? -.18 : .22], color: rock.color };
          const shape = (variant + companion + 1) % coastalCrags.length;
          stacks[shape].push(satellite);
          addRockWash(satellite, angle, rockWashVertices, rockWashCoords, coastalCrags[shape]);
        }
        seaStackTop = Math.max(seaStackTop, rock.p[1] + height * 1.15);
        if (i === 0) {
          // The tallest stack gets scrub and a cypress placed on its real crown.
          const crown = crownOf(rock, coastalCrags[variant]), tree = 3.6 + randomAt(this.index, 5101) * 1.6;
          const item = { p: [crown.x, crown.y - .35, crown.z], scale: [tree, tree, tree], r: [0, -.5 + randomAt(this.index, 5102) * .6, 0], color: green[3] };
          cypresses.push(item);
          solidModel(this, coastalCypress.bark, item.p, item.r[1], tree, true);
          seaStackTop = Math.max(seaStackTop, crown.y + tree);
          for (let k = 0; k < 4; k++) {
            const angle = k * 1.7 + randomAt(this.index, 5103 + k) * .8, reach = crown.radius * (.25 + randomAt(this.index, 5107 + k) * .45);
            const mound = 1 + randomAt(this.index, 5111 + k) * .9;
            scrub[k % 2].push({ p: [crown.x + Math.cos(angle) * reach, crown.y - mound * .45, crown.z + Math.sin(angle) * reach],
              scale: [mound, mound * .7, mound], r: [0, angle, 0], color: bushColors[k % bushColors.length] });
          }
        }
      } else {
        // Land boulders sit mostly buried so they read as bedrock.
        const shape = i % coastalCrags.length;
        rock.p[1] = p.y + height * .1; rock.scale[1] = height * .78;
        stacks[shape].push(rock);
        if (size > 1.6) {
          const angle = rock.r[1] + 1.1, reach = size * .95;
          const t = s + Math.cos(angle) * reach, v = u + Math.sin(angle) * reach;
          if (canGrow(t, v)) {
            const q = planted(t, v), small = size * .42;
            stacks[(shape + 1) % coastalCrags.length].push({ p: [q.x, q.y + small * .05, q.z + this.start],
              scale: [small, small * .7, small * .8], r: [rock.r[0], angle, -rock.r[2]], color: rock.color });
          }
        }
      }
    }
    const outcropRandom = seededRandom(this.index + 51377);
    for (let cluster = 0; cluster < 7; cluster++) {
      const s = this.start + 6 + outcropRandom() * (CHUNK_LENGTH - 12);
      const u = 34 + outcropRandom() ** .7 * 130;
      if (!canGrow(s, u) || rockCover(s, u) < .3 || hillSlope(s, u) > 1.6) continue;
      const lean = outcropRandom() * Math.PI * 2, tint = outcropColors[cluster % outcropColors.length];
      const pieces = 3 + Math.floor(outcropRandom() * 3);
      for (let piece = 0; piece < pieces; piece++) {
        const t = s + (outcropRandom() - .5) * 11, v = u + (outcropRandom() - .5) * 9;
        if (!canGrow(t, v)) continue;
        const p = planted(t, v);
        const size = piece === 0 ? 2.6 + outcropRandom() * 2.6 : 1.1 + outcropRandom() * 2;
        const height = size * (.7 + outcropRandom() * .6);
        stacks[(cluster + piece) % coastalCrags.length].push({ p: [p.x, p.y + height * .05, p.z + this.start],
          scale: [size, height, size * (.7 + outcropRandom() * .5)],
          r: [(outcropRandom() - .5) * .5, lean + piece * .4, (outcropRandom() - .5) * .5], color: tint });
      }
    }
    // Rockfall below the cliff: large slabs near the toe, small pieces toward the beach.
    const fallRandom = seededRandom(this.index + 68134);
    for (let pile = 0; pile < 3; pile++) {
      const center = this.start + 14 + pile * 36 + fallRandom() * 12;
      if (ravineAmount(center, coastOffset(center) - 14) > .1) continue;
      for (let piece = 0; piece < 12; piece++) {
        const large = piece < 3;
        const s = center + (fallRandom() - .5) * (large ? 12 : 23);
        const u = coastOffset(s) - (large ? 13.5 : 15) - fallRandom() * (large ? 3 : 6);
        const p = planted(s, u);
        if (p.y < .6 || p.y > 4 || ravineAmount(s, u) > .12) continue;
        const size = large ? 2.7 + fallRandom() * 3.1 : .5 + fallRandom() * 1.9;
        const height = size * (large ? .6 + fallRandom() * .45 : .4 + fallRandom() * .35);
        const rock = { p: [p.x, p.y + height * .12, p.z + this.start],
          scale: [size, height, size * (.65 + fallRandom() * .5)],
          r: [(fallRandom() - .5) * .6, fallRandom() * Math.PI * 2, (fallRandom() - .5) * .65],
          color: rockColors[Math.floor(fallRandom() * rockColors.length)] };
        const variant = (pile + piece) % coastalCrags.length;
        stacks[variant].push(rock);
        if (large) addRockWash(rock, pile + piece, rockWashVertices, rockWashCoords, coastalCrags[variant]);
      }
    }
    if (rockWashVertices.length) {
      const geometry = geometryFrom(rockWashVertices);
      geometry.setAttribute('rockWash', new THREE.Float32BufferAttribute(rockWashCoords, 2));
      geometry.boundingSphere.radius += .5;
      this.addMesh(geometry, rockWashMaterial).name = 'sea-stack-wash';
    }
    // These wildflowers only grow beside shrubs.
    for (let patch = 0; patch < 28; patch++) {
      const s = this.start + random() * CHUNK_LENGTH;
      const u = patch % 2 ? 10 + random() * 20 : lerp(coastOffset(s) + 3, -9, random());
      if (!canGrow(s, u)) continue;
      const center = planted(s, u);
      const besideShrub = scrub.flat().some(shrub => Math.hypot(shrub.p[0] - center.x, shrub.p[2] - center.z - this.start) < shrub.scale[0] + 3);
      for (let flower = 0; flower < 12; flower++) {
        const t = s + (random() - .5) * 4, v = u + (random() - .5) * 3;
        if (!canGrow(t, v) || Math.abs(v) < 8) continue;
        if (besideShrub) blooms.push({ s: t, u: v, color: patch % 3 ? PETALS.goldfields : PETALS.radish });
      }
    }
    // Route 1 shields on a world-space schedule, clear of the viaducts.
    for (let k = Math.floor((this.start - 520) / 700); k * 700 + 320 < this.start + CHUNK_LENGTH; k++) {
      const s = k * 700 + 320 + randomAt(k, 5131) * 200;
      if (s < this.start || s >= this.start + CHUNK_LENGTH || Math.abs(s - bridgeAt(s).center) < 60) continue;
      const p = planted(s, 7.7);
      shields.push({ p: [p.x, p.y - .1, p.z + this.start], scale: [1, 1, 1], r: [0, -roadFrame(s).angle, 0] });
      solidPost(this, p.x, p.z + this.start, .12);
    }
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 16) {
      if (Math.abs(s - bridgeAt(s).center) < 49) continue;
      for (const u of [-6.85, 6.85]) {
        // No delineator where a guardrail already marks the edge.
        if (u < 0 && (overlookWidth(s) > 6.2 || coastalGuardrail(s))) continue;
        const p = positionAt(s, u); const angle = -roadFrame(s).angle;
        posts.push({ p: [p.x, p.y + .62, p.z + this.start], scale: [1, 1, 1], r: [0, angle, 0] });
        caps.push({ p: [p.x, p.y + .94, p.z + this.start], scale: [1, 1, 1], r: [0, angle, 0] });
      }
    }
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 4) {
      if (!coastalGuardrail(s + 2)) continue;
      const a = positionAt(s, GUARDRAIL_OFFSET), b = positionAt(s + 4, GUARDRAIL_OFFSET);
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      rails.push({ p: [(a.x + b.x) / 2, (a.y + b.y) / 2 + .95, (a.z + b.z) / 2 + this.start],
        scale: [.18, .32, length + .12], r: [-Math.atan2(b.y - a.y, length), Math.atan2(dx, dz), 0] });
      rails.push({ p: [a.x, a.y + .48, a.z + this.start], scale: [.17, .96, .18] });
      // Segments post their near end, so the last one in a run needs a closing post.
      if (!coastalGuardrail(s + 6)) rails.push({ p: [b.x, b.y + .48, b.z + this.start], scale: [.17, .96, .18] });
    }
    const overlook = overlookAt(this.start + CHUNK_LENGTH / 2);
    if (overlook.enabled && overlook.center >= this.start && overlook.center < this.start + CHUNK_LENGTH) {
      for (const ds of [-7, 7]) {
        const s = overlook.center + ds, p = planted(s, -20), angle = -roadFrame(s).angle;
        const part = (u, y, along, scale) => {
          const q = positionAt(s + along, -20 + u, p.y + y);
          benches.push({p: [q.x, q.y, q.z + this.start], scale, r: [0, angle, 0]});
        };
        part(0, .78, 0, [.95, .16, 3.2]);
        part(.42, 1.25, 0, [.13, .65, 3.2]);
        for (const along of [-1.15, 1.15]) for (const u of [-.3, .3]) part(u, .35, along, [.15, .7, .15]);
      }
      const wallRandom = seededRandom(overlook.index + 61211), wallColors = ['#b9b3a1', '#a9aa9f', '#c4bca8', '#9fa39c'];
      for (let s = overlook.center - 17; s < overlook.center + 17; s += 1.2) {
        const p = planted(s, -23.6), height = .62 + wallRandom() * .16, length = 1.12 + wallRandom() * .12;
        walls.push({ p: [p.x, p.y + height / 2 - .12, p.z + this.start], scale: [.62 + wallRandom() * .1, height, length],
          r: [(wallRandom() - .5) * .05, -roadFrame(s).angle + (wallRandom() - .5) * .1, (wallRandom() - .5) * .05], color: wallColors[Math.floor(wallRandom() * wallColors.length)] });
      }
      for (let s = overlook.center - 17; s < overlook.center + 17; s += 8.5) {
        const a = positionAt(s, -23.6), b = positionAt(s + 8.5, -23.6);
        solidSpan(this, { x: a.x, z: a.z + this.start }, { x: b.x, z: b.z + this.start }, .35);
      }
      const viewer = planted(overlook.center - .8, -22.4), turn = -roadFrame(overlook.center).angle;
      rails.push({ p: [viewer.x, viewer.y + .52, viewer.z + this.start], scale: [.13, 1.04, .13], r: [0, turn, 0] },
        { p: [viewer.x - .06, viewer.y + 1.16, viewer.z + this.start], scale: [.34, .26, .52], r: [0, turn, .12] });
      solidPost(this, viewer.x, viewer.z + this.start, .2);
    }
    // Keep this seed sequence stable for beach stones and headland trees.
    const detailRandom = seededRandom(this.index + 45192);
    const grounded = (s, u) => {
      const p = planted(s, u);
      const slope = Math.abs(groundHeight(s, u + 1) - groundHeight(s, u - 1)) / 2;
      return slope < 1.7 ? new THREE.Vector3(p.x, p.y, p.z + this.start) : null;
    };
    for (let patch = 0; patch < 30; patch++) {
      const s = this.start + 5 + detailRandom() * (CHUNK_LENGTH - 10);
      const u = patch < 10 ? coastOffset(s) + 3 + detailRandom() * 6 : 12 + detailRandom() * 110;
      for (let item = 0; item < 9; item++) {
        const t = s + (detailRandom() - .5) * 8, v = u + (detailRandom() - .5) * 6;
        if (!canGrow(t, v) || v < coastOffset(t) + 1 || Math.abs(v) < 9) continue;
        const p = grounded(t, v);
        if (!p) continue;
        const size = .22 + detailRandom() * .65;
        if (item < 5) rocks.push({ p: [p.x, p.y + size * .18, p.z], scale: [size, size * .48, size * .7], r: [0, detailRandom() * 6.28, .15], color: rockColors[patch % rockColors.length] });
        else {
          // Meadow tufts are skipped but still consume their draws so later scenery stays put.
          detailRandom(); detailRandom();
        }
      }
    }
    for (let patch = 0; patch < 9; patch++) {
      const s = this.start + 5 + detailRandom() * (CHUNK_LENGTH - 10);
      const u = coastOffset(s) - 11 - detailRandom() * 2;
      if (ravineAmount(s, u) > .1) continue;
      for (let item = 0; item < 8; item++) {
        const t = s + (detailRandom() - .5) * 6, v = u + (detailRandom() - .5) * 2;
        const p = grounded(t, v);
        if (!p || p.y < .6 || p.y > 3) continue;
        const size = .18 + detailRandom() * .55;
        rocks.push({ p: [p.x, p.y + size * .16, p.z], scale: [size, size * .4, size * .75], r: [0, detailRandom() * 6.28, 0], color: rockColors[item % rockColors.length] });
      }
    }
    for (let i = 0; i < 5; i++) {
      const s = this.start + 8 + detailRandom() * 112;
      const u = lerp(coastOffset(s) + 6, -13, detailRandom());
      if (!canGrow(s, u) || u > -11) continue;
      const p = planted(s, u), size = 6.5 + detailRandom() * 4;
      cypresses.push({ p: [p.x, p.y - .12, p.z + this.start], scale: [size, size, size], r: [0, -.6 + detailRandom() * .5, 0], color: green[i % green.length] });
      solidModel(this, coastalCypress.bark, cypresses.at(-1).p, cypresses.at(-1).r[1], size, true);
    }
    // Find the water's edge on the rendered faces so shore plants and stones meet
    // the bank the water was clipped against, even at a chunk boundary.
    const pond = pondAt(this.start + CHUNK_LENGTH / 2);
    if (Math.abs(pond.center - this.start - CHUNK_LENGTH / 2) < CHUNK_LENGTH / 2 + pond.rs * 1.5) {
      for (let patch = 0; patch < 64; patch++) {
        const angle = patch / 64 * Math.PI * 2;
        const colony = Math.sin(angle * 3 + pond.index * 1.7) + Math.cos(angle * 5 - pond.index) * .4;
        const at = radius => {
          const s = pond.center + Math.cos(angle) * pond.rs * radius;
          const u = pond.u + Math.sin(angle) * pond.ru * radius;
          const p = positionAt(s, u);
          return { ...p, s, u, y: this.sampleGround(p.x, p.z + this.start) };
        };
        let low = .35, high = 1.5, valid = true;
        const inner = at(low), outer = at(high);
        if (inner.y === null || outer.y === null || inner.y >= pond.level || outer.y <= pond.level) continue;
        for (let step = 0; step < 12; step++) {
          const mid = (low + high) / 2, p = at(mid);
          if (p.y === null) { valid = false; break; }
          if (p.y < pond.level) low = mid; else high = mid;
        }
        if (!valid) continue;
        // Seeded per candidate so neighbouring chunks agree when only one can sample it.
        const r = randomAt(pond.index * 67 + patch, 2282);
        const bank = at(high + .035 + r * .045);
        if (bank.s < this.start || bank.s >= this.start + CHUNK_LENGTH || bank.y === null) continue;
        if (colony > .12) {
          for (let plant = 0; plant < 3; plant++) {
            const s = bank.s + (plant - 1) * 1.05, u = bank.u + Math.sin(patch + plant) * .7;
            if (s < this.start || s >= this.start + CHUNK_LENGTH) continue;
            const p = planted(s, u);
            if (this.sampleGround(p.x, p.z + this.start) === null || p.y < pond.level - .15 || p.y > pond.level + 1.65) continue;
            const size = .85 + randomAt(patch * 3 + plant, pond.index + 2283) * .7;
            sedges.push({p: [p.x, p.y - .08, p.z + this.start], scale: [size, size * (1 + r * .35), size],
              r: [0, angle + plant * 2.4, 0], color: patch % 4 ? '#81915e' : '#a2a071'});
          }
        } else if (colony < -.42 && patch % 3 === 0) {
          const p = at(high - .025), size = 1 + r * 1.6;
          if (p.y === null || p.s < this.start || p.s >= this.start + CHUNK_LENGTH) continue;
          rocks.push({p: [p.x, p.y + size * .12, p.z + this.start], scale: [size, size * .48, size * .75],
            r: [.12, angle, -.1], color: rockColors[patch % rockColors.length]});
          const companion = at(high + .07);
          if (companion.y !== null && companion.s >= this.start && companion.s < this.start + CHUNK_LENGTH) {
            rocks.push({p: [companion.x, companion.y, companion.z + this.start], scale: [size * .6, size * .33, size * .55],
              r: [0, angle + .4, .1], color: rockColors[patch % rockColors.length]});
          }
        }
      }
    }
    this.seaStackTop = seaStackTop;
    this.buildBlossoms(canGrow, blooms);
    makeInstances(this.group, trunkGeometry, trunkMaterial, trunks);
    coastalPines.forEach((shape, i) => { const mesh = makeInstances(this.group, shape, pineMaterial, foliage[i]); if (mesh) mesh.name = 'coastal-firs'; });
    makeInstances(this.group, coastalCypress.bark, trunkMaterial, cypresses.map(({ color, ...item }) => item));
    const cypress = makeInstances(this.group, coastalCypress.leaves, pineMaterial, cypresses);
    if (cypress) cypress.name = 'headland-cypresses';
    makeInstances(this.group, coastalMontereyPine.bark, trunkMaterial, monterey.map(({color, ...item}) => item));
    const pines = makeInstances(this.group, coastalMontereyPine.leaves, pineMaterial, monterey);
    if (pines) pines.name = 'monterey-pines';
    const rushes = makeInstances(this.group, coastalSedge, pineMaterial, sedges, false);
    if (rushes) { rushes.name = 'pond-shore-sedges'; rushes.userData.ambientOcclusion = false; }
    coastalCrags.forEach((shape, i) => { const mesh = makeInstances(this.group, shape, cragMaterial, stacks[i]); if (mesh) mesh.name = 'tidal-sea-stacks'; });
    coastalScrub.forEach((shape, i) => { const mesh = makeInstances(this.group, shape, pineMaterial, scrub[i]); if (mesh) mesh.name = 'coastal-scrub'; });
    // Small inland stones read as speckles, so drop them here after generation.
    // Filtering late keeps the seed sequence for later scenery unchanged.
    makeInstances(this.group, rockGeometry, rockMaterial, rocks.filter(rock => rock.scale[0] >= 1 || rock.p[1] < 4));
    makeInstances(this.group, postGeometry, postMaterial, posts);
    makeInstances(this.group, capGeometry, capMaterial, caps);
    const signs = makeInstances(this.group, discoveryAssets.routeShield, discoveryMaterial, shields);
    if (signs) signs.name = 'route-one-shields';
    const rail = makeInstances(this.group, railGeometry, railMaterial, rails);
    if (rail) rail.name = 'coastal-guardrails';
    const seats = makeInstances(this.group, railGeometry, trunkMaterial, benches);
    if (seats) seats.name = 'ocean-overlook-benches';
    const wall = makeInstances(this.group, railGeometry, rockMaterial, walls);
    if (wall) wall.name = 'overlook-stone-wall';
  }
  buildBlossoms(canGrow, extra) {
    // Petals are small flat triangles draped on the rendered faces so they don't
    // float or sink.
    const positions = [], colors = [], random = seededRandom(this.index + 70411);
    const tint = new THREE.Color();
    // Coplanar petals would z-fight, so a coarse grid keeps them from overlapping.
    const placed = new Map(), bin = 1.1;
    const clear = (x, z, reach) => {
      const bx = Math.floor(x / bin), bz = Math.floor(z / bin);
      for (let i = bx - 1; i <= bx + 1; i++) for (let j = bz - 1; j <= bz + 1; j++) {
        for (const other of placed.get(`${i},${j}`) ?? []) if (Math.hypot(other.x - x, other.z - z) < other.reach + reach) return false;
      }
      const key = `${bx},${bz}`;
      if (!placed.has(key)) placed.set(key, []);
      placed.get(key).push({ x, z, reach });
      return true;
    };
    const petal = (x, z, radius, color) => {
      // Petals are much smaller than a terrain face, so use the face's plane.
      const ground = this.sampleGround.plane(x, z + this.start), turn = random() * Math.PI * 2, corners = [];
      const lift = .07 + random() * .03;
      let low = Infinity, high = -Infinity;
      for (let k = 0; k < 3; k++) {
        const angle = turn + k * 2.09 + (random() - .5) * .5, reach = radius * (.75 + random() * .45);
        const px = x + Math.cos(angle) * reach, pz = z + Math.sin(angle) * reach;
        const y = ground ? ground(px, pz + this.start) + lift : 0;
        low = Math.min(low, y); high = Math.max(high, y);
        corners.push({ x: px, y, z: pz });
      }
      if (!ground || high - low > radius * 1.6 || !clear(x, z, radius * 1.2)) return;
      tint.copy(color).multiplyScalar(.9 + random() * .18);
      addTriangle(positions, colors, ...corners, tint, this.start);
    };
    const petalAt = (s, u, radius, color) => { const p = positionAt(s, u); petal(p.x, p.z, radius, color); };
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 4) for (let u = -44; u < 196; u += 4) {
      const cs = s + 2, cu = u + 2;
      if (Math.abs(cu) < 8 || (cu < 0 && cu < coastOffset(cs) + 2)) continue;
      const bloom = wildflowers(cs, cu), total = bloom.poppy + bloom.lupine + bloom.mustard;
      if (total < .06 || !canGrow(cs, cu) || rockCover(cs, cu) > .3) continue;
      // The road's mapping is effectively linear across one 4 m cell.
      const origin = positionAt(s, u), along = positionAt(s + 4, u), across = positionAt(s, u + 4);
      const count = Math.floor(total * 28 + random());
      for (let i = 0; i < count; i++) {
        const pick = random() * total;
        const kind = pick < bloom.poppy ? 'poppy' : pick < bloom.poppy + bloom.lupine ? 'lupine' : 'mustard';
        const colorsOf = PETALS[kind], color = random() < .06 ? PETALS.cream : colorsOf[Math.floor(random() * colorsOf.length)];
        const a = random(), b = random();
        if (u + b * 4 < 0 && u + b * 4 < coastOffset(s + a * 4) + 1.5) continue;
        petal(origin.x + (along.x - origin.x) * a + (across.x - origin.x) * b,
          origin.z + (along.z - origin.z) * a + (across.z - origin.z) * b, .28 + random() * .16, color);
      }
    }
    for (const bloom of extra) petalAt(bloom.s, bloom.u, .22 + random() * .1, bloom.color);
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 1.5) {
      const mat = icePlant(s + .75);
      if (mat < .05 || ravineAmount(s, coastOffset(s)) > .1) continue;
      for (let i = Math.floor(mat * 13 + random()); i > 0; i--) {
        const ps = s + random() * 1.5, pu = coastOffset(ps) - 3.2 + random() * 6.5;
        if (!canGrow(ps, pu)) continue;
        petalAt(ps, pu, .26 + random() * .14, random() < .82 ? PETALS.ice[Math.floor(random() * 3)] : PETALS.iceYellow);
      }
    }
    if (!positions.length) return;
    const blossoms = this.addMesh(geometryFrom(positions, colors), blossomMaterial);
    blossoms.name = 'wildflower-drifts'; blossoms.userData.ambientOcclusion = false;
  }
  dispose() {
    this.group.removeFromParent();
    for (const geometry of this.owned) geometry.dispose();
    this.group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
  }
}

export class CoastalWorld {
  constructor(scene, chunkSource = null) {
    this.scene = scene; this.chunkSource = chunkSource; this.chunks = new Map(); this.origin = 0; this.center = null;
    this.sky = new CoastalSky(scene);
  }
  update(s) {
    const center = Math.floor(s / CHUNK_LENGTH);
    this.origin = Math.floor(s / 1024) * 1024;
    updateResidentChunks(this, center, CoastalChunk);
    positionResidentChunks(this);
    this.sky.follow(roadX(s), roadHeight(s), this.origin - s);
  }
  animate(time) {
    animateWater(time, this.origin);
    for (const chunk of this.chunks.values()) chunk.birds?.update(time);
  }
  dispose() { this.chunkSource?.dispose(); for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear(); this.sky.dispose(); }
}
