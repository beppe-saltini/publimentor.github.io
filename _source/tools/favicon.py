"""Draws the two favicons (one per palette) from the emblem mask: a rounded square in the palette's dark
tone with the emblem in paper cream.  Needs Pillow:  pip install pillow

    python3 _source/tools/favicon.py      # writes assets/favicon-64.png and assets/favicon-64-blue.png
"""
import json, os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PALETTE = json.load(open(os.path.join(ROOT, 'content', 'palette.json'), encoding='utf-8'))['tokens']


def favicon(path, fill, ink):
    S = 256
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle((0, 0, S - 1, S - 1), radius=56, fill=fill)
    alpha = Image.open(os.path.join(ROOT, 'assets', 'emblem-xl-460-60.webp')).convert('RGBA').split()[3]
    w = int(S * .80); h = int(w * alpha.size[1] / alpha.size[0])
    layer = Image.new('RGBA', (w, h), ink); layer.putalpha(alpha.resize((w, h), Image.LANCZOS))
    im.alpha_composite(layer, ((S - w) // 2, (S - h) // 2 - 2))
    im.resize((64, 64), Image.LANCZOS).save(path, optimize=True)
    print('%-28s %s on %s' % (os.path.relpath(path, ROOT), ink, fill))


if __name__ == '__main__':
    favicon(os.path.join(ROOT, 'assets', 'favicon-64.png'), PALETTE['pine']['green'], PALETTE['paper']['green'])
    favicon(os.path.join(ROOT, 'assets', 'favicon-64-blue.png'), PALETTE['brand']['blue'], PALETTE['paper']['blue'])
