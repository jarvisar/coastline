import * as THREE from 'three';
import { randomAt, roadHeight, smoothstep } from './route.js';
import { riftProfile, volcanicPosition } from './volcanic-route.js';

const ASH = 140, EMBERS = 24, WIDTH = 320, HEIGHT = 110, DEPTH = 340;
const wrap = (value, extent) => value - Math.floor(value / extent) * extent - extent / 2;

// One sparse particle batch and four unshadowed lights, independent of the
// number of resident chunks. No textures, extra render targets or shadow maps.
export class VolcanicAtmosphere {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'volcanic-atmosphere'; scene.add(this.group);
    const count = ASH + EMBERS, colors = [], sizes = [], kinds = [];
    this.seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      this.seeds.set([randomAt(i, 80201), randomAt(i, 80202), randomAt(i, 80203), randomAt(i, 80204)], i * 4);
      const ember = i >= ASH, color = new THREE.Color(ember ? '#ff9b35' : i % 3 ? '#5c5350' : '#958077');
      colors.push(color.r, color.g, color.b); sizes.push(ember ? 2.1 : 1.5 + randomAt(i, 80205) * 1.4); kinds.push(ember ? 1 : 0);
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.geometry.setAttribute('fleckSize', new THREE.Float32BufferAttribute(sizes, 1));
    this.geometry.setAttribute('fleckKind', new THREE.Float32BufferAttribute(kinds, 1));
    this.geometry.setAttribute('fleckAlpha', new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.PointsMaterial({ vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: false, toneMapped: false });
    this.material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float fleckSize; attribute float fleckKind; attribute float fleckAlpha; varying float vFleckAlpha; varying float vFleckKind;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('gl_PointSize = size;', `
        gl_PointSize = size * fleckSize * clamp(400.0 / max(140.0, -mvPosition.z), .65, 1.5);
        vFleckAlpha = fleckAlpha; vFleckKind = fleckKind;
      `);
      shader.fragmentShader = 'varying float vFleckAlpha; varying float vFleckKind;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = gl_PointCoord - .5;
        float shape = abs(p.x + p.y * .35) + abs(p.y) * 1.3;
        diffuseColor.a *= (1.0 - smoothstep(.22, .5, shape)) * vFleckAlpha;
        diffuseColor.rgb *= mix(1.0, 1.2, vFleckKind);
      `);
    };
    this.material.customProgramCacheKey = () => 'volcanic-ash-embers-v1';
    this.points = new THREE.Points(this.geometry, this.material); this.points.name = 'volcanic-ash-and-embers';
    this.points.frustumCulled = false; this.points.userData.ambientOcclusion = false; this.group.add(this.points);
    this.lights = Array.from({ length: 4 }, () => {
      const light = new THREE.PointLight('#ff691b', 0, 85, 2); light.name = 'lava-bounce-light'; this.group.add(light); return light;
    });
  }
  update(time, s = 0, origin = 0, chunks = new Map()) {
    const anchor = volcanicPosition(s, -14, roadHeight(s) + 20), positions = this.geometry.attributes.position, alpha = this.geometry.attributes.fleckAlpha;
    this.points.position.set(anchor.x, anchor.y, anchor.z + origin);
    for (let i = 0; i < ASH; i++) {
      const n = i * 4, phase = this.seeds[n + 3] * Math.PI * 2;
      const x = wrap(this.seeds[n] * WIDTH + time * (1.1 + this.seeds[n + 3]) + Math.sin(time * .27 + phase) * 3 - anchor.x, WIDTH);
      const y = wrap(this.seeds[n + 1] * HEIGHT + time * .22 + Math.sin(time * .4 + phase) * 2 - anchor.y, HEIGHT);
      const z = wrap(this.seeds[n + 2] * DEPTH + time * .65 + Math.cos(time * .22 + phase) * 3 - anchor.z, DEPTH);
      positions.setXYZ(i, x, y, z);
      const edge = Math.max(Math.abs(x) / (WIDTH / 2), Math.abs(y) / (HEIGHT / 2), Math.abs(z) / (DEPTH / 2));
      alpha.setX(i, .42 * (1 - smoothstep(.7, 1, edge)));
    }
    const vents = [];
    for (const chunk of chunks.values()) for (const vent of chunk.features.vents) {
      if (Math.abs(vent.s - s) < 170) vents.push({ ...vent, z: vent.z - chunk.start });
    }
    // Embers rise only from local vents. Each one cools and disappears before
    // its cycle restarts, while ash travels mostly sideways instead of falling.
    for (let i = 0; i < EMBERS; i++) {
      const n = (ASH + i) * 4, vent = vents[i % vents.length], age = (time * .075 + this.seeds[n]) % 1;
      if (!vent) { alpha.setX(ASH + i, 0); continue; }
      const phase = this.seeds[n + 1] * Math.PI * 2;
      positions.setXYZ(ASH + i, vent.x - anchor.x + Math.sin(phase + age * 5) * age * 3 + age * 4,
        vent.y - anchor.y + age * (9 + this.seeds[n + 2] * 8), vent.z - anchor.z + Math.cos(phase + age * 4) * age * 3);
      alpha.setX(ASH + i, .85 * smoothstep(0, .12, age) * (1 - smoothstep(.35, 1, age)));
    }
    positions.needsUpdate = true; alpha.needsUpdate = true;
    for (let i = 0; i < this.lights.length; i++) {
      const side = i < 2 ? -1 : 1, span = side < 0 ? 96 : 128, offset = side < 0 ? 0 : 24;
      const cell = Math.floor((s - offset) / span), at = (cell + i % 2) * span + offset;
      const { near, level } = riftProfile(at, side), d = side < 0 ? near + 13 : near - 6;
      const p = volcanicPosition(at, side * d, level + 5), distance = Math.abs(at - s);
      this.lights[i].position.set(p.x, p.y, p.z + origin);
      this.lights[i].intensity = (side < 0 ? 1100 : 700) * (1 - smoothstep(30, span, distance))
        * (.97 + .025 * Math.sin(time * .65 + i) + .015 * Math.sin(time * 1.13 + i * 2));
    }
  }
  dispose() {
    this.group.removeFromParent(); this.geometry.dispose(); this.material.dispose();
    for (const light of this.lights) light.dispose();
  }
}
