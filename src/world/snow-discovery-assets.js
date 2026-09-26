import { joinCoplanarFaces } from './surface-joins.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerChunkResources } from './chunk-resources.js';

const up = new THREE.Vector3(0, 1, 0);

// Parts merge into one draw call. Per-vertex glow lets lit windows share the
// material with everything else.
export class SnowDiscoveryParts {
  constructor() { this.parts = []; }
  add(source, position, color, rotation = null, glow = 0) {
    let geometry = source;
    if (source.index) { geometry = source.toNonIndexed(); source.dispose(); }
    geometry.deleteAttribute('uv'); geometry.deleteAttribute('normal');
    if (rotation?.isQuaternion) geometry.applyQuaternion(rotation);
    else if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    geometry.translate(...(position.isVector3 ? position.toArray() : position));
    const count = geometry.attributes.position.count;
    if (!geometry.attributes.color) {
      const c = new THREE.Color(color), colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    geometry.setAttribute('discoveryGlow', new THREE.BufferAttribute(new Float32Array(count).fill(glow), 1));
    this.parts.push(geometry);
    return geometry;
  }
  box(position, size, color, rotation = null, glow = 0) { return this.add(new THREE.BoxGeometry(...size), position, color, rotation, glow); }
  // Tapered prism from a to b. `radius` is at a, `end` at b.
  beam(a, b, radius, color, sides = 4, end = radius, glow = 0) {
    const direction = b.clone().sub(a), g = new THREE.CylinderGeometry(end, radius, direction.length(), sides);
    return this.add(g, a.clone().add(b).multiplyScalar(.5), color, new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()), glow);
  }
  lump(position, scale, color, rotation = null, glow = 0) {
    const g = new THREE.IcosahedronGeometry(1, 0); g.scale(...scale);
    return this.add(g, position, color, rotation, glow);
  }
  get empty() { return !this.parts.length; }
  finish() {
    const geometry = joinCoplanarFaces(mergeGeometries(this.parts)); this.parts.forEach(part => part.dispose()); this.parts = [];
    geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
  }
}

function glowing(material, key) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float discoveryGlow; varying float vDiscoveryGlow;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDiscoveryGlow = discoveryGlow;');
    shader.fragmentShader = 'varying float vDiscoveryGlow;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vDiscoveryGlow;');
  };
  material.customProgramCacheKey = () => key;
  return material;
}

export const snowDiscoveryMaterial = glowing(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .9 }), 'snow-discovery-v1');

export const CABIN_HANGER_OUT = .9;
function cabin() {
  const parts = new SnowDiscoveryParts(), steel = '#56606c', red = '#b0453b', trim = '#7e2c27';
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  // Carriage sits on the rope at the origin, travelling along +z. The hanger
  // offsets along +x to clear the pylon saddles.
  parts.box([0, -.26, 0], [.46, .36, 2.3], steel);
  for (const z of [-.75, .75]) parts.box([0, -.02, z], [.22, .26, .56], '#3b434d');
  parts.beam(v(0, -.44, 0), v(CABIN_HANGER_OUT, -1.15, 0), .1, steel);
  parts.beam(v(CABIN_HANGER_OUT, -1.15, 0), v(CABIN_HANGER_OUT, -2.3, 0), .1, steel);
  parts.beam(v(CABIN_HANGER_OUT, -2.3, 0), v(0, -2.98, 0), .1, steel);
  parts.box([0, -3.13, 0], [2.5, .3, 3.3], trim);
  parts.box([0, -2.95, 0], [2.24, .1, 3.04], '#dfe8f1');
  parts.box([0, -3.37, 0], [2.36, .18, 3.16], red);
  parts.box([0, -3.93, 0], [2.3, .94, 3.1], '#ffcf8c', null, 2.3);
  for (const x of [-1.14, 1.14]) {
    for (const z of [-1.5, 0, 1.5]) parts.box([x, -3.93, z], [.12, .94, z ? .16 : .1], red);
  }
  for (const z of [-1.54, 1.54]) parts.box([0, -3.93, z], [.2, .94, .1], red);
  parts.box([0, -4.8, 0], [2.4, .8, 3.2], red);
  parts.box([0, -4.52, 0], [2.44, .09, 3.24], '#e6ded0');
  parts.box([0, -5.28, 0], [2.18, .16, 2.96], '#4c2521');
  return parts.finish();
}
export const cableCabinGeometry = cabin();
registerChunkResources('snow-discoveries', { snowDiscoveryMaterial, cableCabinGeometry });
