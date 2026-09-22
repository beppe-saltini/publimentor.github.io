#!/usr/bin/env python3
"""Pre-deployment checks for the PubliMentor website. Standard library only.

    python3 _source/check.py

Fails (exit 1) when the published pages are out of date with _source, a link points nowhere,
an id is duplicated, a placeholder was left unresolved, or an English string is missing.
Chinese gaps are reported but do not fail the check (those strings simply stay in English).
"""
import json, os, re, subprocess, sys, tempfile
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
SITE_DIR = os.environ.get('PUBLIMENTOR_OUT', REPO)
PAGES = ['index.html', 'newsletter.html'] + [a['file'] for a in json.load(open(os.path.join(ROOT, 'content', 'site.json'), encoding='utf-8'))['articles']]

problems, notes = [], []


def problem(msg):
    problems.append(msg)


# 1. Are the published pages exactly what _source builds?
with tempfile.TemporaryDirectory() as tmp:
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'build.py')], env=dict(os.environ, PUBLIMENTOR_OUT=tmp), capture_output=True, text=True)
    if r.returncode != 0:
        problem('build.py failed:\n' + r.stdout + r.stderr)
    else:
        for p in PAGES:
            a, b = os.path.join(tmp, p), os.path.join(SITE_DIR, p)
            if not os.path.exists(b):
                problem('%s is missing — run: python3 _source/build.py' % p)
            elif open(a, 'rb').read() != open(b, 'rb').read():
                problem('%s is out of date with _source — run: python3 _source/build.py' % p)


class Scan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.links, self.i18n = [], [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if 'id' in a:
            self.ids.append(a['id'])
        if 'data-i18n' in a:
            self.i18n.append(a['data-i18n'])
        for k in ('href', 'src', 'data-src'):
            if k in a and a[k]:
                self.links.append(a[k])


scans = {}
for p in PAGES:
    path = os.path.join(SITE_DIR, p)
    if not os.path.exists(path):
        continue
    text = open(path, encoding='utf-8').read()
    s = Scan()
    s.feed(text)
    scans[p] = s
    for left in re.findall(r'\[\[[^\]\n]{1,60}\]\]', text):
        problem('%s: unresolved placeholder %s' % (p, left))
    dup = sorted({i for i in s.ids if s.ids.count(i) > 1})
    if dup:
        problem('%s: duplicate ids %s' % (p, dup))
    size = os.path.getsize(path)
    if size > 1_000_000:
        notes.append('%s is %.1f MB — larger than expected' % (p, size / 1e6))

# 2. Every internal link and anchor resolves.
for p, s in scans.items():
    base = os.path.dirname(p)
    for link in s.links:
        if re.match(r'^(https?:|mailto:|tel:|data:|javascript:)', link):
            continue
        target, _, frag = link.partition('#')
        target = target.split('?')[0]
        if target:
            rel = os.path.normpath(os.path.join(base, target))
            if not os.path.exists(os.path.join(SITE_DIR, rel)):
                problem('%s: link to missing file %s' % (p, link))
                continue
        else:
            rel = p
        if frag and rel in scans and frag not in scans[rel].ids:
            problem('%s: anchor #%s not found in %s' % (p, frag, rel))

# 3. Strings: every key used has English text; report Chinese gaps.
EN = json.load(open(os.path.join(ROOT, 'content', 'en.json'), encoding='utf-8'))
ZH = json.load(open(os.path.join(ROOT, 'content', 'zh.json'), encoding='utf-8'))
used = sorted({k for s in scans.values() for k in s.i18n})
for k in used:
    if k not in EN:
        problem('key %r is used in a page but has no English text in content/en.json' % k)
gaps = [k for k in used if k not in ZH]
if gaps:
    notes.append('keys without a Chinese translation (shown in English when 中文 is selected): %s' % gaps)

# 4. The full-size slides that the pages link to must stay in the repository.
for f in ('assets/training/persuasive-writing-slide-3.png', 'assets/training/persuasive-writing-slide-5.png'):
    if not os.path.exists(os.path.join(SITE_DIR, f)):
        problem('missing linked asset %s' % f)

for n in notes:
    print('note:', n)
if problems:
    print('\n'.join('✗ ' + m for m in problems))
    sys.exit(1)
print('✓ %d pages checked: up to date with _source, links and anchors resolve, ids unique, %d strings in both languages.' % (len(scans), len(used) - len(gaps)))
