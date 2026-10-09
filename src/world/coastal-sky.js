import * as THREE from 'three';
import { coastPalette, COAST_SUN } from './coastal-palette.js';
import { cloudGLSL, CLOUD } from './coastal-clouds.js';
import { waterClock } from './water.js';

const SUN = new THREE.Vector3(...COAST_SUN).normalize();
const color = value => new THREE.Color(value);

// Open water past the chunks, so the driving views look out to a horizon.
// The road never strays more than 57 m from x = 0 and the sea starts beyond
// x = -150 everywhere, so this only ever covers ocean. It sits below the chunk
// sea, which draws over it wherever both exist.
const OPEN_SEA = { near: -150, far: -1350, length: 1350, level: -1 };
function openSeaGeometry() {
  const { near, far, length, level } = OPEN_SEA;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    near, level, -length, far, level, -length, near, level, length,
    far, level, -length, far, level, length, near, level, length,
  ], 3));
  g.setAttribute('shore', new THREE.Float32BufferAttribute(new Array(6).fill(1000), 1));
  g.setAttribute('cove', new THREE.Float32BufferAttribute(new Array(6).fill(0), 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// Sky for the chase and cockpit views. Overhead views never see it, so the
// dome collapses under an orthographic camera.
export class CoastalSky {
  constructor(scene, seaMaterial) {
    this.group = new THREE.Group(); this.group.name = 'coastal-sky'; scene.add(this.group);
    this.domeGeometry = new THREE.SphereGeometry(1000, 32, 16);
    this.domeMaterial = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, toneMapped: false,
      uniforms: { horizon: { value: color(coastPalette.horizon) }, zenith: { value: color(coastPalette.zenith) },
        haze: { value: color(coastPalette.haze) }, bank: { value: color('#eef1ef') }, bankShade: { value: color('#c2cdd2') },
        sun: { value: SUN }, cloudTime: waterClock.time, cloudOrigin: waterClock.origin },
      vertexShader: `varying vec3 vSkyDirection;
        void main() {
          vSkyDirection = position;
          gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
          if (isOrthographic) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        }`,
      fragmentShader: cloudGLSL + `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 haze; uniform vec3 bank; uniform vec3 bankShade;
        uniform vec3 sun; varying vec3 vSkyDirection;
        void main() {
          vec3 direction = normalize(vSkyDirection);
          float elevation = max(0.0, direction.y);
          // Matches the fog colour at the horizon.
          vec3 color = mix(horizon, zenith, pow(smoothstep(0.0, 0.8, elevation), 0.65));
          color = mix(color, haze, smoothstep(0.0, 0.02, elevation) * (1.0 - smoothstep(0.02, 0.12, elevation)) * 0.5);
          float toSun = max(dot(direction, sun), 0.0);
          color += vec3(0.2, 0.15, 0.08) * pow(toSun, 10.0) + vec3(0.35, 0.3, 0.2) * pow(toSun, 120.0);
          color = mix(color, vec3(1.0, 0.98, 0.92), smoothstep(0.9994, 0.9997, toSun));
          // Marine layer: a low fog bank sitting on the sea horizon, west of the road.
          float azimuth = atan(direction.z, direction.x);
          float seaward = smoothstep(0.1, 0.45, -direction.x);
          float top = 0.008 + 0.006 * sin(azimuth * 7.0 + 1.3) + 0.004 * sin(azimuth * 19.0) + 0.003 * sin(azimuth * 43.0 + 2.0);
          float layer = seaward * (1.0 - smoothstep(top, top + 0.004, elevation));
          color = mix(color, mix(bankShade, bank, smoothstep(top - 0.012, top, elevation)), layer * 0.85);
          // The same cumulus that shade the ground, seen from below. Thicker
          // cores go grey underneath and the edges near the sun light up.
          if (direction.y > 0.004) {
            float reach = (${CLOUD.height.toFixed(1)} - cameraPosition.y) / direction.y;
            vec2 point = cameraPosition.xz + direction.xz * reach;
            vec2 q = cloudDrift(vec2(point.x, point.y - cloudOrigin));
            // Seen from below, the small octave only roughens the edges. At
            // full strength it punches holes through the middle of each cloud.
            float body = coastNoise(q / 128.0, 32.0);
            float density = body + (coastNoise(q / 32.0 + vec2(3.7, 1.3), 128.0) - 0.5) * 0.16;
            float cover = smoothstep(0.55, 0.6, density);
            vec3 cloud = mix(vec3(1.0, 0.99, 0.96), vec3(0.74, 0.79, 0.86), smoothstep(0.62, 0.82, body) * 0.7);
            cloud += vec3(0.12, 0.1, 0.06) * pow(toSun, 6.0) * (1.0 - smoothstep(0.57, 0.67, density));
            // Distant clouds sink into the haze above the horizon.
            float far = smoothstep(900.0, 4500.0, reach);
            color = mix(color, mix(cloud, horizon, far * 0.8), cover * (1.0 - far * 0.6));
          }
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }` });
    this.dome = new THREE.Mesh(this.domeGeometry, this.domeMaterial); this.dome.name = 'coastal-sky-dome';
    // Drawn after the opaque scenery at the far plane, so it only shades open sky.
    this.dome.renderOrder = 1000; this.dome.frustumCulled = false; this.dome.userData.ambientOcclusion = false;
    // Fully faded fog is the visible horizon, so match the dome to it.
    this.dome.onBeforeRender = (renderer, scene) => { if (scene.fog) this.domeMaterial.uniforms.horizon.value.copy(scene.fog.color); };
    this.group.add(this.dome);
    this.seaGeometry = openSeaGeometry();
    this.sea = new THREE.Mesh(this.seaGeometry, seaMaterial); this.sea.name = 'open-sea';
    // Last among the opaque meshes, so the chunk sea and land hide it before it shades.
    this.sea.renderOrder = 999; this.sea.frustumCulled = false; this.sea.userData.ambientOcclusion = false;
    this.group.add(this.sea);
  }
  follow(x, y, z) {
    this.group.position.set(x, y, z);
    this.sea.position.set(-x, -y, 0);
  }
  dispose() {
    this.group.removeFromParent();
    this.domeGeometry.dispose(); this.domeMaterial.dispose(); this.seaGeometry.dispose();
  }
}
