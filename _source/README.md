# Website source

`_source/` holds everything the public pages are built from. The folder name starts with an
underscore so GitHub Pages leaves it out of the published site.

## Build, check, deploy

```
python3 _source/build.py            # writes index.html, newsletter.html, newsletter/*.html into the repo root
python3 _source/check.py            # confirms the pages match _source, links resolve, strings exist
_source/tools/deploy.sh "message"   # fetch → build → check → commit → push to main (GitHub Pages)
_source/tools/rollback.sh [commit]  # publish the pages as they were before the latest commit (or at a given commit)
```

Python 3.8+ is all the build and check need. Deploying needs the SSH deploy key in `../.deploy/`
(next to the repository, not inside it).

A rollback is a new commit that restores only the published pages (`index.html`, `newsletter.html`,
`newsletter/*.html`); `_source` and these tools stay as they are, so the problem can be fixed in `_source`
and deployed again. Both scripts share `tools/git-env.sh`, which also lets them run from Claude's sandbox
on the Mac, where nothing inside the folder can be deleted: git's lock and temporary files are moved to
`../_to_delete/git-leftovers/` (safe to trash) and files are replaced by overwriting them.

## Changing things

| Task | Where |
| --- | --- |
| Edit wording | `content/en.json` and `content/zh.json`. Keys match the `data-i18n` attributes in `templates/` and `partials/`. Every key needs English; a key without Chinese simply stays in English. |
| Titles, descriptions, links, e-mail, copyright line, Google Analytics id | `content/site.json` |
| Colours | `content/palette.json` — two palettes, *green* (the original teal/mint) and *blue* (from the logo). The header switch flips between them and remembers the choice in the browser; `?palette=blue` in a link sets it too. `build.py` writes the tokens into the stylesheet and recolours the drawings, so `styles.css` and the art only ever use `var(--token)`. Favicons: `python3 _source/tools/favicon.py` (needs Pillow). |
| Add a newsletter edition | Put the article fragments in `content/articles/<slug>.head.html` and `<slug>.body.html`, list it in `content/site.json` → `articles`, add its date/title/summary strings to both JSON files, and add the edition to `templates/index.body.html` and `templates/newsletter.body.html`. Draw or reuse a cover partial (`partials/art-cover-*.html`). |
| Layout and styling | `templates/*.body.html`, `partials/header.html`, `partials/footer.html`, `styles.css` (colours only through tokens), `script.js` |
| Illustrations | `art.py` draws every `partials/art-*.html` except the globe (`tools/globe.mjs`, needs `npm i d3-geo topojson-client world-atlas`). Run `python3 _source/art.py` after editing. |
| Pictures and fonts | `assets/` (WebP/PNG, already optimised) and `fonts/` (subset WOFF2). They are inlined into the pages at build time. |
| Icons | `icons/` — the Lucide icons in use. Reference one with `[[ic:name]]` in a template. |

## How a page is assembled

`build.py` takes a template, resolves `[[include:…]]` partials, `[[ic:…]]` icons, `[[url:…]]`,
`[[img:…]]`, `[[alt:…]]` and `[[t:…]]` slots, fills every `data-i18n` element with its English
text, inlines the stylesheet, fonts and images, and embeds the Chinese dictionary for the keys that
page uses so the EN / 中文 switch works without a network request. A few strings get extra markup for
presentation (the highlighted words in the hero and mission, the "Coming soon" badge, the durations,
the form fallback link); the build refuses to run if that markup drifts from the JSON wording.

Each page is a single self-contained file. The only external files are the two full-size sample
slides in `assets/training/`, which the thumbnails link to.
