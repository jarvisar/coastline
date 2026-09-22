import * as THREE from 'three';
import { randomAt, lerp, smoothstep } from './route.js';
import { volcanicPalette } from './volcanic-palette.js';

// A great stratovolcano stands on the horizon ahead, erupting. Like the sky
// it travels with the car, so it keeps its bearing and never draws nearer; it
// sits beyond the fog and fades into the haze instead. Only the road-level
// cameras look far enough along the horizon to see it.
const ERUPTION_DIRECTION = new THREE.Vector3(-.36, 0, -.93).normalize();
const DISTANCE = 900, SIDES = 15, PUFFS = 64;
// The crater lip is breached on the side facing the road, where lava pours out.
const FRONT = Math.atan2(-ERUPTION_DIRECTION.z, -ERUPTION_DIRECTION.x);
const centre = ERUPTION_DIRECTION.clone().multiplyScalar(DISTANCE);
// Ring radius and height, from a foot hidden in the haze up to the crater lip.
// The foot stays narrow enough never to reach the edge of an overhead view.
const PROFILE = [[330, -55], [215, 52], [134, 124], [80, 178], [52, 206]];
export const CRATER = new THREE.Vector3(centre.x, 196, centre.z);

const light = new THREE.Vector3(-.5, .62, .6).normalize(), toward = new THREE.Vector3(-ERUPTION_DIRECTION.x, .2, -ERUPTION_DIRECTION.z).normalize();
const color = hex => new THREE.Color(hex);
const shadowSide = color('#1d1a24'), litSide = color('#403645'), ember = color('#ff8a2a'), molten = color('#ffc15a');
const lavaRamp = ['#ffe08a', '#ffab35', '#fa6510', '#c7300c', '#6e1a0e', '#2a1618'].map(color);

function profileRadius(y) {
  for (let i = 1; i < PROFILE.length; i++) if (y <= PROFILE[i][1]) {
    return lerp(PROFILE[i - 1][0], PROFILE[i][0], (y - PROFILE[i - 1][1]) / (PROFILE[i][1] - PROFILE[i - 1][1]));
  }
  return PROFILE.at(-1)[0];
}
function ramp(t) {
  const f = THREE.MathUtils.clamp(t, 0, .9999) * (lavaRamp.length - 1), i = Math.floor(f);
  return lavaRamp[i].clone().lerp(lavaRamp[i + 1], f - i);
}

