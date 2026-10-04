"""Ambient bed for the NAZAR explainer - generated from scratch, nothing sampled.

A slow drone built from a few detuned partials, a breath of filtered noise that
swells and falls, and a soft bell at each section change so the chapters are
audible as well as visible.
"""
import numpy as np, wave, sys, json

SR = 44100
DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 225.0
MARKS = json.loads(sys.argv[2]) if len(sys.argv) > 2 else [18, 50, 85, 125, 160, 195]
n = int(SR * DUR)
t = np.arange(n) / SR
rng = np.random.default_rng(7)


def lfo(freq, lo, hi, phase=0.0):
    return lo + (hi - lo) * (0.5 + 0.5 * np.sin(2 * np.pi * freq * t + phase))


# ---- drone: a low root with a fifth and an octave, each slightly detuned so the
# ---- beating keeps it from sounding like a test tone
root = 55.0                                     # A1
mix = np.zeros(n)
for mult, amp, detune, rate in [(1, 0.50, 0.00, 0.013), (1, 0.34, 0.35, 0.017),
                                (1.5, 0.26, -0.3, 0.011), (2, 0.20, 0.5, 0.019),
                                (3, 0.10, 0.0, 0.023), (4, 0.06, 0.7, 0.029)]:
    f = root * mult + detune
    mix += amp * lfo(rate, 0.35, 1.0, mult) * np.sin(2 * np.pi * f * t)

# a high, quiet shimmer that drifts in and out
for f, a, r in [(880.0, 0.022, 0.007), (1320.5, 0.016, 0.009), (1760.0, 0.010, 0.012)]:
    mix += a * lfo(r, 0.0, 1.0, f) * np.sin(2 * np.pi * f * t)

# ---- air: white noise, smoothed into a wash, breathing roughly every 20 s
noise = rng.normal(0, 1, n)
k = 220                                          # ~5 ms box blur = gentle low-pass
noise = np.convolve(noise, np.ones(k) / k, mode='same')
noise /= (np.max(np.abs(noise)) + 1e-9)
mix += 0.16 * lfo(0.05, 0.25, 1.0) * noise

# ---- bells at the section changes
def bell(at, f0=528.0, dur=3.2, amp=0.20):
    i0 = int(at * SR)
    m = min(int(dur * SR), n - i0)
    if m <= 0:
        return
    tt = np.arange(m) / SR
    env = np.exp(-tt * 1.7)
    v = (np.sin(2 * np.pi * f0 * tt) * 0.6 +
         np.sin(2 * np.pi * f0 * 2.01 * tt) * 0.25 +
         np.sin(2 * np.pi * f0 * 2.99 * tt) * 0.12)
    mix[i0:i0 + m] += amp * env * v


for i, m in enumerate(MARKS):
    bell(m, f0=[528.0, 396.0, 639.0, 432.0, 594.0, 352.0][i % 6])

# ---- shape: fade in, fade out, keep it well under the dialogue-free ceiling
env = np.ones(n)
fade = int(4.0 * SR)
env[:fade] = np.linspace(0, 1, fade)
env[-fade:] = np.linspace(1, 0, fade)
mix *= env
mix /= (np.max(np.abs(mix)) + 1e-9)
mix *= 0.26                                      # quiet bed, not a soundtrack

# ---- gentle stereo: the same bed, delayed a few ms on one side
delay = int(0.011 * SR)
left = mix
right = np.concatenate([np.zeros(delay), mix[:-delay]]) * 0.96
stereo = np.stack([left, right], axis=1)
pcm = np.clip(stereo, -1, 1)
pcm = (pcm * 32767).astype('<i2')

with wave.open('ambient.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote ambient.wav  %.1fs  peak %.2f' % (DUR, float(np.max(np.abs(stereo)))))
