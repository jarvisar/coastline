import * as THREE from 'three';
import { randomAt, lerp, smoothstep } from './route.js';
import { saltPalette, SALT_SUN } from './salt-palette.js';
import { WATER_LEVEL } from './salt-route.js';
import { cloudGLSL, CLOUD_HEIGHT } from './salt-materials.js';
import { waterClock } from './water.js';

const sun = new THREE.Vector3(...SALT_SUN).normalize();

// Drawn after every opaque object at the far plane, so it only shades pixels
// nothing else covered: open sky, the view down through a pool, and the flat
// past the last chunk. Looking down it follows the ray back to the water
// plane and reflects it, so pools mirror the same clouds that drift overhead,
// with the right parallax in every camera.
function skyMaterial() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      horizon: { value: new THREE.Color(saltPalette.horizon) }, zenith: { value: new THREE.Color(saltPalette.zenith) },
      haze: { value: new THREE.Color(saltPalette.haze) }, cloud: { value: new THREE.Color(saltPalette.cloud) },
      cloudShade: { value: new THREE.Color(saltPalette.cloudShade) }, sunDirection: { value: sun.clone() },
    }]),
    vertexShader: `varying vec3 vSkyWorld;
      void main() {
        vSkyWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
      }`,
    fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 haze; uniform vec3 cloud; uniform vec3 cloudShade; uniform vec3 sunDirection;
      uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
      varying vec3 vSkyWorld;
      ${cloudGLSL}
      vec3 skyColor(vec3 direction, vec3 origin) {
        float elevation = max(direction.y, 0.0);
        vec3 color = mix(horizon, zenith, pow(smoothstep(0.0, 0.9, elevation), 0.72));
        color = mix(color, haze, smoothstep(0.0, 0.025, elevation) * (1.0 - smoothstep(0.025, 0.16, elevation)) * 0.5);
        if (direction.y > 0.002) {
          // Cumulus on one flat layer. Sampling toward the sun lights their tops.
          vec2 at = origin.xz + direction.xz * (${CLOUD_HEIGHT.toFixed(1)} - origin.y) / direction.y;
          float cover = saltCloud(at), lit = saltCloud(at + sunDirection.xz * 26.0);
          vec3 puff = mix(cloudShade, cloud, clamp(0.55 + (cover - lit) * 2.2, 0.0, 1.0));
          color = mix(color, puff, cover * smoothstep(0.015, 0.14, elevation) * 0.96);
        }
        return color + vec3(0.1, 0.085, 0.06) * pow(max(dot(direction, sunDirection), 0.0), 20.0);
      }
      void main() {
        vec3 direction = isOrthographic ? -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) : normalize(vSkyWorld - cameraPosition);
        vec3 color; float fogFactor = 0.0;
        if (direction.y < -0.0005) {
          vec3 water = vSkyWorld + direction * (${WATER_LEVEL.toFixed(2)} - vSkyWorld.y) / direction.y;
          color = skyColor(vec3(direction.x, -direction.y, direction.z), water) * vec3(0.88, 0.92, 0.95);
          fogFactor = smoothstep(fogNear, fogFar, -(viewMatrix * vec4(water, 1.0)).z);
        } else color = skyColor(direction, cameraPosition);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
      }`,
  });
  // Shared clock objects, not copies, so the clouds move with the pools and shadows.
  material.uniforms.saltTime = waterClock.time; material.uniforms.saltOrigin = waterClock.origin;
  return material;
}

// Ranges ringing the flat at a fixed distance, following the car like the sky
// so they never get closer. Only road-level cameras see them. Their feet stand
// on the water plane so a mirrored copy can sit directly beneath.
const RANGES = [
  { distance: 700, depth: 90, low: 3, high: 26, peaks: 6, peak: 34, tint: '#9391b8', salt: 8961 },
  { distance: 820, depth: 120, low: 4, high: 40, peaks: 5, peak: 60, tint: '#9e9dc0', salt: 8971 },
  // Only the far range is tall enough to hold snow.
  { distance: 960, depth: 150, low: 5, high: 52, peaks: 4, peak: 96, tint: '#abadca', salt: 8981, snowline: 118 },
];
const STEPS = 150;
function mountains() {
  const positions = [], colors = [], horizon = new THREE.Color(saltPalette.horizon), snow = new THREE.Color('#f1f3f8');
  const light = new THREE.Vector3(sun.x, sun.y * .6, sun.z).normalize();
  for (const range of RANGES) {
    const peaks = Array.from({ length: range.peaks }, (_, i) => ({ angle: (i + randomAt(i, range.salt)) / range.peaks * Math.PI * 2,
      width: .05 + randomAt(i, range.salt + 1) * .08, height: range.peak * (.55 + randomAt(i, range.salt + 2) * .6) }));
    const ridgeHeight = angle => {
      const massif = smoothstep(-.15, .55, Math.sin(angle * 2 + range.salt) * .7 + Math.sin(angle * 5.3 + range.salt * .3) * .3);
      let height = lerp(range.low, range.high * massif, .5 + .3 * Math.sin(angle * 3 + range.salt) + .2 * Math.sin(angle * 7.3 + range.salt * .7));
      for (const peak of peaks) {
        const d = Math.abs(Math.atan2(Math.sin(angle - peak.angle), Math.cos(angle - peak.angle)));
        height += peak.height * Math.max(0, 1 - d / peak.width) ** 1.3 * (.35 + .65 * massif);
      }
      return height;
    };
    const tint = new THREE.Color(range.tint), shade = tint.clone().multiplyScalar(.74).lerp(new THREE.Color('#6d6f95'), .25);
    const rows = Array.from({ length: STEPS }, (_, j) => {
      const angle = (j + (randomAt(j, range.salt + 3) - .5) * .5) / STEPS * Math.PI * 2, height = ridgeHeight(angle);
      const radius = range.distance + (randomAt(j, range.salt + 4) - .5) * 30;
      const at = (r, y) => new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r);
      // Foot, a broken shoulder, then the crest.
      return [at(radius - range.depth, 0), at(radius - range.depth * (.45 + randomAt(j, range.salt + 5) * .2), height * (.42 + randomAt(j, range.salt + 6) * .2)), at(radius, height)];
    });
    const face = (a, b, c) => {
      const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      if (normal.dot(a) > 0) { [b, c] = [c, b]; normal.negate(); }
      const top = Math.max(a.y, b.y, c.y), middle = (a.y + b.y + c.y) / 3;
      const color = shade.clone().lerp(tint, smoothstep(-.1, .6, normal.dot(light)));
      if (range.snowline && top > range.snowline && middle > top * .74) color.lerp(snow, .82);
      // Feet fade into the haze, far ranges more.
      color.lerp(horizon, .2 + .6 * (1 - smoothstep(0, range.high, middle)) * (range.distance / 960));
      for (const p of [a, b, c]) { positions.push(p.x, p.y, p.z); colors.push(color.r, color.g, color.b); }
    };
    for (let j = 0; j < STEPS; j++) {
      const a = rows[j], b = rows[(j + 1) % STEPS];
      face(a[0], b[0], a[1]); face(b[0], b[1], a[1]);
      face(a[1], b[1], a[2]); face(b[1], b[2], a[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return g;
}

export class SaltSky {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'salt-sky'; scene.add(this.group);
    this.domeGeometry = new THREE.SphereGeometry(1000, 32, 16);
    this.domeMaterial = skyMaterial();
    this.dome = new THREE.Mesh(this.domeGeometry, this.domeMaterial); this.dome.name = 'salt-sky-dome';
    this.dome.renderOrder = 1000; this.dome.frustumCulled = false;
    // Fully faded fog is the visible horizon, so match the dome to it.
    this.dome.onBeforeRender = (renderer, scene) => { if (scene.fog) this.domeMaterial.uniforms.horizon.value.copy(scene.fog.color); };
    this.mountainGeometry = mountains();
    this.mountainMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
    // The mirrored ranges read darker and hazier, as on wet salt.
    this.mirrorMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, color: '#c3cad8' });
    this.mountains = new THREE.Mesh(this.mountainGeometry, this.mountainMaterial); this.mountains.name = 'salt-distant-ranges';
    this.reflection = new THREE.Mesh(this.mountainGeometry, this.mirrorMaterial); this.reflection.name = 'salt-distant-ranges-reflection';
    this.reflection.scale.y = -1;
    for (const mesh of [this.dome, this.mountains, this.reflection]) { mesh.userData.ambientOcclusion = false; this.group.add(mesh); }
  }
  follow(x, z) { this.group.position.set(x, WATER_LEVEL, z); }
  dispose() {
    this.group.removeFromParent();
    for (const resource of [this.domeGeometry, this.domeMaterial, this.mountainGeometry, this.mountainMaterial, this.mirrorMaterial]) resource.dispose();
  }
}
