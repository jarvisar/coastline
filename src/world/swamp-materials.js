import * as THREE from 'three';
import { waterClock } from './water.js';
import { WATER_LEVEL } from './swamp-route.js';
import { randomAt } from './route.js';

// Value noise from a 64 x 64 table of cell values. Hashing with sin() in the
// shader cost water and mist a few dozen transcendentals per pixel on phones.
// One filtered read at the smoothed position blends the four corners the same
// way. Wraps at 64 cells so the pattern survives floating-origin rebases and long drives.
const NOISE_SIZE = 64;
const noiseMap = (() => {
  const cells = new Uint8Array(NOISE_SIZE * NOISE_SIZE).map((_, i) => Math.floor(randomAt(i, 3307, 0) * 256));
  const texture = new THREE.DataTexture(cells, NOISE_SIZE, NOISE_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
})();
const noiseUniform = { value: noiseMap };
const noise = /* glsl */`
  uniform sampler2D swampNoiseMap;
  float swampHash(vec2 p) { return texelFetch(swampNoiseMap, ivec2(mod(floor(p), 64.0)), 0).r; }
  float swampNoise(vec2 p) {
    vec2 cell = mod(floor(p), 64.0), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return texture2D(swampNoiseMap, (cell + f + 0.5) / 64.0).r;
  }
`;

// Lambert shading for everything but the water. At the swamp's night light
// levels it looks the same as physical shading and costs far less per pixel.
export const material = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

// A discovery's lantern baked into its model as emitted light: the diffuse
// light a point light of the same colour, intensity and range gives each face,
// with Three.js's inverse-square falloff. Real point lights cost every lit
// pixel in the swamp, near a discovery or not. `scale` converts model units.
export function bakeLantern(geometry, { position, color, intensity, distance }, scale = 1) {
  const points = geometry.attributes.position, normals = geometry.attributes.normal, colors = geometry.attributes.color;
  const light = new THREE.Color(color).multiplyScalar(intensity / Math.PI), baked = new Float32Array(points.count * 3);
  const toLight = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i < points.count; i++) {
    toLight.set(position.x - points.getX(i), position.y - points.getY(i), position.z - points.getZ(i)).multiplyScalar(scale);
    const d = Math.max(toLight.length(), .1), falloff = Math.max(0, 1 - (d / distance) ** 4) ** 2 / (d * d);
    const lit = Math.max(0, normal.fromBufferAttribute(normals, i).dot(toLight) / d) * falloff;
    baked[i * 3] = colors.getX(i) * light.r * lit; baked[i * 3 + 1] = colors.getY(i) * light.g * lit; baked[i * 3 + 2] = colors.getZ(i) * light.b * lit;
  }
  geometry.setAttribute('lantern', new THREE.Float32BufferAttribute(baked, 3));
  return geometry;
}

// Adds the baked lantern light. Meshes without it, like the chapel drive, read zero.
export function lanternLit(lit) {
  lit.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute vec3 lantern; varying vec3 vLantern;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLantern = lantern;');
    shader.fragmentShader = 'varying vec3 vLantern;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vLantern;');
  };
  lit.customProgramCacheKey = () => 'swamp-lantern-lit-v1';
  lit.defaultAttributeValues = { lantern: [0, 0, 0] };
  return lit;
}

