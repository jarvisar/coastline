import { joinCoplanarFaces, roofShell } from './surface-joins.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerChunkResources } from './chunk-resources.js';
import { waterClock } from './water.js';

// Small hand-built silhouettes, with the same flat faces and muted palette as
// the coast. Bake colors into shared geometry rather than adding draw calls.
export class Parts {
  constructor() { this.parts = []; }
  add(g, p, color, rotation = [0, 0, 0]) {
    if (g.index) { const flat = g.toNonIndexed(); g.dispose(); g = flat; }
    g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    g.translate(...p);
    const c = new THREE.Color(color), count = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({length: count}, () => [c.r, c.g, c.b]).flat(), 3));
    this.parts.push(g);
  }
  box(p, size, color, rotation) { this.add(new THREE.BoxGeometry(...size), p, color, rotation); }
  cylinder(p, top, bottom, height, color, sides = 8) { this.add(new THREE.CylinderGeometry(top, bottom, height, sides), p, color); }
  ellipsoid(p, size, color, rotation) {
    const g = new THREE.IcosahedronGeometry(1, 1); g.scale(...size); this.add(g, p, color, rotation);
  }
  beam(a, b, width, color) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
    const g = new THREE.CylinderGeometry(width, width, direction.length(), 5);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    this.add(g, from.add(to).multiplyScalar(.5).toArray(), color);
  }
  finish() {
    const g = joinCoplanarFaces(mergeGeometries(this.parts));
    for (const part of this.parts) part.dispose();
    g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
}

function lighthouse() {
  const p = new Parts(), plaster = '#e9e4cf', trim = '#c5c5b6', iron = '#394d50';
  p.cylinder([0, .25, 0], 3.1, 3.3, .5, trim);
  p.cylinder([0, 6.9, 0], 1.9, 2.65, 13.3, plaster);
  p.cylinder([0, 13.45, 0], 2.15, 2.15, .35, trim);
  p.cylinder([0, 13.85, 0], 3.05, 2.8, .4, plaster);
  p.cylinder([0, 15.25, 0], 1.86, 1.86, 2.4, '#7d9d9b');
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, b = (i + 1) / 8 * Math.PI * 2;
    const at = (angle, radius, y) => [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
    p.beam(at(a, 2.8, 14), at(a, 2.8, 15.05), .045, iron);
    p.beam(at(a, 2.8, 15.05), at(b, 2.8, 15.05), .04, iron);
    p.beam(at(a, 1.87, 14.05), at(a, 1.87, 16.55), .055, iron);
  }
  p.cylinder([0, 16.6, 0], 2.05, 2.05, .22, iron);
  p.cylinder([0, 17.32, 0], .2, 2.55, 1.3, '#536765');
  p.cylinder([0, 18.2, 0], .08, .1, .65, iron);
  // Windows sit on the visible facets; a small amber pane suggests the lens.
  for (const height of [4.7, 8.5, 11.3]) {
    const radius = 2.65 - height / 13.3 * .75;
    p.box([-.03, height, radius - .08], [.66, 1.15, .14], trim);
    p.box([-.03, height, radius + .005], [.4, .87, .04], '#344f59');
  }
  p.box([2.59, 1.15, 0], [.12, 2.2, 1.15], '#58716b');
  p.box([-.02, 15.2, 1.74], [.6, .74, .045], '#d5c98f');
  return p.finish();
}
function cottage() {
  const p = new Parts();
  p.box([0, 1.8, 0], [5.3, 3.6, 7.1], '#e3dfc8');
  const eave = 3.6 - (4.77 - 3.6) * .35 / 2.65;
  p.add(roofShell([[-3, eave + .23], [0, 5], [3, eave + .23]], 7.7, .23), [0, 0, 0], '#8b6552');
  for (const side of [-1, 1]) {
    for (const z of [-2.1, 1.5]) {
      p.box([side * 2.67, 2.05, z], [.08, 1.18, 1.1], '#c5cabc');
      p.box([side * 2.72, 2.05, z], [.05, .88, .8], '#577778');
    }
  }
  // Gable infill is a triangular prism along the roof's ridge.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -2.65, 3.6, 3.56, 2.65, 3.6, 3.56, 0, 4.77, 3.56,
    2.65, 3.6, -3.56, -2.65, 3.6, -3.56, 0, 4.77, -3.56,
  ], 3));
  g.computeVertexNormals(); p.add(g, [0, 0, 0], '#e3dfc8');
  p.box([1.2, 4.5, -1.9], [.72, 2.1, .8], '#d0cbb7');
  p.box([1.2, 5.6, -1.9], [.9, .18, .96], '#9c9f94');
  p.box([0, 1.2, 3.59], [1.18, 2.4, .12], '#556d63');
  return p.finish();
}
function boat() {
  const p = new Parts();
  p.ellipsoid([0, .1, 0], [1.05, .42, 2.6], '#b7c8c2');
  p.ellipsoid([0, .37, 0], [.84, .12, 2.14], '#485d5b');
  for (const z of [-1.1, .55]) p.box([0, .51, z], [1.55, .13, .32], '#aa9976');
  p.beam([-.7, .65, -1.5], [.65, .65, 1.5], .055, '#a38f6d');
  return p.finish();
}
function whale() {
  const p = new Parts(), skin = '#49636a';
  p.ellipsoid([0, -.6, 0], [1.7, 1.3, 5.8], skin);
  p.ellipsoid([0, -.24, 5.05], [.63, .7, 2.45], skin, [.28, 0, 0]);
  for (const side of [-1, 1]) {
    p.ellipsoid([side * 1.43, 1.05, 6.8], [1.82, .19, .85], skin, [0, side * -.42, side * .12]);
    p.ellipsoid([side * 1.72, -.38, -1.3], [1.5, .13, .48], '#667c7e', [0, side * .3, side * .15]);
  }
  const fin = new THREE.ConeGeometry(.53, 1.35, 4); fin.scale(.45, 1, 1.4);
  p.add(fin, [0, .88, 1.45], '#3c565e', [-.3, 0, 0]);
  return p.finish();
}

