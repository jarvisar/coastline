import * as THREE from 'three';

const up = new THREE.Vector3(0, 1, 0);
const heading = new THREE.Euler(0, 0, 0, 'YXZ');
const rotation = new THREE.Quaternion();
const yaw = quaternion => heading.setFromQuaternion(rotation.copy(quaternion), 'YXZ').y;

// The rig follows the game camera; WebXR owns the camera inside it. Moving the
// rig must never overwrite the headset's tracked pose.
export class XRCameraRig {
  constructor() {
    this.rig = new THREE.Group();
    this.camera = new THREE.PerspectiveCamera(60, 1, .1, 1200);
    this.rig.add(this.camera);
    this.origin = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();
    this.offset = new THREE.Vector3();
    this.centered = false;
  }
  recenter() { this.centered = false; }
  update(source, pose) {
    if (!this.centered && pose) {
      this.origin.copy(pose.transform.position);
      // Heading only. Capturing pitch/roll tilts the world for good if the
      // player enters VR looking down at the button.
      this.orientation.setFromAxisAngle(up, -yaw(pose.transform.orientation));
      this.centered = true;
    }
    this.rig.position.copy(source.position);
    if (source.isOrthographicCamera) {
      // Back off so a 60-degree lens matches the overhead framing at its focal
      // plane. The headset supplies the real lenses.
      const distance = (source.top - source.bottom) / (2 * Math.tan(Math.PI / 6));
      source.getWorldDirection(this.offset);
      this.rig.position.addScaledVector(this.offset, source.userData.focusDistance - distance);
    }
    // Yaw only so physical up stays world up on hills. Pitch and roll come from
    // the headset.
    this.rig.quaternion.setFromAxisAngle(up, yaw(source.quaternion)).multiply(this.orientation);
    this.rig.position.sub(this.offset.copy(this.origin).applyQuaternion(this.rig.quaternion));
    this.rig.updateMatrixWorld(true);
  }
}
