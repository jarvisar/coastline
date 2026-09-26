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
