import * as THREE from 'three';

export class TouchStick {
  // Like most mobile games, the stick is hidden until a thumb lands on the
  // scene, then anchors exactly there until that thumb lifts.
  constructor(element, onDrive, surface) {
    this.element = element; this.onDrive = onDrive; this.surface = surface;
    this.pointer = null; this.engaged = false; this.vector = { x: 0, y: 0 };
    element.hidden = true;
    surface.addEventListener('pointerdown', event => {
      if (this.pointer !== null || event.pointerType === 'mouse' || !this.available()) return;
      event.preventDefault();
      this.center = { x: event.clientX, y: event.clientY };
      element.style.left = `${event.clientX}px`; element.style.top = `${event.clientY}px`;
      element.hidden = false; element.classList.add('active');
      this.radius = element.offsetWidth * .3;
      this.pointer = event.pointerId; this.engaged = true;
      surface.setPointerCapture(event.pointerId);
      this.move(event);
    });
    surface.addEventListener('pointermove', event => this.move(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) surface.addEventListener(type, event => {
      if (event.pointerId === this.pointer) this.release();
    });
  }
  // Hidden or inert controls (menus, a controller, the autodrive fade) take no touches.
  available() {
    const controls = this.element.parentElement;
    return !controls.closest('[inert]') && controls.getClientRects().length > 0 && getComputedStyle(controls).visibility === 'visible';
  }
  move(event) {
    if (event.pointerId !== this.pointer) return;
    event.preventDefault();
    const x = (event.clientX - this.center.x) / this.radius, y = (this.center.y - event.clientY) / this.radius;
    const length = Math.hypot(x, y), amount = Math.min(1, length);
    const strength = amount <= .12 ? 0 : (amount - .12) / .88;
    this.vector = { x: length ? x / length * strength : 0, y: length ? y / length * strength : 0 };
    this.element.style.setProperty('--stick-x', `${length ? x / length * amount * this.radius : 0}px`);
    this.element.style.setProperty('--stick-y', `${length ? -y / length * amount * this.radius : 0}px`);
    if (strength) this.onDrive();
  }
  release() {
    const pointer = this.pointer; this.pointer = null; this.vector = { x: 0, y: 0 };
    this.element.hidden = true; this.element.classList.remove('active');
    this.element.style.setProperty('--stick-x', '0px'); this.element.style.setProperty('--stick-y', '0px');
    if (pointer !== null && this.surface.hasPointerCapture(pointer)) this.surface.releasePointerCapture(pointer);
  }
  clear() { if (this.engaged || this.pointer !== null) this.release(); this.engaged = false; }
}

// In the chase view the stick controls the car, independent of camera rotation.
// Use the existing analog driving physics for gradual steering and brake/reverse.
export function thirdPersonDrivingInput(stick) {
  return {
    forward: Math.max(0, stick.y), brake: Math.max(0, -stick.y),
    left: Math.max(0, -stick.x), right: Math.max(0, stick.x),
    handbrake: Math.hypot(stick.x, stick.y) === 0,
  };
}

// Invert the terrain's local screen projection. Including terrain height and the
// actual road coordinates keeps cardinal and diagonal drags aligned with pixels
// even on slopes, bends, or after rotating/resizing the camera.
export function touchDrivingInput(stick, camera, route, s, u, origin = 0) {
  const amount = Math.min(1, Math.hypot(stick.x, stick.y));
  if (!amount) return { amount: 0 };
  const step = .1, p = route.position(s, u), a = route.position(s + step, u), b = route.position(s, u + step);
  const along = { x: (a.x - p.x) / step, y: (a.y - p.y) / step, z: (a.z - p.z) / step };
  const across = { x: (b.x - p.x) / step, y: (b.y - p.y) / step, z: (b.z - p.z) / step };
  camera.updateMatrixWorld();
  const m = camera.matrixWorld.elements;
  // Perspective also changes scale with depth. Evaluate its local derivative
  // at the car, in the same rebased coordinates used to render the scene.
  const point = camera.isPerspectiveCamera
    ? new THREE.Vector3(p.x, p.y + .13, p.z + origin).applyMatrix4(camera.matrixWorldInverse) : null;
  if (point && point.z >= -.1) return { amount: 0 };
  const depth = v => m[8] * v.x + m[9] * v.y + m[10] * v.z;
  const screenX = v => m[0] * v.x + m[1] * v.y + m[2] * v.z - (point ? point.x / point.z * depth(v) : 0);
  const screenY = v => m[4] * v.x + m[5] * v.y + m[6] * v.z - (point ? point.y / point.z * depth(v) : 0);
  const ax = screenX(along), ay = screenY(along), bx = screenX(across), by = screenY(across);
  const determinant = ax * by - ay * bx;
  if (Math.abs(determinant) < .001) return { amount: 0 };
  let ds = (stick.x * by - stick.y * bx) / determinant;
  let du = (ax * stick.y - ay * stick.x) / determinant;
  const dx = along.x * ds + across.x * du, dz = along.z * ds + across.z * du;
  const length = Math.hypot(dx, dz);
  if (length < .0001) return { amount: 0 };
  ds /= length; du /= length;
  return { amount, along: ds, across: du, heading: Math.atan2(dx, -dz) };
}
