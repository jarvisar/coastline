import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Give each coplanar patch one owner. Later faces (trim, glazing, masonry)
// replace only the covered portion of earlier faces, keeping their shared
// boundary on the original plane. This is construction-time geometry work,
// not a depth bias, so shadows and every camera view use the same joins.
// Use on a single-material, static surface batch before computing bounds.
export function joinCoplanarFaces(geometry) {
  if (geometry.groups.length) throw new Error('Join material batches separately');
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const attributes = Object.entries(source.attributes), position = source.attributes.position;
  const triangles = [], buckets = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), edge = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
    const normal = b.clone().sub(a).cross(edge.subVectors(c, a));
    if (normal.lengthSq() < 1e-16) continue;
    normal.normalize();
    const components = normal.toArray().map(Math.abs), dominant = components.indexOf(Math.max(...components));
    const axes = [0, 1, 2].filter(axis => axis !== dominant);
    const points = [a, b, c].map(p => [p.getComponent(axes[0]), p.getComponent(axes[1])]);
    const triangle = { i, normal, vertices: [a.toArray(), b.toArray(), c.toArray()], distance: normal.dot(a), axes, points,
      min: [0, 1].map(j => Math.min(...points.map(p => p[j]))),
      max: [0, 1].map(j => Math.max(...points.map(p => p[j]))) };
    const quantized = normal.toArray().map(v => Math.round(v * 100));
    triangle.key = quantized.join(',');
    const [low, high] = planeRange(triangle.vertices, quantized);
    for (let plane = low; plane <= high; plane++) {
      const key = `${triangle.key}/${plane}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(triangle);
    }
    triangles.push(triangle);
  }
  const output = attributes.map(() => []);
  let changed = false;
  const vertex = i => attributes.flatMap(([, attribute]) => Array.from({ length: attribute.itemSize }, (_, j) => attribute.getComponent(i, j)));
  const positionOffset = attributes.slice(0, attributes.findIndex(([name]) => name === 'position')).reduce((sum, [, attr]) => sum + attr.itemSize, 0);
  for (const triangle of triangles) {
    const project = v => triangle.axes.map(axis => v[positionOffset + axis]);
    let pieces = [[vertex(triangle.i), vertex(triangle.i + 1), vertex(triangle.i + 2)]];
    // Float32 rotations can put an otherwise shared normal on either side
    // of a bin boundary. Search that neighboring bin as well.
    const bins = triangle.normal.toArray().map(v => {
      const scaled = v * 100, rounded = Math.round(scaled), remainder = scaled - rounded;
      return Math.abs(remainder) > .4 ? [rounded, rounded + Math.sign(remainder)] : [rounded];
    });
    const candidates = new Set();
    for (const x of bins[0]) for (const y of bins[1]) for (const z of bins[2]) {
      const [low, high] = planeRange(triangle.vertices, [x, y, z]);
      for (let plane = low; plane <= high; plane++) {
        for (const mask of buckets.get(`${x},${y},${z}/${plane}`) ?? []) candidates.add(mask);
      }
    }
    for (const mask of candidates) {
      if (mask.i <= triangle.i ||
          triangle.min.some((v, j) => v >= mask.max[j] - 1e-7 || triangle.max[j] <= mask.min[j] + 1e-7)) continue;
      // Quantized normals are only a broad phase. Verify the actual planes;
      // nearby parallel surfaces and intersecting slopes must stay intact.
      let coplanar = true;
      for (let j = 0; j < 3; j++) {
        a.fromBufferAttribute(position, mask.i + j);
        // A millimeter accommodates normals reconstructed from very thin
        // Float32 trim faces. Deliberately raised surface layers stay apart.
        if (Math.abs(triangle.normal.dot(a) - triangle.distance) > .001) { coplanar = false; break; }
      }
      if (!coplanar || triangle.normal.dot(mask.normal) < .999999) continue;
      const outline = [0, 1, 2].map(j => { a.fromBufferAttribute(position, mask.i + j); return triangle.axes.map(axis => a.getComponent(axis)); });
      const next = [];
      for (const polygon of pieces) {
        const { inside, outside } = subtract(polygon, outline, project);
        if (area(inside.map(project)) > 1e-8) { next.push(...outside); changed = true; }
        else next.push(polygon);
      }
      pieces = next;
      if (!pieces.length) break;
    }
    // Clipping can leave extra points along a straight edge. Remove those
    // before triangulating so repeated railings do not gain needless faces.
    for (const piece of pieces) {
      const polygon = [...piece];
      for (let i = polygon.length - 1; i >= 0 && polygon.length >= 3; i--) {
        if (Math.abs(cross(project(polygon[(i + polygon.length - 1) % polygon.length]),
          project(polygon[i]), project(polygon[(i + 1) % polygon.length]))) < 1e-9) polygon.splice(i, 1);
      }
      for (let j = 1; j < polygon.length - 1; j++) {
        const face = [polygon[0], polygon[j], polygon[j + 1]];
        if (area(face.map(project)) < 1e-10) continue;
        for (const v of face) {
          let offset = 0;
          attributes.forEach(([, attribute], k) => {
            for (let n = 0; n < attribute.itemSize; n++) output[k].push(v[offset++]);
          });
        }
      }
    }
  }
  if (changed) {
    geometry.setIndex(null);
    attributes.forEach(([name, attribute], i) => {
      const result = new THREE.BufferAttribute(new attribute.array.constructor(output[i].length), attribute.itemSize, attribute.normalized);
      for (let j = 0; j < output[i].length; j++) result.setComponent(Math.floor(j / attribute.itemSize), j % attribute.itemSize, output[i][j]);
      geometry.setAttribute(name, result);
    });
    geometry.boundingBox = null; geometry.boundingSphere = null;
    if (source !== geometry) {
      const indexed = mergeVertices(geometry, 1e-6);
      geometry.setIndex(indexed.index);
      for (const [name, attribute] of Object.entries(indexed.attributes)) geometry.setAttribute(name, attribute);
      indexed.dispose();
    }
  }
  if (source !== geometry) source.dispose();
  return geometry;
}

const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
function planeRange(vertices, normal) {
  const distances = vertices.map(p => (p[0] * normal[0] + p[1] * normal[1] + p[2] * normal[2]) / 10);
  return [Math.floor(Math.min(...distances) - .001), Math.floor(Math.max(...distances) + .001)];
}
function area(points) {
  if (points.length < 3) return 0;
  // Relative coordinates avoid cancellation in chunks far from the origin.
  let sum = 0;
  for (let i = 1; i < points.length - 1; i++) sum += cross(points[0], points[i], points[i + 1]);
  return Math.abs(sum) / 2;
}
function subtract(polygon, outline, project) {
  const sign = Math.sign(cross(...outline)), outside = [];
  let inside = polygon;
  for (let i = 0; i < 3 && inside.length >= 3; i++) {
    const a = outline[i], b = outline[(i + 1) % 3], keep = [], cut = [];
    for (let j = 0; j < inside.length; j++) {
      const p = inside[j], q = inside[(j + 1) % inside.length];
      const dp = sign * cross(a, b, project(p)), dq = sign * cross(a, b, project(q));
      if (dp >= 0) keep.push(p);
      if (dp <= 0) cut.push(p);
      if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) {
        const t = dp / (dp - dq), intersection = p.map((v, k) => v + (q[k] - v) * t);
        keep.push(intersection); cut.push(intersection);
      }
    }
    if (cut.length >= 3) outside.push(cut);
    inside = keep;
  }
  return { inside, outside };
}

// Extrude a roof cross-section as one closed shell. Ridge and pitch changes
// share vertices instead of intersecting the square ends of rotated slabs.
export function roofShell(profile, length, thickness = .22) {
  const outline = [...profile, ...profile.toReversed().map(([x, y]) => [x, y - thickness])];
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geometry.translate(0, 0, -length / 2); geometry.clearGroups();
  return geometry;
}
