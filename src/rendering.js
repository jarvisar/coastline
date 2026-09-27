import * as THREE from 'three';
import { fitSunShadow, stabilizeShadowFiltering } from './shadows.js';
import { ThirdPersonCamera } from './third-person-camera.js';
import { FirstPersonCamera } from './first-person-camera.js';
import { AmbientOcclusion } from './ambient-occlusion.js';
import { Graphics, renderScale } from './graphics.js';
import { XRCameraRig } from './xr-camera.js';
import { volcanicPalette } from './world/volcanic-palette.js';
import { saltPalette, SALT_SUN, SALT_LIGHT } from './world/salt-palette.js';
import { swampPalette, SWAMP_SUN, SWAMP_LIGHT } from './world/swamp-palette.js';

// Overhead follow rates per second. Ground settles fast so steering feels
// immediate. Height stays slow so the view doesn't bob over terrain.
const FOLLOW_GROUND = 8, FOLLOW_HEIGHT = 3;

// Sky, sun and exposure for each route. Overhead views use `fog` as given.
// Driving views fog to the sky colour between thirdNear and thirdFar, so
// resident chunks must always reach past thirdFar.
const ROUTE_LIGHTING = {
  coast: {
    // Blue fill and a near-neutral sun keep the ocean cyan. The sun is about 43°
    // up over the sea so shadows fall inland, slightly brighter to keep flat meadows lit.
    background: '#b5dff5', exposure: 1.02,
    sky: { color: '#c4e5ff', ground: '#365544', intensity: 1.12 },
    sun: { color: '#fff1da', intensity: 3.1, offset: [-190, 215, 125] },
    // The coast range is 100-250 m inland and should show through the haze.
    // The sea mesh reaches 420 m offshore.
    fog: { color: '#b9def3', near: 600, far: 1150, thirdNear: 190, thirdFar: 380 },
  },
  desert: {
    background: '#dfb399', exposure: .92,
    sky: { color: '#e5d8d0', ground: '#79635a', intensity: 1.27 },
    sun: { color: '#ffe0bc', intensity: 2.45, offset: [-170, 150, 120] },
    fog: { color: '#dab49b', near: 460, far: 860, thirdNear: 210, thirdFar: 350 },
  },
  snow: {
    background: '#111f2b', exposure: .91,
    sky: { color: '#91afca', ground: '#2b3b4c', intensity: .72 },
    sun: { color: '#bbd1ea', intensity: 1.16, offset: [-170, 190, -80] },
    fog: { color: '#243949', near: 340, far: 760, thirdNear: 190, thirdFar: 330 },
  },
  jungle: {
    // Weak sun nearly overhead so the canopy shades the road, with strong green fill.
    background: '#a9c4a2', exposure: .9,
    sky: { color: '#c4dcb0', ground: '#2f4d28', intensity: 1.75 },
    sun: { color: '#eef2c4', intensity: 1.35, offset: [-55, 245, 40] },
    fog: { color: '#9ab89a', near: 320, far: 780, thirdNear: 110, thirdFar: 250 },
  },
  plains: {
    // Sun about 20° up for long shadows. Low sun lights flat ground less, so
    // intensity is higher. The cool fill against a warm sun gives the gold look.
    background: '#eeb85e', exposure: .98,
    sky: { color: '#d5dbd0', ground: '#8b7444', intensity: 1.12 },
    sun: { color: '#ffc368', intensity: 3.45, offset: [-188, 92, 127] },
    fog: { color: '#e9b360', near: 500, far: 1000, thirdNear: 200, thirdFar: 360 },
  },
  city: {
    // Overcast. Sky fill does most of the lighting and a weak sun keeps facets readable.
    background: new THREE.Color('#adb7bf').multiplyScalar(.9), exposure: .52,
    sky: { color: '#d8e0e6', ground: '#5c6369', intensity: 2 },
    sun: { color: '#e2e9ef', intensity: 1.3, offset: [-150, 210, 110] },
    fog: { color: new THREE.Color('#aab4bc').multiplyScalar(.9), near: 470, far: 900, thirdNear: 130, thirdFar: 330 },
  },
  volcanic: {
    // Low warm sun with a weaker cool fill to separate lit and shadowed faces.
    background: volcanicPalette.horizon, exposure: 1.1,
    sky: { color: volcanicPalette.skyLight, ground: volcanicPalette.groundLight, intensity: 1.65 },
    sun: { color: volcanicPalette.sun, intensity: 2.55, offset: [-175, 185, 110] },
    fog: { color: volcanicPalette.horizon, near: 290, far: 800, thirdNear: 105, thirdFar: 310 },
  },
  salt: {
    // High sun over white ground. Strong bounce from the salt keeps shadows
    // soft, and a high exposure lifts the crust to a bright cream.
    background: saltPalette.horizon, exposure: 1.48,
    sky: { color: saltPalette.skyLight, ground: saltPalette.groundLight, intensity: SALT_LIGHT.sky },
    sun: { color: saltPalette.sun, intensity: SALT_LIGHT.sun, offset: SALT_SUN },
    // Clear air: the flat reads a long way before it pales into the horizon.
    fog: { color: saltPalette.fog, near: 700, far: 1300, thirdNear: 230, thirdFar: 470 },
  },
  swamp: {
    // Blue hour. A cool moon-and-sky fill keeps the water readable and leaves
    // the headlights, camp windows and fireflies as the only warm light.
    background: swampPalette.horizon, exposure: SWAMP_LIGHT.exposure,
    sky: { color: swampPalette.skyLight, ground: swampPalette.groundLight, intensity: SWAMP_LIGHT.sky },
    sun: { color: swampPalette.sun, intensity: SWAMP_LIGHT.sun, offset: SWAMP_SUN },
    // Dusk haze: the far hammocks soften into blue before the view ends.
    fog: { color: swampPalette.fog, near: 380, far: 880, thirdNear: 120, thirdFar: 300 },
  },
};

