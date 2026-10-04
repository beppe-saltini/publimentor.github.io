(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Language toggle (EN / 中文)
     English lives in the HTML. Chinese lives in the dictionary below.
     Add a key to an element with data-i18n="key" and give it a Chinese
     entry here; elements without an entry simply stay in English.
     ------------------------------------------------------------------ */
  var ZH = /*__ZH_DICT__*/{};

  var root = document.documentElement;
  var current = 'en';

  function readLangFromUrl() {
    try {
      var p = new URLSearchParams(window.location.search).get('lang');
      return p === 'zh' ? 'zh' : 'en';
    } catch (e) { return 'en'; }
  }

  function writeLangToUrl(lang) {
    try {
      var url = new URL(window.location.href);
      if (lang === 'zh') { url.searchParams.set('lang', 'zh'); } else { url.searchParams.delete('lang'); }
      window.history.replaceState(null, '', url.toString());
    } catch (e) { /* file previews and sandboxes may refuse; the toggle still works */ }
  }

  // Carry the chosen language across the site's own pages
  function updateInternalLinks(lang) {
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var raw = links[i].getAttribute('href');
      if (!/^(?!https?:|mailto:|tel:|#)[^?#]*\.html(?:[?#].*)?$/i.test(raw)) { continue; }
      var hash = '';
      var hashAt = raw.indexOf('#');
      if (hashAt > -1) { hash = raw.slice(hashAt); raw = raw.slice(0, hashAt); }
      raw = raw.replace(/\?.*$/, '');
      links[i].setAttribute('href', raw + (lang === 'zh' ? '?lang=zh' : '') + hash);
    }
  }

  function setLang(lang, opts) {
    current = lang === 'zh' ? 'zh' : 'en';
    root.lang = current === 'zh' ? 'zh-Hans' : 'en';

    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el.hasAttribute('data-en')) { el.setAttribute('data-en', el.innerHTML); }
      var zh = ZH[el.getAttribute('data-i18n')];
      el.innerHTML = (current === 'zh' && zh) ? zh : el.getAttribute('data-en');
    }

    var attrNodes = document.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < attrNodes.length; j++) {
      var node = attrNodes[j];
      var pair = node.getAttribute('data-i18n-attr').split(':');
      var attr = pair[0], key = pair[1];
      if (!node.hasAttribute('data-en-' + attr)) { node.setAttribute('data-en-' + attr, node.getAttribute(attr) || ''); }
      node.setAttribute(attr, (current === 'zh' && ZH[key]) ? ZH[key] : node.getAttribute('data-en-' + attr));
    }

    var buttons = document.querySelectorAll('.lang button');
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].setAttribute('aria-pressed', buttons[k].getAttribute('data-lang') === current ? 'true' : 'false');
    }

    updateInternalLinks(current);
    if (!opts || !opts.silent) { writeLangToUrl(current); }
  }

  var langButtons = document.querySelectorAll('.lang button');
  for (var b = 0; b < langButtons.length; b++) {
    langButtons[b].addEventListener('click', function () { setLang(this.getAttribute('data-lang')); });
  }
  setLang(readLangFromUrl(), { silent: true });

  /* ------------------------------------------------------------------
     Colour palette switch (green / blue)
     The two palettes are token sets in the stylesheet (built from
     content/palette.json); "blue" is applied as data-palette on <html>.
     The choice is remembered in this browser; ?palette=blue|green in a
     link sets it too. A tiny script in <head> applies the saved choice
     before first paint, this part wires up the buttons and the favicon.
     ------------------------------------------------------------------ */
  var PALETTE_KEY = 'pm-palette';
  var paletteButtons = document.querySelectorAll('.palette button');
  var iconLink = document.querySelector('link[rel="icon"]');
  var iconGreen = iconLink ? iconLink.getAttribute('href') : null;

  function setPalette(name, remember) {
    name = name === 'blue' ? 'blue' : 'green';
    if (name === 'blue') { root.setAttribute('data-palette', 'blue'); } else { root.removeAttribute('data-palette'); }
    for (var i = 0; i < paletteButtons.length; i++) {
      paletteButtons[i].setAttribute('aria-pressed', paletteButtons[i].getAttribute('data-palette') === name ? 'true' : 'false');
    }
    if (iconLink && iconLink.getAttribute('data-blue')) {
      iconLink.setAttribute('href', name === 'blue' ? iconLink.getAttribute('data-blue') : iconGreen);
    }
    if (remember) { try { localStorage.setItem(PALETTE_KEY, name); } catch (e) { /* private mode */ } }
  }
  (function () {
    var fromUrl = null, saved = null;
    try { fromUrl = new URLSearchParams(window.location.search).get('palette'); } catch (e) { /* old browser */ }
    try { saved = localStorage.getItem(PALETTE_KEY); } catch (e) { /* storage blocked */ }
    if (fromUrl === 'blue' || fromUrl === 'green') { setPalette(fromUrl, true); }
    else { setPalette(saved || (root.getAttribute('data-palette') === 'blue' ? 'blue' : 'green'), false); }
  })();
  for (var pb = 0; pb < paletteButtons.length; pb++) {
    paletteButtons[pb].addEventListener('click', function () { setPalette(this.getAttribute('data-palette'), true); });
  }

  /* ---------------- Header: shadow on scroll, mobile menu ---------------- */
  var header = document.getElementById('siteHeader');
  var menuBtn = document.getElementById('menuBtn');

  function onScroll() { if (header) { header.classList.toggle('is-stuck', window.scrollY > 8); } }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  function setMenu(open) {
    if (!header || !menuBtn) { return; }
    header.setAttribute('data-open', open ? 'true' : 'false');
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (menuBtn) {
    menuBtn.addEventListener('click', function () { setMenu(header.getAttribute('data-open') !== 'true'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setMenu(false); } });
    var panelLinks = document.querySelectorAll('#siteMenu a');
    for (var l = 0; l < panelLinks.length; l++) { panelLinks[l].addEventListener('click', function () { setMenu(false); }); }
    window.addEventListener('resize', function () { if (window.innerWidth > 1240) { setMenu(false); } });
  }

  /* ---------------- Scroll-spy: mark the section being read ---------------- */
  var navLinks = document.querySelectorAll('.nav a[href^="#"], .nav a[data-spy]');
  var spyTargets = document.querySelectorAll('main section[id]');
  if (navLinks.length && spyTargets.length > 1 && 'IntersectionObserver' in window) {
    var byId = {};
    for (var n = 0; n < navLinks.length; n++) {
      var href = navLinks[n].getAttribute('href');
      byId[navLinks[n].getAttribute('data-spy') || href.slice(href.indexOf('#') + 1)] = navLinks[n];
    }
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) { return; }
        for (var id in byId) { byId[id].removeAttribute('aria-current'); }
        var link = byId[entry.target.id];
        if (link) { link.setAttribute('aria-current', 'true'); }
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    for (var s = 0; s < spyTargets.length; s++) { spy.observe(spyTargets[s]); }
  }

  /* ---------------- Newsletter form: load only when asked for ---------------- */
  var subBtn = document.getElementById('subscribeBtn');
  var subPanel = document.getElementById('subscribePanel');
  if (subBtn && subPanel) {
    subBtn.addEventListener('click', function () {
      var open = subPanel.hasAttribute('hidden');
      if (open) {
        var frame = subPanel.querySelector('iframe');
        if (frame && !frame.getAttribute('src')) { frame.setAttribute('src', frame.getAttribute('data-src')); }
        subPanel.removeAttribute('hidden');
        subPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        subPanel.setAttribute('hidden', '');
      }
      subBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* ---------------- Sample slides: lightbox ---------------- */
  var box = document.getElementById('lightbox');
  if (box && typeof box.showModal === 'function') {
    var boxImg = box.querySelector('img');
    var boxCap = document.getElementById('lightboxCaption');
    var triggers = document.querySelectorAll('[data-lightbox]');
    for (var t = 0; t < triggers.length; t++) {
      triggers[t].addEventListener('click', function (e) {
        var img = this.querySelector('img');
        var fig = this.closest('figure');
        var cap = fig ? fig.querySelector('figcaption') : null;
        if (!img) { return; }
        e.preventDefault();
        boxImg.src = img.currentSrc || img.src;
        boxImg.alt = img.alt;
        boxCap.textContent = cap ? cap.textContent : '';
        box.showModal();
      });
    }
    box.addEventListener('click', function (e) { if (e.target === box) { box.close(); } });
    var closeBtn = box.querySelector('.lightbox-close');
    if (closeBtn) { closeBtn.addEventListener('click', function () { box.close(); }); }
  }
})();