function mountain() {
  const positions = [], colors = [], horizon = color(volcanicPalette.horizon), normal = new THREE.Vector3();
  const face = (a, b, c, tint) => {
    normal.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (normal.y < 0) { [b, c] = [c, b]; normal.negate(); }
    const shade = typeof tint === 'function' ? tint(normal, (a.y + b.y + c.y) / 3) : tint;
    for (const p of [a, b, c]) { positions.push(p.x, p.y, p.z); colors.push(shade.r, shade.g, shade.b); }
  };
  // Distance lifts the shadows and drains colour: the foot dissolves into the
  // haze that also hides the far terrain, the summit stays a crisp silhouette.
  const rock = (n, y) => {
    const lit = Math.max(0, n.dot(light)), glow = smoothstep(120, 206, y) * Math.max(0, n.dot(toward));
    return shadowSide.clone().lerp(litSide, lit).lerp(horizon, .18 + .72 * (1 - smoothstep(-70, 150, y))).add(ember.clone().multiplyScalar(.035 * glow));
  };
  const rings = PROFILE.map(([radius, y], level) => Array.from({ length: SIDES }, (_, k) => {
    const angle = k / SIDES * Math.PI * 2 + level * .08 + (randomAt(k, level + 8300) - .5) * .14;
    const ridge = level < PROFILE.length - 1 ? (k % 2 ? .9 : 1.05) * (.92 + randomAt(k, level + 8310) * .16) : 1;
    const breach = level === PROFILE.length - 1 ? -8 * Math.max(0, Math.cos(angle - FRONT)) ** 4 + (randomAt(k, 8320) - .5) * 14 : 0;
    return new THREE.Vector3(centre.x + Math.cos(angle) * radius * ridge, y + breach, centre.z + Math.sin(angle) * radius * ridge);
  }));
  for (let level = 0; level < rings.length - 1; level++) for (let k = 0; k < SIDES; k++) {
    const next = (k + 1) % SIDES, a = rings[level][k], b = rings[level][next], c = rings[level + 1][k], d = rings[level + 1][next];
    face(a, b, d, rock); face(a, d, c, rock);
  }
  // The crater: an inner wall lit from the lava pond that fills it.
  const lip = rings.at(-1), floor = lip.map(p => new THREE.Vector3(lerp(CRATER.x, p.x, .62), CRATER.y - 6, lerp(CRATER.z, p.z, .62)));
  const throat = ember.clone().multiplyScalar(.28).lerp(shadowSide, .35);
  for (let k = 0; k < SIDES; k++) {
    const next = (k + 1) % SIDES;
    face(lip[k], floor[next], lip[next], throat); face(lip[k], floor[k], floor[next], throat);
    face(new THREE.Vector3(CRATER.x, CRATER.y - 6, CRATER.z), floor[k], floor[next], molten);
  }
  // Lava pours through the breach and down three gullies on the near flank,
  // bright at the lip and dimming to a dull crust where it slows. Each sample
  // is cast onto the finished flank so the flows lie in its facets.
  const flank = new THREE.BufferGeometry();
  flank.setAttribute('position', new THREE.Float32BufferAttribute(positions.slice(), 3));
  const surface = new THREE.Mesh(flank), caster = new THREE.Raycaster(), inward = new THREE.Vector3();
  const onFlank = (angle, y) => {
    inward.set(-Math.cos(angle), 0, -Math.sin(angle));
    caster.set(new THREE.Vector3(centre.x + Math.cos(angle) * 700, y, centre.z + Math.sin(angle) * 700), inward);
    const hit = caster.intersectObject(surface)[0];
    return hit && hit.point.addScaledVector(hit.face.normal, 1.8);
  };
  for (const [offset, length, width] of [[0, .74, 10], [-.34, .5, 6], [.3, .4, 5.5]]) {
    let previous;
    for (let step = 0; step <= 16; step++) {
      const t = step / 16, y = lerp(198, lerp(198, -40, length), t);
      const angle = FRONT + offset + Math.sin(t * 5 + offset * 9) * .05, half = width * (1 - .55 * t) / 2 / profileRadius(y);
      const row = [-half, half].map(turn => onFlank(angle + turn, y));
      if (row.every(Boolean) && previous) {
        const tint = ramp(Math.min(1, t * 1.15 + (offset ? .15 : 0))).lerp(horizon, .12 + .55 * t * t);
        face(previous[0], previous[1], row[1], tint); face(previous[0], row[1], row[0], tint);
      }
      previous = row.every(Boolean) ? row : null;
    }
  }
  flank.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return g;
}

// The ash column: faceted puffs that leave the crater fast, slow as they climb
// and spread into a leaning head. Each puff's phase, spin and size ride along
// as attributes, so the column animates entirely on the GPU.
function column() {
  const puff = new THREE.IcosahedronGeometry(1, 1), source = puff.attributes.position, positions = [], seeds = [];
  for (let n = 0; n < PUFFS; n++) {
    const phase = n / PUFFS + randomAt(n, 8340) * .02, spin = randomAt(n, 8341), size = .8 + randomAt(n, 8342) * .4;
    for (let i = 0; i < source.count; i++) { positions.push(source.getX(i), source.getY(i), source.getZ(i)); seeds.push(phase, spin, size); }
  }
  puff.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('plumeSeed', new THREE.Float32BufferAttribute(seeds, 3));
  g.boundingSphere = new THREE.Sphere(CRATER.clone().add(new THREE.Vector3(120, 300, 0)), 520);
  return g;
}

