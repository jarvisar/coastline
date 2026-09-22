import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { positionAt, shorelineOffset, randomAt } from './route.js';
import { waterClock } from './water.js';
import { birdFlightGLSL } from './bird-flight.js';

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute([
  0, 0, -.38, -.65, .08, 0, -.1, 0, .3,
  -.65, .08, 0, -1.5, -.12, .45, -.1, 0, .3,
  0, 0, -.38, .1, 0, .3, .65, .08, 0,
  .65, .08, 0, .1, 0, .3, 1.5, -.12, .45,
  -.13, 0, .2, .13, 0, .2, 0, 0, .68,
], 3));
geometry.computeVertexNormals();
const material = new THREE.MeshBasicMaterial({ color: '#fffaf0', side: THREE.DoubleSide, toneMapped: false });
material.onBeforeCompile = shader => {
  shader.uniforms.birdTime = waterClock.time;
  shader.uniforms.birdOrigin = waterClock.origin;
  shader.vertexShader = 'uniform float birdTime; uniform float birdOrigin;\n' + birdFlightGLSL + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
    #include <begin_vertex>
    // A bird's identity stays fixed while its instance moves. Chunk position
    // is wrapped like the water clock so origin rebases cannot reset its beat.
    float flock = floor(mod(modelMatrix[3].z - birdOrigin, 4096.0) / 128.0 + 0.5);
    float seed = flock * 7.0 + float(gl_InstanceID);
    float flap = birdBeat(birdTime, seed, 5.0);
    transformed.y += abs(position.x) * (0.12 + flap * 0.25);
  `);
};
material.customProgramCacheKey = () => 'coastal-gull-v2';
registerChunkResources('birds', { geometry, material });
const transform = new THREE.Object3D();
const flightUp = new THREE.Vector3(0, 1, 0), forward = new THREE.Vector3();
const previousForward = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
const basis = new THREE.Matrix4();
const p = new THREE.Vector3(), before = new THREE.Vector3(), after = new THREE.Vector3();

export class CoastalBirds {
  constructor(chunk) {
    this.start = chunk.start; this.phase = randomAt(chunk.index, 1761) * Math.PI * 2;
    // Pick a clear cruising height once, over the tallest sea stack's crown
    // (the chunk records it; inland boulders share the stacks' batches but
    // lie far from the gulls' offshore circuit). The margin covers the gentle
    // bobbing and wings without per-frame collisions.
    this.flightHeight = Math.max(22, (chunk.seaStackTop ?? 0) + 5);
    this.mesh = new THREE.InstancedMesh(geometry, material, 4);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = 'coastal-gulls';
    chunk.group.add(this.mesh); this.update(0);
    this.mesh.computeBoundingSphere(); this.mesh.boundingSphere.radius += 85;
  }
  update(time) {
    // Worker-restored flocks initialize this small deterministic cache once too.
    if (!this.flight) {
      this.flight = new Float64Array(16);
      for (let i = 0; i < 4; i++) {
        const seed = this.start / 128 * 7 + i;
        this.flight.set([.13 + randomAt(seed, 1771) * .065, randomAt(seed, 1772) * 2.2,
          21 + randomAt(seed, 1773) * 7, 8 + randomAt(seed, 1774) * 4], i * 4);
      }
    }
    for (let i = 0; i < 4; i++) {
      this.flightPoint(i, time, p); this.flightPoint(i, time - .02, before); this.flightPoint(i, time + .02, after);
      // The shoreline bends the actual world-space path; an orbit angle alone
      // cannot tell which way the bird is travelling along that path.
      forward.set(after.x - before.x, after.y - before.y, after.z - before.z).normalize();
      previousForward.set(p.x - before.x, p.y - before.y, p.z - before.z).normalize();
      const turn = previousForward.z * forward.x - previousForward.x * forward.z;
      const bank = THREE.MathUtils.clamp(turn * 90, -.32, .32);
      right.crossVectors(forward, flightUp).normalize(); up.crossVectors(right, forward);
      basis.makeBasis(right, up, forward.negate());
      transform.position.set(p.x, p.y, p.z + this.start);
      transform.quaternion.setFromRotationMatrix(basis); transform.rotateZ(bank);
      transform.scale.setScalar(.78); transform.updateMatrix(); this.mesh.setMatrixAt(i, transform.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  flightPoint(i, time, target) {
    const n = i * 4, rate = this.flight[n], delay = this.flight[n + 1];
    const phase = this.phase + time * rate + delay + .1 * Math.sin(time * .31 + delay);
    const s = this.start + 64 + Math.cos(phase) * this.flight[n + 2] - i * 2.4;
    const u = shorelineOffset(s) - 30 + Math.sin(phase) * this.flight[n + 3] + (i % 2 ? 2 : -2);
    return positionAt(s, u, this.flightHeight + Math.sin(phase * 2 + delay) * 1.2 + i * .35, target);
  }
}
