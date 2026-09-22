import * as THREE from 'three';

export class TouchStick {
  // The stick rests in its corner as a hint, but a touch anywhere on the open
  // scene summons it under the thumb, as in most mobile games.
  constructor(element, onDrive, surface = null) {
    this.element = element; this.onDrive = onDrive;
    this.pointer = null; this.engaged = false; this.vector = { x: 0, y: 0 }; this.offset = { x: 0, y: 0 };
    element.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      this.engage(event);
    });
    surface?.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || !this.available()) return;
      this.engage(event, { x: event.clientX, y: event.clientY });
    });
    element.addEventListener('pointermove', event => this.move(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(type, event => {
      if (event.pointerId === this.pointer) this.release();
    });
    element.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('resize', () => this.release());
  }
  // Hidden, inert (autodrive fade, menus) or display:none controls take no touches.
  available() {
    const { element } = this;
    if (element.closest('[inert]') || !element.getClientRects().length) return false;
    return getComputedStyle(element).visibility === 'visible';
  }
  engage(event, at = null) {
    if (this.pointer !== null) return;
    event.preventDefault();
    const rect = this.element.getBoundingClientRect(), half = rect.width / 2;
    // Measure from the resting spot, even mid-way through the glide home.
    const home = { x: rect.x + half - this.offset.x, y: rect.y + rect.height / 2 - this.offset.y };
    this.center = at ? {
      x: Math.min(Math.max(at.x, half), innerWidth - half),
      y: Math.min(Math.max(at.y, half), innerHeight - half),
    } : { x: rect.x + half, y: rect.y + rect.height / 2 };
    this.setOffset(this.center.x - home.x, this.center.y - home.y);
    this.radius = rect.width * .3;
    this.pointer = event.pointerId; this.engaged = true;
    this.element.setPointerCapture(event.pointerId); this.element.classList.add('active');
    this.move(event);
  }
  setOffset(x, y) {
    this.offset = { x, y };
    this.element.style.setProperty('--stick-dx', `${x}px`); this.element.style.setProperty('--stick-dy', `${y}px`);
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
    this.element.classList.remove('active');
    this.element.style.setProperty('--stick-x', '0px'); this.element.style.setProperty('--stick-y', '0px');
    this.setOffset(0, 0);
    if (pointer !== null && this.element.hasPointerCapture(pointer)) this.element.releasePointerCapture(pointer);
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
