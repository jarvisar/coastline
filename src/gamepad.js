import { KonamiCode } from './konami-code.js';

const CODE_BUTTONS = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 1: 'KeyB', 0: 'KeyA' };
const deadzone = (value = 0, threshold = .18) => Math.abs(value) <= threshold ? 0 : Math.sign(value) * Math.min(1, (Math.abs(value) - threshold) / (1 - threshold));
const buttonValue = (pad, index) => {
  const button = pad.buttons[index];
  return button ? Math.min(1, Math.max(0, button.value ?? Number(button.pressed))) : 0;
};

// Standard gamepad layout. Unmapped handheld pads use the same indices as a
// best-effort fallback.
export class GamepadInput {
  constructor(onAction, onConnection, getGamepads = () => navigator.getGamepads?.() ?? [], onKonami = () => {}) {
    this.onAction = onAction; this.onConnection = onConnection; this.getGamepads = getGamepads;
    this.index = null; this.connected = false; this.state = {};
    this.previousButtons = []; this.requireNeutral = false;
    this.konami = new KonamiCode(); this.onKonami = onKonami;
  }
  clear({ preserveKonami = false } = {}) {
    this.state = {}; this.requireNeutral = true;
    if (!preserveKonami) this.konami.reset();
  }
  // `menu` is 'pause' for the pause screen, truthy for a modal chooser, and
  // false during a drive.
  update({ blocked = false, paused = false, menu = false } = {}) {
    let pads;
    try { pads = Array.from(this.getGamepads()).filter(pad => pad?.connected); }
    catch { pads = []; } // Gamepad API missing or blocked; other inputs still work.
    const pad = pads.find(pad => pad.index === this.index) ?? pads.find(pad => pad.mapping === 'standard') ?? pads[0];
    if ((pad?.index ?? null) !== this.index) {
      this.index = pad?.index ?? null; this.state = {}; this.previousButtons = [];
      this.konami.reset();
      // A replacement pad must start at rest; the first may start with Gas held.
      this.requireNeutral = this.connected;
    }
    if (Boolean(pad) !== this.connected) {
      this.connected = Boolean(pad); this.onConnection(this.connected);
    }
    if (!pad) { this.state = {}; return; }
    const buttons = pad.buttons.map((_, index) => buttonValue(pad, index) > .5);
    // Stick directions act as buttons 17-20 so they fire once per tilt. Axes stay
    // separate so card grids can move by row or column.
    buttons[17] = (pad.axes[0] ?? 0) < -.5;
    buttons[18] = (pad.axes[0] ?? 0) > .5;
    buttons[19] = (pad.axes[1] ?? 0) < -.5;
    buttons[20] = (pad.axes[1] ?? 0) > .5;
    const pressed = index => buttons[index] && !this.previousButtons[index];
    const steer = deadzone(pad.axes[0]);
    const state = {
      forward: Math.max(deadzone(buttonValue(pad, 7), .08), buttonValue(pad, 0)),
      brake: Math.max(deadzone(buttonValue(pad, 6), .08), buttonValue(pad, 1)),
      left: Math.max(-steer, buttonValue(pad, 14), 0),
      right: Math.max(steer, buttonValue(pad, 15), 0),
    };
    const active = Object.values(state).some(Boolean) || buttons.some(Boolean);
    if (blocked || this.requireNeutral) {
      if (blocked) this.konami.reset();
      this.state = {}; this.previousButtons = buttons;
      this.requireNeutral = blocked || active;
      return;
    }
    // Konami code on the D-pad plus B/A. Off in menus; held buttons count once.
    if (paused || menu) this.konami.reset();
    else {
      const presses = buttons.flatMap((down, index) => down && pressed(index) && index < 17 ? [index] : []);
      if (presses.length > 1) this.konami.reset();
      else if (presses.length === 1 && this.konami.press(CODE_BUTTONS[presses[0]] ?? 'Other')) {
        this.previousButtons = buttons; this.clear(); this.onKonami();
        return;
      }
    }
    // Sampled every frame, even while paused, so Start can resume the game.
    this.state = paused ? {} : state;
    const pause = pressed(9), view = pressed(2), reset = pressed(3), nextJourney = pressed(5);
    const journey = pressed(8), fullscreen = pressed(4), fps = pressed(11), car = pressed(10);
    const back = pressed(1), confirm = pressed(0), autodrive = pressed(12);
    const previous = pressed(14) || pressed(17), next = pressed(15) || pressed(18);
    const up = pressed(12) || pressed(19), down = pressed(13) || pressed(20);
    this.previousButtons = buttons;
    if (fps) this.onAction('fps');
    if (fullscreen) { this.onAction('fullscreen'); return; }
    // Choosers take the whole pad. The pause screen only borrows directions and
    // A, so the shortcuts below still work from it.
    if (menu && menu !== 'pause') {
      this.state = {};
      if (journey || car || back) this.onAction('menuClose');
      else if (previous) this.onAction('menuPrevious');
      else if (next) this.onAction('menuNext');
      else if (up) this.onAction('menuUp');
      else if (down) this.onAction('menuDown');
      else if (confirm) this.onAction('menuConfirm');
      return;
    }
    if (journey) { this.onAction('journey'); return; }
    if (car) { this.onAction('car'); return; }
    if (pause) { this.onAction('pause'); return; }
    if (nextJourney) { this.onAction('nextJourney'); return; }
    if (paused) {
      // While paused, directions move the pause screen's focus.
      if (menu !== 'pause') return;
      if (previous) this.onAction('menuPrevious');
      else if (next) this.onAction('menuNext');
      else if (up) this.onAction('menuUp');
      else if (down) this.onAction('menuDown');
      else if (confirm) this.onAction('menuConfirm');
      else if (back) this.onAction('menuClose');
      return;
    }
    if (state.forward || state.brake) this.onAction('drive');
    if (autodrive) this.onAction('autodrive');
    if (view) this.onAction('view');
    if (reset) this.onAction('reset');
  }
}
