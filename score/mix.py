"""
Build Glyph's soundtrack: the Flow Music track, edited on its bar lines to the film's 38 s, with the
code-generated sound effects underneath. Run after `npm run sfx`:

    python3 score/mix.py music/flow-typesetting.m4a score/sfx.wav score/score.raw.wav

The track runs at 120.02 BPM with downbeats every 2 s from 0.792 s (measured from its onsets). The film
also runs at 120 BPM with an era every 4 s, so every splice below sits on a bar line, and the track's lift
out of its breakdown lands on the finale at 32 s.
"""
import subprocess
import sys
import numpy as np

SR = 48000
DOWNBEAT = 0.792
BAR = 60 / 120.02 * 4  # 1.9997 s

# (film start, source start, length) in seconds, all on bar lines
EDIT = [
    (0, DOWNBEAT, 22),             # opening run
    (22, DOWNBEAT + 10 * BAR, 2),  # one breakdown bar again, so the lift lands on the finale
    (24, DOWNBEAT + 11 * BAR, 10), # breakdown, then the lift (source 30.79 s) at film 32 s
    (34, 54.78, 4.4),              # the track's own ending and tail
]
XF = 0.03  # equal-power crossfade at each splice
DURATION = 38.0
SFX_GAIN_DB = -9


def load(path: str) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def main(music_path: str, sfx_path: str, out_path: str) -> None:
    src = load(music_path)
    n = int(DURATION * SR) + SR
    out = np.zeros((n, 2), dtype=np.float32)
    xf = int(XF * SR)
    h = xf // 2
    for i, (film, start, length) in enumerate(EDIT):
        first, last = i == 0, i == len(EDIT) - 1
        pre = 0 if first else h                 # start half a crossfade early...
        post = 0 if last else h                 # ...and run half a crossfade late
        a = int(film * SR) - pre
        s = int(start * SR) - pre
        seg = src[s:s + pre + int(length * SR) + post].copy()
        env = np.ones(len(seg), dtype=np.float32)
        if not first:
            env[:xf] = np.sin(np.linspace(0, np.pi / 2, xf))
        else:
            env[:int(0.01 * SR)] = np.linspace(0, 1, int(0.01 * SR))
        if not last:
            env[-xf:] = np.cos(np.linspace(0, np.pi / 2, xf))
        seg *= env[:, None]
        end = min(n, a + len(seg))
        out[a:end] += seg[:end - a]
    sfx = load(sfx_path)
    k = min(len(sfx), n)
    out[:k] += sfx[:k] * 10 ** (SFX_GAIN_DB / 20)
    # fade the last 0.5 s so the tail ends with the picture
    f0, f1 = int((DURATION - 0.5) * SR), int(DURATION * SR)
    out[f0:f1] *= np.linspace(1, 0, f1 - f0)[:, None]
    out = out[:f1]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-',
                    '-c:a', 'pcm_s24le', out_path], input=out.astype(np.float32).tobytes(), check=True)
    print(f'wrote {out_path}: {f1 / SR:.2f} s')


if __name__ == '__main__':
    main(*sys.argv[1:4])
