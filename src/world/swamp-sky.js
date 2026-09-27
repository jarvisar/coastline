import * as THREE from 'three';
import { swampPalette } from './swamp-palette.js';
import { waterClock } from './water.js';

// The driving cameras look into a blue-hour sky, with a low bank of haze and
// thin cloud across the moon. The far-plane dome never enters the AO pass.
export class SwampSky {
  constructor(parent) {
    this.geometry = new THREE.SphereGeometry(1000, 24, 12);
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, toneMapped: false,
      uniforms: {
        horizon: { value: new THREE.Color(swampPalette.horizon) },
        zenith: { value: new THREE.Color('#142738') },
        moonDirection: { value: new THREE.Vector3(-.36, .34, -1).normalize() },
        swampTime: waterClock.time,
      },
      vertexShader: /* glsl */`
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
          gl_Position = clip.xyww;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 horizon; uniform vec3 zenith; uniform vec3 moonDirection;
        uniform float swampTime; varying vec3 vDirection;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
        }
        void main() {
          vec3 ray = normalize(vDirection);
          float elevation = max(0.0, ray.y);
          vec3 color = mix(horizon, zenith, pow(smoothstep(0.0, 0.85, elevation), 0.65));
          vec2 p = ray.xz / (0.3 + elevation) * vec2(2.8, 6.0) + vec2(swampTime * 0.001, 0.0);
          float cloud = smoothstep(0.34, 0.8, noise(p) * 0.7 + noise(p * 2.7) * 0.3);
          color += vec3(0.009, 0.011, 0.012) * cloud * smoothstep(0.0, 0.15, elevation);
          float moon = max(dot(ray, moonDirection), 0.0);
          color += vec3(0.09, 0.12, 0.14) * pow(moon, 100.0) * (1.0 - cloud * 0.7);
          color += vec3(0.56, 0.63, 0.64) * smoothstep(0.99986, 0.99994, moon) * (1.0 - cloud * 0.8);
          if (isOrthographic) color = horizon;
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material); this.mesh.name = 'swamp-sky';
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1000;
    this.mesh.userData.ambientOcclusion = false;
    parent.add(this.mesh);
  }
  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
