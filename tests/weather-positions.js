// Read the motion inputs as positions for simulation assertions. The browser
// weather test separately executes the real GLSL and checks it against the
// original seeded motion equations, including long drives and time rebasing.
export function weatherPositions(weather) {
  const { position, weatherMotion } = weather.geometry.attributes;
  const u = weather.motion.uniforms, anchor = u.weatherAnchor.value;
  const drift = u.weatherDrift.value, waves = u.weatherWaves.value;
  const result = new Float32Array(position.array.length);
  const wrap = (value, extent) => value - Math.floor(value / extent) * extent - extent / 2;
  for (let i = 0; i < position.count; i++) {
    result[i * 3] = wrap(position.getX(i) + drift.x + (waves.x * weatherMotion.getZ(i) + waves.y * weatherMotion.getY(i)) * 2.1 - anchor.x, 300);
    result[i * 3 + 1] = wrap(position.getY(i) - u.weatherTime.value * weatherMotion.getX(i) - anchor.y, 200);
    result[i * 3 + 2] = wrap(position.getZ(i) + drift.y + waves.w * weatherMotion.getZ(i) - waves.z * weatherMotion.getY(i) - anchor.z, 360);
  }
  return result;
}
