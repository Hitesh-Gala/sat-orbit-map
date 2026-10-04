"""Render the NAZAR explainer: a 3Blue1Brown-flavoured tour of the site.

Frames are composed with PIL and piped straight into ffmpeg - screenshots of the
real pages, slow Ken Burns moves, annotation boxes that point at a feature, and
captions on a lower third.  Nothing here is sampled or copied: the starfield,
the type and the ambient bed are all generated.
"""
import io, json, math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS = 1280, 720, 30
SHOTS = os.path.join(os.environ['TEMP'], 'shots')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'nazar-explainer.mp4'
FAST = '--fast' in sys.argv                      # low-res proof for checking timings

FONT_DIR = r'C:\Windows\Fonts'
F = lambda name, size: ImageFont.truetype(os.path.join(FONT_DIR, name), size)
SERIF, SERIF_B = 'georgia.ttf', 'georgiab.ttf'
MONO, MONO_B = 'consola.ttf', 'consolab.ttf'
HEAD = 'bahnschrift.ttf'

CY = (122, 210, 255)        # cyan, the site's accent
GOLD = (255, 207, 92)
WHITE = (233, 242, 251)
DIM = (150, 173, 196)
BG = (7, 10, 16)

cache = {}


FALLBACK = {'godm': 'god-b', 'debm': 'debris-b', 'ops': 'ops-b'}


def shot(name):
    if name not in cache:
        path = os.path.join(SHOTS, name + '.png')
        if not os.path.exists(path):             # a motion frame that never captured
            path = os.path.join(SHOTS, FALLBACK[name.split('-')[0]] + '.png')
        cache[name] = Image.open(path).convert('RGB')
    return cache[name]


def ease(x):                                     # smootherstep: no visible start/stop
    x = max(0.0, min(1.0, x))
    return x * x * x * (x * (x * 6 - 15) + 10)


# ---------------------------------------------------------------- starfield
def make_stars(seed=3):
    rng = np.random.default_rng(seed)
    a = np.zeros((H, W, 3), np.float32)
    a[:, :] = BG
    for n, lo, hi in [(420, 20, 70), (150, 70, 140), (40, 140, 210)]:
        ys = rng.integers(0, H, n); xs = rng.integers(0, W, n)
        vs = rng.uniform(lo, hi, n)
        for x, y, v in zip(xs, ys, vs):
            a[y, x] += v
    im = Image.fromarray(np.clip(a, 0, 255).astype('uint8'))
    return im.filter(ImageFilter.GaussianBlur(0.6))


STARS = make_stars()


def star_bg(t):
    """A slow drift, so even a text card is never dead still."""
    dx = int((t * 6) % W)
    bg = Image.new('RGB', (W, H), BG)
    bg.paste(STARS, (-dx, 0))
    bg.paste(STARS, (W - dx, 0))
    return bg


# ---------------------------------------------------------------- drawing
def text(d, xy, s, font, fill, anchor='la', shadow=True, spacing=10):
    if shadow:
        d.multiline_text((xy[0] + 2, xy[1] + 2), s, font=font, fill=(0, 0, 0), anchor=anchor, spacing=spacing)
    d.multiline_text(xy, s, font=font, fill=fill, anchor=anchor, spacing=spacing)


def fade(im, k):
    if k >= 1:
        return im
    return Image.blend(Image.new('RGB', im.size, BG), im, max(0.0, k))


def sequence(frames, u):
    """Captured frames are seconds apart; cross-fade between neighbours so the
    drift reads as motion rather than a slideshow."""
    u = max(0.0, min(0.9999, u))
    x = u * (len(frames) - 1)
    i = int(x)
    f = x - i
    if i >= len(frames) - 1:
        return shot(frames[-1])
    if f < 0.02:
        return shot(frames[i])
    return Image.blend(shot(frames[i]), shot(frames[i + 1]), f)


def crop_rect(a, b, k, size=(1280, 720)):
    """The crop in source pixels at time k, kept 16:9 and inside the frame."""
    e = ease(k)
    x = a[0] + (b[0] - a[0]) * e
    y = a[1] + (b[1] - a[1]) * e
    w = a[2] + (b[2] - a[2]) * e
    sw, sh = size
    w = min(w, sw)
    h = w * H / W
    if h > sh:
        h = sh
        w = h * W / H
    x = min(max(0.0, x), sw - w)
    y = min(max(0.0, y), sh - h)
    return x, y, w, h


def to_screen(box, rect):
    """A rect given in source pixels, mapped into the cropped frame - without
    this, every annotation would sit where it was before the camera moved."""
    x, y, w, h = rect
    sx, sy = W / w, H / h
    return [(box[0] - x) * sx, (box[1] - y) * sy, box[2] * sx, box[3] * sy]


