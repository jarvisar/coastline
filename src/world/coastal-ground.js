import * as THREE from 'three';
import { randomAt, roadFrame, coastOffset, ravineAmount, rockCover, cliffRib, coastalGrove, rangeInfluence, wildflowers, icePlant, pondAt, pondRadius, coastNoise, fieldNoise, clamp, lerp, smoothstep } from './route.js';
import { COAST_SUN } from './coastal-palette.js';

// Ground colours for the coast. Colour comes from slow fields like height,
// slope, aspect and distance from the sea. Per-face jitter stays at a few
// percent, so the flat shading is what picks out the facets.
const color = value => new THREE.Color(value);
const GROUND = {
  sand: color('#dccaa4'), wetSand: color('#a39480'), garnet: color('#8a6276'),
  cliff: color('#b9a688'), cliffBand: color('#9d8a6d'), cliffWarm: color('#cdb58c'), cliffShade: color('#7d7466'),
  serpentine: color('#7f8670'), wetRock: color('#45403a'),
  grass: color('#76924f'), lushGrass: color('#668a46'), sage: color('#7d8a60'), deepGrass: color('#52703f'),
  gold: color('#c9a664'), goldShade: color('#a2885a'), olive: color('#6a7548'),
  rock: color('#a8936f'), rockShade: color('#7a6c58'),
  iceLeaf: color('#6f9a3e'), dust: color('#b4a274'),
  poppy: color('#e47a26'), mustard: color('#d2bf40'),
};
const sunNormal = new THREE.Vector3(...COAST_SUN).normalize();
const sunSide = new THREE.Vector2(COAST_SUN[0], COAST_SUN[2]).normalize();
const edgeA = new THREE.Vector3(), edgeB = new THREE.Vector3(), normal = new THREE.Vector3();