export class VolcanicBackdrop {
  constructor(group) {
    this.group = new THREE.Group(); this.group.name = 'volcanic-backdrop'; group.add(this.group);
    this.clock = { value: 0 };
    this.mountainGeometry = mountain();
    this.mountainMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
    this.mountain = new THREE.Mesh(this.mountainGeometry, this.mountainMaterial); this.mountain.name = 'volcanic-distant-volcano';
    this.columnGeometry = column();
    this.columnMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, toneMapped: false });
    const wind = new THREE.Vector3(ERUPTION_DIRECTION.z, 0, -ERUPTION_DIRECTION.x).multiplyScalar(.85).add(ERUPTION_DIRECTION.clone().multiplyScalar(.35));
    this.columnMaterial.onBeforeCompile = shader => {
      shader.uniforms.plumeTime = this.clock;
      shader.vertexShader = `uniform float plumeTime; attribute vec3 plumeSeed; varying float vPlumeAge; varying float vPlumeRise; varying vec3 vPlumeShape; varying float vPlumeEdge;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        float age = fract(plumeSeed.x + plumeTime * .0085);
        float rise = pow(age, .72);
        float swirl = plumeSeed.y * 6.2832 + age * 5.0;
        vec3 wind = vec3(${wind.x.toFixed(4)}, 0.0, ${wind.z.toFixed(4)});
        vec3 centre = vec3(${CRATER.x.toFixed(2)}, ${CRATER.y.toFixed(2)}, ${CRATER.z.toFixed(2)})
          + wind * age * age * 380.0 + vec3(sin(swirl), 0.0, cos(swirl)) * age * 34.0 + vec3(0.0, rise * 540.0, 0.0);
        float radius = (20.0 + age * 160.0) * plumeSeed.z;
        // A tall jet leaves the vent; higher up the puffs flatten into the head.
        vec3 transformed = centre + position * radius * vec3(1.0, mix(2.1, .72, smoothstep(0.0, .55, age)), 1.0);
        vPlumeAge = age; vPlumeRise = rise; vPlumeShape = position;
        vec3 towardCamera = normalize(-(modelViewMatrix * vec4(centre, 1.0)).xyz);
        vPlumeEdge = abs(dot(normalize(normalMatrix * position), towardCamera));
      `);
      shader.fragmentShader = `varying float vPlumeAge; varying float vPlumeRise; varying vec3 vPlumeShape; varying float vPlumeEdge;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        // Dark ash, lit copper from the crater below and faintly rose on top
        // where the last of the daylight reaches it. Linear colours.
        vec3 facet = normalize(cross(dFdx(vPlumeShape), dFdy(vPlumeShape)));
        float lit = max(0.0, dot(facet, normalize(vec3(-.5, .75, .45))));
        vec3 ash = mix(vec3(.034, .028, .034), vec3(.1, .075, .085), lit);
        float fire = (1.0 - smoothstep(.0, .3, vPlumeRise)) * (.2 + .8 * smoothstep(-.1, -.8, vPlumeShape.y));
        diffuseColor.rgb = ash + vec3(.42, .1, .02) * fire * fire + vec3(.12, .035, .012) * fire;
        diffuseColor.a = smoothstep(0.0, .035, vPlumeAge) * (1.0 - smoothstep(.62, 1.0, vPlumeAge)) * smoothstep(.04, .55, vPlumeEdge) * .94;
      `);
    };
    this.columnMaterial.customProgramCacheKey = () => 'volcanic-eruption-column-v1';
    this.column = new THREE.Mesh(this.columnGeometry, this.columnMaterial); this.column.name = 'volcanic-eruption-column';
    for (const mesh of [this.mountain, this.column]) { mesh.userData.ambientOcclusion = false; this.group.add(mesh); }
    this.column.renderOrder = 1;
  }
  update(time, x, y, z) { this.clock.value = time; this.group.position.set(x, y, z); }
  dispose() {
    this.group.removeFromParent();
    for (const resource of [this.mountainGeometry, this.mountainMaterial, this.columnGeometry, this.columnMaterial]) resource.dispose();
  }
}
