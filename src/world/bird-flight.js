// Bird models face -Z. The frame follows the path tangent, then banks around it.
export const birdFlightGLSL = /* glsl */`
  float birdHash(float seed) {
    return fract(sin(seed * 127.1 + 311.7) * 43758.5453);
  }
  float birdBeat(float time, float seed, float baseRate) {
    float phase = birdHash(seed + 1.0) * 6.2831853;
    float rate = baseRate * mix(0.82, 1.2, birdHash(seed + 2.0));
    float glide = sin(time * mix(0.32, 0.65, birdHash(seed + 3.0)) + birdHash(seed + 4.0) * 6.2831853);
    float effort = smoothstep(-0.35, 0.45, glide);
    return sin(time * rate + phase + 0.22 * sin(time * 0.8 + phase)) * effort;
  }
  vec3 birdOrbit(float orbit, vec2 radius, float phase) {
    return vec3(radius.x * (cos(orbit) + 0.08 * sin(2.0 * orbit)),
      0.65 * sin(orbit * 2.0 + phase), radius.y * sin(orbit));
  }
  mat3 birdFrame(float orbit, vec2 radius, float phase) {
    vec3 velocity = vec3(radius.x * (-sin(orbit) + 0.16 * cos(2.0 * orbit)),
      1.3 * cos(orbit * 2.0 + phase), radius.y * cos(orbit));
    vec3 forward = normalize(velocity);
    vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, forward);
    float bank = -0.18 - 0.06 * sin(orbit);
    float c = cos(bank), s = sin(bank);
    return mat3(right, up, -forward) * mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
  }
`;