// Colours one terrain triangle. `col` is its terrain column: 6 and below is
// beach and sea floor, 7 to 10 the cliff, 11 the bluff top and 12 on inland.
// Grass comes back as a per-vertex function so flower drifts and damp pond
// banks fade across faces instead of filling them.
export function groundColor(tri, col, r, target = new THREE.Color()) {
  const s = (tri[0].s + tri[1].s + tri[2].s) / 3, u = (tri[0].u + tri[1].u + tri[2].u) / 3, y = (tri[0].y + tri[1].y + tri[2].y) / 3;
  edgeA.set(tri[1].x - tri[0].x, tri[1].y - tri[0].y, tri[1].z - tri[0].z);
  edgeB.set(tri[2].x - tri[0].x, tri[2].y - tri[0].y, tri[2].z - tri[0].z);
  const longestEdgeSq = Math.max(edgeA.lengthSq(), edgeB.lengthSq(), edgeA.distanceToSquared(edgeB));
  normal.crossVectors(edgeA, edgeB);
  const sliver = normal.length() < longestEdgeSq * .12;
  normal.normalize();
  if (normal.y < 0) normal.negate();
  const steep = normal.y < .59, ravine = ravineAmount(s, u);
  const shoreFace = col <= 6 || (ravine > .65 && u < 35);
  // Sand on low ground, including the steeper swash slope into the water.
  // Rim turf skips steep cliff slivers.
  const sandy = shoreFace && (normal.y > .78 || (col <= 6 && ravine < .3)) && Math.max(tri[0].y, tri[1].y, tri[2].y) < 3.5;
  const ledge = tri.rimTurf && normal.y > .5 && !(sliver && normal.y < .7) && ravine < .12;
  const shelf = col >= 10 && col <= 11 && ravine < .12;
  const cover = col >= 12 ? rockCover(s, u) : 0;
  // Summit rock only shows on faces steep enough to shed soil.
  const inlandRock = !shelf && ((steep && u > coastOffset(s) - 10 && (normal.y < .44 || (ravine > .05 && normal.y < .55))) || (cover + (r - .5) * .08 > .52 && normal.y < .9));
  const facing = normal.x * sunSide.x + normal.z * sunSide.y;
  if (sandy) {
    // Darker where the swash keeps it wet, with garnet streaks in some coves.
    target.copy(GROUND.sand).lerp(GROUND.wetSand, 1 - smoothstep(.1, .8, y));
    target.lerp(GROUND.garnet, smoothstep(.62, .82, coastNoise(s, 37, 2311)) * smoothstep(.4, 1.2, y) * .35);
    return target.multiplyScalar(.99 + r * .02);
  }
  if (shoreFace || (col >= 7 && col <= 9 && !ledge) || (!ledge && (col <= 9 || inlandRock))) {
    if (col <= 10) {
      // Bedded sandstone and granite: soft bands by height that wander along
      // the coast, greener serpentine in places and a dark wet foot.
      const band = .5 + .5 * Math.sin(y * 1.7 + s * .021 + coastNoise(s, 29, 2312) * 4);
      target.copy(GROUND.cliff).lerp(GROUND.cliffBand, band * .55);
      target.lerp(GROUND.serpentine, smoothstep(.6, .85, coastNoise(s, 113, 2313)) * .6);
      // Buttress crowns catch the sun and weather paler.
      target.lerp(GROUND.cliffWarm, smoothstep(.5, .9, cliffRib(s, 1)) * smoothstep(6, 14, y) * .5);
      target.lerp(GROUND.cliffShade, smoothstep(.1, -.4, facing) * .25);
      return target.lerp(GROUND.wetRock, 1 - smoothstep(1.6, 4, y)).multiplyScalar(.98 + r * .04);
    }
    // Weathered granite: banded by height like the sea cliffs, darker away from the sun.
    const band = .5 + .5 * Math.sin(y * .45 + s * .013 + u * .02);
    target.copy(GROUND.rock).lerp(GROUND.rockShade, smoothstep(.15, -.35, facing) * .5 + band * .25 + randomAt(Math.floor(s / 21) * 7 + Math.floor(u / 17), 1642) * .12);
    // Low-cover faces blend into the grass. Summits stay bare.
    target.lerp(GROUND.goldShade, (1 - smoothstep(.45, .85, cover)) * smoothstep(.48, .85, normal.y) * .55);
    return target.multiplyScalar(.98 + r * .04);
  }
  // Grass. The bench and roadside stay green, fed by the sea fog. The range
  // goes gold on slopes facing the afternoon sun and stays green in the shade
  // and in the canyons, where the trees are.
  const verge = smoothstep(8, 100, Math.abs(u));
  const patch = fieldNoise(s, u * verge, 61, 2321) * .7 + fieldNoise(s, u, 23, 2322) * .3;
  target.copy(GROUND.grass).lerp(GROUND.lushGrass, smoothstep(.35, .75, patch) * .7);
  target.lerp(GROUND.sage, smoothstep(.55, .8, fieldNoise(s, u, 41, 2323)) * (1 - smoothstep(-6, 30, u)) * .4);
  const grove = lerp(coastalGrove(s, 0), coastalGrove(s, u), verge);
  const range = rangeInfluence(u), height = y - roadFrame(s).y;
  const dry = clamp(range * smoothstep(-.05, .3, facing) + smoothstep(25, 90, height) * .5, 0, 1) * (1 - smoothstep(.45, .75, grove) * .8);
  target.lerp(GROUND.gold, dry * .85);
  target.lerp(GROUND.goldShade, dry * smoothstep(.2, -.2, normal.dot(sunNormal) - .5) * .4);
  target.lerp(GROUND.olive, range * smoothstep(0, .3, -facing) * .55);
  target.lerp(GROUND.deepGrass, smoothstep(.4, .8, grove) * .45);
  // Ice plant mats along the bluff edge, faded per vertex so they don't show the faces.
  const rim = tri.rimTurf || (col === 10 && u < coastOffset(s) + 5) ? clamp(1 - ravine * 3, 0, 1) : 0;
  if (tri.rimTurf) target.lerp(GROUND.dust, smoothstep(.45, .9, cliffRib(s, 1)) * .3);
  target.multiplyScalar(.985 + r * .03);
  const pond = col >= 12 && pondRadius(s, u) < 2.6 ? pondAt(s) : null;
  return p => {
    const vertex = target.clone();
    // Poppies and mustard tint the grass. Lupine stays in the petals, since
    // purple over green turns grey.
    const bloom = wildflowers(p.s, p.u);
    vertex.lerp(GROUND.mustard, smoothstep(.25, .7, bloom.mustard) * .22).lerp(GROUND.poppy, smoothstep(.25, .75, bloom.poppy) * .2);
    if (rim) vertex.lerp(GROUND.iceLeaf, icePlant(p.s) * rim * .6);
    if (pond) vertex.lerp(GROUND.deepGrass, (1 - smoothstep(.65, 2.3, pondRadius(p.s, p.u, pond))) * (1 - smoothstep(pond.level + .5, pond.level + 12, p.y)) * .3);
    return vertex;
  };
}
