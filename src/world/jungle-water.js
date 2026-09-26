import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { waterClock } from './water.js';

// Wraps at 64 units so patterns don't jump when the floating origin rebases.
const noise = /* glsl */`
  float jungleHash(vec2 p) { p = mod(p, 64.0); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float jungleNoise(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(jungleHash(cell), jungleHash(cell + vec2(1.0, 0.0)), f.x),
      mix(jungleHash(cell + vec2(0.0, 1.0)), jungleHash(cell + vec2(1.0)), f.x), f.y);
  }
`;

// riverCoord is (s, across -1..1, turbulence).
export function createRiverMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .38, metalness: .05 });
  material.onBeforeCompile = shader => {
    shader.uniforms.jungleTime = waterClock.time;
    shader.vertexShader = 'attribute vec3 riverCoord; varying vec3 vRiver;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiver = riverCoord;');
    shader.fragmentShader = 'uniform float jungleTime; varying vec3 vRiver;\n' + noise + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float flow = vRiver.x * 0.12 - jungleTime * 0.65;
      float lane = vRiver.y * 7.0;
      float streak = jungleNoise(vec2(flow * 1.3, lane * 1.6)) * 0.65 + jungleNoise(vec2(flow * 2.4 + 7.3, lane * 3.1)) * 0.35;
      float ripple = smoothstep(0.66, 0.83, streak);
      float edge = smoothstep(0.86, 1.0, abs(vRiver.y)) * smoothstep(0.48, 0.76, jungleNoise(vec2(flow * 2.1, lane + 11.0)));
      float churn = vRiver.z * (0.35 + 0.65 * smoothstep(0.3, 0.75, jungleNoise(vec2(vRiver.x * 0.5 - jungleTime * 2.4, lane * 0.75 + 5.0))));
      diffuseColor.rgb *= 0.96 + streak * 0.1;
      float white = clamp(ripple * 0.17 + edge * 0.32 + churn * 0.88, 0.0, 1.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.99, 0.97), white);
    `);
  };
  material.customProgramCacheKey = () => 'jungle-river-v2';
  return material;
}

// foamCoord is (flow, across, feather). Feather fades the sheet at its edges.
export function createFoamMaterial(mist = false) {
  const material = new THREE.MeshBasicMaterial({ color: mist ? '#e4f1ea' : '#f4fcf7', transparent: true, opacity: mist ? .3 : .88,
    depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  material.onBeforeCompile = shader => {
    shader.uniforms.jungleTime = waterClock.time;
    shader.vertexShader = 'attribute vec3 foamCoord; varying vec3 vFoam;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFoam = foamCoord;');
    shader.fragmentShader = 'uniform float jungleTime; varying vec3 vFoam;\n' + noise + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', mist ? `
      #include <color_fragment>
      float drift = jungleNoise(vec2(vFoam.x * 0.35 + jungleTime * 0.08, vFoam.y * 1.2 + jungleTime * 0.03));
      diffuseColor.a *= smoothstep(0.35, 0.75, drift) * vFoam.z;
    ` : `
      #include <color_fragment>
      float streak = jungleNoise(vec2(vFoam.x * 3.0 - jungleTime * 1.6, vFoam.y * 4.5)) * 0.6
        + jungleNoise(vec2(vFoam.x * 7.0 - jungleTime * 2.3 + 4.0, vFoam.y * 9.0 + 2.0)) * 0.4;
      diffuseColor.a *= smoothstep(0.28, 0.62, streak) * vFoam.z;
    `);
  };
  material.customProgramCacheKey = () => `jungle-foam-${mist ? 'mist' : 'sheet'}-v1`;
  return material;
}

// fallCoord is (distance down the fall, across -1..1, foam, seed).
export function createFallMaterial() {
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, side: THREE.DoubleSide, forceSinglePass: true });
  material.onBeforeCompile = shader => {
    shader.uniforms.jungleTime = waterClock.time;
    shader.vertexShader = 'attribute vec4 fallCoord; varying vec4 vFall;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFall = fallCoord;');
    shader.fragmentShader = 'uniform float jungleTime; varying vec4 vFall;\n' + noise + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float side = abs(vFall.y);
      float streak = jungleNoise(vec2(vFall.y * 6.0 + vFall.w, vFall.x * 0.45 - jungleTime * 2.6)) * 0.6
        + jungleNoise(vec2(vFall.y * 15.0 + vFall.w * 1.7, vFall.x * 1.1 - jungleTime * 3.8)) * 0.4;
      float white = max(smoothstep(0.4, 0.7, streak), vFall.z * (0.6 + 0.4 * streak));
      float strands = smoothstep(0.2, 0.36, jungleNoise(vec2(vFall.y * 2.2 + vFall.w * 3.1, vFall.x * 0.05 + vFall.w)));
      float fray = 1.0 - smoothstep(0.72, 1.0, side) * (0.55 + 0.45 * streak);
      vec3 water = mix(vec3(0.3, 0.68, 0.64), vec3(0.94, 0.99, 0.97), white);
      diffuseColor.rgb = water * (0.82 + 0.18 * (1.0 - side * side));
      diffuseColor.a = clamp(fray * mix(0.5, 1.0, max(strands, vFall.z)) * (0.8 + 0.2 * white), 0.0, 1.0);
    `);
  };
  material.customProgramCacheKey = () => 'jungle-fall-v2';
  return material;
}

export const riverMaterial = createRiverMaterial();
export const fallMaterial = createFallMaterial();
export const foamMaterial = createFoamMaterial();
export const mistMaterial = createFoamMaterial(true);
export const valleyMistMaterial = createFoamMaterial(true);
valleyMistMaterial.opacity = .5;
registerChunkResources('jungle-water', { riverMaterial, fallMaterial, foamMaterial, mistMaterial, valleyMistMaterial });
