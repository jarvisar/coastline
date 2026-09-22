import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { CHUNK_LENGTH, randomAt, positionAt, roadFrame, shorelineOffset } from './route.js';
import { waterClock } from './water.js';
import { Parts } from './coastal-discovery-assets.js';

// A few sloops stand off the coast, placed from world-space seeds so
// neighbouring chunks agree.

// A small cruising sloop, about 9 m overall, bow toward +z. The hull is lofted
// through a few stations, so it has a real sheer, a fine bow and a transom,
// with dark bottom paint showing below a boot stripe. Sails carry a slight
// belly to leeward (+x); the boats heel the same way.
const HULL = [
  // z, half-beam, sheer height, keel depth
  [4.7, 0, 1.05, .2], [3.5, .78, .92, -.28], [1.6, 1.24, .82, -.5], [-.6, 1.34, .78, -.56], [-2.8, 1.2, .8, -.46], [-4.1, .98, .86, -.2],
];
function sloop({ topsides, bottom, stripe, deck, sailColor, jibColor }) {
  const p = new Parts();
  const faces = new Map();
  const face = (color, ...points) => { if (!faces.has(color)) faces.set(color, []); faces.get(color).push(...points.flat()); };
  // Each station's outline: sheer, chine (at the boot stripe) and keel, both sides.
  const outline = ([z, b, top, keel]) => ({
    sheer: side => [side * b * 1.04, top, z], chine: side => [side * b * .9, .18, z], waterline: side => [side * b * .66, -.04, z], keel: [0, keel, z],
  });
  for (let i = 0; i < HULL.length - 1; i++) {
    const a = outline(HULL[i]), c = outline(HULL[i + 1]);
    for (const side of [-1, 1]) {
      face(topsides, a.sheer(side), c.sheer(side), a.chine(side), c.sheer(side), c.chine(side), a.chine(side));
      face(stripe, a.chine(side), c.chine(side), a.waterline(side), c.chine(side), c.waterline(side), a.waterline(side));
      face(bottom, a.waterline(side), c.waterline(side), a.keel, c.waterline(side), c.keel, a.keel);
    }
    // A pale deck between the sheers keeps the boat bright from above.
    face(deck, a.sheer(-1), c.sheer(-1), a.sheer(1), c.sheer(-1), c.sheer(1), a.sheer(1));
  }
  // The transom closes the stern.
  const stern = outline(HULL.at(-1));
  face(topsides, stern.sheer(-1), stern.sheer(1), stern.chine(1), stern.sheer(-1), stern.chine(1), stern.chine(-1));
  face(stripe, stern.chine(-1), stern.chine(1), stern.waterline(1), stern.chine(-1), stern.waterline(1), stern.waterline(-1));
  face(bottom, stern.waterline(-1), stern.waterline(1), stern.keel);
  for (const [color, vertices] of faces) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    g.computeVertexNormals(); p.add(g, [0, 0, 0], color);
  }
  // A trunk cabin with a band of windows, a cockpit coaming and a tiller.
  p.box([0, 1.04, -.2], [1.5, .46, 2.6], topsides);
  p.box([0, 1.08, -.2], [1.53, .14, 2.2], '#324653');
  p.box([0, 1.3, -.1], [1.2, .08, 2.3], deck);
  p.box([0, .98, -2.6], [1.7, .22, 1.9], '#b89a6c');
  p.beam([0, 1.05, -3.3], [0, 1.2, -2.5], .04, '#6f5a43');
  // Stainless pulpit at the bow and lifeline stanchions.
  p.beam([-.34, 1.32, 3.9], [.34, 1.32, 3.9], .025, '#d8dcdc');
  for (const z of [2.6, .8, -1.2, -3]) for (const side of [-1, 1]) {
    const beam = HULL.reduce((best, station) => Math.abs(station[0] - z) < Math.abs(best[0] - z) ? station : best)[1];
    p.beam([side * beam * .92, .85, z], [side * beam * .92, 1.4, z], .022, '#d8dcdc');
  }
  // Mast, spreaders and boom.
  p.cylinder([0, 6.4, .7], .055, .09, 11.4, '#d9d6cd', 6);
  p.beam([-.75, 7.6, .7], [.75, 7.6, .7], .035, '#d9d6cd');
  p.beam([0, 1.72, .6], [0, 1.8, -3.5], .07, '#d9d6cd');
  p.beam([0, 11.9, .7], [0, 1.05, 4.5], .015, '#8f9496');
  // Sails with a little belly: each panel is split so its middle stands off
  // the straight line between its corners.
  const sail = (tack, head, clew, belly, color) => {
    const mid = (a, b, k) => a.map((v, j) => v + (b[j] - v) * .5 + (j === 0 ? k : 0));
    const luff = mid(tack, head, 0), foot = mid(tack, clew, belly * .7), leech = mid(head, clew, belly);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([tack, luff, foot, luff, head, leech, foot, leech, clew, luff, leech, foot].flat(), 3));
    g.computeVertexNormals(); p.add(g, [0, 0, 0], color);
  };
  sail([.02, 1.85, .55], [.02, 11.7, .6], [.02, 1.95, -3.45], .42, sailColor);
  sail([0, 1.2, 4.35], [0, 10.4, .8], [.05, 1.7, .1], .36, jibColor);
  // Wake and bow wave lie flat, just clear of the swell.
  const foam = (...points) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    g.computeVertexNormals(); p.add(g, [0, 0, 0], '#d5eceb');
  };
  // Short, broad wedges of wash: a stern wake and a curl at the bow.
  for (const side of [-1, 1]) {
    foam([side * .8, .3, -3.9], [side * 2.5, .3, -8], [side * 1.3, .3, -8.4]);
    foam([side * .45, .3, 4.2], [side * 1.5, .3, 2.6], [side * 1.05, .3, 1.9]);
  }
  foam([-.8, .3, -4.2], [.8, .3, -4.2], [0, .3, -7]);
  return p.finish();
}