export function createRendering(canvas, graphics = new Graphics()) {
  stabilizeShadowFiltering();
  // Multisampling is fixed when the context is created, so the starting level decides it.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: graphics.antialias, powerPreference: 'high-performance' });
  let canvasWidth, canvasHeight, pixelRatio;
  function resizeCanvas() {
    if (renderer.xr.isPresenting) return;
    const width = window.innerWidth, height = window.innerHeight, ratio = renderScale(graphics.settings.density, window.devicePixelRatio);
    if (width === canvasWidth && height === canvasHeight && ratio === pixelRatio) return;
    // Update size and density together: setPixelRatio followed by setSize allocates twice.
    renderer.setDrawingBufferSize(width, height, ratio);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    canvasWidth = width; canvasHeight = height; pixelRatio = ratio;
  }
  resizeCanvas();
  // Only sample frame times while the scene is actually drawing.
  const recordFrame = (timestamp, active) => graphics.sample(timestamp, active);
  document.addEventListener('visibilitychange', () => graphics.suspend());
  window.addEventListener('blur', () => graphics.suspend());
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .94;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#b8dfe0'); scene.fog = new THREE.Fog('#c2e2db', 460, 860);
  // The scene never moves. Auto-updating it makes every static child recompute its world matrix.
  scene.matrixAutoUpdate = false;
  const sky = new THREE.HemisphereLight('#e4f2f5', '#617149', 1.45); scene.add(sky);
  const sun = new THREE.DirectionalLight('#fff1db', 2.5); sun.castShadow = true;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 650; sun.shadow.normalBias = .65; sun.shadow.bias = -.0003; sun.shadow.radius = 2;
  scene.add(sun); scene.add(sun.target);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1200);
  const thirdPerson = new ThirdPersonCamera();
  const firstPerson = new FirstPersonCamera();
  let followedCar;
  const vrCamera = new XRCameraRig();
  scene.add(vrCamera.rig);
  renderer.xr.cameraAutoUpdate = false;
  renderer.xr.addEventListener('sessionend', () => { graphics.suspend(); resizeCanvas(); });
  const ambientOcclusion = new AmbientOcclusion(renderer, scene, camera);
  let journey = 'coast', quality = graphics.settings;
  // Soft edges take 16 shadow-map samples on every lit pixel. The swamp's faint
  // moonlight shadows take one filtered sample instead, to fit phone budgets.
  // The jungle climbs and falls along the route, so its shadow coverage follows the road's height.
  const shadowFloor = () => journey === 'jungle' ? sun.target.position.y : 0;
  function applyShadowSoftness() { sun.shadow.radius = quality.id === 'basic' || journey === 'swamp' ? 0 : 2; }
  // AO on or off is the player's choice, else the device default. The quality level sets everything else.
  // A new shadow map size only takes effect once the old texture is released.
  function applyQuality(settings) {
    quality = settings;
    ambientOcclusion.enabled = settings.ambientOcclusion;
    ambientOcclusion.setQuality(settings.aoQuality);
    applyShadowSoftness();
    if (sun.shadow.mapSize.x !== settings.shadowMap) {
      sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    resizeCanvas();
  }
  applyQuality(graphics.settings);
  graphics.onChange(applyQuality);
  const follow = new THREE.Vector3(); const target = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3(-220, 245, 260);
  const cameraRight = new THREE.Vector3(cameraOffset.z, 0, -cameraOffset.x).normalize();
  const framingOffset = new THREE.Vector3();
  const touchScreen = window.matchMedia('(any-pointer: coarse)');
  const sunOffset = new THREE.Vector3(-110, 240, 100);
  const views = [{ height: 235, label: 'Scenic view' }, { height: 165, label: 'Medium view' }, { height: 115, label: 'Close view' }, { height: 75, label: 'Extra close view' }, { height: 115, label: 'Third-person view', thirdPerson: true }, { height: 115, label: 'First-person view', firstPerson: true }];
  const activeCamera = () => views[view].firstPerson ? firstPerson.camera : views[view].thirdPerson ? thirdPerson.camera : camera;
  let initialized = false; let view = touchScreen.matches ? 2 : 1; let viewHeight = views[view].height; let previousOrigin = 0;
  let snowy = false;
  function updateFog() {
    const profile = ROUTE_LIGHTING[journey].fog;
    // Driving views fog to the exact sky colour so faded terrain leaves no seam.
    if (activeCamera().isPerspectiveCamera) {
      scene.fog.color.copy(scene.background);
      scene.fog.near = profile.thirdNear; scene.fog.far = profile.thirdFar;
    } else {
      scene.fog.color.set(profile.color);
      scene.fog.near = profile.near; scene.fog.far = profile.far;
    }
  }
  const lookAhead = new THREE.Vector3(-24, 0, -46);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function resize() {
    const width = window.innerWidth, height = window.innerHeight;
    const aspect = width / height;
    // Portrait needs extra height, e.g. to fit the alpine road and the lake below it.
    const size = viewHeight * (aspect < 1 ? 1.12 : 1);
    camera.left = -size * aspect / 2; camera.right = size * aspect / 2; camera.top = size / 2; camera.bottom = -size / 2; camera.updateProjectionMatrix();
    thirdPerson.resize(aspect);
    firstPerson.resize(aspect);
    if (initialized) fitSunShadow(activeCamera(), sun, shadowFloor(), previousOrigin);
  }
  function update(car, dt, origin) {
    followedCar = car;
    const originShift = origin - previousOrigin; follow.z += originShift; previousOrigin = origin;
    if (!initialized) { follow.copy(car.position); initialized = true; }
    // Reduced motion tracks height at the ground rate too, keeping the car still on screen.
    const groundRate = 1 - Math.exp(-dt * FOLLOW_GROUND);
    follow.x += (car.position.x - follow.x) * groundRate;
    follow.z += (car.position.z - follow.z) * groundRate;
    follow.y += (car.position.y - follow.y) * (1 - Math.exp(-dt * (reducedMotion ? FOLLOW_GROUND : FOLLOW_HEIGHT)));
    const nextHeight = THREE.MathUtils.damp(viewHeight, views[view].height, 4, dt);
    if (Math.abs(nextHeight - viewHeight) > .01) { viewHeight = nextHeight; resize(); }
    // Shorten the look-ahead in close view so the car stays onscreen in portrait layouts.
    const framing = Math.min(1, viewHeight / 165);
    target.copy(follow).addScaledVector(lookAhead, framing);
    if (snowy) { target.y -= 14 * framing; target.z += 18 * framing; }
    if (touchScreen.matches || window.innerWidth < window.innerHeight) {
      // Ease framing toward centre without changing vertical look-ahead.
      const lateralOffset = framingOffset.copy(target).sub(follow).dot(cameraRight);
      // Look-ahead is a world distance, so cap it on narrow screens.
      const limit = .25 * (camera.right - camera.left) / 2;
      const eased = lateralOffset * .70;
      target.addScaledVector(cameraRight, THREE.MathUtils.clamp(eased, -limit, limit) - lateralOffset);
    }
    // Fixed ocean-side azimuth at about 36° elevation.
    camera.position.copy(target).add(cameraOffset); camera.lookAt(target);
    camera.userData.focusDistance = cameraOffset.length();
    if (views[view].thirdPerson) { thirdPerson.update(car, dt); target.copy(car.position); }
    if (views[view].firstPerson) { firstPerson.update(car, dt); target.copy(car.position); }
    sun.position.copy(target).add(sunOffset); sun.target.position.copy(target);
    fitSunShadow(activeCamera(), sun, shadowFloor(), origin);
  }
  // Zoom only changes the projection. Resizing the canvas per zoom frame reallocates buffers.
  window.addEventListener('resize', () => { graphics.suspend(); resizeCanvas(); resize(); }); resize();
  function setJourney(id) {
    journey = ROUTE_LIGHTING[id] ? id : 'coast';
    snowy = id === 'snow';
    applyShadowSoftness();
    resize();
    const lighting = ROUTE_LIGHTING[journey];
    scene.background.set(lighting.background); updateFog();
    sky.color.set(lighting.sky.color); sky.groundColor.set(lighting.sky.ground); sky.intensity = lighting.sky.intensity;
    sun.color.set(lighting.sun.color); sun.intensity = lighting.sun.intensity; sunOffset.set(...lighting.sun.offset);
    renderer.toneMappingExposure = lighting.exposure;
  }
  setJourney('coast');
  function draw(viewCamera, stereo = false) {
    // Hide the car for the whole first-person draw, shadows and AO included.
    // Restored in finally so a render error can't leave it hidden.
    const car = views[view].firstPerson ? followedCar : null;
    const visible = car?.visible;
    if (car) car.visible = false;
    try {
      if (stereo) renderer.render(scene, viewCamera);
      else ambientOcclusion.render(viewCamera);
    } finally { if (car) car.visible = visible; }
  }
  function render(frame, beforeXRRender) {
    if (renderer.xr.isPresenting) {
      const pose = frame?.getViewerPose(renderer.xr.getReferenceSpace());
      vrCamera.update(activeCamera(), pose);
      renderer.xr.updateCamera(vrCamera.camera);
      beforeXRRender?.();
      if (!renderer.xr.isPresenting) { draw(activeCamera()); return; }
      // AO is a monoscopic screen pass, so render directly and let Three.js draw each eye.
      draw(vrCamera.camera, true);
    } else draw(activeCamera());
  }
  function setView(index) { view = index; updateFog(); thirdPerson.snap(); firstPerson.snap(); return views[view].label; }
  let desktopView;
  function enterVR() { desktopView = view; setView(views.findIndex(view => view.thirdPerson)); }
  function exitVR() { if (desktopView !== undefined) setView(desktopView); desktopView = undefined; }
  return { renderer, scene, graphics, ambientOcclusion, vrCamera, render, enterVR, exitVR, toggleAO() { return graphics.toggleAmbientOcclusion(); }, get camera() { return activeCamera(); }, update, resize, recordFrame, setJourney, get viewLabel() { return views[view].label; }, toggleView() { return setView((view + 1) % views.length); }, snap() { initialized = false; thirdPerson.snap(); firstPerson.snap(); } };
}
