#!/usr/bin/env python3
"""Draws the PubliMentor illustration set as inline SVG partials.

Everything is built from the brand palette (logo navy-teal, slide-deck teal and green)
plus one warm highlighter accent. No text inside the pictures, so there is nothing to translate.
"""
import math, os, random

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'partials')

INK, PINE, BRAND, TEAL, TEAL2 = '#0D2B38', '#123B49', '#1E4E5F', '#0D757F', '#2B98A1'
MINT, MINTW, PAPER, WHITE = '#CFE6D6', '#EAF3EC', '#FAF7F0', '#FFFFFF'
GREY, GREY2, SAGE = '#DDE5E3', '#C3D1CE', '#9CCBAF'
AMBER, AMBER2 = '#F3C66F', '#E2A43A'


def f(n):
    return ('%.2f' % n).rstrip('0').rstrip('.')


def rrect(x, y, w, h, r, fill, extra=''):
    return '<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="%s"%s/>' % (f(x), f(y), f(w), f(h), f(r), fill, (' ' + extra) if extra else '')


def bar(x, y, w, h=4, fill=GREY):
    return rrect(x, y, w, h, h / 2, fill)


def circle(cx, cy, r, fill, extra=''):
    return '<circle cx="%s" cy="%s" r="%s" fill="%s"%s/>' % (f(cx), f(cy), f(r), fill, (' ' + extra) if extra else '')


def check(cx, cy, s, stroke=WHITE, width=3):
    """a tick centred on (cx, cy); s is half its width"""
    return ('<path d="M%s %sl%s %sl%s %s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round"/>'
            % (f(cx - s), f(cy + s * .05), f(s * .68), f(s * .68), f(s * 1.32), f(-s * 1.36), stroke, f(width)))


def text_lines(x, y, w, n, gap=9, h=4, fill=GREY, seed=1, last=.62, ragged=.12):
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        ww = w * (last if i == n - 1 else 1 - rnd.random() * ragged)
        out.append(bar(x, y + i * gap, ww, h, fill))
    return ''.join(out)


def leaf_branch(cx, cy, R, a0, a1, n, size, fill, opacity):
    """laurel branch: pairs of leaves along an arc (angles in degrees, SVG clockwise)"""
    out = []
    for i in range(n):
        t = i / (n - 1)
        a = math.radians(a0 + (a1 - a0) * t)
        x, y = cx + R * math.cos(a), cy + R * math.sin(a)
        tangent = math.degrees(a) + (90 if a1 > a0 else -90)
        s = size * (1 - .35 * t)
        for splay in (-34, 34):
            out.append('<path d="M0 0C%s %s %s %s 0 %sC%s %s %s %s 0 0Z" transform="translate(%s %s) rotate(%s)"/>' % (
                f(s * .30), f(-s * .25), f(s * .30), f(-s * .75), f(-s), f(-s * .30), f(-s * .75), f(-s * .30), f(-s * .25),
                f(x), f(y), f(tangent + 90 + splay)))
    return '<g fill="%s" opacity="%s">%s</g>' % (fill, opacity, ''.join(out))


def scallop(cx, cy, R, n, fill):
    pts = [(cx + R * math.cos(2 * math.pi * i / n), cy + R * math.sin(2 * math.pi * i / n)) for i in range(n)]
    r = R * math.sin(math.pi / n) * 1.08
    d = 'M%s %s' % (f(pts[0][0]), f(pts[0][1]))
    for i in range(1, n + 1):
        x, y = pts[i % n]
        d += 'A%s %s 0 0 1 %s %s' % (f(r), f(r), f(x), f(y))
    return '<path d="%sZ" fill="%s"/>' % (d, fill)


def spark(cx, cy, s, fill):
    return '<path d="M%s %sQ%s %s %s %sQ%s %s %s %sQ%s %s %s %sQ%s %s %s %sZ" fill="%s"/>' % (
        f(cx), f(cy - s), f(cx), f(cy), f(cx + s), f(cy), f(cx), f(cy), f(cx), f(cy + s), f(cx), f(cy), f(cx - s), f(cy),
        f(cx), f(cy), f(cx), f(cy - s), fill)


def svg(vb, body, cls, defs='', extra=''):
    return ('<svg class="%s" viewBox="0 0 %s %s" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"%s>%s%s</svg>\n'
            % (cls, vb[0], vb[1], (' ' + extra) if extra else '', ('<defs>%s</defs>' % defs) if defs else '', body))


def shadow(idn, dy=10, blur=14, op=.18):
    return ('<filter id="%s" x="-30%%" y="-30%%" width="160%%" height="170%%"><feDropShadow dx="0" dy="%s" stdDeviation="%s" flood-color="#0D2B38" flood-opacity="%s"/></filter>'
            % (idn, dy, blur, op))