function routeShield() {
  // California's green spade-shaped State Route 1 marker on a steel post,
  // facing traffic along +z. A white border frames the shield and its "1".
  const p = new Parts(), green = '#2f6e4b', white = '#f1f0e8';
  p.box([0, 1.25, 0], [.1, 2.5, .1], '#8e9597');
  const badge = (scale, z, color) => {
    p.box([0, 2.62, z], [.86 * scale, .5 * scale, .04], color);
    const tip = new THREE.CylinderGeometry(.61 * scale, .61 * scale, .04, 4, 1);
    tip.rotateX(Math.PI / 2); tip.scale(1, .62, 1);
    p.add(tip, [0, 2.36, z], color);
  };
  badge(1, .07, white); badge(.86, .1, green);
  p.box([.03, 2.5, .13], [.11, .48, .02], white);
  p.box([-.05, 2.7, .13], [.14, .09, .02], white, [0, 0, .45]);
  return p.finish();
}

export const discoveryAssets = {
  lighthouse: lighthouse(), cottage: cottage(), boat: boat(), whale: whale(), routeShield: routeShield(),
  box: new THREE.BoxGeometry(1, 1, 1),
  foundation: new THREE.CylinderGeometry(1, 1.05, 1, 8),
};
export const discoveryMaterial = new THREE.MeshStandardMaterial({vertexColors: true, flatShading: true, roughness: .95});
export const timberMaterial = new THREE.MeshStandardMaterial({color: '#a49678', flatShading: true, roughness: 1});
export const footingMaterial = new THREE.MeshStandardMaterial({color: '#b7b6a5', flatShading: true, roughness: 1});
export const pathMaterial = new THREE.MeshStandardMaterial({color: '#c4c5b6', roughness: 1, side: THREE.DoubleSide});
function swimmingMaterial(whale = false) {
  const material = discoveryMaterial.clone();
  material.onBeforeCompile = shader => {
    shader.uniforms.coastTime = waterClock.time;
    shader.vertexShader = 'uniform float coastTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      float phase = instanceMatrix[3].x * 0.17 + instanceMatrix[3].z * 0.1;
      transformed.y += ${whale ? 'sin(coastTime * 0.22 + phase) * 0.7' : 'sin(coastTime * 0.85 + phase) * 0.12'};
      transformed.y += transformed.x * sin(coastTime * 0.43 + phase) * 0.04;
      ${whale ? 'transformed.z += sin(coastTime * 0.12 + phase) * 2.5;' : ''}
    `);
  };
  material.customProgramCacheKey = () => `coastal-swimmer-${whale ? 'whale' : 'boat'}-v1`;
  return material;
}
export const boatMaterial = swimmingMaterial(), whaleMaterial = swimmingMaterial(true);
registerChunkResources('coastal-discoveries', {discoveryAssets, discoveryMaterial, timberMaterial, footingMaterial, pathMaterial, boatMaterial, whaleMaterial});
