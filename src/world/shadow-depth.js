import * as THREE from 'three';

// Three.js shares one MeshDepthMaterial across shadow casters, so mixing plain,
// instanced and instance-coloured meshes switches its program on most shadow
// draws. One material per signature keeps each program cached. The renderer
// still copies side, alphaTest and maps from the caster's material.
const shadowSide = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const depthMaterials = new Map();

function depthMaterial(object, material) {
  const side = material.shadowSide ?? shadowSide[material.side] ?? THREE.BackSide;
  const kind = object.isInstancedMesh ? (object.instanceColor ? 'instanced-colored' : 'instanced') : 'mesh';
  const key = `${kind}/${side}`;
  let depth = depthMaterials.get(key);
  if (!depth) {
    // r186 PCF shadows sample a native depth texture, so skip packed RGBA
    // output and colour writes.
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, colorWrite: false, side });
    depth.name = `shadow-depth-${key}`;
    depthMaterials.set(key, depth);
  }
  return depth;
}

// renderer.compile() skips the shadow pass, so a caster in a later chunk would
// link its depth program mid-drive. These stand-ins let rendering.js compile
// them early. A depth program's key follows its material, the instancing and
// whether the geometry has normals.
const standIns = new Map(), casters = new THREE.Group();
const bare = new THREE.BufferGeometry();
bare.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
const shaded = bare.clone();
shaded.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3));

export function shadowCasterStandIns(root) {
  casters.clear();
  root.traverse(object => {
    const depth = object.customDepthMaterial;
    if (!object.isMesh || !object.castShadow || !depth) return;
    const colored = Boolean(object.instanceColor), normals = Boolean(object.geometry.attributes.normal);
    const key = `${depth.uuid}/${object.isInstancedMesh}/${colored}/${normals}`;
    let standIn = standIns.get(key);
    if (!standIn) {
      const geometry = normals ? shaded : bare;
      standIn = object.isInstancedMesh ? new THREE.InstancedMesh(geometry, depth, 1) : new THREE.Mesh(geometry, depth);
      if (colored) standIn.setColorAt(0, new THREE.Color());
      standIns.set(key, standIn);
    }
    casters.add(standIn);
  });
  return casters;
}

// Materials the renderer builds its own depth variant for (cutouts,
// displacement, clipped shadows) keep the stock path.
const needsOwnVariant = material => Boolean(material.displacementMap && material.displacementScale !== 0)
  || Boolean(material.alphaMap && material.alphaTest > 0) || Boolean(material.map && material.alphaTest > 0)
  || material.alphaToCoverage === true || (material.clipShadows && material.clippingPlanes?.length);

export function stableShadowDepth(object) {
  if (!object.isMesh || !object.castShadow || object.customDepthMaterial) return;
  const material = object.material;
  if (Array.isArray(material) || needsOwnVariant(material)) return;
  object.customDepthMaterial = depthMaterial(object, material);
}
