// Generative music. Each route has a key, a mode and a progression of scale
// degrees. Chords are stacked thirds over a bass note. Pads crossfade between
// two slots, and a mallet melody plays more notes at speed.
const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
};
export const HARMONY = {
  coast: { root: 45, mode: 'lydian', progression: [0, 1, 5, 2], tempo: 72 },
  desert: { root: 38, mode: 'dorian', progression: [0, 3, 0, 6], tempo: 66 },
  snow: { root: 42, mode: 'aeolian', progression: [0, 5, 2, 6], tempo: 58 },
  jungle: { root: 43, mode: 'ionian', progression: [0, 5, 3, 4], tempo: 76 },
  plains: { root: 36, mode: 'ionian', progression: [0, 3, 5, 4], tempo: 70 },
  city: { root: 41, mode: 'dorian', progression: [0, 3, 6, 2], tempo: 68 },
  volcanic: { root: 43, mode: 'phrygian', progression: [0, 1, 0, 6], tempo: 56 },
  salt: { root: 40, mode: 'lydian', progression: [0, 1, 0, 4], tempo: 62 },
  swamp: { root: 38, mode: 'aeolian', progression: [0, 5, 3, 4], tempo: 60 },
};
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
// Semitones above the root for a scale degree, which may run past the octave.
export function degree(mode, step) {
  const scale = MODES[mode], octave = Math.floor(step / 7);
  return scale[((step % 7) + 7) % 7] + octave * 12;
}
export function chordNotes(harmony, index) {
  const step = harmony.progression[index % harmony.progression.length];
  return { bass: harmony.root + degree(harmony.mode, step), pad: [2, 4, 6, 8].map(third => harmony.root + 12 + degree(harmony.mode, step + third)) };
}
const BEATS_PER_CHORD = 8, MALLET_PITCH = 261.63;

export class Music {
  constructor() { this.seed = 0x6d75; this.reset(); }
  random() { this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5; return (this.seed >>> 0) / 4294967296; }
  reset() { this.active = false; this.chord = 0; this.nextChord = 0; this.nextStep = 0; this.step = 0; this.melody = 9; this.slot = 0; }
  stop(graph, now) {
    if (!this.active) return;
    this.active = false;
    for (const slot of graph.pads) graph.releasePad(slot, now, .6);
  }
  update(graph, journey, motion, now, level) {
    if (level <= 0) { this.stop(graph, now); return; }
    const harmony = HARMONY[journey] ?? HARMONY.coast, beat = 60 / harmony.tempo;
    if (!this.active) { this.active = true; this.nextChord = now + .05; this.nextStep = this.nextChord; this.step = 0; }
    // Never replay a backlog after the context was suspended.
    if (this.nextChord < now - .2) { this.nextChord = now + .05; this.nextStep = this.nextChord; this.step = 0; }
    if (this.nextChord <= now + .15) {
      const time = this.nextChord, notes = chordNotes(harmony, this.chord), release = time + beat * BEATS_PER_CHORD;
      const previous = graph.pads[this.slot];
      this.slot = 1 - this.slot;
      graph.releasePad(previous, time, 1.6);
      graph.playPad(graph.pads[this.slot], notes.pad.map(hz), hz(notes.bass), time, release + 5, 900 + motion * 900);
      this.chord++; this.nextChord = release;
    }
    // Melody steps are half beats.
    while (this.nextStep <= now + .15 && this.nextStep < this.nextChord) {
      const time = this.nextStep, first = this.step % (BEATS_PER_CHORD * 2) === 0;
      if (first || this.random() < .12 + motion * .22) {
        this.melody = Math.max(5, Math.min(13, this.melody + [-2, -1, -1, 1, 1, 2, 3, -3][Math.floor(this.random() * 8)]));
        const notes = chordNotes(harmony, this.chord - 1);
        // Strong beats snap to a chord tone.
        let midi = harmony.root + 12 + degree(harmony.mode, this.melody);
        if (this.step % 4 === 0) midi = notes.pad.reduce((best, pad) => { const target = pad + 12 * Math.round((midi - pad) / 12); return Math.abs(target - midi) < Math.abs(best - midi) ? target : best; }, notes.pad[0] + 12);
        graph.play('music', graph.mallet, { time, rate: hz(midi) / MALLET_PITCH, level: (first ? .11 : .07 + this.random() * .035) * (1 - Math.max(0, midi - 76) * .03), pan: this.random() * 1.2 - .6, cutoff: 3800 });
      }
      this.step++; this.nextStep += beat / 2;
    }
  }
}
