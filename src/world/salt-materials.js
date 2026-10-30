import * as THREE from 'three';
import { waterClock } from './water.js';
import { saltPalette, SALT_SUN, SALT_LIGHT } from './salt-palette.js';
import { SALT_LEVEL, WATER_LEVEL } from './salt-route.js';

export const CLOUD_HEIGHT = SALT_LEVEL + 240;
const sun = new THREE.Vector3(...SALT_SUN).normalize();
// GLSL literal for a vector or a (linear) colour.
const vec3 = v => `vec3(${(v.isColor ? [v.r, v.g, v.b] : [v.x, v.y, v.z]).map(n => n.toFixed(4)).join(', ')})`;

// Broad atmospheric shade and small surface breezes share the cloud clock.
// The field wraps every 4096 m so floating-origin rebases don't move it.
export const cloudGLSL = /* glsl */`
  uniform float saltTime;
  uniform float saltOrigin;
  // Lattice wraps every 16 cells. Callers scale world metres by 1 / 2^n so the
  // pattern repeats on the 4096 m origin wrap.
  float saltHash(vec2 p) {
    p = mod(p, 16.0);
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float saltValue(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(saltHash(cell), saltHash(cell + vec2(1.0, 0.0)), f.x),
      mix(saltHash(cell + vec2(0.0, 1.0)), saltHash(cell + vec2(1.0)), f.x), f.y);
  }
  // Cover over world x/z, 0 for clear sky and 1 inside a cloud.
  float saltCloud(vec2 world) {
    vec2 p = vec2(world.x, world.y - saltOrigin) / 256.0 + vec2(saltTime * 0.008, -saltTime * 0.0035);
    // Rounded billows: the broad layer sets where clouds sit, finer ones puff their edges.
    float n = saltValue(p) * 0.6 + saltValue(p * 2.0 + vec2(5.0, 11.0)) * 0.26 + saltValue(p * 4.0 + vec2(17.0, 3.0)) * 0.14;
    return smoothstep(0.6, 0.7, n);
  }
  // Direct sunlight left after the cloud above a point.
  float saltCloudShadow(vec3 world) {
    vec3 toSun = ${vec3(sun)};
    vec2 above = world.xz + toSun.xz * (${CLOUD_HEIGHT.toFixed(1)} - world.y) / toSun.y;
    return 1.0 - 0.1 * saltCloud(above);
  }
`;
function clockUniforms(shader) {
  shader.uniforms.saltTime = waterClock.time; shader.uniforms.saltOrigin = waterClock.origin;
}
const worldVarying = name => `
  vec4 ${name}Position = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    ${name}Position = instanceMatrix * ${name}Position;
  #endif
  ${name} = (modelMatrix * ${name}Position).xyz;
`;

