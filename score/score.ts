/**
 * The Glyph score: A minor, 120 BPM, two bars per era. The instrumentation travels through time with
 * the type (organ and bells, lute, harpsichord, strings, machines, swing, chiptune, supersaw), and it
 * reads the same timing functions as the picture: the 2016 filter follows the font weight, odometer
 * clicks land on digit rolls, and the finale plucks land with each specimen letter.
 */
import { Track, SR, hz, tone, fm, kick, snare, hat, clap, adsr, decay, filter, noiseBuf, saturate, reverb, delay, duckCurve, gainBuf } from 'reel-film/audio';
import { beatGrid } from 'reel-film';
import { DURATION, FINALE, ERAS } from '../src/eras.js';
import { weightAt, digitRolls, sectionStart, STRIP_LAND, TITLE_LAND, WEIGHT_START } from '../src/timing.js';

const g = beatGrid(120);
const B = (beat: number, k = 0) => sectionStart(k) + beat * g.spb; // beat within section k

/** Karplus-Strong plucked string: lute, harpsichord, pizzicato, upright bass. */
function ks(freq: number, dur: number, o: { damp?: number; decayK?: number; seed?: number; body?: number } = {}): Float32Array {
  const n = Math.ceil(dur * SR);
  const out = new Float32Array(n);
  const N = Math.max(2, Math.round(SR / freq));
  const buf = noiseBuf(N / SR + 1e-4, 'white', o.seed ?? Math.round(freq * 7), SR).slice(0, N);
  const damp = o.damp ?? 0.5;
  const k = o.decayK ?? 0.996;
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const a = buf[idx], b = buf[(idx + 1) % N];
    out[i] = a;
    buf[idx] = k * ((1 - damp) * a + damp * b);
    idx = (idx + 1) % N;
  }
  if (o.body) filter(out, 'peak', o.body, 1.2, 4);
  return out;
}

function organ(freq: number, dur: number): Float32Array {
  const env = adsr(dur, { a: 0.35, d: 0.2, s: 0.85, r: 0.6 });
  const out = new Float32Array(env.length);
  [[1, 1], [2, 0.5], [3, 0.3], [4, 0.18], [6, 0.08]].forEach(([m, a]) => {
    const p = tone({ wave: 'sine', freq: freq * m, dur, env });
    for (let i = 0; i < out.length; i++) out[i] += p[i] * a * 0.5;
  });
  return out;
}

const bell = (freq: number, len = 2.2) => fm({ freq, ratio: 3.5, index: (t) => 4 * Math.exp(-t * 3), dur: len, env: decay(len, 0.6, 0.002) });

function pad(freqs: number[], dur: number, cutoff: number | ((t: number) => number), voices = 5): Float32Array {
  const env = adsr(dur, { a: 0.25, d: 0.3, s: 0.8, r: 0.5 });
  const out = new Float32Array(env.length);
  for (const f of freqs) {
    const v = tone({ wave: 'saw', freq: f, dur, env, voices, detune: 14 });
    for (let i = 0; i < out.length; i++) out[i] += v[i] / freqs.length;
  }
  return filter(out, 'lowpass', cutoff, 0.8);
}

function whoosh(len = 0.4): Float32Array {
  const n = filter(noiseBuf(len, 'pink', 21), 'bandpass', (t) => 300 + 5000 * (t / len) ** 2, 1.4);
  for (let i = 0; i < n.length; i++) n[i] *= Math.pow(i / n.length, 2.2);
  return gainBuf(n, 2.2);
}

const tick = (seed: number) => {
  const n = filter(noiseBuf(0.012, 'white', seed), 'bandpass', 4200, 2);
  const e = decay(0.012, 0.0025, 0.0003);
  for (let i = 0; i < n.length; i++) n[i] *= e[i];
  return n;
};

