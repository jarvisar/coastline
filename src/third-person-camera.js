import * as THREE from 'three';

export class ThirdPersonCamera {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(45, 1, .1, 1200);
    this.initialized = false;
    this.heading = 0;
    this.headingVelocity = 0;
    this.pitch = 0;
    this.height = 0;
    this.forward = new THREE.Vector3();
    this.target = new THREE.Vector3();
  }
  resize(aspect) {
    this.camera.aspect = aspect;
    // Preserve enough horizontal room for the car on narrow phones.
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.PI / 8) / Math.min(aspect, 1)));
    this.camera.updateProjectionMatrix();
  }
  snap() { this.initialized = false; }
  update(car, dt) {
    const heading = -car.rotation.y;
    // Follow the slope partly so the horizon doesn't copy every chassis movement.
    const pitch = THREE.MathUtils.clamp(car.rotation.x * .45, -.18, .18);
    if (!this.initialized) {
      this.heading = heading; this.headingVelocity = 0;
      this.pitch = pitch; this.height = car.position.y; this.initialized = true;
    } else {
      // Critically damped spring. Clamping the error caps a U-turn orbit at about
      // 125 deg/s, and fixed small steps keep that cap the same at any refresh rate.
      for (let remaining = dt; remaining > 1e-8;) {
        const step = Math.min(remaining, 1 / 120);
        const difference = Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading));
        const frequency = 7, change = THREE.MathUtils.clamp(difference, -.62, .62);
        const spring = this.headingVelocity - frequency * change;
        const decay = Math.exp(-frequency * step);
        this.heading += change + (-change + spring * step) * decay;
        this.headingVelocity = (this.headingVelocity - frequency * spring * step) * decay;
        remaining -= step;
      }
      this.pitch = THREE.MathUtils.damp(this.pitch, pitch, 2.5, dt);
      this.height = THREE.MathUtils.damp(this.height, car.position.y, 9, dt);
    }
    this.forward.set(Math.sin(this.heading), 0, -Math.cos(this.heading));
    this.camera.position.copy(car.position).addScaledVector(this.forward, -14);
    // A low camera aimed high and far shows more road and keeps the car low in frame.
    // chaseLift raises it so tall cars don't hide the road.
    const lift = car.userData.chaseLift ?? 0;
    this.camera.position.y = this.height + 4.5 + lift - Math.sin(this.pitch) * 14;
    this.target.copy(car.position).addScaledVector(this.forward, 7);
    this.target.y = this.height + 2.2 + lift * .35 + Math.sin(this.pitch) * 7;
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