// swampCoord is (s, u, depth). Still water: a slow sheen, rings where fish rise
// and duckweed in the shallows.
export function createWaterMaterial() {
  const water = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .42, metalness: 0,
    transparent: true, opacity: .64, depthWrite: true });
  water.onBeforeCompile = shader => {
    shader.uniforms.swampTime = waterClock.time; shader.uniforms.swampNoiseMap = noiseUniform;
    shader.vertexShader = 'attribute vec3 swampCoord; varying vec3 vSwamp;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSwamp = swampCoord;');
    shader.fragmentShader = 'uniform float swampTime; varying vec3 vSwamp;\n' + noise + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec2 p = vSwamp.xy;
      float broad = swampNoise(p * 0.018 + vec2(swampTime * 0.006, 0.0));
      float fine = swampNoise(p * 0.21 + vec2(-swampTime * 0.07, swampTime * 0.045));
      // One ring per 15 m cell, kept inside the cell so it never clips.
      vec2 cell = floor(p / 15.0), inCell = p - cell * 15.0;
      float seed = swampHash(cell + 17.0), period = 5.0 + seed * 7.0;
      float age = fract(swampTime / period + seed * 3.1);
      vec2 center = vec2(4.0) + vec2(swampHash(cell + 3.0), swampHash(cell + 9.0)) * 7.0;
      float radius = age * 3.2, distance = length(inCell - center);
      float ring = (1.0 - smoothstep(0.025, 0.12, abs(distance - radius))) * sin(age * 3.14159) * (1.0 - age) * step(0.91, swampHash(cell + 29.0));
      diffuseColor.rgb *= 0.94 + broad * 0.1 + fine * 0.035;
      // A faint sky sheen, broken up so the surface doesn't read as flat paint.
      diffuseColor.rgb += vec3(0.016, 0.026, 0.04) * smoothstep(0.25, 0.85, broad * 0.6 + fine * 0.4);
      diffuseColor.rgb += vec3(0.035, 0.055, 0.075) * ring;
      float weed = smoothstep(0.58, 0.74, swampNoise(p * 0.09 + vec2(3.7, 1.3)) * 0.7 + swampNoise(p * 0.5) * 0.3)
        * (1.0 - smoothstep(0.15, 0.85, vSwamp.z));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.095, 0.13, 0.058) * (0.85 + fine * 0.3), weed * 0.7);
      diffuseColor.a = mix(0.9, 0.57, smoothstep(0.05, 1.1, vSwamp.z)) + weed * 0.1;
    `);
  };
  water.customProgramCacheKey = () => 'swamp-water-v3';
  return water;
}

// Trees, camps and landmarks mirrored under the water, drawn dark (or nearly
// full strength for lit windows) through the translucent surface. Meshes carry
// the mirror in their own transform, so instanced reflections reuse the
// original's instance buffers. Near the waterline trunks join their
// reflections exactly. Only the submerged silhouette wavers, with a shared
// world-space phase.
export function createReflectionMaterial(strength) {
  const reflection = new THREE.MeshBasicMaterial({ color: new THREE.Color(strength, strength, strength), vertexColors: true, toneMapped: false });
  reflection.onBeforeCompile = shader => {
    shader.uniforms.swampTime = waterClock.time;
    shader.uniforms.swampOrigin = waterClock.origin;
    shader.vertexShader = 'uniform float swampTime; uniform float swampOrigin; varying float vReflectionDepth;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 reflected = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        reflected = instanceMatrix * reflected;
      #endif
      reflected = modelMatrix * reflected;
      vec3 still = reflected.xyz;
      vReflectionDepth = ${WATER_LEVEL.toFixed(1)} - still.y;
      float distortion = smoothstep(0.0, 5.0, vReflectionDepth);
      // Integer cycles per 4096 m match the water clock's origin wrapping.
      reflected.x += sin((still.z - swampOrigin) * (6.28318530718 * 1173.0 / 4096.0) + still.y * 2.4 + swampTime * 0.8) * 0.16 * distortion;
      reflected.z += sin(still.x * 1.1 + still.y * 3.1 - swampTime * 0.65) * 0.08 * distortion;
      // Anything buried below the waterline mirrors up above it. It's pressed
      // flat just under the surface rather than discarded, since discard stops
      // phone GPUs rejecting hidden pixels early.
      reflected.y = min(reflected.y, ${(WATER_LEVEL - .02).toFixed(2)});
      vec4 mvPosition = viewMatrix * reflected;
      gl_Position = projectionMatrix * mvPosition;
    `);
    shader.fragmentShader = 'varying float vReflectionDepth;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.009, 0.021, 0.034), smoothstep(2.0, 30.0, vReflectionDepth) * 0.72);
    `);
  };
  reflection.customProgramCacheKey = () => 'swamp-reflections-v3';
  return reflection;
}

// mistCoord is (s, u, strength). Wisps drift slowly across the road.
export function createMistMaterial() {
  const mist = new THREE.MeshBasicMaterial({ color: '#8da5b6', transparent: true, opacity: .13, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  mist.onBeforeCompile = shader => {
    shader.uniforms.swampTime = waterClock.time; shader.uniforms.swampNoiseMap = noiseUniform;
    shader.vertexShader = 'attribute vec3 mistCoord; varying vec3 vMist;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMist = mistCoord;');
    shader.fragmentShader = 'uniform float swampTime; varying vec3 vMist;\n' + noise + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // Warped noise gives soft, uneven banks rather than stripes or blobs.
      vec2 p = vMist.xy * vec2(0.032, 0.065) + vec2(swampTime * 0.004, swampTime * 0.009);
      vec2 warp = vec2(swampNoise(p * 1.7 + 3.1), swampNoise(p * 1.7 + 8.3)) - 0.5;
      float bank = swampNoise(p + warp * 1.4), wisp = swampNoise(p * 3.3 + warp * 2.0 - swampTime * 0.006);
      diffuseColor.a *= smoothstep(0.38, 0.8, bank * 0.62 + wisp * 0.38) * vMist.z;
    `);
  };
  mist.customProgramCacheKey = () => 'swamp-mist-v3';
  return mist;
}