const sloopGeometries = [
  sloop({ topsides: '#f3f1ea', bottom: '#2d4a66', stripe: '#b8483c', deck: '#e4ded0', sailColor: '#f8f5ec', jibColor: '#f1ebdc' }),
  sloop({ topsides: '#2f4a63', bottom: '#8d3b35', stripe: '#f1efe6', deck: '#ddd6c6', sailColor: '#e8d9b5', jibColor: '#d9c197' }),
];
const sloopMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .9, side: THREE.DoubleSide });
sloopMaterial.onBeforeCompile = shader => {
  shader.uniforms.coastTime = waterClock.time;
  shader.vertexShader = 'uniform float coastTime;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
    #include <begin_vertex>
    // Each boat pitches, rolls and heels on its own phase, and eases a few
    // metres back and forth on its mooring-slow course.
    float phase = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
    float roll = sin(coastTime * 0.61 + phase) * 0.05;
    transformed.y += sin(coastTime * 0.83 + phase) * 0.14 + transformed.x * roll - transformed.z * sin(coastTime * 0.47 + phase) * 0.012;
    transformed.x -= transformed.y * roll;
    transformed.z += sin(coastTime * 0.021 + phase) * 5.0;
  `);
};
sloopMaterial.customProgramCacheKey = () => 'coastal-sloop-v2';
registerChunkResources('coastal-sea', { sloopGeometries, sloopMaterial });

const transform = new THREE.Object3D();
function instances(chunk, geometry, material, items, name, shadows) {
  if (!items.length) return;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  items.forEach((item, i) => {
    transform.position.set(...item.p); transform.rotation.set(...item.r); transform.scale.set(...item.scale);
    transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
  });
  mesh.name = name; mesh.castShadow = shadows; mesh.receiveShadow = true;
  mesh.computeBoundingSphere(); chunk.group.add(mesh);
  return mesh;
}
const clearOfSites = (chunk, s, u, margin) => chunk.discoveries.every(site => Math.hypot(s - site.s, u - site.u) > site.radius + margin);

function buildSloops(chunk) {
  const boats = [[], []];
  for (let i = 0; i < 2; i++) {
    const seed = chunk.index * 2 + i;
    if (randomAt(seed, 3321) > .17) continue;
    const s = chunk.start + 16 + randomAt(seed, 3322) * (CHUNK_LENGTH - 32);
    const u = shorelineOffset(s) - 95 - randomAt(seed, 3323) * 150;
    if (!clearOfSites(chunk, s, u, 30)) continue;
    const p = positionAt(s, u, .05), heading = -roadFrame(s).angle + (randomAt(seed, 3324) > .5 ? 0 : Math.PI) + (randomAt(seed, 3325) - .5) * .6;
    const size = .85 + randomAt(seed, 3326) * .3;
    // Heeled to leeward, the side the sails belly toward.
    boats[randomAt(seed, 3327) > .6 ? 1 : 0].push({ p: [p.x, p.y, p.z + chunk.start], r: [0, heading, -.12], scale: [size, size, size] });
  }
  sloopGeometries.forEach((geometry, i) => {
    const mesh = instances(chunk, geometry, sloopMaterial, boats[i], 'offshore-sloops', true);
    if (mesh) { mesh.boundingSphere.radius += 8; mesh.userData.ambientOcclusion = false; }
  });
}

export function buildCoastalSea(chunk) {
  buildSloops(chunk);
}