# ---------------------------------------------------------------------------
# Manuscript page (shared by the hero and the role pictures)
# ---------------------------------------------------------------------------
def manuscript(w=250, h=350, detail=True, seed=3):
    p = []
    p.append(rrect(0, 0, w, h, 10, WHITE))
    # running head
    p.append('<path d="M0 10a10 10 0 0 1 10-10h%s a10 10 0 0 1 10 10v24H0z" fill="%s"/>' % (f(w - 20), MINTW))
    p.append(circle(22, 17, 6, TEAL))
    p.append(bar(34, 14.5, 62, 5, SAGE))
    p.append(circle(w - 22, 17, 6.5, AMBER))
    p.append('<path d="M%s 16.5v-2.2a2.6 2.6 0 0 1 5.2 0" fill="none" stroke="%s" stroke-width="1.6" stroke-linecap="round"/>' % (f(w - 24.6), WHITE))
    p.append(rrect(w - 25.6, 16.2, 7.2, 5.4, 1.4, WHITE))
    # article type + title + authors
    p.append(rrect(22, 50, 44, 9, 4.5, TEAL))
    p.append(bar(22, 70, w - 62, 10, INK))
    p.append(bar(22, 87, w - 118, 10, INK))
    p.append(bar(22, 108, 118, 5, TEAL2))
    p.append(bar(22, 119, 164, 4, GREY2))
    # abstract
    p.append(rrect(22, 134, w - 44, 58, 6, MINTW))
    p.append(rrect(30, 151.5, 128, 9, 2, AMBER, 'opacity=".75"'))
    p.append(text_lines(32, 144, w - 64, 4, gap=10, h=4, fill=GREY2, seed=seed))
    # two columns
    colw = (w - 44 - 14) / 2
    lx, rx = 22, 22 + colw + 14
    p.append(rrect(lx - 3, 236.5, colw + 2, 22, 3, MINT, 'opacity=".9"'))
    p.append(text_lines(lx, 204, colw, 13, gap=9.4, h=4, fill=GREY, seed=seed + 1))
    # figure
    p.append(rrect(rx, 204, colw, 72, 5, WHITE, 'stroke="%s" stroke-width="1.5"' % GREY))
    bars_h = [22, 34, 48, 30, 40]
    bw = (colw - 24) / 5
    for i, bh in enumerate(bars_h):
        p.append(rrect(rx + 10 + i * bw, 204 + 60 - bh, bw - 5, bh, 2, TEAL2 if i == 2 else MINT))
    pts = ' '.join('%s,%s' % (f(rx + 10 + i * bw + (bw - 5) / 2), f(204 + 52 - v)) for i, v in enumerate([18, 28, 46, 30, 42]))
    p.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' % (pts, INK))
    p.append(bar(rx, 283, colw * .7, 3.5, GREY2))
    p.append(text_lines(rx, 296, colw, 4, gap=9.4, h=4, fill=GREY, seed=seed + 2))
    if detail:
        # reviewer's marks in the margin
        p.append(check(11, 246, 4.2, TEAL, 2.2))
        p.append(check(11, 158, 4.2, TEAL, 2.2))
        p.append('<path d="M%s 303l4-6 4 6" fill="none" stroke="%s" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' % (f(lx + 30), AMBER2))
    p.append(bar(w / 2 - 9, h - 16, 18, 3.5, GREY2))
    return ''.join(p)


# ---------------------------------------------------------------------------
# HERO — back layer: backdrop, laurel, second sheet, manuscript
# ---------------------------------------------------------------------------
def hero_back():
    b = []
    b.append('<circle cx="318" cy="282" r="234" fill="url(#hbG)"/>')
    b.append('<circle cx="318" cy="282" r="258" fill="none" stroke="%s" stroke-width="1.5" stroke-dasharray="2 9" stroke-linecap="round"/>' % SAGE)
    b.append(leaf_branch(318, 282, 258, 108, 200, 9, 30, TEAL, .26))
    b.append(leaf_branch(318, 282, 258, 72, -20, 9, 30, TEAL, .26))
    b.append(spark(86, 78, 13, AMBER))
    b.append(spark(566, 330, 9, AMBER))
    b.append(circle(548, 96, 5, TEAL2, 'opacity=".55"'))
    b.append(circle(44, 250, 4, TEAL2, 'opacity=".45"'))
    b.append('<circle cx="120" cy="492" r="7" fill="none" stroke="%s" stroke-width="2.5" opacity=".5"/>' % TEAL2)
    # sheet behind
    b.append('<g transform="translate(70 96) rotate(3 125 175)" filter="url(#hbS2)">%s%s</g>' % (
        rrect(0, 0, 250, 350, 10, '#F4F8F6'), text_lines(24, 40, 200, 6, gap=12, h=4, fill=GREY, seed=9)))
    # the manuscript
    b.append('<g transform="translate(44 88) rotate(-7 125 175)" filter="url(#hbS)">%s</g>' % manuscript())
    defs = ('<linearGradient id="hbG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#DDEEE3"/><stop offset="1" stop-color="#F1F7F2"/></linearGradient>'
            + shadow('hbS', 14, 16, .2) + shadow('hbS2', 6, 8, .1))
    return svg((600, 540), ''.join(b), 'art-layer', defs)


