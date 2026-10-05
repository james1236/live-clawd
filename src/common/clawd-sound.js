/**
 * Clawd's sound effects: tiny chiptune bleeps synthesised with Web Audio (no audio
 * files). Played by the background page — which isn't subject to a web page's autoplay
 * rules — for the overlay and the sidebar alike. Self-contained.
 */

let ctx = null;
let master = null;
let noiseBuf = null;

function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** A blip: frequency `f` (sliding to `to`), `dur` seconds, starting `at` seconds from now. */
function tone(f, dur, { type = 'square', vol = 0.3, to = null, at = 0, vibrato = 0 } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  if (vibrato) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 6;
    lg.gain.value = vibrato;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A puff of filtered noise. */
function noise(dur, { vol = 0.25, freq = 1500, to = null, kind = 'bandpass', q = 1, at = 0 } = {}) {
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = kind;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

const rnd = (a, b) => a + Math.random() * (b - a);
const PENTA = [523, 587, 659, 784, 880, 1047];
let note = 0;

/** Every sound Clawd makes. */
const SOUNDS = {
  step: () => tone(rnd(170, 230), 0.045, { type: 'triangle', vol: 0.22 }),
  glug: () => tone(rnd(300, 360), 0.11, { type: 'sine', vol: 0.35, to: 160 }),
  ahh: () => { tone(560, 0.35, { type: 'sine', vol: 0.18, to: 420, vibrato: 12 }); noise(0.3, { vol: 0.05, freq: 900 }); },
  whoosh: () => noise(0.3, { vol: 0.25, freq: 400, to: 2600, q: 2 }),
  giggle: () => [0, 1, 2, 3, 4, 5].forEach(i => tone(i % 2 ? 760 : 980, 0.05, { type: 'square', vol: 0.12, at: i * 0.07, to: i % 2 ? 820 : 1040 })),
  pop: () => tone(520, 0.07, { type: 'sine', vol: 0.35, to: 1300 }),
  boop: () => tone(480, 0.08, { type: 'sine', vol: 0.25, to: 720 }),
  swish: () => noise(0.18, { vol: 0.16, freq: 2500, to: 5000, kind: 'highpass' }),
  psst: () => noise(0.22, { vol: 0.14, freq: 3500, kind: 'highpass' }),
  vacuum: () => { noise(1.05, { vol: 0.12, freq: 500, to: 700, kind: 'lowpass' }); tone(110, 1.05, { type: 'sawtooth', vol: 0.04, vibrato: 4 }); },
  slurp: () => tone(900, 0.35, { type: 'sine', vol: 0.25, to: 140 }),
  bonk: () => { tone(170, 0.13, { type: 'sine', vol: 0.45, to: 80 }); noise(0.03, { vol: 0.2, freq: 3200, kind: 'highpass' }); },
  squeak: () => tone(rnd(1300, 1500), 0.07, { type: 'square', vol: 0.08, to: 1900 }),
  tick: () => noise(0.025, { vol: 0.18, freq: 4500, kind: 'highpass' }),
  chime: () => [880, 1320, 1760].forEach((f, i) => tone(f, 0.25, { type: 'sine', vol: 0.15, at: i * 0.06 })),
  zap: () => tone(1300, 0.13, { type: 'sawtooth', vol: 0.1, to: 180 }),
  blip: () => tone(rnd(600, 1300), 0.035, { type: 'square', vol: 0.08 }),
  note: () => tone(PENTA[(note = (note + 1 + Math.floor(Math.random() * 2)) % PENTA.length)], 0.14, { type: 'triangle', vol: 0.22 }),
  shutter: () => { noise(0.035, { vol: 0.3, freq: 3000 }); noise(0.05, { vol: 0.25, freq: 2000, at: 0.08 }); },
  shimmer: () => [1568, 2093, 2637].forEach((f, i) => tone(f, 0.18, { type: 'sine', vol: 0.06, at: i * 0.05 })),
  zip: () => tone(300, 0.28, { type: 'square', vol: 0.06, to: 1000 }),
  creak: () => { tone(140, 0.3, { type: 'sawtooth', vol: 0.05, to: 210 }); tone(988, 0.08, { type: 'square', vol: 0.1, at: 0.32 }); tone(1319, 0.25, { type: 'square', vol: 0.1, at: 0.4 }); },
  sonar: () => tone(1050, 0.5, { type: 'sine', vol: 0.18 }),
  hmm: () => tone(260, 0.3, { type: 'triangle', vol: 0.18, to: 235 }),
  boing: () => { tone(180, 0.12, { type: 'sine', vol: 0.3, to: 520 }); tone(520, 0.15, { type: 'sine', vol: 0.2, to: 300, at: 0.12 }); },
  thought: () => tone(900, 0.04, { type: 'sine', vol: 0.12 }),
  flip: () => noise(0.08, { vol: 0.18, freq: 1500, to: 900 }),
  dingdong: () => { tone(659, 0.4, { type: 'sine', vol: 0.3 }); tone(523, 0.55, { type: 'sine', vol: 0.3, at: 0.35 }); },
  happy: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.1, { type: 'square', vol: 0.12, at: i * 0.08 })),
  sad: () => [[392, 370], [370, 349], [349, 330], [330, 294]].forEach(([f, to], i) => (
    tone(f, i === 3 ? 0.9 : 0.32, { type: 'triangle', vol: 0.25, to, at: i * 0.36, vibrato: i === 3 ? 10 : 0 }))),
  sniffle: () => { noise(0.07, { vol: 0.1, freq: 2600, q: 3 }); noise(0.09, { vol: 0.1, freq: 2300, q: 3, at: 0.12 }); },
  phew: () => { noise(0.35, { vol: 0.1, freq: 1300, to: 500 }); tone(640, 0.25, { type: 'sine', vol: 0.18, to: 420, at: 0.05 }); },
  tape: () => tone(rnd(220, 260), 0.06, { type: 'square', vol: 0.05 }),
  // long waits, results, helpers
  snore: () => { noise(1.1, { vol: 0.07, freq: 300, to: 520, kind: 'lowpass' }); tone(95, 1.1, { type: 'sawtooth', vol: 0.03, to: 110, vibrato: 6 }); },
  yawn: () => tone(520, 0.9, { type: 'triangle', vol: 0.16, to: 230, vibrato: 8 }),
  crunch: () => [0, 0.09, 0.2, 0.27].forEach(at => noise(0.07, { vol: 0.22, freq: rnd(700, 1400), q: 2, at })),
  ding: () => { tone(1568, 0.6, { type: 'sine', vol: 0.2 }); tone(2093, 0.5, { type: 'sine', vol: 0.08, at: 0.01 }); },
  scribble: () => [0, 0.07, 0.16].forEach(at => noise(0.05, { vol: 0.1, freq: rnd(3000, 4200), q: 4, at })),
  rustle: () => noise(0.25, { vol: 0.12, freq: 1800, to: 1100, q: 1.5 }),
  dink: () => { tone(2350, 0.12, { type: 'sine', vol: 0.3, to: 2250 }); tone(3520, 0.08, { type: 'sine', vol: 0.12 }); tone(5100, 0.05, { type: 'sine', vol: 0.05 }); },
  fork: () => { tone(260, 0.55, { type: 'triangle', vol: 0.18, to: 780, vibrato: 14 }); noise(0.3, { vol: 0.06, freq: 1200, to: 3000, at: 0.3 }); },
  bubble: () => [0, 0.08, 0.15].forEach(at => tone(rnd(500, 900), 0.06, { type: 'sine', vol: 0.14, to: rnd(1100, 1500), at })),
  click: () => tone(rnd(1900, 2200), 0.02, { type: 'square', vol: 0.05 }),
  yes: () => { tone(523, 0.08, { type: 'square', vol: 0.14 }); tone(784, 0.08, { type: 'square', vol: 0.14, at: 0.09 }); tone(1047, 0.22, { type: 'square', vol: 0.14, at: 0.18 }); },
  facepalm: () => { noise(0.06, { vol: 0.3, freq: 900, q: 1 }); tone(330, 0.5, { type: 'triangle', vol: 0.18, to: 196, at: 0.12 }); },
};

