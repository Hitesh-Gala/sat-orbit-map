// rocket-models.js — the launch-vehicle deck.
//
// Catalogue facts come from data/rockets.json (built from the open launch
// database, the same source NextSpaceflight's rockets page uses). Photographs
// are ours: public-domain or Creative-Commons files from Wikimedia Commons,
// credited under every card. Cards with no verified free photo get a
// typographic plate rather than a borrowed or wrong picture.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }

  // A country code is clearer with a flag beside it, and the regional-indicator
  // trick needs the two-letter form, not the three-letter one the data carries.
  var CC2 = {
    USA: 'US', RUS: 'RU', CHN: 'CN', IND: 'IN', JPN: 'JP', FRA: 'FR', GER: 'DE', DEU: 'DE',
    ITA: 'IT', GBR: 'GB', UKR: 'UA', KAZ: 'KZ', ISR: 'IL', IRN: 'IR', PRK: 'KP', KOR: 'KR',
    BRA: 'BR', NZL: 'NZ', AUS: 'AU', ESP: 'ES', EU: 'EU', SWE: 'SE', NOR: 'NO', CAN: 'CA',
    ARG: 'AR', TWN: 'TW', ZAF: 'ZA', IRQ: 'IQ', OMN: 'OM', MHL: 'MH', GUF: 'GF',
  };
  function flag(cc) {
    var two = CC2[cc] || (cc && cc.length === 2 ? cc : '');
    if (!two || two === 'EU') return '';
    return two.replace(/./g, function (ch) { return String.fromCodePoint(0x1F1E6 - 65 + ch.toUpperCase().charCodeAt(0)); });
  }

  var ALL = [], shown = [], meta = {}, query = '', filter = 'all';

  var FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'photo', label: 'With a photo' },
    { key: 'reusable', label: 'Reusable' },
    { key: 'USA', label: '🇺🇸 USA' },
    { key: 'RUS', label: '🇷🇺 Russia' },
    { key: 'CHN', label: '🇨🇳 China' },
    { key: 'IND', label: '🇮🇳 India' },
    { key: 'JPN', label: '🇯🇵 Japan' },
    { key: 'EUR', label: '🇪🇺 Europe' },
  ];
  var EUR = ['FRA', 'GER', 'DEU', 'ITA', 'GBR', 'ESP', 'SWE', 'NOR', 'EU'];

  function passes(r) {
    if (filter === 'photo' && !r.img) return false;
    if (filter === 'reusable' && !r.reusable) return false;
    if (filter === 'EUR' && EUR.indexOf(r.cc) === -1) return false;
    if (['USA', 'RUS', 'CHN', 'IND', 'JPN'].indexOf(filter) !== -1 && r.cc !== filter) return false;
    if (!query) return true;
    return (r.full + ' ' + r.name + ' ' + r.family + ' ' + r.maker + ' ' + r.makerFull).toLowerCase().indexOf(query) !== -1;
  }

  function countFor(key) {
    var save = filter, n;
    filter = key;
    n = ALL.filter(passes).length;
    filter = save;
    return n;
  }

  function renderFilters() {
    $('rk-filters').innerHTML = FILTERS.map(function (f) {
      return '<button type="button" class="rk-chip' + (filter === f.key ? ' on' : '') + '" data-f="' + f.key + '">' +
        esc(f.label) + '<span class="n">' + countFor(f.key).toLocaleString() + '</span></button>';
    }).join('');
  }

  function cardHtml(r, i) {
    var shot = r.img
      ? '<img src="' + esc(r.img) + '" alt="' + esc(r.full) + '" loading="lazy" decoding="async">'
      : '<div class="rk-plate"><span>' + esc((r.name || '?').slice(0, 3).toUpperCase()) + '</span></div>';
    var fl = flag(r.cc);
    return '<button type="button" class="rk-card" data-i="' + i + '">' +
      '<div class="rk-shot">' + shot +
        (r.cc ? '<span class="rk-flag">' + (fl ? fl + ' ' : '') + esc(r.cc) + '</span>' : '') +
        (r.reusable ? '<span class="rk-reuse">REUSABLE</span>' : '') +
      '</div>' +
      '<div class="rk-body">' +
        '<div class="rk-name">' + esc(r.name) + '</div>' +
        '<div class="rk-maker">' + esc(r.maker || r.makerFull || '—') + '</div>' +
        (r.family && r.family !== r.name ? '<span class="rk-fam">' + esc(r.family) + '</span>' : '') +
      '</div>' +
      (r.credit ? '<div class="rk-credit">📷 ' + esc(r.credit.author) + ' · ' + esc(r.credit.licence) + '</div>' : '') +
    '</button>';
  }

  function render() {
    shown = ALL.filter(passes);
    $('rk-grid').innerHTML = shown.map(cardHtml).join('') ||
      '<div class="rk-count" style="grid-column:1/-1;padding:40px 0">Nothing matches that search.</div>';
    $('rk-count').textContent = shown.length.toLocaleString() + ' of ' + ALL.length.toLocaleString() +
      ' vehicles · ' + shown.filter(function (r) { return r.img; }).length.toLocaleString() + ' with a photograph';
    renderFilters();
  }

  function openCard(i) {
    var r = shown[i];
    if (!r) return;
    var rows = '';
    var row = function (k, v) { return v ? '<div><span>' + k + '</span><b>' + v + '</b></div>' : ''; };
    rows += row('Full name', esc(r.full));
    rows += row('Family', esc(r.family));
    rows += row('Variant', esc(r.variant));
    rows += row('Manufacturer', esc(r.makerFull || r.maker));
    rows += row('Country', (flag(r.cc) ? flag(r.cc) + ' ' : '') + esc(r.cc || '—'));
    rows += row('Reusable', r.reusable ? 'Yes' : 'No');
    $('rk-big').innerHTML =
      (r.img ? '<img src="' + esc(r.img) + '" alt="' + esc(r.full) + '">' : '') +
      '<div class="rk-big-body">' +
        '<h2>' + esc(r.name) + '</h2>' +
        '<div class="who">' + esc(r.makerFull || r.maker || '') + '</div>' +
        '<div class="rk-rows">' + rows + '</div>' +
        (r.credit ? '<div class="rk-credit" style="padding:12px 0 0">📷 ' + esc(r.credit.author) +
          ' · ' + esc(r.credit.licence) + ' · <a href="' + esc(r.credit.source) +
          '" target="_blank" rel="noopener noreferrer">Wikimedia Commons ↗</a></div>' : '') +
        '<div class="rk-acts">' +
          (r.wiki ? '<a href="' + esc(r.wiki) + '" target="_blank" rel="noopener noreferrer">Read on ' + esc(host(r.wiki)) + ' ↗</a>' : '') +
          '<button type="button" id="rk-close">Close</button>' +
        '</div>' +
      '</div>';
    $('rk-modal').hidden = false;
    $('rk-close').addEventListener('click', close);
  }
  function close() { $('rk-modal').hidden = true; }

  fetch('data/rockets.json').then(function (r) { return r.json(); }).then(function (d) {
    ALL = d.rockets || [];
    meta = d;
    render();
    $('rk-foot').innerHTML = esc(d.note) + ' Compiled ' + esc(d.compiled) + '.';
    $('rk-q').addEventListener('input', function (e) { query = e.target.value.trim().toLowerCase(); render(); });
    $('rk-filters').addEventListener('click', function (e) {
      var b = e.target.closest('.rk-chip');
      if (!b) return;
      filter = b.dataset.f;
      render();
    });
    $('rk-grid').addEventListener('click', function (e) {
      var c = e.target.closest('.rk-card');
      if (c) openCard(+c.dataset.i);
    });
    $('rk-modal').addEventListener('click', function (e) { if (e.target === $('rk-modal')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }).catch(function (e) {
    $('rk-count').textContent = 'Could not load the catalogue: ' + e.message;
  });
})();