# ---------------------------------------------------------------------------
# HERO — front layer: journal, magnifier, seal, review comment
# ---------------------------------------------------------------------------
def journal(w=156, h=206):
    j = []
    j.append(rrect(4, 3, w - 2, h - 2, 6, '#E9EFEC'))                      # page block
    j.append(rrect(0, 0, w, h, 6, 'url(#hfJ)'))
    j.append('<path d="M0 6a6 6 0 0 1 6-6h9v%sH6a6 6 0 0 1-6-6z" fill="%s" opacity=".55"/>' % (f(h), INK))
    j.append(rrect(28, 22, w - 46, 7, 3.5, MINT, 'opacity=".9"'))
    j.append(rrect(28, 35, w - 86, 5, 2.5, MINT, 'opacity=".45"'))
    j.append(circle(w / 2 + 7, 108, 47, WHITE, 'opacity=".07"'))
    j.append('<circle cx="%s" cy="108" r="47" fill="none" stroke="%s" stroke-width="1.2" opacity=".35"/>' % (f(w / 2 + 7), MINT))
    j.append(rrect(28, h - 38, 40, 4.5, 2.2, MINT, 'opacity=".5"'))
    j.append(rrect(28, h - 27, 64, 4.5, 2.2, MINT, 'opacity=".3"'))
    j.append(rrect(w - 50, h - 40, 24, 18, 3, TEAL2))
    # bookmark ribbon
    j.append('<path d="M%s -6h16v46l-8-7-8 7z" fill="%s"/>' % (f(w - 40), AMBER))
    return ''.join(j)


def magnifier(cx, cy, r):
    m = []
    m.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="13" stroke-linecap="round"/>' % (f(cx + r * .74), f(cy + r * .74), f(cx + r * 1.62), f(cy + r * 1.62), INK))
    m.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="13" stroke-linecap="butt"/>' % (f(cx + r * .98), f(cy + r * .98), f(cx + r * 1.2), f(cy + r * 1.2), TEAL2))
    m.append(circle(cx, cy, r, '#F3F9F6', 'opacity=".96"'))
    # what the lens shows: the figure, enlarged, and a tick of approval
    for i, bh in enumerate([16, 27, 40]):
        m.append(rrect(cx - 27 + i * 15, cy + 20 - bh, 11, bh, 2.5, TEAL2 if i == 2 else SAGE))
    m.append(circle(cx + 19, cy - 14, 12.5, TEAL))
    m.append(check(cx + 19, cy - 14, 5.4, WHITE, 2.8))
    m.append('<circle cx="%s" cy="%s" r="%s" fill="none" stroke="%s" stroke-width="8"/>' % (f(cx), f(cy), f(r), INK))
    m.append('<path d="M%s %sa%s %s 0 0 1 %s %s" fill="none" stroke="%s" stroke-width="3" stroke-linecap="round" opacity=".9"/>' % (
        f(cx - r * .62), f(cy - r * .2), f(r * .66), f(r * .66), f(r * .42), f(-r * .44), WHITE))
    return ''.join(m)


def seal(cx, cy, R):
    s = []
    s.append('<path d="M%s %sl-9 34 13-8 9 13 7-36z" fill="%s"/>' % (f(cx - 8), f(cy + R * .6), BRAND))
    s.append('<path d="M%s %sl9 34-13-8-9 13-7-36z" fill="%s"/>' % (f(cx + 8), f(cy + R * .6), PINE))
    s.append(scallop(cx, cy, R, 14, TEAL))
    s.append('<circle cx="%s" cy="%s" r="%s" fill="none" stroke="%s" stroke-width="1.6" opacity=".55"/>' % (f(cx), f(cy), f(R * .74), WHITE))
    s.append(check(cx, cy, R * .3, WHITE, 4.2))
    return ''.join(s)


