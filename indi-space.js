// indi-space.js — NAZAR on India's private space ecosystem.
// Loads data/indi-space.json (36 company vignettes parsed from the
// "People Behind India's Private Space Industry" volume) and renders a
// filterable grid of cards, each opening a colourful, structured pop-up.
(function () {
  'use strict';

  var CATS = {
    launch: { label: 'Launch & Propulsion', icon: '🚀', color: '#ff7a3c' },
    sat:    { label: 'Satellites & Platforms', icon: '🛰', color: '#67c8ff' },
    eo:     { label: 'Earth Observation', icon: '🌍', color: '#58d68d' },
    rf:     { label: 'Electronics & RF', icon: '📡', color: '#c9a0ff' },
    heavy:  { label: 'Heavy Engineering', icon: '🏭', color: '#ffcf5c' },
    ssa:    { label: 'Space Awareness', icon: '🔭', color: '#ff6f9c' },
  };
  var ORDER = ['launch', 'sat', 'eo', 'rf', 'heavy', 'ssa'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }

  var COMPANIES = [], filterCat = 'all', query = '';
  var gridEl, emptyEl, filtersEl, searchEl, modal;

  function matches(c) {
    if (filterCat !== 'all' && c.cat !== filterCat) return false;
    if (!query) return true;
    var q = query.toLowerCase();
    var hay = (c.name + ' ' + c.sector + ' ' + (c.snapshot.Founders || '') + ' ' +
               (c.snapshot['Current Leaders'] || '') + ' ' + c.hook + ' ' +
               (c.snapshot.Headquarters || '')).toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function renderFilters() {
    var counts = { all: COMPANIES.length };
    ORDER.forEach(function (k) { counts[k] = COMPANIES.filter(function (c) { return c.cat === k; }).length; });
    var chips = ['<button type="button" class="is-chip' + (filterCat === 'all' ? ' active' : '') +
                 '" data-cat="all" style="--chip:#9fb2c6">All <span class="n">' + counts.all + '</span></button>'];
    ORDER.forEach(function (k) {
      var cat = CATS[k];
      chips.push('<button type="button" class="is-chip' + (filterCat === k ? ' active' : '') +
        '" data-cat="' + k + '" style="--chip:' + cat.color + '">' + cat.icon + ' ' + esc(cat.label) +
        ' <span class="n">' + counts[k] + '</span></button>');
    });
    filtersEl.innerHTML = chips.join('');
  }

  function renderGrid() {
    var list = COMPANIES.filter(matches);
    emptyEl.hidden = list.length > 0;
    gridEl.innerHTML = list.map(function (c) {
      var cat = CATS[c.cat];
      return '<button type="button" class="is-card is-cat-' + c.cat + '" data-num="' + esc(c.num) + '">' +
        '<span class="num">' + esc(c.num) + '</span>' +
        '<span class="cat-tag">' + cat.icon + ' ' + esc(cat.label) + '</span>' +
        '<h3>' + esc(c.name) + '</h3>' +
        '<div class="sector">' + esc(c.sector) + '</div>' +
        '<div class="hook">' + esc(c.hook) + '</div>' +
        '<div class="go">Read the story →</div>' +
      '</button>';
    }).join('');
  }

  function factRow(c) {
    return ['Founded', 'Headquarters', 'Founders', 'Current Leaders', 'Capital & Scale', 'Education']
      .filter(function (k) { return c.snapshot[k]; })
      .map(function (k) {
        return '<div class="is-m-fact"><span class="k">' + esc(k) + '</span>' +
               '<span class="v">' + esc(c.snapshot[k]) + '</span></div>';
      }).join('');
  }

  function buildModal() {
    modal = document.createElement('div');
    modal.className = 'is-modal';
    modal.id = 'is-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<div class="is-modal-card" id="is-modal-card"></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  }

  function openModal(num) {
    var c = COMPANIES.find(function (x) { return x.num === num; });
    if (!c) return;
    var cat = CATS[c.cat];
    var h = '';
    h += '<div class="is-m-hero">' +
      '<button type="button" class="is-m-close" id="is-m-close" aria-label="Close">×</button>' +
      '<div class="is-m-kick"><span class="is-m-num">' + esc(c.num) + ' / 36</span>' +
      '<span class="is-m-cat">' + cat.icon + ' ' + esc(cat.label) + '</span></div>' +
      '<h2 class="is-m-name">' + esc(c.name) + '</h2>' +
      '<div class="is-m-sector">' + esc(c.sector) + '</div>' +
      (c.website ? '<a class="is-m-web" href="' + esc(c.website) + '" target="_blank" rel="noopener noreferrer">🌐 Visit ' + esc(host(c.website)) + ' ↗</a>' : '') +
    '</div>';

    h += '<div class="is-m-body">';
    h += '<div class="is-m-facts">' + factRow(c) + '</div>';

    if (c.achievements && c.achievements.length) {
      h += '<div class="is-m-sec"><h3 class="is-m-h">🏆 Notable achievements</h3><ul class="is-m-ach">' +
        c.achievements.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>';
    }
    if (c.bios && c.bios.length) {
      h += '<div class="is-m-sec"><h3 class="is-m-h">👤 The people</h3>' +
        c.bios.map(function (b) { return '<p class="is-m-p">' + esc(b) + '</p>'; }).join('') + '</div>';
    }
    if (c.quote && c.quote.text) {
      h += '<div class="is-m-quote"><div class="q">' + esc(c.quote.text) + '</div>' +
        (c.quote.by ? '<span class="by">— ' + esc(c.quote.by) + '</span>' : '') + '</div>';
    }
    if (c.story && c.story.length) {
      h += '<div class="is-m-sec"><h3 class="is-m-h">📖 Origin story</h3>' +
        c.story.map(function (s, i) { return '<p class="is-m-p' + (i === 0 ? ' lead' : '') + '">' + esc(s) + '</p>'; }).join('') + '</div>';
    }
    if (c.researchNote) {
      h += '<div class="is-m-note"><div class="k">Research note</div><div class="v">' + esc(c.researchNote) + '</div></div>';
    }
    if (c.sources && c.sources.length) {
      h += '<div class="is-m-sec"><h3 class="is-m-h">🔗 Sources &amp; links</h3><div class="is-m-src">' +
        c.sources.map(function (s) {
          return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(s.text) + '">' +
                 '<span class="n">[' + esc(s.n) + ']</span> <span class="t">' + esc(host(s.url)) + '</span></a>';
        }).join('') + '</div></div>';
    }
    h += '</div>';

    var card = modal.querySelector('#is-modal-card');
    card.className = 'is-modal-card is-cat-' + c.cat;
    card.innerHTML = h;
    card.scrollTop = 0;
    modal.querySelector('#is-m-close').addEventListener('click', closeModal);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
  }
  function closeModal() { modal.hidden = true; modal.setAttribute('aria-hidden', 'true'); }

  function boot(data) {
    COMPANIES = data;
    gridEl = document.getElementById('is-grid');
    emptyEl = document.getElementById('is-empty');
    filtersEl = document.getElementById('is-filters');
    searchEl = document.getElementById('is-search');
    buildModal();
    renderFilters();
    renderGrid();
    filtersEl.addEventListener('click', function (e) {
      var b = e.target.closest('.is-chip'); if (!b) return;
      filterCat = b.dataset.cat; renderFilters(); renderGrid();
    });
    gridEl.addEventListener('click', function (e) {
      var b = e.target.closest('.is-card'); if (b) openModal(b.dataset.num);
    });
    searchEl.addEventListener('input', function () { query = searchEl.value.trim(); renderGrid(); });
  }

  fetch('data/indi-space.json')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(boot)
    .catch(function (err) {
      var e = document.getElementById('is-empty');
      e.hidden = false; e.textContent = 'Could not load company data: ' + err.message;
    });
})();