// Clouds dim only the direct sun, so shadowed faces stay the same.
function cloudShaded(material, key, compile = null) {
  material.onBeforeCompile = shader => {
    clockUniforms(shader);
    shader.vertexShader = 'varying vec3 vSaltWorld;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      ${worldVarying('vSaltWorld')}`);
    shader.fragmentShader = cloudGLSL + 'varying vec3 vSaltWorld;\n' + shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      float saltShade = saltCloudShadow(vSaltWorld);
      reflectedLight.directDiffuse *= saltShade;
      reflectedLight.directSpecular *= saltShade;`);
    compile?.(shader);
  };
  material.customProgramCacheKey = () => key;
  return material;
}
const standard = (options, key) => cloudShaded(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, ...options }), key);
// Matte scenery uses Lambert shading. It looks the same as physical shading on
// rough surfaces and costs much less per pixel. Roads keep physical shading for
// their faint sheen, as do water and metal.
const matte = (options, key) => cloudShaded(new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, ...options }), key);

// Crust, causeway and far field share one faceted batch.
export const crustMaterial = matte({ vertexColors: true }, 'salt-crust-v1');
// Asphalt, gravel and paint in one vertex-coloured ribbon batch.
export const roadMaterial = standard({ vertexColors: true, roughness: .93, flatShading: false }, 'salt-road-v1');
export const rockMaterial = matte({ vertexColors: true }, 'salt-rock-v1');
export const plantMaterial = matte({ vertexColors: true, side: THREE.DoubleSide }, 'salt-plant-v1');
export const pileMaterial = matte({ vertexColors: true }, 'salt-pile-v1');
// Landmarks. Instance colours repaint the lodge's roof, door and shutters.
export const discoveryMaterial = matte({ vertexColors: true }, 'salt-discovery-v1');
export const birdMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export const postMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .8 });

// Transparent film over the mirror beneath each pool: pale where it runs over
// the salt rim, deeper over open water, thinner at grazing angles so road-level
// views see more reflection. Brine shifts between cobalt, turquoise and milky
// aqua across the flat, and rose stretches colour some pools with algae.
export const poolMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false });
poolMaterial.onBeforeCompile = shader => {
  clockUniforms(shader);
  shader.vertexShader = 'attribute float poolDepth; attribute float poolRose; varying float vPoolDepth; varying float vPoolRose; varying vec3 vPoolWorld;\n'
    + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
    vPoolDepth = poolDepth; vPoolRose = poolRose;
    ${worldVarying('vPoolWorld')}`);
  shader.fragmentShader = cloudGLSL + 'varying float vPoolDepth; varying float vPoolRose; varying vec3 vPoolWorld;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    vec3 toEye = isOrthographic ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) : normalize(cameraPosition - vPoolWorld);
    float grazing = pow(1.0 - clamp(abs(toEye.y), 0.0, 1.0), 4.0);
    // Cat's-paws of wind drifting across the surface.
    vec2 p = vec2(vPoolWorld.x, vPoolWorld.z - saltOrigin);
    float band = saltValue(p * 0.0625 + vec2(saltTime * 0.05, saltTime * 0.02));
    float breeze = smoothstep(0.6, 0.85, saltValue(p * 0.125 - vec2(saltTime * 0.08, saltTime * 0.03)));
    float tone = saltValue(p * 0.0078125 + vec2(3.0, 7.0));
    float cobalt = smoothstep(0.42, 0.24, tone), milky = smoothstep(0.58, 0.76, tone);
    // Broad patches with crisp edges. Toward the end of a rose stretch the
    // patches thin out rather than fading.
    float rose = smoothstep(0.0, 0.06, saltValue(p * 0.00390625 + vec2(11.0, 5.0)) + vPoolRose * 0.62 - 0.97);
    vec3 shallow = mix(mix(mix(vec3(0.62, 0.83, 0.84), vec3(0.58, 0.79, 0.88), cobalt), vec3(0.76, 0.89, 0.9), milky), vec3(0.99, 0.85, 0.77), rose);
    vec3 deep = mix(mix(mix(vec3(0.12, 0.5, 0.6), vec3(0.09, 0.37, 0.62), cobalt), vec3(0.36, 0.66, 0.76), milky), vec3(0.94, 0.56, 0.52), rose);
    // Shallow only along the outer rim, so reflections near a shore stay clear.
    float depth = smoothstep(0.0, 0.32, vPoolDepth);
    diffuseColor.rgb = mix(shallow, deep, depth) * (0.94 + 0.08 * band) + breeze * 0.025;
    // Milky and algal brine is more opaque.
    float body = max(milky * 0.5, rose);
    diffuseColor.a = mix(mix(0.76, 0.46, depth), mix(0.88, 0.8, depth), body) * mix(1.0, 0.3, grazing) + breeze * 0.035;
  `);
};
poolMaterial.customProgramCacheKey = () => 'salt-pool-film-v3';

// Reflections are geometry flipped under the water plane. They're lit with
// the un-mirrored face normal against the scene's sun and sky, so each face
// shows the shade its real counterpart has, then dimmed a little by the water.
// Instanced mirrors flip winding inside the instance matrix, which Three.js
// can't see, so they draw back faces. Plain meshes get the flip handled.
function mirrorMaterial(side, key) {
  // Not tone mapped, like the sky they're reflected against, so exposure can't wash them out.
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, side, toneMapped: false });
  const skyLight = new THREE.Color(saltPalette.skyLight), groundLight = new THREE.Color(saltPalette.groundLight), sunLight = new THREE.Color(saltPalette.sun);
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vMirrorWorld;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      ${worldVarying('vMirrorWorld')}`);
    shader.fragmentShader = 'varying vec3 vMirrorWorld;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      // Anything buried below the waterline flips up above it. A reflection
      // can't show there, and it would poke through the real thing.
      if (vMirrorWorld.y > ${WATER_LEVEL.toFixed(2)}) discard;
      vec3 facet = normalize(cross(dFdx(vMirrorWorld), dFdy(vMirrorWorld)));
      vec3 toEye = isOrthographic ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) : normalize(cameraPosition - vMirrorWorld);
      if (dot(facet, toEye) < 0.0) facet = -facet;
      vec3 real = vec3(facet.x, -facet.y, facet.z);
      vec3 hemisphere = mix(${vec3(groundLight)}, ${vec3(skyLight)}, real.y * 0.5 + 0.5) * ${SALT_LIGHT.sky.toFixed(2)};
      vec3 direct = ${vec3(sunLight)} * max(dot(real, ${vec3(sun)}), 0.0) * ${SALT_LIGHT.sun.toFixed(2)};
      // Fade the deepest parts of a reflection, as the rim of the pool would.
      float below = clamp((${WATER_LEVEL.toFixed(2)} - vMirrorWorld.y) / 9.0, 0.0, 1.0);
      diffuseColor.rgb *= (hemisphere + direct) * 0.3183 * mix(0.52, 0.4, below);
    `);
  };
  material.customProgramCacheKey = () => key;
  return material;
}
export const mirrorInstanceMaterial = mirrorMaterial(THREE.BackSide, 'salt-mirror-instanced-v2');
export const mirrorMeshMaterial = mirrorMaterial(THREE.FrontSide, 'salt-mirror-mesh-v2');

// Reflection about the water plane, for building mirrored instance matrices.
export const WATER_MIRROR = new THREE.Matrix4().makeScale(1, -1, 1).setPosition(0, WATER_LEVEL * 2, 0);