def bubble(x, y, w, h, tail='right'):
    b = []
    tx = x + w - 30 if tail == 'right' else x + 30
    b.append('<path d="M%s %sl10 -15 12 15z" fill="%s"/>' % (f(tx), f(y + 2), WHITE))
    b.append(rrect(x, y, w, h, 13, WHITE))
    b.append(circle(x + 24, y + h / 2, 12, AMBER))
    b.append(circle(x + 24, y + h / 2 - 3, 4.2, WHITE))
    b.append('<path d="M%s %sa8 8 0 0 1 16 0z" fill="%s"/>' % (f(x + 16), f(y + h / 2 + 9.5), WHITE))
    b.append(bar(x + 46, y + h / 2 - 11, w - 64, 5, GREY2))
    b.append(bar(x + 46, y + h / 2 + 1, w - 84, 5, GREY))
    b.append(circle(x + w - 8, y + 8, 9, TEAL))
    b.append(check(x + w - 8, y + 8, 3.8, WHITE, 2.2))
    return ''.join(b)


def hero_front():
    b = []
    b.append('<g transform="translate(372 300) rotate(8 78 103)" filter="url(#hfS)">%s</g>' % journal())
    b.append('<g filter="url(#hfS2)">%s</g>' % magnifier(232, 352, 43))
    b.append('<g filter="url(#hfS2)" class="art-float">%s</g>' % seal(262, 92, 29))
    b.append('<g filter="url(#hfS2)" class="art-float art-float--b">%s</g>' % bubble(2, 306, 132, 56, 'right'))
    defs = ('<linearGradient id="hfJ" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1B5466"/><stop offset="1" stop-color="%s"/></linearGradient>' % PINE
            + shadow('hfS', 16, 16, .28) + shadow('hfS2', 8, 9, .2))
    return svg((600, 540), ''.join(b), 'art-layer', defs)


# ---------------------------------------------------------------------------
# Role pictures (Services)
# ---------------------------------------------------------------------------
def tile(body, idn, defs=''):
    base = rrect(0, 0, 132, 100, 18, MINTW)
    return svg((132, 100), base + body, 'role-art', defs + shadow(idn, 4, 5, .16))


def mini_page(w=62, h=80, seed=5, title=True):
    p = [rrect(0, 0, w, h, 6, WHITE)]
    y = 12
    if title:
        p.append(bar(9, y, w - 26, 6, INK)); y += 11
        p.append(bar(9, y, w - 36, 4, TEAL2)); y += 11
    p.append(text_lines(9, y, w - 18, int((h - y - 8) / 8), gap=8, h=3.6, fill=GREY2, seed=seed))
    return ''.join(p)


def role_authors():
    b = '<g transform="translate(30 12) rotate(-6 31 40)" filter="url(#raS)">%s</g>' % mini_page(seed=11)
    # pen
    b += ('<g transform="translate(92 58) rotate(38)" filter="url(#raS)">'
          + rrect(-5.5, -44, 11, 50, 3, INK) + rrect(-5.5, -8, 11, 9, 0, TEAL2)
          + '<path d="M-5.5 6h11l-5.5 15z" fill="%s"/><path d="M-1.8 16h3.6L0 21z" fill="%s"/>' % (AMBER, INK)
          + rrect(-5.5, -50, 11, 8, 3, AMBER) + '</g>')
    b += spark(106, 24, 7, AMBER)
    return tile(b, 'raS')


def role_reviewers():
    b = '<g transform="translate(24 11)" filter="url(#rrS)">%s%s</g>' % (mini_page(seed=21), rrect(7, 45, 34, 9, 2, AMBER, 'opacity=".7"'))
    b += '<g filter="url(#rrS)">%s</g>' % (
        '<line x1="92" y1="72" x2="110" y2="90" stroke="%s" stroke-width="8" stroke-linecap="round"/>' % INK
        + circle(78, 58, 21, '#F3F9F6', 'opacity=".96"') + circle(78, 58, 9.5, TEAL) + check(78, 58, 4.2, WHITE, 2.4)
        + '<circle cx="78" cy="58" r="21" fill="none" stroke="%s" stroke-width="5"/>' % INK)
    return tile(b, 'rrS')


def role_publishers():
    b = '<g filter="url(#rpS)">'
    specs = [(26, 26, 17, 62, PINE, 0), (45, 18, 19, 70, TEAL, 0), (66, 30, 16, 58, SAGE, 0), (86, 24, 18, 66, BRAND, 9)]
    for x, y, w, h, col, rot in specs:
        inner = rrect(x, y, w, h, 3, col) + rrect(x + 3.5, y + 9, w - 7, 4, 2, WHITE, 'opacity=".55"') + rrect(x + 3.5, y + h - 16, w - 7, 7, 2, AMBER if col == TEAL else WHITE, 'opacity="%s"' % ('.95' if col == TEAL else '.3'))
        b += '<g transform="rotate(%s %s %s)">%s</g>' % (rot, x, y + h, inner)
    b += rrect(18, 88, 96, 4, 2, INK) + '</g>'
    return tile(b, 'rpS')


