import * as THREE from 'three';

export const volcanicClock = { value: 0 };
// `heat` is height in metres above the lava lighting the vertex, or COLD. It
// interpolates linearly, so a one-facet cliff glows at its foot.
export const COLD = 100;
export const basaltMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
basaltMaterial.onBeforeCompile = shader => {
  shader.uniforms.volcanicTime = volcanicClock;
  shader.vertexShader = 'attribute float heat; varying float vHeat;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = heat;');
  shader.fragmentShader = 'uniform float volcanicTime; varying float vHeat;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    float glow = 1.0 - clamp(vHeat / 11.0, 0.0, 1.0);
    glow *= glow;
    float pulse = .97 + .025 * sin(volcanicTime * .65) + .015 * sin(volcanicTime * 1.13);
    totalEmissiveRadiance += mix(vec3(.16, .008, .001), vec3(.72, .067, .003), glow) * glow * pulse;
  `);
};
basaltMaterial.customProgramCacheKey = () => 'volcanic-basalt-v10';

// Lava reuses `heat` as a per-facet phase. The polygon offset stops thin veins
// sinking into coarse terrain facets. Positive `flow` is ground lava, negative
// a falling sheet.
export const lavaMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
lavaMaterial.onBeforeCompile = shader => {
  shader.uniforms.volcanicTime = volcanicClock;
  shader.vertexShader = 'uniform float volcanicTime; attribute float heat; attribute float flow; attribute vec2 flowCoordinates; varying vec2 vFlowCoordinates; varying float vLavaPulse; varying float vSurfaceFlow; varying vec3 vFlowPosition;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vLavaPulse = .94 + .045 * sin(position.x * .12 + position.z * .08 + volcanicTime * .3) + .035 * sin(heat * 6.2832 + volcanicTime * (.25 + heat * .35));
    if (flow > 0.0) vLavaPulse = .94 + .04 * sin(heat * 6.2832 + volcanicTime * .35);
    vSurfaceFlow = flow;
    vFlowCoordinates = flowCoordinates;
    vFlowPosition = position;
  `);
  shader.fragmentShader = 'uniform float volcanicTime; varying vec2 vFlowCoordinates; varying float vLavaPulse; varying float vSurfaceFlow; varying vec3 vFlowPosition;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    // Hot folds moving down the rock steps.
    float fold = sin(vFlowPosition.y * 2.6 + volcanicTime * 1.15 + .35 * sin(vFlowPosition.x * .7));
    diffuseColor.rgb *= vLavaPulse * (1.0 + abs(vSurfaceFlow) * fold * .065);
    if (vSurfaceFlow > .5) {
      // Route coordinates keep the facets fixed across joins and origin shifts.
      vec2 tiles = vec2(vFlowCoordinates.x * .45 + vFlowCoordinates.y * .18, vFlowCoordinates.y * .8 - vFlowCoordinates.x * .12);
      vec2 cell = floor(tiles), within = fract(tiles);
      float face = step(1.0, within.x + within.y);
      float grain = fract(sin(dot(cell, vec2(127.1, 311.7)) + face * 74.7) * 43758.5453);
      diffuseColor.rgb *= vec3(.94 + .06 * grain, .8 + .2 * grain, .85 + .15 * grain);
    }
  `);
};
lavaMaterial.customProgramCacheKey = () => 'volcanic-lava-v9';

// Vertex colours fade to black at the edge so additive glow leaves no border.
// Additive light has to fade to black in fog instead of toward the fog colour.
export const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
// The same batch carries basin heat haze (`haze` = 1). It shows when seen
// across the ground and fades out from overhead or edge on.
glowMaterial.onBeforeCompile = shader => {
  shader.uniforms.volcanicTime = volcanicClock;
  shader.vertexShader = 'uniform float volcanicTime; attribute float haze; varying float vHaze;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>
    vHaze = 1.0;
    if (haze > .5) {
      vec3 hazeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vec3 hazeView = isOrthographic ? -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) : normalize(hazeWorld - cameraPosition);
      float facing = abs(dot(normalize(mat3(modelMatrix) * normal), hazeView));
      vHaze = pow(1.0 - min(1.0, abs(hazeView.y) * 1.25), 3.0) * smoothstep(.05, .45, facing)
        * (.86 + .14 * sin(volcanicTime * .7 + hazeWorld.x * .05 + hazeWorld.z * .03));
    }
  `);
  shader.fragmentShader = 'varying float vHaze;\n' + shader.fragmentShader.replace('#include <fog_fragment>', `
    gl_FragColor.rgb *= vHaze;
    #ifdef USE_FOG
      gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  `);
};
glowMaterial.customProgramCacheKey = () => 'volcanic-glow-v2';

