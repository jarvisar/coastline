import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { randomAt, smoothstep } from './route.js';
import { saltPalette, SALT_SUN } from './salt-palette.js';
import { SALT_LEVEL, WATER_LEVEL } from './salt-route.js';
import { waterClock } from './water.js';

const TILE = 1024;

// A repeating sky of low, broad cumulus banks. The same closed geometry is
// reflected beneath the pools; shaded undersides and bright crowns stay aligned.
function cloudGeometry() {
  const parts = [], sun = new THREE.Vector3(...SALT_SUN).normalize();
  const white = new THREE.Color('#fffdf5'), shade = new THREE.Color('#bdcfdf');
  for (let bank = 0; bank < 12; bank++) {
    const x = (bank % 4 + .2 + randomAt(bank, 8991) * .6) * TILE / 4;
    const z = (Math.floor(bank / 4) + .2 + randomAt(bank, 8992) * .6) * TILE / 3;
    const y = SALT_LEVEL + 110 + randomAt(bank, 8993) * 60;
    const width = 45 + randomAt(bank, 8994) * 37;
    for (let puff = 0; puff < 6; puff++) {
      const r = randomAt(puff, bank * 17 + 8995), crown = puff > 1;
      const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
      const radius = width * (crown ? .27 + r * .22 : .7);
      const px = x + (puff / 5 - .5) * width * 1.9;
      const py = y + (crown ? radius * .35 : 0), pz = z + (randomAt(puff, bank * 17 + 8996) - .5) * width * .4;
      for (let i = 0; i < p.count; i++) {
        // Flatten the underside into a cloud base; upper billows keep their volume.
        p.setXYZ(i, px + p.getX(i) * radius * 1.25, py + Math.max(-.32, p.getY(i)) * radius * (crown ? 1 : .48), pz + p.getZ(i) * radius);
      }
      g.computeVertexNormals();
      const colors = [], normal = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 3) {
        normal.fromBufferAttribute(g.attributes.normal, i);
        const lit = smoothstep(-.45, .85, normal.dot(sun));
        const tint = shade.clone().lerp(white, .4 + lit * .6);
        for (let j = 0; j < 3; j++) colors.push(tint.r, tint.g, tint.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      parts.push(g);
    }
  }
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return geometry;
}

export class SaltClouds {
  constructor(scene) {
    this.geometry = cloudGeometry();
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, transparent: true });
    this.material.onBeforeCompile = shader => {
      shader.uniforms.saltTime = waterClock.time; shader.uniforms.saltOrigin = waterClock.origin;
      shader.vertexShader = 'uniform float saltTime; uniform float saltOrigin; varying float vCloudDistance;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vec4 cloudPosition = instanceMatrix * vec4(transformed, 1.0);
        vec2 drift = vec2(saltTime * 0.65, saltOrigin - saltTime * 0.24);
        cloudPosition.xz += floor((cameraPosition.xz - drift) / ${TILE.toFixed(1)}) * ${TILE.toFixed(1)} + drift;
        vec4 cloudWorld = modelMatrix * cloudPosition;
        vCloudDistance = length(cloudWorld.xz - cameraPosition.xz);
        vec4 mvPosition = viewMatrix * cloudWorld;
        gl_Position = projectionMatrix * mvPosition;
      `);
      shader.fragmentShader = 'varying float vCloudDistance;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.a *= 1.0 - smoothstep(700.0, 1000.0, vCloudDistance);
      `);
    };
    this.material.customProgramCacheKey = () => 'salt-cumulus-v1';
    this.clouds = new THREE.InstancedMesh(this.geometry, this.material, 9);
    this.clouds.name = 'salt-cumulus';
    // Skip the overhead clouds entirely, including in overhead VR. Their
    // reflections still draw, without clouds obscuring the road below the camera.
    this.clouds.onBeforeRender = (renderer, scene, camera) => {
      this.clouds.count = camera.isOrthographicCamera || camera.matrixWorld.elements[13] > SALT_LEVEL + 75 ? 0 : 9;
    };
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) this.clouds.setMatrixAt(index++, matrix.makeTranslation(x * TILE, 0, z * TILE));
    this.reflection = new THREE.InstancedMesh(this.geometry, this.material, 9);
    this.reflection.instanceMatrix.array.set(this.clouds.instanceMatrix.array);
    this.reflection.instanceMatrix.needsUpdate = true;
    this.reflection.name = 'salt-cumulus-reflection';
    this.reflection.position.y = WATER_LEVEL * 2; this.reflection.scale.y = -1;
    for (const mesh of [this.clouds, this.reflection]) {
      mesh.frustumCulled = false; mesh.userData.ambientOcclusion = false;
      // Transparent clouds and their reflections draw before the water tint.
      mesh.renderOrder = -1; scene.add(mesh);
    }
  }
  dispose() {
    for (const mesh of [this.clouds, this.reflection]) { mesh.removeFromParent(); mesh.dispose(); }
    this.geometry.dispose(); this.material.dispose();
  }
}