export default function score(): Track {
  const mix = new Track(DURATION + 1.2);
  const keys = new Track(mix.seconds); // melodic bus, sent to reverb
  const drums = new Track(mix.seconds);
  const kickTimes: number[] = [];

  // ---- transitions: a swell into every era change, a soft thump on it
  for (let k = 1; k < ERAS.length; k++) {
    mix.add(whoosh(0.38), sectionStart(k) - 0.38, 0.12, 0);
    mix.add(kick({ tune: 38, length: 0.6, punch: 1.5 }), sectionStart(k), 0.22);
  }
  // ---- odometer clicks on every rolling digit
  digitRolls().forEach((t, i) => mix.add(tick(i + 3), t + 0.12, 0.16, -0.4 + (i % 4) * 0.27));

  // ---- 1455: stamp, organ drone, bells
  mix.add(kick({ tune: 34, length: 0.9, punch: 2 }), 0.1, 0.6);
  mix.add(filter(noiseBuf(0.15, 'pink', 2), 'bandpass', 900, 0.7), 0.1, 0.35);
  keys.add(organ(hz('A2'), 4.2), 0, 0.24).add(organ(hz('E3'), 4.2), 0, 0.15);
  [['A4', 1], ['E5', 2], ['D5', 2.5], ['C5', 3]].forEach(([n, b]) => keys.add(bell(hz(n as string)), B((b as number) * 2), 0.11, 0.2));

  // ---- 1530: lute arpeggios (Am | G)
  const lute = [['A2', 'E3', 'A3', 'C4', 'E4', 'C4', 'A3', 'E3'], ['G2', 'D3', 'G3', 'B3', 'D4', 'B3', 'G3', 'D3']];
  lute.forEach((bar, bi) => bar.forEach((n, i) => keys.add(ks(hz(n), 1.4, { damp: 0.45, decayK: 0.995, body: 400 }), B(bi * 4 + i * 0.5, 1), 0.36, i % 2 ? 0.25 : -0.25)));
  keys.add(organ(hz('A2'), 1.6), sectionStart(1), 0.16);

  // ---- 1757: harpsichord sixteenths over a continuo (F | E)
  const harp = [['F4', 'A4', 'C5', 'A4'], ['E4', 'G#4', 'B4', 'G#4']];
  harp.forEach((fig, bi) => {
    for (let s = 0; s < 16; s++) keys.add(ks(hz(fig[s % 4]), 0.8, { damp: 0.12, decayK: 0.992 }), B(bi * 4 + s * 0.25, 2), 0.17, 0.3);
    for (let b = 0; b < 4; b++) keys.add(ks(hz(bi ? 'E2' : 'F2'), 1.2, { damp: 0.4, decayK: 0.995 }), B(bi * 4 + b, 2), 0.4, -0.2);
  });

  // ---- 1790: strings and pizzicato (Am | Dm)
  keys.add(pad([hz('A3'), hz('C4'), hz('E4')], 1.9, 2200), B(0, 3), 0.78, -0.1);
  keys.add(pad([hz('D3'), hz('F4'), hz('A4')], 1.9, 2200), B(4, 3), 0.78, 0.1);
  [['E5', 0], ['C5', 1], ['A5', 2], ['E5', 3], ['F5', 4], ['D5', 5], ['A5', 6], ['F5', 7]].forEach(([n, b]) =>
    keys.add(ks(hz(n as string), 0.35, { damp: 0.5, decayK: 0.985 }), B(b as number, 3), 0.36, 0.35));

  // ---- 1898: the machine room (F | G)
  for (let b = 0; b < 8; b++) {
    const t = B(b, 4);
    if (b % 2 === 0) { drums.add(kick({ tune: 44 }), t, 0.5); kickTimes.push(t); }
    else drums.add(fm({ freq: 180, ratio: 1.414, index: (x) => 7 * Math.exp(-x * 18), dur: 0.5, env: decay(0.5, 0.09) }), t, 0.15, 0.2);
    drums.add(filter(noiseBuf(0.18, 'white', 30 + b), 'highpass', 6000), t + 0.25, 0.05, -0.3);
    keys.add(tone({ wave: 'sine', freq: hz(b < 4 ? 'F2' : 'G2'), dur: 0.4, env: decay(0.45, 0.18) }), t, 0.36);
  }

  // ---- 1927: swing (Am | E7), ride on swung eighths, walking bass, rim on 2 and 4
  const walk = ['A2', 'C3', 'E3', 'G3', 'E2', 'G#2', 'B2', 'D3'];
  for (let b = 0; b < 8; b++) {
    const t = B(b, 5);
    keys.add(ks(hz(walk[b]), 0.6, { damp: 0.55, decayK: 0.993 }), t, 0.62, -0.1);
    drums.add(fm({ freq: 520, ratio: 2.76, index: (x) => 3 * Math.exp(-x * 6), dur: 0.6, env: decay(0.6, 0.25) }), t, 0.06, 0.35);
    drums.add(fm({ freq: 520, ratio: 2.76, index: 2, dur: 0.3, env: decay(0.3, 0.1) }), t + g.spb * (2 / 3), 0.035, 0.35);
    if (b % 2 === 1) drums.add(snare({ tone: 320, length: 0.12 }), t, 0.16, -0.15);
  }
  keys.add(pad([hz('A3'), hz('C4'), hz('E4'), hz('G4')], 1.0, 1500, 3), B(0, 5), 0.26);
  keys.add(pad([hz('G#3'), hz('B3'), hz('D4'), hz('E4')], 1.0, 1500, 3), B(4, 5), 0.26);

  // ---- 1984: chiptune (F | G), square arpeggios, pulse bass, noise snare
  const chip = [['F4', 'A4', 'C5', 'F5'], ['G4', 'B4', 'D5', 'G5']];
  for (let s = 0; s < 32; s++) {
    const bar = s < 16 ? 0 : 1;
    keys.add(tone({ wave: 'square', freq: hz(chip[bar][s % 4]), dur: 0.11, env: decay(0.12, 0.08, 0.001) }), B(s * 0.25, 6), 0.085, (s % 2) * 0.3 - 0.15);
  }
  for (let e = 0; e < 16; e++) keys.add(tone({ wave: 'square', freq: hz(e < 8 ? 'F2' : 'G2'), dur: 0.2, env: decay(0.22, 0.12, 0.001) }), B(e * 0.5, 6), 0.14);
  for (let b = 0; b < 8; b++) {
    if (b % 2) drums.add(filter(noiseBuf(0.15, 'white', 50 + b), 'highpass', 1500), B(b, 6), 0.18);
    else { drums.add(tone({ wave: 'sine', freq: (t) => 150 * Math.exp(-t * 20) + 50, dur: 0.15, env: decay(0.16, 0.06) }), B(b, 6), 0.6); kickTimes.push(B(b, 6)); }
  }

  // ---- 2016: supersaw through a filter that follows the font weight on screen
  const cut = (t: number) => {
    const w = t + sectionStart(7) >= WEIGHT_START ? weightAt(t + sectionStart(7)) : 400;
    return 250 * Math.pow(32, (w - 100) / 800); // 100 -> 250 Hz, 900 -> 8 kHz
  };
  const saw7 = pad([hz('A3'), hz('C4'), hz('E4'), hz('G4'), hz('A4')], 2.0, (t) => cut(t), 7);
  const saw7b = pad([hz('F3'), hz('A3'), hz('C4'), hz('E4'), hz('A4')], 2.0, (t) => cut(t + 2), 7);
  keys.add(saw7, B(0, 7), 0.4, -0.05).add(saw7b, B(4, 7), 0.4, 0.05);
  for (let b = 0; b < 8; b++) {
    const t = B(b, 7);
    drums.add(kick({ tune: 46 }), t, 0.62); kickTimes.push(t);
    if (b % 2) drums.add(clap(), t, 0.3, 0.05);
    drums.add(hat({ seed: 70 + b }), t + g.spb / 2, 0.14, 0.25);
    keys.add(tone({ wave: 'sine', freq: hz(b < 4 ? 'A1' : 'F1'), dur: 0.42, env: decay(0.45, 0.25, 0.004) }), t, 0.42);
  }

  // ---- finale: impact, plucks as the strip lands, bells for the title, a resolving chord
  mix.add(whoosh(0.5), FINALE - 0.5, 0.18);
  drums.add(kick({ tune: 36, length: 1.2, punch: 2.5 }), FINALE, 0.9); kickTimes.push(FINALE);
  ['A4', 'C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'E6'].forEach((n, i) => keys.add(ks(hz(n), 1.6, { damp: 0.3, decayK: 0.996 }), STRIP_LAND(i), 0.22, -0.6 + i * 0.17));
  ['A4', 'C5', 'E5', 'G5', 'A5'].forEach((n, i) => keys.add(bell(hz(n), 3), TITLE_LAND(i), 0.1, -0.3 + i * 0.15));
  keys.add(pad([hz('A2'), hz('E3'), hz('A3'), hz('B3'), hz('C4'), hz('E4')], DURATION - FINALE - 1.2, 1600, 5), FINALE + 0.4, 0.38);
  keys.add(organ(hz('A1'), DURATION - FINALE - 1), FINALE + 0.4, 0.25);

  // ---- mix: keys duck under the kicks, sends to reverb and delay, gentle glue
  keys.gain(duckCurve(kickTimes, 0.35, 0.22));
  mix.mix(keys, 1).mix(drums, 1);
  mix.mix(reverb(keys, { room: 0.86, damp: 0.35, predelay: 0.025 }), 0.32);
  mix.mix(delay(keys, { time: g.spb * 0.75, feedback: 0.28, tone: 0.5 }), 0.08);
  mix.mix(reverb(drums, { room: 0.7, damp: 0.5 }), 0.12);
  mix.gain(() => 0.62); // headroom before the glue saturation
  for (const ch of [mix.L, mix.R]) saturate(ch, 1.15);
  // tail fade
  mix.gain((t) => (t < DURATION - 0.6 ? 1 : Math.max(0, 1 - (t - (DURATION - 0.6)) / 1.6)));
  return mix;
}
