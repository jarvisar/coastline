import * as THREE from 'three';

export const volcanicClock = { value: 0 };
// `heat` is a vertex's height in metres above the molten surface that lights it
// (COLD where nothing does). Height interpolates exactly across a flat facet, so
// the glow gathers at the foot of a cliff drawn with one vertex top and bottom.
export const COLD = 100;
export const basaltMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
basaltMaterial.onBeforeCompile = shader => {
  shader.uniforms.volcanicTime = volcanicClock;
  shader.vertexShader = 'attribute float heat; varying float vHeat;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = heat;');
  shader.fragmentShader = 'uniform float volcanicTime; varying float vHeat;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    float glow = 1.0 - clamp(vHeat / 13.0, 0.0, 1.0);
    glow *= glow;
    float pulse = .97 + .025 * sin(volcanicTime * .65) + .015 * sin(volcanicTime * 1.13);
    totalEmissiveRadiance += mix(vec3(.2, .009, .0005), vec3(.85, .078, .001), glow) * glow * pulse;
  `);
};
basaltMaterial.customProgramCacheKey = () => 'volcanic-basalt-v9';

// Lava reuses the `heat` slot as a per-facet phase, so the mosaic shimmers
// facet by facet under one slow travelling swell. The depth offset keeps thin
// veins laid over coarse terrain facets from sinking into them.
// Positive `flow` marks ground-bound lava, negative marks a falling sheet.
export const lavaMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
lavaMaterial.onBeforeCompile = shader => {
  shader.uniforms.volcanicTime = volcanicClock;
  shader.vertexShader = 'uniform float volcanicTime; attribute float heat; attribute float flow; varying float vLavaPulse; varying float vSurfaceFlow; varying vec3 vFlowPosition;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vLavaPulse = .97 + .025 * sin(position.x * .22 + position.z * .17 + volcanicTime * .35) + .02 * sin(heat * 6.2832 + volcanicTime * (.25 + heat * .35));
    vSurfaceFlow = abs(flow);
    vFlowPosition = position;
  `);
  shader.fragmentShader = 'uniform float volcanicTime; varying float vLavaPulse; varying float vSurfaceFlow; varying vec3 vFlowPosition;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    // Moving hot folds follow decreasing elevation over the rock steps.
    float fold = sin(vFlowPosition.y * 2.6 + volcanicTime * 1.15 + .35 * sin(vFlowPosition.x * .7));
    diffuseColor.rgb *= vLavaPulse * (1.0 + vSurfaceFlow * fold * .065);
  `);
};
lavaMaterial.customProgramCacheKey = () => 'volcanic-lava-v6';

// Light spilling from molten rock onto whatever lies beside it: vertex colours
// fade to black at the outer edge, so adding them leaves no visible border.
// Additive light must fade out in fog instead of blending toward its colour.
export const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
glowMaterial.onBeforeCompile = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
    #ifdef USE_FOG
      gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  `);
};
glowMaterial.customProgramCacheKey = () => 'volcanic-glow-v1';

// Geometry carries the chimney's anchor, phase and scale. Expanding puffs rise
// in the shader so worker-transferred chunks share one clock and no CPU updates.
// A puff is a unit sphere, so its position doubles as a smooth normal and the
// silhouette fades out softly rather than facet by facet.
export const smokeMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: .52 });
smokeMaterial.onBeforeCompile = shader => {
  shader.uniforms.volcanicTime = volcanicClock;
  shader.vertexShader = 'uniform float volcanicTime; attribute vec3 smokeAnchor; attribute vec2 smokeCycle; varying float vSmokeAge; varying float vSmokeEdge; varying vec3 vSmokeShape;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
    float age = fract(smokeCycle.x + volcanicTime * .055);
    vSmokeAge = age;
    vSmokeShape = position;
    // Each puff leaves the column its own way, so a plume seen from the road
    // billows instead of stacking up like a row of identical discs.
    vec2 drift = vec2(sin(smokeCycle.x * 31.0), cos(smokeCycle.x * 47.0)) * age * 2.5;
    vec3 centre = smokeAnchor + vec3(age * age * 6.0 + drift.x, age * (17.0 + 3.0 * sin(smokeCycle.x * 19.0)), sin(age * 5.0 + smokeCycle.x * 6.28) * age * 1.6 + drift.y) * smokeCycle.y;
    vec3 puffScale = vec3(1.0 + .15 * sin(smokeCycle.x * 23.0), .88 + .12 * cos(smokeCycle.x * 17.0), 1.0);
    vec3 transformed = centre + position * puffScale * smokeCycle.y * (1.15 + age * 5.7);
    vec3 towardCamera = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-(modelViewMatrix * vec4(centre, 1.0)).xyz);
    vSmokeEdge = abs(dot(normalize(normalMatrix * position), towardCamera));
  `);
  shader.fragmentShader = 'varying float vSmokeAge; varying float vSmokeEdge; varying vec3 vSmokeShape;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    // Lit from the crater below, then cooling to ash-pink as it thins. Linear colours.
    diffuseColor.rgb = mix(mix(vec3(1.0, .19, .022), vec3(.30, .085, .057), smoothstep(0.0, .3, vSmokeAge)), vec3(.16, .10, .09), smoothstep(.25, 1.0, vSmokeAge));
    float billow = sin(vSmokeShape.x * 4.5 + vSmokeAge * 3.0) * sin(vSmokeShape.y * 5.0 - vSmokeAge * 2.0) * sin(vSmokeShape.z * 3.5);
    vec3 facetNormal = normalize(cross(dFdx(vSmokeShape), dFdy(vSmokeShape)));
    float facetLight = abs(dot(facetNormal, normalize(vec3(-.4, .7, .5))));
    diffuseColor.rgb *= .77 + .12 * billow + .15 * facetLight + .08 * vSmokeShape.y;
    diffuseColor.a *= smoothstep(0.0, .08, vSmokeAge) * (1.0 - smoothstep(.55, 1.0, vSmokeAge)) * smoothstep(.06, .7, vSmokeEdge);
  `);
};
smokeMaterial.customProgramCacheKey = () => 'volcanic-smoke-v9';
