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
  const attributes = Object.entries(source.attributes), position = source.attributes.position, faces = Math.floor(position.count / 3);
  // Faces are read once into flat arrays. A chunk's rock or street batch holds
  // tens of thousands of them, and objects per face cost more than the joins.
  const corner = new Float64Array(faces * 9), normal = new Float64Array(faces * 3), distance = new Float64Array(faces);
  const first = new Uint8Array(faces), second = new Uint8Array(faces), bounds = new Float64Array(faces * 4), plane = [0, 0];
  for (let v = 0; v < faces * 3; v++) { corner[v * 3] = position.getX(v); corner[v * 3 + 1] = position.getY(v); corner[v * 3 + 2] = position.getZ(v); }
  // Faces by quantized normal, then 10 m plane band, then grid cell.
  const triangles = [], buckets = new Map();
  for (let f = 0; f < faces; f++) {
    const p = f * 9, ax = corner[p], ay = corner[p + 1], az = corner[p + 2];
    const ux = corner[p + 3] - ax, uy = corner[p + 4] - ay, uz = corner[p + 5] - az;
    const vx = corner[p + 6] - ax, vy = corner[p + 7] - ay, vz = corner[p + 8] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const lengthSq = nx * nx + ny * ny + nz * nz;
    if (lengthSq < 1e-16) continue;
    const scale = 1 / (Math.sqrt(lengthSq) || 1);
    nx *= scale; ny *= scale; nz *= scale;
    normal[f * 3] = nx; normal[f * 3 + 1] = ny; normal[f * 3 + 2] = nz;
    distance[f] = nx * ax + ny * ay + nz * az;
    // Project onto the two axes the face is least steep across.
    const x = Math.abs(nx), y = Math.abs(ny), z = Math.abs(nz), dominant = x >= y && x >= z ? 0 : y >= z ? 1 : 2;
    const s = first[f] = dominant === 0 ? 1 : 0, t = second[f] = dominant === 2 ? 1 : 2;
    bounds[f * 4] = Math.min(corner[p + s], corner[p + 3 + s], corner[p + 6 + s]);
    bounds[f * 4 + 1] = Math.min(corner[p + t], corner[p + 3 + t], corner[p + 6 + t]);
    bounds[f * 4 + 2] = Math.max(corner[p + s], corner[p + 3 + s], corner[p + 6 + s]);
    bounds[f * 4 + 3] = Math.max(corner[p + t], corner[p + 3 + t], corner[p + 6 + t]);
    const qx = Math.round(nx * 100), qy = Math.round(ny * 100), qz = Math.round(nz * 100), code = normalCode(qx, qy, qz);
    planeRange(corner, p, qx, qy, qz, plane);
    if (!buckets.has(code)) buckets.set(code, new Map());
    const planes = buckets.get(code);
    for (let band = plane[0]; band <= plane[1]; band++) {
      if (!planes.has(band)) planes.set(band, new Map());
      const cells = planes.get(band);
      // Broad, level ground puts thousands of faces on one plane. A coarse
      // grid over each plane keeps a face's search to its own neighbourhood.
      const x0 = cell(bounds[f * 4]), x1 = cell(bounds[f * 4 + 2]), z0 = cell(bounds[f * 4 + 1]), z1 = cell(bounds[f * 4 + 3]);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const key = cellKey(cx, cz), list = cells.get(key);
        if (list) list.push(f); else cells.set(key, [f]);
      }
    }
    triangles.push(f);
  }
  // Bounds that meet, then the actual planes: quantized normals are only a
  // broad phase, and nearby parallel surfaces and intersecting slopes must
  // stay intact.
  const overlaps = (f, m) => {
    const a = f * 4, b = m * 4;
    if (bounds[a] >= bounds[b + 2] - 1e-7 || bounds[a + 2] <= bounds[b] + 1e-7
      || bounds[a + 1] >= bounds[b + 3] - 1e-7 || bounds[a + 3] <= bounds[b + 1] + 1e-7) return false;
    const nx = normal[f * 3], ny = normal[f * 3 + 1], nz = normal[f * 3 + 2];
    // A millimeter accommodates normals reconstructed from very thin
    // Float32 trim faces. Deliberately raised surface layers stay apart.
    for (let j = m * 9; j < m * 9 + 9; j += 3) if (Math.abs(nx * corner[j] + ny * corner[j + 1] + nz * corner[j + 2] - distance[f]) > .001) return false;
    return nx * normal[m * 3] + ny * normal[m * 3 + 1] + nz * normal[m * 3 + 2] >= .999999;
  };
  let changed = false;
  const stride = attributes.reduce((sum, [, attribute]) => sum + attribute.itemSize, 0);
  const vertex = i => {
    const values = new Array(stride);
    let offset = 0;
    for (const [, attribute] of attributes) for (let j = 0; j < attribute.itemSize; j++) values[offset++] = attribute.getComponent(i, j);
    return values;
  };
  const corners = f => [[vertex(f * 3), vertex(f * 3 + 1), vertex(f * 3 + 2)]];
  const positionOffset = attributes.slice(0, attributes.findIndex(([name]) => name === 'position')).reduce((sum, [, attr]) => sum + attr.itemSize, 0);
  const projection = f => {
    const s = positionOffset + first[f], t = positionOffset + second[f];
    return v => [v[s], v[t]];
  };
  // Most faces overlap nothing. They are read in full only once another face
  // actually clips them, or when the joined batch is finally rebuilt.
  const clipped = new Array(faces).fill(null), seen = new Int32Array(faces).fill(-1), masks = [], bins = [[], [], []];
  for (const f of triangles) {
    // Float32 rotations can put an otherwise shared normal on either side
    // of a bin boundary. Search that neighboring bin as well.
    for (let j = 0; j < 3; j++) {
      const scaled = normal[f * 3 + j] * 100, rounded = Math.round(scaled), remainder = scaled - rounded;
      bins[j].length = 0; bins[j].push(rounded);
      if (Math.abs(remainder) > .4) bins[j].push(rounded + Math.sign(remainder));
    }
    // Faces whose bounds can meet this one share a cell with it. They clip it
    // in the order a search of whole planes finds them: by normal bin, then
    // plane, then build order. A face met again in a later bin or plane was
    // already considered at its first.
    const x0 = cell(bounds[f * 4]), x1 = cell(bounds[f * 4 + 2]), z0 = cell(bounds[f * 4 + 1]), z1 = cell(bounds[f * 4 + 3]);
    let group = 0;
    masks.length = 0;
    for (const qx of bins[0]) for (const qy of bins[1]) for (const qz of bins[2]) {
      const planes = buckets.get(normalCode(qx, qy, qz));
      if (!planes) continue;
      planeRange(corner, f * 9, qx, qy, qz, plane);
      for (let band = plane[0]; band <= plane[1]; band++, group++) {
        const cells = planes.get(band);
        if (!cells) continue;
        for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
          // Lists are in build order, and only later faces can clip this one.
          const list = cells.get(cellKey(cx, cz));
          if (list) for (let k = list.length - 1; k >= 0 && list[k] > f; k--) {
            const m = list[k];
            if (seen[m] === f) continue;
            seen[m] = f;
            if (overlaps(f, m)) masks.push(group, m);
          }
        }
      }
    }
    if (!masks.length) continue;
    const order = [];
    for (let k = 0; k < masks.length; k += 2) order.push(k);
    order.sort((p, q) => masks[p] - masks[q] || masks[p + 1] - masks[q + 1]);
    const project = projection(f), s = first[f], t = second[f];
    let pieces = corners(f);
    for (const k of order) {
      const m = masks[k + 1] * 9;
      const outline = [0, 3, 6].map(j => [corner[m + j + s], corner[m + j + t]]);
      const next = [];
      for (const polygon of pieces) {
        const { inside, outside } = subtract(polygon, outline, project);
        if (area(inside.map(project)) > 1e-8) { next.push(...outside); changed = true; }
        else next.push(polygon);
      }
      pieces = next;
      if (!pieces.length) break;
    }
    clipped[f] = pieces;
  }
  if (changed) {
    // Each face kept whole is its index; a clipped one leaves the triangles of
    // its remaining pieces.
    const emitted = [];
    for (const f of triangles) {
      const pieces = clipped[f];
      if (!pieces) {
        // An untouched face is copied as it is, unless it is too thin to keep.
        const p = f * 9, s = first[f], t = second[f];
        const a = [corner[p + s], corner[p + t]], b = [corner[p + 3 + s], corner[p + 3 + t]], c = [corner[p + 6 + s], corner[p + 6 + t]];
        if (Math.abs(cross(b, c, a)) >= 1e-9 && Math.abs(cross(a, b, c)) >= 1e-9 && Math.abs(cross(c, a, b)) >= 1e-9 && area([a, b, c]) >= 1e-10) emitted.push(f);
        continue;
      }
      const project = projection(f);
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
          if (area(face.map(project)) >= 1e-10) emitted.push(face);
        }
      }
    }
    geometry.setIndex(null);
    let offset = 0;
    for (const [name, attribute] of attributes) {
      const size = attribute.itemSize, from = offset;
      const result = new THREE.BufferAttribute(new attribute.array.constructor(emitted.length * 3 * size), size, attribute.normalized), array = result.array;
      // Plain arrays take the values as they are; normalized ones re-encode them.
      const put = attribute.normalized ? (i, n, value) => result.setComponent(i, n, value) : (i, n, value) => { array[i * size + n] = value; };
      let i = 0;
      for (const face of emitted) {
        if (typeof face === 'number') for (let v = face * 3; v < face * 3 + 3; v++, i++) for (let n = 0; n < size; n++) put(i, n, attribute.getComponent(v, n));
        else for (const v of face) { for (let n = 0; n < size; n++) put(i, n, v[from + n]); i++; }
      }
      geometry.setAttribute(name, result);
      offset += size;
    }
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
// Small integer keys, which a Map finds without allocating. A quantized normal
// has components within ±101. Grid cells wrap every 262 km; faces that far
// apart can share a list, but never overlap, so they are passed over.
const normalCode = (x, y, z) => ((x + 128) * 256 + y + 128) * 256 + z + 128;
const CELL = 8;
const cell = value => Math.floor(value / CELL);
const cellKey = (x, z) => ((x & 0x7fff) << 15) | (z & 0x7fff);
function planeRange(corner, p, x, y, z, range) {
  let low = Infinity, high = -Infinity;
  for (let j = p; j < p + 9; j += 3) {
    const distance = (corner[j] * x + corner[j + 1] * y + corner[j + 2] * z) / 10;
    low = Math.min(low, distance); high = Math.max(high, distance);
  }
  range[0] = Math.floor(low - .001); range[1] = Math.floor(high + .001);
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
