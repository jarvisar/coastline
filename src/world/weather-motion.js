import * as THREE from 'three';

const WIDTH = 300, HEIGHT = 200, DEPTH = 360, EPOCH = 256;
const mod = (value, extent) => value - Math.floor(value / extent) * extent;

// Particles move in the shader so only a few uniforms change per frame.
// JS wraps the anchor and rebases fall time every EPOCH seconds so shader inputs
// stay small enough for float precision on long drives.
export const weatherMotionGLSL = /* glsl */`
  attribute vec3 weatherMotion;
  uniform float weatherTime;
  uniform vec3 weatherAnchor;
  uniform vec2 weatherDrift;
  uniform vec4 weatherWaves;
  vec3 weatherPosition(vec3 seed, vec3 motion) {
    vec3 offset = vec3(
      weatherDrift.x + (weatherWaves.x * motion.z + weatherWaves.y * motion.y) * 2.1,
      -weatherTime * motion.x,
      weatherDrift.y + weatherWaves.w * motion.z - weatherWaves.z * motion.y
    );
    return mod(seed + offset - weatherAnchor, vec3(300.0, 200.0, 360.0)) - vec3(150.0, 100.0, 180.0);
  }
`;

export class WeatherMotion {
  constructor(geometry, seeds, stride) {
    this.seeds = seeds; this.stride = stride; this.epoch = 0;
    const count = seeds.length / stride, positions = new Float32Array(count * 3), motion = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const n = i * stride;
      positions.set(seeds.subarray(n, n + 3), i * 3);
      motion[i * 3] = seeds[n + 3];
      if (stride === 6) {
        motion[i * 3 + 1] = Math.sin(seeds[n + 4]) * seeds[n + 5];
        motion[i * 3 + 2] = Math.cos(seeds[n + 4]) * seeds[n + 5];
      }
    }
    this.position = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('weatherMotion', new THREE.BufferAttribute(motion, 3));
    this.uniforms = {
      weatherTime: { value: 0 }, weatherAnchor: { value: new THREE.Vector3() },
      weatherDrift: { value: new THREE.Vector2() }, weatherWaves: { value: new THREE.Vector4() },
    };
  }
  compile(shader) {
    Object.assign(shader.uniforms, this.uniforms);
    shader.vertexShader = weatherMotionGLSL + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = weatherPosition(position, weatherMotion);');
  }
  update(time, anchor) {
    const epoch = Math.floor(time / EPOCH) * EPOCH;
    if (epoch !== this.epoch) {
      for (let i = 0; i < this.position.count; i++) {
        const n = i * this.stride;
        this.position.setY(i, mod(this.seeds[n + 1] - epoch * this.seeds[n + 3], HEIGHT));
      }
      this.position.needsUpdate = true; this.epoch = epoch;
    }
    this.uniforms.weatherTime.value = time - epoch;
    this.uniforms.weatherAnchor.value.set(mod(anchor.x, WIDTH), mod(anchor.y, HEIGHT), mod(anchor.z, DEPTH));
    if (this.stride === 6) {
      this.uniforms.weatherDrift.value.set(mod(time * .8, WIDTH), mod(time * .28, DEPTH));
      this.uniforms.weatherWaves.value.set(Math.sin(time * .55), Math.cos(time * .55), Math.sin(time * .37), Math.cos(time * .37));
    }
  }
}
