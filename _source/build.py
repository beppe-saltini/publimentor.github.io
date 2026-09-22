#!/usr/bin/env python3
"""Builds the PubliMentor website (www.publimentor.com) from _source/ into the repository root.

    python3 _source/build.py            # writes index.html, newsletter.html, newsletter/*.html

Everything the pages need (fonts, pictures, icons, styles, script) is inlined, so each page is a
single self-contained file. Only the two full-size sample slides in assets/training/ are linked.

Where things live
  content/en.json, zh.json   every visible string, by key. Elements in the templates carry
                             data-i18n="key"; the English text is filled in at build time and the
                             Chinese text ships in the page's script for the EN / 中文 switch.
  content/site.json          titles, descriptions, URLs, e-mail, copyright line, Analytics id, alt texts.
  content/palette.json       the two colour palettes (green, blue); becomes the :root tokens and recolours the art.
  content/articles/          the newsletter articles (head + body fragments, HTML).
  templates/, partials/      page structure; partials/art-*.html are drawn by art.py.
  styles.css, script.js      one stylesheet and one script shared by all pages.
  assets/, fonts/, icons/    optimised pictures, subset fonts, the Lucide icons in use.

Needs only Python 3.8+ (standard library).
"""
import base64, html, json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
DIST = os.environ.get('PUBLIMENTOR_OUT', REPO)


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return f.read()


def b64(*parts):
    with open(os.path.join(ROOT, *parts), 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


SITE = json.loads(read('content', 'site.json'))
EN = json.loads(read('content', 'en.json'))
ZH = json.loads(read('content', 'zh.json'))
URLS, ALTS = SITE['urls'], SITE['alts']

# --------------------------------------------------------------------------
# A few strings carry extra markup for presentation (a highlight, a badge, a link).
# The words must stay identical to en.json / zh.json: the build checks this and stops otherwise.
# --------------------------------------------------------------------------
fallback_link = '<a href="%s" target="_blank" rel="noopener">%%s</a>' % html.escape(URLS['form_direct'])
EN_HTML = {
    'hero.title': 'A hub for <mark>ethical, impactful</mark> academic publishing',
    'hero.founder': 'Founded by <strong>Simona Fiorani, PhD</strong>',
    'svc.ai': 'AI Formatting &amp; Ethics Assistant <span class="soon"><span class="paren">(</span>Coming Soon<span class="paren">)</span></span>',
    'mission.lead': html.escape(EN['mission.lead'], quote=False).replace('clearer, fairer, and more robust', '<mark>clearer, fairer, and more robust</mark>'),
    'bio.l1': 'Manuscript readiness review <span class="dur">(2 weeks)</span>',
    'bio.l2': 'Reviewer coaching workshop <span class="dur">(90 mins)</span>',
    'news.fallback': html.escape(EN['news.fallback'][:-len(' Open it in a new tab.')], quote=False) + ' ' + (fallback_link % 'Open it in a new tab') + '.',
}
ZH_HTML = {
    'hero.title': '促进<mark>诚信与影响力</mark>的学术出版资源中心',
    'hero.founder': '由 <strong>Simona Fiorani，博士</strong> 创建',
    'svc.ai': 'AI 排版与伦理助手<span class="soon"><span class="paren">（</span>即将推出<span class="paren">）</span></span>',
    'mission.lead': html.escape(ZH['mission.lead'], quote=False).replace('更清晰、更公平、更稳健', '<mark>更清晰、更公平、更稳健</mark>'),
    'bio.l1': '稿件准备度审查<span class="dur">（2周）</span>',
    'bio.l2': '审稿人培训工作坊<span class="dur">（90分钟）</span>',
    'news.fallback': '看不到表单？' + (fallback_link % '在新标签页中打开') + '。',
}


def strip_tags(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s))


for key, markup in EN_HTML.items():
    if strip_tags(markup) != EN[key]:
        sys.exit('EN markup for %r no longer matches en.json:\n  %r\n  %r' % (key, strip_tags(markup), EN[key]))
for key, markup in ZH_HTML.items():
    if strip_tags(markup) != ZH[key]:
        sys.exit('ZH markup for %r no longer matches zh.json:\n  %r\n  %r' % (key, strip_tags(markup), ZH[key]))