// Each firefly is one camera-facing quad. firefly is (centre, seed) and corner
// runs -1..1. Positions and blinking come from the shared clock, so no buffer
// updates. The quad shrinks near a perspective camera.
export function createFireflyMaterial(opacity = 1) {
  const glow = new THREE.MeshBasicMaterial({ color: '#ffc94f', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    fog: false, toneMapped: false, opacity, side: THREE.DoubleSide, forceSinglePass: true });
  glow.onBeforeCompile = shader => {
    shader.uniforms.swampTime = waterClock.time;
    shader.vertexShader = `attribute vec4 firefly; attribute vec2 corner; uniform float swampTime; varying vec2 vCorner; varying float vGlow;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      float seed = firefly.w, t = swampTime;
      vec3 center = firefly.xyz + vec3(sin(t * (0.23 + fract(seed * 7.3) * 0.2) + seed * 5.1) * 1.1,
        sin(t * (0.41 + fract(seed * 3.1) * 0.3) + seed * 2.3) * 0.4,
        cos(t * (0.19 + fract(seed * 5.7) * 0.2) + seed * 3.7) * 1.1);
      vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
      float near = projectionMatrix[3][3] < 0.5 ? clamp(-mvPosition.z / 60.0, 0.12, 1.0) : 1.0;
      mvPosition.xy += corner * (0.75 + fract(seed * 19.1) * 0.45) * near;
      gl_Position = projectionMatrix * mvPosition;
      vCorner = corner;
      float cycle = fract(t / (2.6 + fract(seed * 11.7) * 3.4) + seed);
      vGlow = 0.04 + 0.96 * smoothstep(0.0, 0.08, cycle) * (1.0 - smoothstep(0.12, 0.5, cycle));
      vGlow *= 1.0 - smoothstep(120.0, 290.0, length(mvPosition.xyz)) * float(projectionMatrix[3][3] < 0.5);
    `);
    shader.fragmentShader = 'varying vec2 vCorner; varying float vGlow;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float r2 = dot(vCorner, vCorner);
      float core = exp(-r2 * 44.0), halo = exp(-r2 * 6.0) * 0.3;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.91, 0.51), core);
      diffuseColor.a = opacity * (core + halo) * vGlow * (1.0 - smoothstep(0.7, 1.0, r2));
    `);
  };
  glow.customProgramCacheKey = () => 'swamp-fireflies-v2';
  return glow;
}
