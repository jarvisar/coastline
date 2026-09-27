import * as THREE from 'three';
import { waterClock } from './water.js';
import { WATER_LEVEL } from './swamp-route.js';

// Wraps at 64 cells so the pattern survives floating-origin rebases and long drives.
const noise = /* glsl */`
  float swampHash(vec2 p) { p = mod(p, 64.0); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float swampNoise(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(swampHash(cell), swampHash(cell + vec2(1.0, 0.0)), f.x),
      mix(swampHash(cell + vec2(0.0, 1.0)), swampHash(cell + vec2(1.0)), f.x), f.y);
  }
`;

export const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, ...extra });

// swampCoord is (s, u, depth). Still water: a slow sheen, rings where fish rise
// and duckweed in the shallows.
export function createWaterMaterial() {
  const water = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .42, metalness: 0,
    transparent: true, opacity: .64, depthWrite: true });
  water.onBeforeCompile = shader => {
    shader.uniforms.swampTime = waterClock.time;
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
  water.customProgramCacheKey = () => 'swamp-water-v2';
  return water;
}

export function createReflectionMaterial() {
  const reflection = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  reflection.onBeforeCompile = shader => {
    shader.uniforms.swampTime = waterClock.time;
    shader.uniforms.swampOrigin = waterClock.origin;
    shader.vertexShader = 'uniform float swampTime; uniform float swampOrigin; varying float vReflectionDepth;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vReflectionDepth = ${WATER_LEVEL.toFixed(1)} - (modelMatrix * vec4(position, 1.0)).y;
      float worldZ = (modelMatrix * vec4(position, 1.0)).z - swampOrigin;
      // Near the waterline trunks join their reflections exactly. Only the
      // submerged silhouette wavers, with a shared world-space phase.
      float distortion = smoothstep(0.0, 5.0, vReflectionDepth);
      // Integer cycles per 4096 m match the water clock's origin wrapping.
      transformed.x += sin(worldZ * (6.28318530718 * 1173.0 / 4096.0) + position.y * 2.4 + swampTime * 0.8) * 0.16 * distortion;
      transformed.z += sin(position.x * 1.1 + position.y * 3.1 - swampTime * 0.65) * 0.08 * distortion;
    `);
    shader.fragmentShader = 'varying float vReflectionDepth;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      if (vReflectionDepth < 0.0) discard;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.009, 0.021, 0.034), smoothstep(2.0, 30.0, vReflectionDepth) * 0.72);
    `);
  };
  reflection.customProgramCacheKey = () => 'swamp-reflections-v1';
  return reflection;
}

// mistCoord is (s, u, strength). Wisps drift slowly across the road.
export function createMistMaterial() {
  const mist = new THREE.MeshBasicMaterial({ color: '#8da5b6', transparent: true, opacity: .13, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  mist.onBeforeCompile = shader => {
    shader.uniforms.swampTime = waterClock.time;
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
  mist.customProgramCacheKey = () => 'swamp-mist-v2';
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