def en_html(key):
    if key in EN_HTML:
        return EN_HTML[key]
    if key not in EN:
        sys.exit('No English text for key %r (add it to content/en.json)' % key)
    return html.escape(EN[key], quote=False)


def zh_html(key):
    if key in ZH_HTML:
        return ZH_HTML[key]
    return html.escape(ZH[key], quote=False) if key in ZH else None


# --------------------------------------------------------------------------
# Assets
# --------------------------------------------------------------------------
IMAGES = {
    'headshot': 'data:image/webp;base64,' + b64('assets', 'headshot-320.webp'),
    'slide3': 'data:image/webp;base64,' + b64('assets', 'slide-3-1280.webp'),
    'slide5': 'data:image/webp;base64,' + b64('assets', 'slide-5-1280.webp'),
}
EMBLEM = 'data:image/webp;base64,' + b64('assets', 'emblem-mask.webp')
EMBLEM_XL = 'data:image/webp;base64,' + b64('assets', 'emblem-xl-460-60.webp')   # the homepage shows the emblem large
SLIDE_SMALL = 'data:image/webp;base64,' + b64('assets', 'slide-3-800.webp')
FAVICON = 'data:image/png;base64,' + b64('assets', 'favicon-64.png')
FAVICON_BLUE = 'data:image/png;base64,' + b64('assets', 'favicon-64-blue.png')


def font_face(family, style, weight, filename):
    return ('@font-face{font-family:"%s";font-style:%s;font-weight:%s;font-display:swap;'
            'src:url(data:font/woff2;base64,%s) format("woff2")}' % (family, style, weight, b64('fonts', filename)))


FONTS = {
    'display': '\n'.join([font_face('Newsreader', 'normal', '400 600', 'newsreader-roman-display.woff2'),
                          font_face('Newsreader', 'italic', '400 600', 'newsreader-italic-display.woff2'),
                          font_face('Figtree', 'normal', '400 700', 'figtree-roman.woff2')]),
    'text': '\n'.join([font_face('Newsreader', 'normal', '400 600', 'newsreader-roman-text.woff2'),
                       font_face('Newsreader', 'italic', '400 600', 'newsreader-italic-text.woff2'),
                       font_face('Figtree', 'normal', '400 700', 'figtree-roman.woff2'),
                       font_face('Figtree', 'italic', '400 700', 'figtree-italic.woff2')]),
}
PALETTE = json.loads(read('content', 'palette.json'))
TOKENS = PALETTE['tokens']


def palette_css():
    """The :root tokens for the green palette, the overrides for the blue one, and the two swatches."""
    green = ''.join('--%s:%s;' % (k, v['green']) for k, v in TOKENS.items())
    blue = ''.join('--%s:%s;' % (k, v['blue']) for k, v in TOKENS.items() if v['blue'] != v['green'])
    sw = ''.join('.palette button[data-palette="%s"]{--swatch:linear-gradient(135deg,%s 50%%,%s 50%%)}' % (name, a, b)
                 for name, (a, b) in PALETTE['swatches'].items())
    return '%s\n}\n:root[data-palette="blue"]{%s}\n%s\n:root{' % (green, blue, sw)


CSS = read('styles.css')
assert CSS.count('/* [[palette]] */') == 1, 'styles.css needs the /* [[palette]] */ marker inside :root'
CSS = CSS.replace('/* [[palette]] */', palette_css())
JS = read('script.js')

# The drawings are generated with the green colours; each becomes its token so the switch recolours them.
ART_TOKEN = {}
for _k, _v in TOKENS.items():
    if _v['green'].startswith('#'):
        assert _v['green'].upper() not in ART_TOKEN, 'duplicate green value for %s' % _k
        ART_TOKEN[_v['green'].upper()] = _k


def tokenise_art(svg):
    def tag(m):
        t = m.group(0); styles = []
        def attr(a):
            prop, val = a.group(1), a.group(2).upper()
            if val in ART_TOKEN:
                styles.append('%s:var(--%s)' % (prop, ART_TOKEN[val])); return ''
            return a.group(0)
        t = re.sub(r'\s(fill|stroke|stop-color|flood-color)="(#[0-9A-Fa-f]{6})"', attr, t)
        if styles:
            t = t[:-2] + ' style="%s"/>' % ';'.join(styles) if t.endswith('/>') else t[:-1] + ' style="%s">' % ';'.join(styles)
        return t
    return re.sub(r'<[a-zA-Z][^>]*>', tag, svg)