def role_editors():
    b = '<g transform="translate(35 10)" filter="url(#reS)">' + rrect(0, 4, 62, 80, 7, WHITE) + rrect(19, 0, 24, 10, 4, INK)
    for i, col in enumerate([TEAL, AMBER2, BRAND]):
        y = 27 + i * 19
        b += circle(14, y, 6.5, col) + bar(26, y - 5, 22, 4, GREY2) + bar(26, y + 2, 14, 3.4, GREY)
        b += (circle(52, y, 5, MINTW) + check(52, y, 2.5, TEAL, 1.8)) if i != 1 else circle(52, y, 2.6, AMBER)
    b += '</g>'
    return tile(b, 'reS')


def role_ai():
    b = rrect(0, 0, 132, 100, 18, '#1B4C5C')
    b += '<g transform="translate(30 10)" filter="url(#riS)">%s</g>' % mini_page(w=60, h=80, seed=31)
    b += rrect(22, 46, 76, 16, 3, TEAL2, 'opacity=".28"') + rrect(18, 53, 84, 3, 1.5, MINT)
    b += circle(90, 22, 9, TEAL2) + check(90, 22, 4, WHITE, 2.2)
    chip = rrect(0, 0, 34, 34, 7, INK) + rrect(8, 8, 18, 18, 4, MINT)
    for i in range(3):
        chip += rrect(7 + i * 8, -5, 3.4, 6, 1.5, MINT) + rrect(7 + i * 8, 33, 3.4, 6, 1.5, MINT) + rrect(-5, 7 + i * 8, 6, 3.4, 1.5, MINT) + rrect(33, 7 + i * 8, 6, 3.4, 1.5, MINT)
    b += '<g transform="translate(82 54)" filter="url(#riS)">%s</g>' % chip
    b += spark(22, 22, 7, AMBER)
    return svg((132, 100), b, 'role-art', shadow('riS', 4, 5, .3))


# ---------------------------------------------------------------------------
# Workshop scene (Training) — the screen shows the real sample slide, placed over it in HTML
# ---------------------------------------------------------------------------
def workshop():
    b = [rrect(0, 0, 480, 360, 22, MINTW)]
    b.append('<path d="M0 300h480v38a22 22 0 0 1-22 22H22a22 22 0 0 1-22-22z" fill="%s" opacity=".7"/>' % MINT)
    # screen: x 72..408 (70%), y 34..223
    b.append('<g filter="url(#wsS)">%s</g>' % rrect(66, 28, 348, 201, 10, INK))
    b.append(rrect(72, 34, 336, 189, 5, WHITE))
    # audience, seen from behind
    people = [(58, 322, 22, BRAND, 'plain'), (150, 310, 25, INK, 'bun'), (246, 324, 23, TEAL, 'long'), (338, 308, 26, PINE, 'plain'), (428, 322, 22, BRAND, 'bob')]
    for x, y, r, col, hair in people:
        sh = r * 2.15
        b.append('<path d="M%s 360v-%sa%s %s 0 0 1 %s 0v%sz" fill="%s"/>' % (f(x - sh), f(360 - y - r * 1.55), f(sh), f(r * 1.25), f(sh * 2), f(360 - y - r * 1.55), col))
        b.append(rrect(x - r * .42, y + r * .6, r * .84, r * .9, 4, col))
        if hair == 'long':
            b.append('<path d="M%s %sa%s %s 0 0 1 %s 0v%sa8 8 0 0 1-8 8h-%sa8 8 0 0 1-8-8z" fill="%s"/>' % (f(x - r * 1.08), f(y), f(r * 1.08), f(r * 1.08), f(r * 2.16), f(r * 1.5), f(r * 2.16 - 16), col))
        if hair == 'bob':
            b.append(rrect(x - r * 1.1, y - r * .1, r * 2.2, r * 1.25, r * .5, col))
        if hair == 'bun':
            b.append(circle(x + r * .1, y - r * 1.12, r * .46, col))
        b.append(circle(x, y, r, col))
        b.append('<path d="M%s %sa%s %s 0 0 1 %s %s" fill="none" stroke="%s" stroke-width="3" stroke-linecap="round" opacity=".14"/>' % (f(x - r * .7), f(y - r * .25), f(r * .8), f(r * .8), f(r * .55), f(-r * .5), WHITE))
    b.append(spark(440, 58, 9, AMBER))
    body = '<g clip-path="url(#wsC)">%s</g>' % ''.join(b)
    return svg((480, 360), body, 'art-layer', shadow('wsS', 8, 10, .2) + '<clipPath id="wsC"><rect width="480" height="360" rx="22"/></clipPath>')


