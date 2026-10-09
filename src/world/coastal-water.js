import * as THREE from 'three';
import { declarations, waterClock } from './water.js';
import { COAST_SUN } from './coastal-palette.js';
import { addCloudShadows } from './coastal-clouds.js';

const vec3 = color => { const c = new THREE.Color(color); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
const sun = new THREE.Vector3(...COAST_SUN).normalize();

// Sea colour comes from distance offshore, not from the faces, so the depth
// bands stay smooth across the jittered triangles. `shore` is metres past the
// waterline and `cove` is 1 off sandy beaches and 0 off rocky ones. Noise
// cells repeat every 4096 m along z like the floating origin, so a rebase
// can't make the patterns jump.
export function createOceanMaterial() {
  const material = new THREE.MeshLambertMaterial({ flatShading: true });
  material.onBeforeCompile = shader => {
    shader.uniforms.coastTime = waterClock.time; shader.uniforms.coastOrigin = waterClock.origin;
    shader.uniforms.sunDirection = { value: sun };
    shader.vertexShader = declarations + `
      attribute float shore; attribute float cove;
      varying float vShore; varying float vCove; varying float vSwell;
    ` + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec4 waterWorld = modelMatrix * vec4(position, 1.0);
      vWaterCoord = vec2(waterWorld.x, waterWorld.z - coastOrigin);
      vShore = shore; vCove = cove; vSwell = swell(vWaterCoord);
      // Calmer near the beach so the swell doesn't lift water over the sand.
      transformed.y += vSwell * 0.15 * smoothstep(2.0, 20.0, shore);
    `);
    shader.fragmentShader = declarations + `
      uniform vec3 sunDirection;
      varying float vShore; varying float vCove; varying float vSwell;
    ` + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec2 drift = vec2(-coastTime * 0.21, coastTime * 0.11);
      float warp = 0.0, ripple = 0.0;
      // Past 300 m the sea is one flat colour, so the band edges don't need noise.
      if (vShore < 300.0) {
        warp = coastNoise((vWaterCoord + drift) / 32.0, 128.0) - 0.5;
        ripple = coastNoise((vWaterCoord - drift * 2.0) / 8.0 + vec2(7.3, 1.9), 512.0) - 0.5;
      }
      float offshore = vShore + warp * 16.0 + ripple * 3.0;
      // Clear blues only, from aqua over the sand out to deep water.
      vec3 shallow = mix(${vec3('#3c9cbc')}, ${vec3('#5ec5d8')}, vCove);
      vec3 water = mix(shallow, ${vec3('#2a86b8')}, smoothstep(9.0, 15.0, offshore));
      water = mix(water, ${vec3('#236fae')}, smoothstep(40.0, 52.0, offshore));
      water = mix(water, ${vec3('#1e5a9a')}, smoothstep(120.0, 260.0, offshore));
      // Inlets run inside the shoreline and deepen toward their middle.
      water = mix(water, ${vec3('#2a86b8')}, smoothstep(-6.0, -30.0, offshore) * 0.45);
      // Breakers roll in every 11 m, broken into crests, and fade out to sea.
      // They settle inside inlets, which reach past the shoreline. The branches
      // skip the foam noise over open water, which is most of the sea.
      float surf = (1.0 - smoothstep(6.0, 36.0, offshore)) * smoothstep(-24.0, -4.0, offshore);
      float foam = 0.0;
      if (surf > 0.0) {
        float roll = fract((offshore + ripple * 2.5) / 11.0 + coastTime * 0.17);
        float crest = smoothstep(0.0, 0.05, roll) * (1.0 - smoothstep(0.05, 0.3, roll));
        foam = crest * surf * smoothstep(0.38, 0.62, coastNoise(vec2(vWaterCoord.x / 7.0, vWaterCoord.y / 16.0) + drift * 0.05, 256.0));
      }
      // Lace left behind the crests close in.
      if (offshore > -8.0 && offshore < 9.0) foam = max(foam, smoothstep(0.62, 0.82, coastNoise(vWaterCoord / 2.0 - drift * 0.3, 2048.0))
        * (1.0 - smoothstep(1.0, 9.0, offshore)) * smoothstep(-8.0, -1.0, offshore) * 0.8);
      water = mix(water, ${vec3('#eef6f8')}, foam * 0.9);
      diffuseColor.rgb = water * (0.98 + 0.04 * vSwell);
      // Sparse glitter. In the driving views it gathers along the sun's reflection.
      vec2 sparkCell = floor(vWaterCoord / 2.0);
      float spark = coastHash(sparkCell + vec2(17.0, 0.0), 2048.0);
      vec3 toCamera = isOrthographic ? vec3(0.0) : normalize(cameraPosition - vWorldWaterPosition);
      float sunPath = isOrthographic ? 0.0 : pow(max(dot(reflect(-toCamera, vec3(0.0, 1.0, 0.0)), sunDirection), 0.0), 12.0);
      float twinkle = smoothstep(0.8, 1.0, sin(coastTime * (2.0 + spark * 3.0) + spark * 60.0));
      // Overhead they only twinkle now and then, so they don't read as a fixed pattern.
      float glint = step(mix(0.992, 0.8, sunPath), fract(spark * 7.31)) * twinkle * (isOrthographic ? 0.6 : 1.0)
        * smoothstep(0.22, 0.08, length(fract(vWaterCoord / 2.0) - 0.5)) * (1.0 - surf * 0.7);
    `).replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      totalEmissiveRadiance += ${vec3('#fff6e0')} * glint * 1.6;
    `).replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        // The open sea clears much further than the land in the driving views,
        // fading into the horizon just before the camera's far plane cuts it off.
        float seaHaze = isOrthographic ? smoothstep(fogNear, fogFar, vFogDepth)
          : pow(smoothstep(120.0, 1150.0, vFogDepth), 0.85);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, seaHaze);
      #endif
    `);
    shader.vertexShader = 'varying vec3 vWorldWaterPosition;\n' + shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      vWorldWaterPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `);
    shader.fragmentShader = 'varying vec3 vWorldWaterPosition;\n' + shader.fragmentShader;
    addCloudShadows(shader, true);
  };
  material.customProgramCacheKey = () => 'coast-ocean-v1';
  return material;
}