def kenburns(name, a, b, k, src=None):
    src = src if src is not None else shot(name)
    x, y, w, h = crop_rect(a, b, k, src.size)
    box = (int(round(x)), int(round(y)), int(round(x + w)), int(round(y + h)))
    return src.resize((W, H), Image.LANCZOS, box=box)


def caption(img, lines, k, y=H - 118):
    """Lower third: a band, a cyan rule, and up to two lines of serif."""
    if k <= 0:
        return
    a = min(1.0, k * 3.0)
    band_h = 106
    band = Image.new('RGB', (W, band_h), (4, 7, 12))
    img.paste(Image.blend(img.crop((0, y - 8, W, y - 8 + band_h)), band, 0.82 * a), (0, y - 8))
    d = ImageDraw.Draw(img)
    d.rectangle([0, y - 9, int(W * ease(min(1, k * 1.6))), y - 7], fill=CY)
    f = F(SERIF, 31)
    for i, ln in enumerate(lines[:2]):
        shown = ln
        text(d, (64, y + 16 + i * 40), shown, f, WHITE)


def annotate(img, box, label, k, color=CY, side='right'):
    """A rounded box that draws itself in, with a leader line and a label."""
    if k <= 0:
        return
    e = ease(min(1.0, k * 1.8))
    x, y, w, h = box
    cx, cy = x + w / 2, y + h / 2
    ww, hh = w * e, h * e
    d = ImageDraw.Draw(img, 'RGBA')
    col = color + (int(235 * min(1.0, k * 2)),)
    d.rounded_rectangle([cx - ww / 2, cy - hh / 2, cx + ww / 2, cy + hh / 2], radius=10, outline=col, width=3)
    if k > 0.35 and label:
        f = F(MONO_B, 23)
        lx = x + w + 18 if side == 'right' else x - 18
        ly = y + h / 2
        d.line([(x + w, ly) if side == 'right' else (x, ly), (lx, ly)], fill=col, width=3)
        anchor = 'lm' if side == 'right' else 'rm'
        tw = d.textlength(label, font=f)
        pad = 10
        bx0 = lx - (0 if side == 'right' else tw + pad * 2)
        d.rounded_rectangle([bx0, ly - 22, bx0 + tw + pad * 2, ly + 22], radius=8,
                            fill=(4, 10, 18, 225), outline=col, width=2)
        d.text((bx0 + pad, ly), label, font=f, fill=color + (255,), anchor='lm')


def progress(img, t, total):
    d = ImageDraw.Draw(img, 'RGBA')
    d.rectangle([0, H - 4, W, H], fill=(255, 255, 255, 26))
    d.rectangle([0, H - 4, int(W * t / total), H], fill=CY + (190,))


# ---------------------------------------------------------------- scenes
def title_card(t, dur):
    img = star_bg(t)
    d = ImageDraw.Draw(img)
    k = ease(min(1.0, t / 1.6))
    f1 = F(HEAD, 96)
    text(d, (W / 2, 232), 'N A Z A R', f1, tuple(int(c * k) for c in WHITE), anchor='mm')
    if t > 1.2:
        k2 = ease(min(1.0, (t - 1.2) / 1.4))
        f2 = F(SERIF, 34)
        text(d, (W / 2, 318), 'a satellite tracker that runs entirely in a browser tab',
             f2, tuple(int(c * k2) for c in DIM), anchor='mm')
    if t > 2.6:
        k3 = ease(min(1.0, (t - 2.6) / 1.2))
        d.rectangle([W / 2 - 150 * k3, 366, W / 2 + 150 * k3, 368], fill=CY)
    if t > 3.4:
        k4 = ease(min(1.0, (t - 3.4) / 1.4))
        f3 = F(MONO, 24)
        text(d, (W / 2, 424), 'Nonchalantly Assembled Zero-budget\nAssessment of Space Reconnaissance',
             f3, tuple(int(c * k4) for c in DIM), anchor='mm', spacing=12)
    if t > dur - 1.0:
        img = fade(img, (dur - t) / 1.0)
    return img


def section_card(t, dur, n, title, sub):
    img = star_bg(t)
    d = ImageDraw.Draw(img)
    k = ease(min(1.0, t / 0.9))
    text(d, (W / 2, 268), n, F(MONO_B, 26), tuple(int(c * k) for c in CY), anchor='mm')
    k2 = ease(min(1.0, max(0.0, (t - 0.35) / 1.0)))
    text(d, (W / 2, 334), title, F(HEAD, 64), tuple(int(c * k2) for c in WHITE), anchor='mm')
    k3 = ease(min(1.0, max(0.0, (t - 0.8) / 1.0)))
    text(d, (W / 2, 404), sub, F(SERIF, 30), tuple(int(c * k3) for c in DIM), anchor='mm')
    d.rectangle([W / 2 - 180 * k2, 372, W / 2 + 180 * k2, 373], fill=(40, 70, 100))
    if t > dur - 0.8:
        img = fade(img, (dur - t) / 0.8)
    return img