def icon_symbol(name):
    svg = read('icons', name + '.svg')
    inner = re.sub(r'\s+', ' ', re.search(r'<svg[^>]*>(.*?)</svg>', svg, re.S).group(1)).strip()
    return '<symbol id="i-%s" viewBox="0 0 24 24">%s</symbol>' % (name, inner)


# --------------------------------------------------------------------------
# Page assembly
# --------------------------------------------------------------------------
def render(body_tpl, ctx):
    out = body_tpl
    for k, v in ctx.items():                      # page slots may themselves carry includes
        out = out.replace('[[%s]]' % k, v)
    counter = [0]

    def include(m):
        name = m.group(1)
        part = read('partials', name + '.html').rstrip('\n')
        if name.startswith('art-'):               # a picture placed twice needs distinct SVG ids
            counter[0] += 1
            suffix = '-%d' % counter[0]
            for i in re.findall(r'\sid="([^"]+)"', part):
                part = part.replace('id="%s"' % i, 'id="%s%s"' % (i, suffix)).replace('url(#%s)' % i, 'url(#%s%s)' % (i, suffix))
            part = tokenise_art(part)
        return part

    for _ in range(2):
        out = re.sub(r'\[\[include:([\w-]+)\]\]', include, out)
    for k, v in ctx.items():
        out = out.replace('[[%s]]' % k, v)
    out = out.replace('[[t:email]]', html.escape(SITE['email'])).replace('[[t:copyright]]', html.escape(SITE['copyright'], quote=False))
    out = re.sub(r'\[\[t:([\w.]+)\]\]', lambda m: html.escape(EN[m.group(1)]), out)
    out = re.sub(r'\[\[url:(\w+)\]\]', lambda m: html.escape(URLS[m.group(1)]), out)
    out = re.sub(r'\[\[alt:(\w+)\]\]', lambda m: html.escape(ALTS[m.group(1)]), out)
    out = re.sub(r'\[\[img:(\w+)\]\]', lambda m: IMAGES[m.group(1)], out)

    used_icons = []

    def icon(m):
        name, extra = m.group(1), (m.group(2) or '').strip()
        if name not in used_icons:
            used_icons.append(name)
        return '<svg class="%s" aria-hidden="true" focusable="false"><use href="#i-%s"/></svg>' % ('ic' + (' ' + extra if extra else ''), name)

    out = re.sub(r'\[\[ic:([a-z0-9-]+)((?: [a-z0-9-]+)*)\]\]', icon, out)

    used_keys = []

    def fill(m):
        key = m.group(4)
        if key not in used_keys:
            used_keys.append(key)
        return m.group(1) + en_html(key) + m.group(6)

    out = re.sub(r'(<(\w+)([^>]*?)\sdata-i18n="([^"]+)"([^>]*)>)(</\2>)', fill, out)
    for m in re.finditer(r'data-i18n-attr="[\w-]+:([\w.]+)"', out):
        if m.group(1) not in used_keys:
            used_keys.append(m.group(1))

    leftovers = re.findall(r'\[\[[^\]]+\]\]', out)
    if leftovers:
        sys.exit('Unresolved placeholders: %s' % leftovers)

    sprite = ('<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">'
              + ''.join(icon_symbol(n) for n in used_icons) + '</svg>')
    zh, missing = {}, []
    for k in used_keys:
        v = zh_html(k)
        (missing.append(k) if v is None else zh.__setitem__(k, v))
    return out, sprite, zh, missing


