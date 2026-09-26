import * as THREE from 'three';

// Sky for the chase and cockpit views. Overhead views never see it, so the
// dome collapses under an orthographic camera.
const SUN = new THREE.Vector3(-190, 215, 125).normalize();

export class CoastalSky {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'coastal-sky'; scene.add(this.group);
    this.domeGeometry = new THREE.SphereGeometry(1000, 32, 16);
    this.domeMaterial = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, toneMapped: false,
      uniforms: { horizon: { value: new THREE.Color('#b5dff5') }, zenith: { value: new THREE.Color('#5a9fda') },
        haze: { value: new THREE.Color('#e4f1f6') }, sun: { value: SUN } },
      vertexShader: `varying vec3 vSkyDirection;
        void main() {
          vSkyDirection = position;
          gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
          if (isOrthographic) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        }`,
      fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 haze; uniform vec3 sun; varying vec3 vSkyDirection;
        void main() {
          vec3 direction = normalize(vSkyDirection);
          float elevation = max(0.0, direction.y);
          // Matches the fog colour at the horizon.
          vec3 color = mix(horizon, zenith, pow(smoothstep(0.0, 0.85, elevation), 0.75));
          // Thin haze band just above the horizon.
          color = mix(color, haze, smoothstep(0.0, 0.02, elevation) * (1.0 - smoothstep(0.02, 0.13, elevation)) * 0.55);
          color += vec3(0.16, 0.13, 0.08) * pow(max(dot(direction, sun), 0.0), 16.0);
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }` });
    this.dome = new THREE.Mesh(this.domeGeometry, this.domeMaterial); this.dome.name = 'coastal-sky-dome';
    this.dome.renderOrder = -1000; this.dome.frustumCulled = false; this.dome.userData.ambientOcclusion = false;
    // Fully faded fog is the visible horizon, so match the dome to it.
    this.dome.onBeforeRender = (renderer, scene) => { if (scene.fog) this.domeMaterial.uniforms.horizon.value.copy(scene.fog.color); };
    this.group.add(this.dome);
  }
  follow(x, y, z) { this.group.position.set(x, y, z); }
  dispose() {
    this.group.removeFromParent();
    this.domeGeometry.dispose(); this.domeMaterial.dispose();
  }
}