/** Map of overlay moods to the sound they make, and how often (ms) while it lasts. */
export const ACTION_SOUNDS = {
  paint: ['swish', 900], canvas: ['swish', 900], spray: ['psst', 500], erase: ['squeak', 320],
  remove: ['vacuum', 1050], write: ['tick', 280], font: ['boing', 1000], build: ['bonk', 700],
  measure: ['zip', 1600], add: ['chime', 1200], wire: ['zap', 450], hack: ['blip', 240],
  watch: ['hmm', 2000], dance: ['note', 250], photo: ['shutter', 1600], stash: ['creak', 1600],
  polish: ['shimmer', 1000], search: ['sonar', 1300], read: ['flip', 1400], think: ['thought', 1200],
  fetch: ['step', 320], tinker: ['bonk', 1200], wave: ['dingdong', 8000], sad: ['sniffle', 2600],
  test: ['tick', 800], lab: ['bubble', 700], compile: ['bonk', 700], install: ['rustle', 1100], mail: ['whoosh', 1800],
  ponder: ['scribble', 1700], wait: ['flip', 5000], knit: ['click', 380], doze: ['snore', 3200],
  timer: ['click', 160], compact: ['crunch', 1300],
};

export const SOUND_NAMES = Object.keys(SOUNDS);

/** Play a named sound at `volume` (0..1). Returns false if audio isn't available. */
export function playSound(name, volume = 0.35) {
  const fn = SOUNDS[name];
  if (!fn) return false;
  try {
    audio();
    master.gain.value = volume;
    fn();
    return ctx.state !== 'suspended';
  } catch {
    return false;
  }
}