def page(title, description, canonical, body_tpl, ctx, fonts, home=False):
    body, sprite, zh, missing = render(body_tpl, ctx)
    zh_json = json.dumps(zh, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    js = JS.replace('/*__ZH_DICT__*/{}', zh_json)
    ga = ('  <!-- Google tag (gtag.js) -->\n'
          '  <script async src="https://www.googletagmanager.com/gtag/js?id=%s"></script>\n'
          '  <script>\n    window.dataLayer = window.dataLayer || [];\n    function gtag(){dataLayer.push(arguments);}\n'
          "    gtag('js', new Date());\n    gtag('config', '%s');\n  </script>\n" % (SITE['ga_id'], SITE['ga_id']))
    head = (
        '<!doctype html>\n<html lang="en">\n<head>\n' + ga +
        '  <meta charset="utf-8">\n'
        '  <script>try{if(localStorage.getItem("pm-palette")==="blue"){document.documentElement.setAttribute("data-palette","blue")}}catch(e){}</script>\n'
        '  <meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '  <title>%s</title>\n'
        '  <meta name="description" content="%s">\n'
        '  <link rel="canonical" href="%s">\n'
        '  <meta property="og:type" content="website">\n'
        '  <meta property="og:site_name" content="PubliMentor">\n'
        '  <meta property="og:title" content="%s">\n'
        '  <meta property="og:description" content="%s">\n'
        '  <meta property="og:url" content="%s">\n'
        '  <meta name="theme-color" content="#FAF7F0">\n'
        '  <meta name="color-scheme" content="light">\n'
        '  <link rel="icon" type="image/png" href="%s" data-blue="%s">\n'
        % (html.escape(title, quote=False), html.escape(description), canonical,
           html.escape(title), html.escape(description), canonical, FAVICON, FAVICON_BLUE)
    )
    root_vars = ':root{--emblem:url(%s)%s}' % (EMBLEM_XL if home else EMBLEM, (';--slide3s:url(%s)' % SLIDE_SMALL) if home else '')
    style = '  <style>\n%s\n%s\n%s\n  </style>\n' % (root_vars, FONTS[fonts], CSS)
    style += ('  <noscript><style>@media (max-width:1240px){.menu-btn{display:none}.header-inner{flex-wrap:wrap}'
              '.header-panel{position:static;display:flex;padding:0 0 16px;border:0;box-shadow:none;background:none}}</style></noscript>\n')
    doc = head + style + '</head>\n<body>\n' + sprite + '\n' + body.strip('\n') + '\n\n<script>\n' + js + '</script>\n</body>\n</html>\n'
    return doc, missing


def write(rel, doc):
    path = os.path.join(DIST, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(doc)
    print('%-52s %7.1f KB' % (rel, len(doc.encode('utf-8')) / 1024))


def indent(fragment, n):
    return '\n'.join(' ' * n + line if line else line for line in fragment.rstrip('\n').split('\n'))


report = {}
base = SITE['site_url']

p = SITE['pages']['index.html']
ctx = {'home': '', 'newsletter': 'newsletter.html', 'newsletter_current': '', 'footer_home': ''}
doc, report['index.html'] = page(p['title'], p['description'], base, read('templates', 'index.body.html'), ctx, 'display', home=True)
write('index.html', doc)

p = SITE['pages']['newsletter.html']
ctx = {'home': 'index.html', 'newsletter': 'newsletter.html', 'newsletter_current': ' aria-current="page"',
       'footer_home': '<a href="index.html" data-i18n="ui.home"></a>\n      '}
doc, report['newsletter.html'] = page(p['title'], p['description'], base + 'newsletter.html', read('templates', 'newsletter.body.html'), ctx, 'display')
write('newsletter.html', doc)

for a in SITE['articles']:
    ctx = {'home': '../index.html', 'newsletter': '../newsletter.html', 'newsletter_current': ' aria-current="page"',
           'footer_home': '<a href="../index.html" data-i18n="ui.home"></a>\n      '}
    ctx['article_head'] = indent(read('content', 'articles', a['slug'] + '.head.html'), 10)
    ctx['article_body'] = indent(read('content', 'articles', a['slug'] + '.body.html'), 10)
    ctx['article_back'] = '<span data-i18n="ui.back"></span>'
    ctx['article_cover'] = '[[include:%s]]' % a['cover']
    doc, report[a['file']] = page(a['title'], a['description'], base + a['file'], read('templates', 'article.body.html'), ctx, 'text')
    write(a['file'], doc)

print()
for name, missing in report.items():
    print('%s — keys without a Chinese entry (stay in English): %s' % (name, missing or 'none'))
