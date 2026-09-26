import * as THREE from 'three';
import { N8AOPass } from 'n8ao';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// N8AO shades at half the depth size, the only ratio its depth-aware upsampling
// supports. Depth follows the drawing buffer, so graphics presets scale AO too.
//
// `maxPixelRatio` caps depth at that many device pixels per CSS pixel so dense
// phone screens don't pay for detail they can't show. The mask is filtered up
// the rest of the way, softening it by under a CSS pixel.
export const AO_QUALITY = {
  high: { maxPixelRatio: 1.5 },
  low: { maxPixelRatio: 1 },
};

export class AmbientOcclusion {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.enabled = true;
    this.size = new THREE.Vector2();
    this.hidden = [];
    this.pass = new N8AOPass(scene, camera, 2, 2);
    // N8AO's noise is screen-fixed, so leftover noise crawls as the world scrolls.
    // More samples and a wide denoise radius quiet it; more resolution or the
    // radius-6 presets make it worse (see scripts/ao-motion-test.mjs).
    // All presets share these so changing quality never recompiles AO shaders.
    Object.assign(this.pass.configuration, {
      aoRadius: 2.4, distanceFalloff: 1, intensity: 2,
      aoSamples: 32, denoiseSamples: 16, denoiseRadius: 12, denoiseIterations: 2,
      halfRes: true, gammaCorrection: false, autoRenderBeauty: false,
      transparencyAware: false, accumulate: false, depthAwareUpsampling: true,
    });
    this.setQuality('high');
    this.pass.setDisplayMode('AO');
    // Nearest filtering matches AO to depth at silhouettes, so background
    // occlusion doesn't bleed into foreground pixels.
    for (const target of [this.pass.writeTargetInternal, this.pass.readTargetInternal, this.pass.accumulationRenderTarget]) {
      target.texture.minFilter = target.texture.magFilter = THREE.NearestFilter;
    }
    // Depth-only prepass. N8AO derives normals from depth, so colour is never read.
    this.depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, fog: false });
    this.pass.beautyRenderTarget.texture.type = THREE.UnsignedByteType;
    this.aoTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
    this.material = new THREE.ShaderMaterial({
      name: 'Soft ambient occlusion',
      uniforms: {
        tAO: { value: this.aoTarget.texture },
        intensity: { value: .48 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tAO;
        uniform float intensity;
        varying vec2 vUv;
        void main() {
          // N8AO already leaves the sky unshaded and fades its mask with fog.
          gl_FragColor = vec4(vec3(mix(1.0, texture2D(tAO, vUv).r, intensity)), 1.0);
        }
      `,
      blending: THREE.MultiplyBlending, transparent: true, premultipliedAlpha: true,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
    // Bound once because it runs over every visible object each frame.
    this.hideOverlay = object => {
      if (!object.isMesh && !object.isPoints && !object.isLine) return;
      // Opted-out background layers skip the AO prepass but still draw normally.
      if (object.userData.ambientOcclusion === false) {
        this.hidden.push(object);
        object.visible = false;
        return;
      }
      const material = object.material;
      if (Array.isArray(material) ? material.every(item => !item.depthWrite) : !material.depthWrite) {
        this.hidden.push(object);
        object.visible = false;
      }
    };
  }

  setQuality(quality) {
    this.quality = quality;
    this.maxPixelRatio = AO_QUALITY[quality].maxPixelRatio;
  }

  render(camera) {
    const { renderer, scene, pass } = this;
    // Keep renderer.info meaningful across the scene and postprocessing draws.
    const autoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    if (autoReset) renderer.info.reset();
    const autoClear = renderer.autoClear;
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const matrixWorldAutoUpdate = scene.matrixWorldAutoUpdate;
    const overrideMaterial = scene.overrideMaterial;
    const background = scene.background;
    const xrEnabled = renderer.xr.enabled;
    const target = renderer.getRenderTarget();
    try {
      renderer.render(scene, camera);
      if (!this.enabled) return;

      renderer.getDrawingBufferSize(this.size);
      const scale = Math.min(1, this.maxPixelRatio / renderer.getPixelRatio());
      // Even dimensions keep half-resolution depth and AO texels aligned.
      const width = Math.max(2, Math.floor(this.size.x * scale / 2) * 2);
      const height = Math.max(2, Math.floor(this.size.y * scale / 2) * 2);
      const cameraChanged = Boolean(pass.camera.isOrthographicCamera) !== Boolean(camera.isOrthographicCamera);
      pass.camera = camera;
      if (pass.width !== width || pass.height !== height) pass.setSize(width, height);
      if (this.aoTarget.width !== width || this.aoTarget.height !== height) this.aoTarget.setSize(width, height);
      // N8AO specializes its shaders for the camera projection at creation.
      if (cameraChanged) {
        pass.configureSampleDependentPasses();
        pass.configureEffectCompositer(pass.configuration.depthBufferType, camera.isOrthographicCamera);
      }
      // Foam, mist, flakes and other overlays must not become opaque AO casters.
      scene.traverseVisible(this.hideOverlay);
      renderer.shadowMap.autoUpdate = false;
      // The colour pass already updated transforms.
      scene.matrixWorldAutoUpdate = false;
      scene.overrideMaterial = this.depthMaterial;
      scene.background = null;
      renderer.setRenderTarget(pass.beautyRenderTarget);
      renderer.render(scene, camera);
      scene.overrideMaterial = overrideMaterial;
      scene.background = background;
      pass.render(renderer, this.aoTarget);
      renderer.setRenderTarget(target);
      renderer.autoClear = false;
      this.quad.render(renderer);
    } finally {
      for (const object of this.hidden) object.visible = true;
      this.hidden.length = 0;
      renderer.setRenderTarget(target);
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      scene.matrixWorldAutoUpdate = matrixWorldAutoUpdate;
      scene.overrideMaterial = overrideMaterial;
      scene.background = background;
      renderer.xr.enabled = xrEnabled;
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
    }
  }

  dispose() {
    // N8AO 2.0.1 inherits Pass's empty dispose(), so release its owned resources.
    const resources = new Set();
    for (const value of Object.values(this.pass)) {
      if (value?.isWebGLRenderTarget || value?.isTexture || value?.isMaterial) resources.add(value);
      if (value?.material?.isMaterial) resources.add(value.material);
      if (value?._mesh?.geometry) resources.add(value._mesh.geometry);
    }
    for (const resource of resources) resource.dispose();
    this.aoTarget.dispose();
    this.depthMaterial.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