def page_scene(t, dur, spec):
    """A screenshot under a slow move, with timed annotations and captions."""
    frames = spec.get('frames')
    if frames:                                   # a captured sequence = real motion
        src = sequence(frames, (t / dur) * spec.get('rate', 1.0))
        img = kenburns(None, spec['from'], spec['to'], t / dur, src=src)
    else:
        img = kenburns(spec['shot'], spec['from'], spec['to'], t / dur)
    rect = crop_rect(spec['from'], spec['to'], t / dur)
    for a in spec.get('notes', []):
        if t >= a['at']:
            annotate(img, to_screen(a['box'], rect), a.get('label', ''), (t - a['at']) / 0.55,
                     a.get('color', CY), a.get('side', 'right'))
    caps = spec.get('caps', [])
    for c in caps:
        if c['at'] <= t < c['at'] + c['for']:
            caption(img, c['lines'], (t - c['at']) / 0.4)
    if t < 0.5:
        img = fade(img, t / 0.5)
    if t > dur - 0.5:
        img = fade(img, (dur - t) / 0.5)
    return img


def outro(t, dur):
    img = star_bg(t)
    d = ImageDraw.Draw(img)
    k = ease(min(1.0, t / 1.2))
    text(d, (W / 2, 210), 'No server. No account. No cost.', F(HEAD, 54),
         tuple(int(c * k) for c in WHITE), anchor='mm')
    rows = [
        ('Orbits', 'SGP4 propagation in your browser, from public element sets'),
        ('Data', 'CelesTrak and Space-Track, refreshed every few hours'),
        ('Everything else', 'one static site - open a page and it just runs'),
    ]
    for i, (a, b) in enumerate(rows):
        kk = ease(min(1.0, max(0.0, (t - 1.2 - i * 0.55) / 1.0)))
        if kk <= 0:
            continue
        y = 300 + i * 62
        text(d, (W / 2 - 24, y), a, F(MONO_B, 26), tuple(int(c * kk) for c in CY), anchor='rm')
        text(d, (W / 2 + 24, y), b, F(SERIF, 27), tuple(int(c * kk) for c in DIM), anchor='lm')
    kk = ease(min(1.0, max(0.0, (t - 3.6) / 1.2)))
    if kk > 0:
        text(d, (W / 2, 536), 'hitesh-gala.github.io/sat-orbit-map', F(MONO, 27),
             tuple(int(c * kk) for c in WHITE), anchor='mm')
        text(d, (W / 2, 584), 'built by Hitesh Gala  ·  The Takshashila Institution', F(SERIF, 24),
             tuple(int(c * kk * 0.85) for c in DIM), anchor='mm')
    if t > dur - 1.6:
        img = fade(img, (dur - t) / 1.6)
    return img


# ---------------------------------------------------------------- storyboard
FULL = (0, 0, 1280, 720)
STORY = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'story.json'), encoding='utf-8'))

TOTAL = sum(s['dur'] for s in STORY)
print('scenes: %d   total: %.1fs' % (len(STORY), TOTAL))


def render_at(t):
    acc = 0.0
    for s in STORY:
        if t < acc + s['dur'] or s is STORY[-1]:
            lt = t - acc
            kind = s['kind']
            if kind == 'title':
                img = title_card(lt, s['dur'])
            elif kind == 'section':
                img = section_card(lt, s['dur'], s['n'], s['title'], s['sub'])
            elif kind == 'outro':
                img = outro(lt, s['dur'])
            else:
                img = page_scene(lt, s['dur'], s)
            progress(img, t, TOTAL)
            return img
        acc += s['dur']


def main():
    import imageio_ffmpeg
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    n = int(TOTAL * FPS)
    cmd = [exe, '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, H),
           '-r', str(FPS), '-i', 'pipe:0', '-i', 'ambient.wav',
           '-c:v', 'libx264', '-preset', 'medium', '-crf', '23' if not FAST else '32',
           '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
           '-c:a', 'aac', '-b:a', '128k', '-shortest', OUT]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for i in range(n):
        img = render_at(i / FPS)
        p.stdin.write(img.tobytes())
        if i % 300 == 0:
            print('  frame %d / %d  (%.0f%%)' % (i, n, 100 * i / n), flush=True)
    p.stdin.close()
    p.wait()
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    if '--probe' in sys.argv:
        for t in [float(x) for x in sys.argv[sys.argv.index('--probe') + 1].split(',')]:
            render_at(t).save('probe_%06.1f.jpg' % t, quality=88)
        print('probes written')
    else:
        main()