# ---------------------------------------------------------------------------
# Newsletter covers
# ---------------------------------------------------------------------------
def cover_migrasome():
    rnd = random.Random(7)
    b = [rrect(0, 0, 480, 300, 0, 'url(#cmB)')]
    # retraction fibres trailing behind the migrating cell, with migrasomes budding on them
    fibres = []
    for i in range(7):
        y0 = 92 + i * 21 + rnd.uniform(-4, 4)
        y1 = 40 + i * 38 + rnd.uniform(-10, 10)
        xm = rnd.uniform(150, 210)
        ym = (y0 + y1) / 2 + rnd.uniform(-18, 18)
        fibres.append((300, y0, xm, ym, rnd.uniform(-6, 40), y1))
    for x0, y0, xm, ym, x1, y1 in fibres:
        b.append('<path d="M%s %sQ%s %s %s %s" fill="none" stroke="%s" stroke-width="1.6" opacity=".55" stroke-linecap="round"/>' % (f(x0), f(y0), f(xm), f(ym), f(x1), f(y1), MINT))
    for k, (x0, y0, xm, ym, x1, y1) in enumerate(fibres):
        for t in (rnd.uniform(.25, .45), rnd.uniform(.6, .9)):
            x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * xm + t * t * x1
            y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * ym + t * t * y1
            r = rnd.uniform(5, 13)
            col = AMBER if (k + int(t * 10)) % 3 == 0 else MINT
            b.append(circle(x, y, r, col, 'opacity=".95"'))
            b.append('<circle cx="%s" cy="%s" r="%s" fill="none" stroke="%s" stroke-width="1.4" opacity=".55"/>' % (f(x), f(y), f(r * .62), WHITE))
            if r > 9:
                b.append(circle(x - r * .2, y + r * .15, 1.8, PINE, 'opacity=".55"') + circle(x + r * .25, y - r * .2, 1.4, PINE, 'opacity=".55"'))
    # the cell
    b.append('<path d="M300 70C350 30 440 40 462 110C486 180 452 262 380 268C318 274 276 232 286 176C290 150 270 100 300 70Z" fill="url(#cmC)"/>')
    b.append('<path d="M418 66C462 92 474 170 446 226" fill="none" stroke="%s" stroke-width="10" stroke-linecap="round" opacity=".35"/>' % WHITE)
    b.append(circle(372, 160, 44, TEAL, 'opacity=".9"'))
    b.append(circle(384, 150, 15, PINE, 'opacity=".75"'))
    for _ in range(9):
        b.append(circle(rnd.uniform(310, 440), rnd.uniform(80, 250), rnd.uniform(2, 4.5), WHITE, 'opacity=".5"'))
    for _ in range(16):
        b.append(circle(rnd.uniform(10, 280), rnd.uniform(10, 290), rnd.uniform(1, 2.2), MINT, 'opacity=".35"'))
    defs = ('<linearGradient id="cmB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>' % (INK, PINE)
            + '<linearGradient id="cmC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7CC7B5"/><stop offset="1" stop-color="%s"/></linearGradient>' % TEAL2)
    return svg((480, 300), ''.join(b), 'cover-art', defs, 'preserveAspectRatio="xMidYMid slice"')


def cover_oa():
    b = [rrect(0, 0, 480, 300, 0, 'url(#coB)')]
    b.append(circle(372, 150, 118, WHITE, 'opacity=".55"'))
    # the invoice
    r = [rrect(0, 0, 150, 236, 4, WHITE)]
    zig = 'M0 232' + ''.join('l7.5 %s' % ('9' if i % 2 == 0 else '-9') for i in range(20)) + 'V236H0z'
    r.append('<path d="%s" fill="%s"/>' % (zig.replace('V236H0z', 'v-10H0z'), WHITE))
    r.append(rrect(14, 16, 58, 9, 4.5, TEAL))
    r.append(bar(14, 34, 84, 4, GREY2))
    for i in range(6):
        y = 60 + i * 19
        r.append(bar(14, y, 62 + (i * 13) % 24, 4.5, GREY))
        r.append(bar(108, y, 28, 4.5, GREY2))
    r.append('<line x1="14" y1="178" x2="136" y2="178" stroke="%s" stroke-width="1.5" stroke-dasharray="3 4"/>' % GREY2)
    r.append(rrect(10, 188, 130, 20, 4, AMBER, 'opacity=".55"'))
    r.append(bar(16, 195, 40, 6, INK))
    r.append(bar(96, 195, 38, 6, INK))
    b.append('<g transform="translate(96 40) rotate(-7 75 118)" filter="url(#coS)">%s</g>' % ''.join(r))
    # the open padlock
    lock = ['<path d="M-62 -6v-30a24 24 0 0 1 48 0v44" fill="none" stroke="%s" stroke-width="15" stroke-linecap="round"/>' % INK]
    lock.append(rrect(-46, 0, 92, 78, 14, AMBER))
    lock.append(rrect(-46, 0, 92, 78, 14, AMBER2, 'opacity=".25"'))
    lock.append(circle(0, 32, 10, INK))
    lock.append(rrect(-4, 34, 8, 22, 4, INK))
    b.append('<g transform="translate(372 138) rotate(7)" filter="url(#coS)">%s</g>' % ''.join(lock))
    b.append(spark(448, 52, 10, TEAL2))
    b.append(spark(64, 250, 8, AMBER2))
    defs = ('<linearGradient id="coB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E3F0E7"/><stop offset="1" stop-color="#F6F1E4"/></linearGradient>'
            + shadow('coS', 10, 10, .2))
    return svg((480, 300), ''.join(b), 'cover-art', defs, 'preserveAspectRatio="xMidYMid slice"')


