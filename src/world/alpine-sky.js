import * as THREE from 'three';
import { randomAt, lerp, smoothstep } from './route.js';

// Lower than the moonlight itself, so the chase camera sees it over the lake.
const MOON = new THREE.Vector3(-.86, .36, -.4).normalize();
const ZENITH = '#050b16', HORIZON = '#1b2c3d';

// Moonlit night sky for the chase and cockpit views, with stars and a low
// halo of light around the moon. Overhead views never see it.
function domeMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: { horizon: { value: new THREE.Color(HORIZON) }, zenith: { value: new THREE.Color(ZENITH) }, moon: { value: MOON } },
    vertexShader: `varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = position;
        gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
        if (isOrthographic) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      }`,
    fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 moon; varying vec3 vSkyDirection;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 direction = normalize(vSkyDirection);
        float elevation = max(0.0, direction.y), toMoon = max(dot(direction, moon), 0.0);
        // Matches the fog colour at the horizon.
        vec3 color = mix(horizon, zenith, pow(smoothstep(0.0, 0.75, elevation), 0.6));
        color += vec3(0.05, 0.07, 0.1) * pow(toMoon, 12.0) + vec3(0.1, 0.12, 0.15) * pow(toMoon, 160.0);
        // Stars sit one to a cell on a coarse grid of directions, fading into
        // the haze and around the moon.
        vec3 cell = floor(direction * 110.0);
        float seed = hash(cell);
        vec3 star = (cell + 0.25 + 0.5 * vec3(hash(cell + 1.7), hash(cell + 3.1), hash(cell + 5.3))) / 110.0;
        float glow = 1.0 - smoothstep(0.0, 0.0012 + fract(seed * 7.0) * 0.001, length(direction - normalize(star)));
        float stars = glow * step(0.965, seed) * (0.25 + 0.75 * fract(seed * 13.0));
        stars *= smoothstep(0.06, 0.3, elevation) * (1.0 - smoothstep(0.93, 0.995, toMoon));
        color += vec3(0.62, 0.68, 0.78) * stars;
        // A small, slightly cratered disc.
        float disc = smoothstep(0.99955, 0.9997, toMoon);
        float shade = 0.9 + 0.1 * sin(direction.x * 2400.0) * sin(direction.y * 2100.0);
        color = mix(color, vec3(0.86, 0.89, 0.92) * shade, disc);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// Snowy ranges ringing the view past the last chunk, following the car so
// they never get closer. Snow fields face the moon. Feet fade into the haze.
const RANGES = [
  { distance: 640, depth: 110, low: 40, high: 120, peaks: 7, peak: 70, salt: 6101 },
  { distance: 790, depth: 150, low: 70, high: 170, peaks: 6, peak: 120, salt: 6111 },
  { distance: 950, depth: 170, low: 90, high: 210, peaks: 5, peak: 170, salt: 6121 },
];
const STEPS = 140;
function ranges() {
  const positions = [], colors = [], horizon = new THREE.Color(HORIZON);
  const rock = new THREE.Color('#33415a'), shade = new THREE.Color('#202d40');
  const snow = new THREE.Color('#9fb2c8'), snowShade = new THREE.Color('#5d6f88');
  const light = new THREE.Vector3(MOON.x, .8, MOON.z).normalize();
  RANGES.forEach((range, layer) => {
    const peaks = Array.from({ length: range.peaks }, (_, i) => ({ angle: (i + randomAt(i, range.salt)) / range.peaks * Math.PI * 2,
      width: .06 + randomAt(i, range.salt + 1) * .08, height: range.peak * (.5 + randomAt(i, range.salt + 2) * .7) }));
    const ridge = angle => {
      let height = lerp(range.low, range.high, .5 + .3 * Math.sin(angle * 3 + range.salt) + .2 * Math.sin(angle * 7.3 + range.salt * .7));
      height *= .9 + .1 * Math.sin(angle * 23 + range.salt) + .06 * Math.sin(angle * 41 + range.salt * .3);
      for (const peak of peaks) {
        const d = Math.abs(Math.atan2(Math.sin(angle - peak.angle), Math.cos(angle - peak.angle)));
        height += peak.height * Math.max(0, 1 - d / peak.width) ** 1.2;
      }
      return height;
    };
    const rows = Array.from({ length: STEPS }, (_, j) => {
      const angle = (j + (randomAt(j, range.salt + 3) - .5) * .5) / STEPS * Math.PI * 2, height = ridge(angle);
      const radius = range.distance + (randomAt(j, range.salt + 4) - .5) * 30;
      const at = (r, y, offset = 0) => new THREE.Vector3(Math.cos(angle + offset) * r, y, Math.sin(angle + offset) * r);
      return [at(radius - range.depth, 0), at(radius - range.depth * (.3 + randomAt(j, range.salt + 5) * .35),
        height * (.45 + randomAt(j, range.salt + 6) * .3), (randomAt(j, range.salt + 7) - .5) * .03), at(radius, height)];
    });
    const snowline = range.low * (1.1 - layer * .15);
    const face = (a, b, c) => {
      const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      if (normal.dot(a) > 0) { [b, c] = [c, b]; normal.negate(); }
      const lit = smoothstep(-.2, .6, normal.dot(light)), middle = (a.y + b.y + c.y) / 3;
      const color = middle > snowline || (middle > snowline * .7 && normal.y > .45)
        ? snowShade.clone().lerp(snow, lit) : shade.clone().lerp(rock, lit);
      // Farther ranges and lower slopes sink into the haze.
      color.lerp(horizon, .25 + layer * .17 + .4 * (1 - smoothstep(0, range.high, middle)));
      for (const p of [a, b, c]) { positions.push(p.x, p.y, p.z); colors.push(color.r, color.g, color.b); }
    };
    for (let j = 0; j < STEPS; j++) {
      const a = rows[j], b = rows[(j + 1) % STEPS];
      face(a[0], b[0], a[1]); face(b[0], b[1], a[1]);
      face(a[1], b[1], a[2]); face(b[1], b[2], a[2]);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return g;
}

export const ALPINE_HORIZON = HORIZON;

export class AlpineSky {
  constructor(parent) {
    this.group = new THREE.Group(); this.group.name = 'alpine-sky'; parent.add(this.group);
    this.domeGeometry = new THREE.SphereGeometry(1000, 32, 16);
    this.domeMaterial = domeMaterial();
    this.dome = new THREE.Mesh(this.domeGeometry, this.domeMaterial); this.dome.name = 'alpine-sky-dome';
    this.dome.renderOrder = 1000; this.dome.frustumCulled = false;
    this.rangeGeometry = ranges();
    this.rangeMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
    this.ranges = new THREE.Mesh(this.rangeGeometry, this.rangeMaterial); this.ranges.name = 'alpine-distant-ranges';
    this.ranges.frustumCulled = false;
    for (const mesh of [this.dome, this.ranges]) { mesh.userData.ambientOcclusion = false; this.group.add(mesh); }
  }
  follow(x, y, z) { this.group.position.set(x, y, z); }
  dispose() {
    this.group.removeFromParent();
    for (const resource of [this.domeGeometry, this.domeMaterial, this.rangeGeometry, this.rangeMaterial]) resource.dispose();
  }
}
