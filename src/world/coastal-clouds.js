import * as THREE from 'three';
import { waterClock } from './water.js';
import { COAST_SUN } from './coastal-palette.js';

// Fair-weather cumulus drifting in off the sea. Lit scenery darkens under them
// and the driving views see the same clouds overhead, so the shadows always
// match something in the sky.
export const CLOUD = { height: 260, shade: .35 };
const sun = new THREE.Vector3(...COAST_SUN).normalize();

// Shared by the scenery shaders, the sea and the sky dome. `period` wraps the
// z cells so patterns repeat every 4096 m like the floating origin: pass
// 4096 over the cell size. The hash avoids sin(), which is slow on phone GPUs.
export const cloudGLSL = /* glsl */`
  uniform float cloudTime;
  uniform float cloudOrigin;
  float coastHash(vec2 cell, float period) {
    cell.y = mod(cell.y, period);
    vec3 p = fract(vec3(cell.xyx) * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float coastNoise(vec2 p, float period) {
    vec2 cell = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(coastHash(cell, period), coastHash(cell + vec2(1.0, 0.0), period), f.x),
      mix(coastHash(cell + vec2(0.0, 1.0), period), coastHash(cell + vec2(1.0), period), f.x), f.y);
  }
  // p is world x and origin-wrapped z on the cloud layer. Clouds blow in off
  // the sea at about 3 m/s.
  vec2 cloudDrift(vec2 p) { return p + vec2(cloudTime * 3.0, -cloudTime * 1.2); }
  float cloudDensity(vec2 q) {
    return coastNoise(q / 128.0, 32.0) * 0.66 + coastNoise(q / 32.0 + vec2(3.7, 1.3), 128.0) * 0.34;
  }
  // 0 in clear sky, 1 under a cloud.
  float cloudCover(vec2 p) { return smoothstep(0.53, 0.64, cloudDensity(cloudDrift(p))); }
  // Follows the sun's ray from a point up to the cloud layer.
  float cloudShadow(vec3 world) {
    vec2 layer = world.xz + vec2(${(sun.x / sun.y).toFixed(4)}, ${(sun.z / sun.y).toFixed(4)}) * (${CLOUD.height.toFixed(1)} - world.y);
    return cloudCover(vec2(layer.x, layer.y - cloudOrigin));
  }
`;

const lightsChunk = () => THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  `getDirectionalLightInfo( directionalLight, directLight );
  directLight.color *= 1.0 - vCloudShadow * ${CLOUD.shade.toFixed(2)};`);

// Adds cloud shadows to a lit material's shader. They're sampled per vertex,
// since the shadows are far larger than most faces. The sea's big flat faces
// would show their edges, so `perPixel` samples it per pixel instead.
export function addCloudShadows(shader, perPixel = false) {
  shader.uniforms.cloudTime = waterClock.time; shader.uniforms.cloudOrigin = waterClock.origin;
  const varying = perPixel ? 'varying vec3 vCloudPoint;\n' : 'varying float vCloudShadow;\n';
  shader.vertexShader = cloudGLSL + varying + shader.vertexShader.replace('#include <project_vertex>', `
    #include <project_vertex>
    vec4 cloudPoint = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      cloudPoint = instanceMatrix * cloudPoint;
    #endif
    ${perPixel ? 'vCloudPoint = (modelMatrix * cloudPoint).xyz;' : 'vCloudShadow = cloudShadow((modelMatrix * cloudPoint).xyz);'}
  `);
  shader.fragmentShader = (perPixel ? cloudGLSL : '') + varying + shader.fragmentShader.replace('#include <lights_fragment_begin>',
    (perPixel ? 'float vCloudShadow = cloudShadow(vCloudPoint);\n' : '') + lightsChunk());
}

// For materials with no shader hook of their own.
export function cloudShaded(material, key) {
  material.onBeforeCompile = shader => addCloudShadows(shader);
  material.customProgramCacheKey = () => `coast-clouds-${key}`;
  return material;
}
