/**
 * Glyph's sound effects, generated in code from the same timing functions as the picture: a swell and a
 * soft thump on every era change, an odometer click on every rolling year digit, and an impact on the
 * finale. The music is a separate track (see score/mix.py), so these stay small and dry.
 */
import { Track, kick, decay, filter, noiseBuf, gainBuf } from 'reel-film/audio';
import { DURATION, FINALE, ERAS } from '../src/eras.js';
import { digitRolls, sectionStart } from '../src/timing.js';

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

export default function sfx(): Track {
  const mix = new Track(DURATION + 1.2);
  for (let k = 1; k < ERAS.length; k++) {
    mix.add(whoosh(0.38), sectionStart(k) - 0.38, 0.12, 0);
    mix.add(kick({ tune: 38, length: 0.6, punch: 1.5 }), sectionStart(k), 0.16);
  }
  digitRolls().forEach((t, i) => mix.add(tick(i + 3), t + 0.12, 0.16, -0.4 + (i % 4) * 0.27));
  mix.add(whoosh(0.5), FINALE - 0.5, 0.18);
  mix.add(kick({ tune: 36, length: 1.2, punch: 2.5 }), FINALE, 0.5);
  return mix;
}
