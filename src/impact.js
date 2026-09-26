// Rigid-rectangle collisions on a flat plane. Cars are
// { x, z, heading, halfWidth, halfLength, vx, vz, mass? } as trafficContact reads them.
// Mass defaults to footprint area. Positive spin turns the nose to the car's right.

const BOUNCE = .2;  // cars crumple far more than they rebound
// Tonnes: .18 per square metre gives a hatchback 1.1 and a van 1.8.
export const footprintMass = (width, length) => width * length * .18;

// Average of the corners that are inside the other car.
export function contactPoint(a, b) {
  let x = 0, z = 0, count = 0;
  for (const [car, other] of [[a, b], [b, a]]) {
    const cos = Math.cos(car.heading), sin = Math.sin(car.heading), otherCos = Math.cos(other.heading), otherSin = Math.sin(other.heading);
    for (const [side, end] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const cx = car.x + cos * car.halfWidth * side + sin * car.halfLength * end, cz = car.z + sin * car.halfWidth * side - cos * car.halfLength * end;
      const dx = cx - other.x, dz = cz - other.z;
      if (Math.abs(dx * otherCos + dz * otherSin) > other.halfWidth + .02 || Math.abs(dx * otherSin - dz * otherCos) > other.halfLength + .02) continue;
      x += cx; z += cz; count++;
    }
  }
  return count ? { x: x / count, z: z / count } : { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

// Velocity and spin changes along the normal (b to a), or null if already separating.
export function collisionImpulse(a, b, normal, point) {
  const closing = (a.vx - b.vx) * normal.x + (a.vz - b.vz) * normal.z;
  if (closing >= 0) return null;
  const body = car => {
    const mass = car.mass ?? footprintMass(car.halfWidth * 2, car.halfLength * 2), inertia = mass * (car.halfWidth ** 2 + car.halfLength ** 2) / 3;
    return { mass, inertia, lever: (point.x - car.x) * normal.z - (point.z - car.z) * normal.x };
  };
  const p = body(a), q = body(b);
  const j = -(1 + BOUNCE) * closing / (1 / p.mass + 1 / q.mass + p.lever ** 2 / p.inertia + q.lever ** 2 / q.inertia);
  return {
    a: { x: normal.x * j / p.mass, z: normal.z * j / p.mass, spin: p.lever * j / p.inertia },
    b: { x: -normal.x * j / q.mass, z: -normal.z * j / q.mass, spin: -q.lever * j / q.inertia },
  };
}