# ---------------------------------------------------------------------------
# Services side picture: the manuscript's journey between the four roles
# ---------------------------------------------------------------------------
def pict_pen():
    return ('<g transform="rotate(38)">' + rrect(-5, -26, 10, 34, 3, INK) + rrect(-5, -2, 10, 7, 0, TEAL2)
            + '<path d="M-5 8h10l-5 13z" fill="%s"/><path d="M-1.7 16.5h3.4L0 21z" fill="%s"/>' % (AMBER, INK) + rrect(-5, -31, 10, 7, 3, AMBER) + '</g>')


def pict_lens():
    return ('<line x1="9" y1="9" x2="22" y2="22" stroke="%s" stroke-width="7" stroke-linecap="round"/>' % INK
            + circle(-3, -3, 17, '#F3F9F6') + circle(-3, -3, 8, TEAL) + check(-3, -3, 3.4, WHITE, 2.1)
            + '<circle cx="-3" cy="-3" r="17" fill="none" stroke="%s" stroke-width="4.5"/>' % INK)


def pict_clipboard():
    g = rrect(-17, -19, 34, 42, 5, WHITE, 'stroke="%s" stroke-width="2.5"' % INK) + rrect(-8, -24, 16, 8, 3, INK)
    for i, col in enumerate([TEAL, AMBER2, BRAND]):
        y = -7 + i * 10
        g += circle(-9, y, 3.2, col) + bar(-3, y - 2, 15, 4, GREY2)
    return g


def pict_books():
    g = ''
    for x, h, col in ((-20, 34, PINE), (-9, 42, TEAL), (2, 30, SAGE)):
        g += rrect(x, 20 - h, 9.5, h, 2, col) + rrect(x + 2, 20 - h + 6, 5.5, 3, 1.5, WHITE, 'opacity=".55"')
    g += '<g transform="rotate(10 13 20)">%s</g>' % (rrect(13, -14, 9.5, 34, 2, BRAND) + rrect(15, -8, 5.5, 3, 1.5, WHITE, 'opacity=".55"'))
    g += rrect(-25, 20, 52, 3.5, 1.75, INK)
    return g


def lifecycle():
    cx = cy = 200
    R = 138
    b = [circle(cx, cy, 176, MINTW)]
    b.append('<circle cx="%s" cy="%s" r="%s" fill="none" stroke="%s" stroke-width="2.5" stroke-dasharray="3 9" stroke-linecap="round"/>' % (cx, cy, R, TEAL2))
    for a in (-45, 45, 135, 225):                                   # clockwise arrowheads between the stops
        x, y = cx + R * math.cos(math.radians(a)), cy + R * math.sin(math.radians(a))
        b.append('<path d="M-9 -7L7 0L-9 7z" fill="%s" transform="translate(%s %s) rotate(%s)"/>' % (TEAL, f(x), f(y), a + 90))
    b.append('<g transform="translate(%s %s) rotate(-6) scale(1.12)" filter="url(#lcS)"><g transform="translate(-31 -40)">%s</g></g>' % (cx, cy, mini_page(seed=41)))
    b.append(circle(cx + 30, cy - 38, 15, TEAL) + check(cx + 30, cy - 38, 6.2, WHITE, 3.2))
    for a, pic in ((-90, pict_pen()), (0, pict_lens()), (90, pict_clipboard()), (180, pict_books())):
        x, y = cx + R * math.cos(math.radians(a)), cy + R * math.sin(math.radians(a))
        b.append('<g transform="translate(%s %s)"><circle r="45" fill="%s" filter="url(#lcS)"/><circle r="45" fill="none" stroke="%s" stroke-width="1.5"/>%s</g>' % (f(x), f(y), WHITE, GREY, pic))
    b.append(spark(58, 66, 9, AMBER) + spark(346, 340, 7, AMBER))
    return svg((400, 400), ''.join(b), 'side-art', shadow('lcS', 6, 7, .16))


