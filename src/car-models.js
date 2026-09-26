import * as THREE from 'three';
import { vehicleGeometry, WHEEL } from './traffic-models.js';
import { stableShadowDepth } from './world/shadow-depth.js';

// Same merged bodywork as traffic, with separate wheels so they can steer and spin.
export function createShapeCar(entry) {
  const { paint: paintGeometry, details: trimGeometry, headlights: frontGeometry, taillights: rearGeometry, wheels: placements } =
    vehicleGeometry(entry.shape, { separateWheels: true });
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .74, flatShading: true, ...extra });
  const paint = mat(entry.paint);
  const trim = mat('#ffffff', { vertexColors: true });
  const front = mat('#fff5cf', { emissive: '#e9cc84', emissiveIntensity: .24 });
  const rear = mat('#8e3328', { emissive: '#b8220d', emissiveIntensity: .1 });
  const tireMaterial = mat('#2b3434'), hubMaterial = mat('#bfc4b9');
  const car = new THREE.Group(); car.name = `car-${entry.shape.name}`;
  const body = new THREE.Group(); car.add(body);
  const shells = [[paintGeometry, paint], [trimGeometry, trim], [frontGeometry, front], [rearGeometry, rear]];
  for (const [geometry, material] of shells) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true; body.add(mesh);
  }
  const tireGeometry = new THREE.CylinderGeometry(WHEEL.radius, WHEEL.radius, WHEEL.width, 12);
  const hubGeometry = new THREE.CylinderGeometry(WHEEL.hubRadius, WHEEL.hubRadius, WHEEL.hubWidth, 10);
  const wheels = placements.map(({ x, y, z, front: steered }) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, z); car.add(pivot);
    const wheel = new THREE.Mesh(tireGeometry, tireMaterial); wheel.rotation.z = Math.PI / 2; wheel.castShadow = true; pivot.add(wheel);
    const hub = new THREE.Mesh(hubGeometry, hubMaterial); hub.rotation.z = Math.PI / 2; pivot.add(hub);
    return { pivot, wheel, hub, front: steered };
  });
  car.traverse(stableShadowDepth);
  return {
    car, body, wheels,
    nightLights: [{ material: front, day: .24, night: 2.2 }, { material: rear, day: .1, night: 2.5 }],
    // Keeps its own paint and kit on every route.
    applyTrim() {},
    paintCar(color) { paint.color.set(color || entry.paint); },
    disposeModel() {
      for (const geometry of [paintGeometry, trimGeometry, frontGeometry, rearGeometry, tireGeometry, hubGeometry]) geometry.dispose();
      for (const material of [paint, trim, front, rear, tireMaterial, hubMaterial]) material.dispose();
    },
  };
}