// Puffs animate in the shader from per-vertex anchor, phase and scale, so
// worker-built chunks share one clock with no CPU updates. A puff is a unit
// sphere, so position doubles as a smooth normal for the edge fade.
export const smokeMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: .44 });
smokeMaterial.onBeforeCompile = shader => {
  shader.uniforms.volcanicTime = volcanicClock;
  shader.vertexShader = 'uniform float volcanicTime; attribute vec3 smokeAnchor; attribute vec2 smokeCycle; attribute float smokeKind; varying float vSteam; varying float vSmokeAge; varying float vSmokeEdge; varying vec3 vSmokeShape;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
    float age = fract(smokeCycle.x + volcanicTime * .055);
    vSmokeAge = age;
    vSteam = smokeKind;
    vSmokeShape = position;
    // Per-puff drift so a plume billows instead of stacking identical discs.
    vec2 drift = vec2(sin(smokeCycle.x * 31.0), cos(smokeCycle.x * 47.0)) * age * 2.5;
    vec3 centre = smokeAnchor + vec3(age * age * 6.0 + drift.x, age * (17.0 + 3.0 * sin(smokeCycle.x * 19.0)), sin(age * 5.0 + smokeCycle.x * 6.28) * age * 1.6 + drift.y) * smokeCycle.y;
    vec3 puffScale = vec3(1.0 + .15 * sin(smokeCycle.x * 23.0), .88 + .12 * cos(smokeCycle.x * 17.0), 1.0);
    vec3 transformed = centre + position * puffScale * smokeCycle.y * (1.15 + age * 5.7);
    vec3 towardCamera = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-(modelViewMatrix * vec4(centre, 1.0)).xyz);
    vSmokeEdge = abs(dot(normalize(normalMatrix * position), towardCamera));
  `);
  shader.fragmentShader = 'varying float vSteam; varying float vSmokeAge; varying float vSmokeEdge; varying vec3 vSmokeShape;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    // Copper near the vent, fading to ash. Linear colours.
    diffuseColor.rgb = mix(mix(vec3(.85, .19, .038), vec3(.24, .115, .09), smoothstep(0.0, .3, vSmokeAge)), vec3(.14, .13, .16), smoothstep(.2, .85, vSmokeAge));
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(.38, .40, .43), vec3(.23, .24, .28), vSmokeAge), vSteam);
    float billow = sin(vSmokeShape.x * 4.5 + vSmokeAge * 3.0) * sin(vSmokeShape.y * 5.0 - vSmokeAge * 2.0) * sin(vSmokeShape.z * 3.5);
    vec3 facetNormal = normalize(cross(dFdx(vSmokeShape), dFdy(vSmokeShape)));
    float facetLight = abs(dot(facetNormal, normalize(vec3(-.4, .7, .5))));
    diffuseColor.rgb *= .77 + .12 * billow + .15 * facetLight + .08 * vSmokeShape.y;
    diffuseColor.a *= smoothstep(0.0, .08, vSmokeAge) * (1.0 - smoothstep(.55, 1.0, vSmokeAge)) * smoothstep(.06, .7, vSmokeEdge);
  `);
};
smokeMaterial.customProgramCacheKey = () => 'volcanic-smoke-v11';