# ---------------------------------------------------------------------------
# Newsletter side picture: an issue leaving its envelope
# ---------------------------------------------------------------------------
def newsletter_art():
    b = [circle(180, 138, 112, MINT, 'opacity=".55"')]
    b.append('<path d="M60 120l120-84 120 84z" fill="%s"/>' % PINE)                                   # flap, open
    letter = rrect(0, 0, 176, 150, 8, WHITE) + rrect(16, 16, 60, 8, 4, TEAL) + bar(16, 34, 118, 7, INK) + bar(16, 48, 84, 7, INK)
    letter += rrect(16, 66, 144, 40, 5, 'url(#nlC)') + circle(132, 86, 12, MINT, 'opacity=".9"') + bar(28, 80, 60, 4, WHITE) + bar(28, 90, 40, 4, WHITE)
    letter += text_lines(16, 116, 144, 3, gap=9, h=4, fill=GREY2, seed=51)
    b.append('<g transform="translate(92 40) rotate(-3 88 75)" filter="url(#nlS)">%s</g>' % letter)
    b.append('<path d="M60 120v92a12 12 0 0 0 12 12h216a12 12 0 0 0 12-12v-92l-120 70z" fill="%s"/>' % BRAND)  # pocket
    b.append('<path d="M60 214l96-62M300 214l-96-62" fill="none" stroke="%s" stroke-width="2" opacity=".25" stroke-linecap="round"/>' % WHITE)
    b.append(circle(292, 124, 17, AMBER) + circle(292, 124, 17, WHITE, 'opacity=".0"') + spark(292, 124, 9, WHITE))
    # paper plane on its way
    b.append('<path d="M18 120q10 -44 56 -58" fill="none" stroke="%s" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>' % TEAL2)
    b.append('<g transform="translate(98 54) rotate(-16)"><path d="M0 0L-38 -14L-28 0L-38 14Z" fill="%s"/><path d="M0 0L-28 0L-38 14Z" fill="%s"/></g>' % (TEAL2, TEAL))
    b.append(spark(326, 58, 8, TEAL2) + spark(44, 196, 7, AMBER2))
    defs = shadow('nlS', 8, 9, .2) + '<linearGradient id="nlC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>' % (PINE, TEAL)
    return svg((360, 250), ''.join(b), 'side-art', defs)


# ---------------------------------------------------------------------------
# Testimonials picture: voices
# ---------------------------------------------------------------------------
def quotes_art():
    def quote_glyph(x, y, s, fill):
        g = ''
        for dx in (0, s * 1.35):
            g += circle(x + dx, y, s * .5, fill) + '<path d="M%s %sq%s %s %s %s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round"/>' % (
                f(x + dx + s * .42), f(y - s * .1), f(s * .1), f(s * .85), f(-s * .65), f(s * 1.1), fill, f(s * .3))
        return g
    b = []
    b.append('<g filter="url(#qaS)">' + '<path d="M26 26h150a18 18 0 0 1 18 18v64a18 18 0 0 1-18 18H92l-30 26v-26H44a18 18 0 0 1-18-18V44a18 18 0 0 1 18-18z" fill="%s"/>' % TEAL + '</g>')
    b.append(quote_glyph(70, 66, 26, WHITE))
    b.append(bar(126, 58, 50, 6, WHITE) + bar(126, 72, 38, 6, MINT))
    b.append('<g filter="url(#qaS)">' + '<path d="M150 96h112a16 16 0 0 1 16 16v44a16 16 0 0 1-16 16h-14v22l-26-22h-72a16 16 0 0 1-16-16v-44a16 16 0 0 1 16-16z" fill="%s"/>' % WHITE + '</g>')
    b.append(circle(172, 134, 13, AMBER) + circle(172, 130.5, 4.6, WHITE) + '<path d="M163.5 144a8.5 8.5 0 0 1 17 0z" fill="%s"/>' % WHITE)
    b.append(bar(194, 122, 66, 6, GREY2) + bar(194, 136, 48, 6, GREY) + bar(194, 150, 58, 6, GREY))
    b.append(spark(232, 40, 11, AMBER) + spark(268, 66, 6, TEAL2) + spark(24, 164, 7, AMBER2))
    return svg((300, 210), ''.join(b), 'side-art', shadow('qaS', 8, 9, .18))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    parts = {
        'art-hero-back': hero_back(), 'art-hero-front': hero_front(),
        'art-role-authors': role_authors(), 'art-role-reviewers': role_reviewers(),
        'art-role-publishers': role_publishers(), 'art-role-editors': role_editors(), 'art-role-ai': role_ai(),
        'art-workshop': workshop(), 'art-lifecycle': lifecycle(), 'art-newsletter': newsletter_art(), 'art-quotes': quotes_art(), 'art-cover-migrasome': cover_migrasome(), 'art-cover-oa': cover_oa(),
    }
    for name, markup in parts.items():
        with open(os.path.join(OUT, name + '.html'), 'w', encoding='utf-8') as fh:
            fh.write(markup)
        print('%-24s %5.1f KB' % (name, len(markup) / 1024))
