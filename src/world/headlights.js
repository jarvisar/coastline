import * as THREE from 'three';

function headlightPattern() {
  // Two headlight lobes from one spotlight map, so no second light or shadow pass.
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    const left = Math.exp(-.5 * ((u + .3) / .25) ** 2);
    const right = Math.exp(-.5 * ((u - .3) / .25) ** 2);
    const value = Math.round(255 * Math.min(1, left + right) * Math.exp(-.5 * (v / .65) ** 2));
    const offset = (y * size + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value; pixels[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const up = new THREE.Vector3(0, 1, 0);

// The player's headlights on night routes. The open-wheel racer has none.
export class CarHeadlights extends THREE.Group {
  constructor() {
    super();
    // Full beam. Routes may retune it.
    this.brightness = 170;
    this.light = new THREE.SpotLight('#ffe0a6', this.brightness, 18, .64, .8, 1.5);
    this.light.position.set(0, 1.03, -2.02); this.light.target.position.set(0, -1, -8);
    this.light.map = headlightPattern(); this.light.castShadow = false;
    this.add(this.light, this.light.target);
  }
  follow(vehicle) {
    // Dimmed rather than hidden: a hidden light changes the light count, which
    // recompiles every lit shader.
    this.light.intensity = vehicle.carId === 'formula' ? 0 : this.brightness;
    this.position.copy(vehicle.car.position); this.quaternion.copy(vehicle.car.quaternion);
    this.light.shadow.camera.up.copy(up).applyQuaternion(vehicle.car.quaternion);
  }
  dispose() { this.light.map.dispose(); this.light.dispose(); }
}
