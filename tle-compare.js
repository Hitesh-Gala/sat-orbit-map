// tle-compare.js — the Western vs Chinese element-set window on the Data
// Comparison page.
//
// Three catalogues, one object per row: AOE (spacemapper.cn), Space-Track and
// CelesTrak. The remarks column is computed here rather than stored, because
// what matters is the relationship between the three epochs - which source is
// fresher, by how long, and whether the orbits they describe actually agree.
//
// The AOE gateway answers 401 without a subscription, so that column is empty
// unless someone drops an export into data/aoe-tle.txt and re-runs
// scripts/gen_tle_compare.py. Every row links out to the object on their site
// so a reader can check by eye; the window never calls them.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var DATA = null, rows = [], side = 'all', query = '';

  function when(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d) ? null : d;
  }

  function ago(iso, now) {
    var d = when(iso);
    if (!d) return '—';
    var h = (now - d) / 3.6e6;
    if (h < 1) return Math.round(h * 60) + ' min old';
    if (h < 48) return h.toFixed(1) + ' h old';
    return (h / 24).toFixed(1) + ' days old';
  }

  function cell(src, label) {
    if (!src) {
      return '<td class="none">not available' +
        (label === 'aoe' ? '<br>subscription needed' : '') + '</td>';
    }
    var d = when(src.epoch);
    return '<td><span class="ep"><b>' + esc(src.epoch ? src.epoch.replace('T', ' ').replace('Z', '') : '—') +
      '</b> UTC</span><span class="tle">' + esc((src.l1 || '').slice(0, 44)) + '\n' +
      esc((src.l2 || '').slice(0, 44)) + '</span></td>';
  }

  // What the three epochs say about each other, in words.
  function remarks(r, now) {
    var have = [];
    if (r.aoe) have.push(['AOE', when(r.aoe.epoch)]);
    if (r.spacetrack) have.push(['Space-Track', when(r.spacetrack.epoch)]);
    if (r.celestrak) have.push(['CelesTrak', when(r.celestrak.epoch)]);
    have = have.filter(function (h) { return h[1]; });
    if (!have.length) return 'No element set in any of the three catalogues.';

    var out = [];
    if (have.length === 1) {
      out.push('Only <b>' + have[0][0] + '</b> carries this object here — ' + ago(
        have[0][0] === 'AOE' ? r.aoe.epoch : have[0][0] === 'Space-Track' ? r.spacetrack.epoch : r.celestrak.epoch, now) + '.');
      out.push(r.side === 'cn'
        ? 'A Chinese object with no Western cross-check in this bundle.'
        : 'A Western object with nothing to compare against on the Chinese side.');
    } else {
      have.sort(function (a, b) { return b[1] - a[1]; });
      var lead = have[0], last = have[have.length - 1];
      var gapH = (lead[1] - last[1]) / 3.6e6;
      out.push('<span class="fresh">' + lead[0] + '</span> is the fresher set, ' +
        (gapH < 1 ? Math.round(gapH * 60) + ' minutes' : gapH.toFixed(1) + ' hours') +
        ' ahead of <span class="stale">' + last[0] + '</span>.');
      // Mean motion is the quickest tell: if the two disagree beyond rounding,
      // they are describing different orbits, not the same one at two times.
      var a = r.spacetrack && r.spacetrack.mm, b = r.celestrak && r.celestrak.mm;
      if (a && b) {
        var dmm = Math.abs(a - b);
        out.push(dmm < 1e-4
          ? 'Western sources agree on mean motion to five decimals.'
          : 'Mean motion differs by ' + dmm.toFixed(5) + ' rev/day between the Western sources — worth a look.');
      }
    }
    if (!r.aoe) {
      out.push('AOE not pulled: their catalogue gateway needs a subscription, so the Chinese column is checked by hand.');
    }
    return out.join(' ');
  }

  function render() {
    var now = new Date();
    var list = rows.filter(function (r) {
      if (side !== 'all' && r.side !== side) return false;
      if (!query) return true;
      return (r.name + ' ' + r.norad + ' ' + r.kind + ' ' + r.owner).toLowerCase().indexOf(query) !== -1;
    });
    $('tlecmp-rows').innerHTML = list.slice(0, 400).map(function (r) {
      return '<tr><td class="side-' + r.side + '"><span class="nm">' + esc(r.name) + '</span>' +
        '<span class="kind">' + esc(r.kind) + (r.owner ? ' · ' + esc(r.owner) : '') + '</span></td>' +
        '<td class="num">' + esc(r.norad) + '</td>' +
        '<td class="num">' + esc(r.launched || '—') + '</td>' +
        cell(r.aoe, 'aoe') + cell(r.spacetrack, 'st') + cell(r.celestrak, 'ct') +
        '<td class="rem">' + remarks(r, now) + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="none" style="padding:22px">Nothing matches that filter.</td></tr>';
    $('tlecmp-count').textContent = list.length.toLocaleString() + ' of ' + rows.length.toLocaleString() + ' objects' +
      (list.length > 400 ? ' · showing the first 400' : '');
  }

  function load() {
    if (DATA) return Promise.resolve();
    return fetch('data/tle-compare.json').then(function (r) { return r.json(); }).then(function (d) {
      DATA = d;
      rows = d.rows || [];
      $('tlecmp-sub').textContent = d.counts.west + ' Western · ' + d.counts.cn + ' Chinese · built ' +
        (d.built || '').slice(0, 10);
      $('tlecmp-foot').innerHTML =
        'Western reconnaissance and electronic-intelligence satellites are set against the Chinese catalogue and Chinese ones against ' +
        'the Western pair. CelesTrak comes from the bundled snapshot; Space-Track fills in when the nightly job runs with its credentials. ' +
        'The AOE column is deliberately empty: <a href="' + esc(d.aoeLink) + '" target="_blank" rel="noopener noreferrer">spacemapper.cn</a> ' +
        'answers <code>401 Unauthorized</code> without a subscription, and nothing here scrapes around that — open an object there to compare by eye.';
    });
  }

  // ---- window behaviour -------------------------------------------------
  function wire() {
    var win = $('tlecmp'), head = $('tlecmp-head');
    var pos = null;

    $('tlecmp-open').addEventListener('click', function () {
      win.hidden = false;
      load().then(render).catch(function (e) {
        $('tlecmp-rows').innerHTML = '<tr><td colspan="7" class="none" style="padding:22px">Could not load the comparison: ' +
          esc(e.message) + '</td></tr>';
      });
    });
    $('tlecmp-close').addEventListener('click', function () { win.hidden = true; });
    $('tlecmp-min').addEventListener('click', function () {
      win.classList.toggle('min');
      $('tlecmp-min').textContent = win.classList.contains('min') ? '▢' : '–';
    });

    // drag by the title bar
    var id = null, dx = 0, dy = 0;
    head.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      var r = win.getBoundingClientRect();
      id = e.pointerId; dx = e.clientX - r.left; dy = e.clientY - r.top;
      win.style.transform = 'none';
      win.style.left = r.left + 'px';
      win.style.top = r.top + 'px';
      win.classList.add('dragging');
      head.setPointerCapture(id);
      e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) {
      if (e.pointerId !== id) return;
      var w = win.offsetWidth;
      pos = {
        left: Math.min(Math.max(6, e.clientX - dx), innerWidth - w - 6),
        top: Math.min(Math.max(6, e.clientY - dy), innerHeight - 44),
      };
      win.style.left = pos.left + 'px';
      win.style.top = pos.top + 'px';
    });
    var end = function (e) { if (e.pointerId === id) { id = null; win.classList.remove('dragging'); } };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);

    // resize from the corner grip
    var grip = $('tlecmp-resize'), rid = null, sw = 0, sh = 0, sx = 0, sy = 0;
    grip.addEventListener('pointerdown', function (e) {
      rid = e.pointerId; sw = win.offsetWidth; sh = win.offsetHeight; sx = e.clientX; sy = e.clientY;
      grip.setPointerCapture(rid);
      e.preventDefault();
    });
    grip.addEventListener('pointermove', function (e) {
      if (e.pointerId !== rid) return;
      win.style.width = Math.max(560, Math.min(innerWidth - 20, sw + (e.clientX - sx))) + 'px';
      win.style.height = Math.max(220, Math.min(innerHeight - 20, sh + (e.clientY - sy))) + 'px';
    });
    var rend = function (e) { if (e.pointerId === rid) rid = null; };
    grip.addEventListener('pointerup', rend);
    grip.addEventListener('pointercancel', rend);

    $('tlecmp-q').addEventListener('input', function (e) {
      query = e.target.value.trim().toLowerCase();
      render();
    });
    [].forEach.call(document.querySelectorAll('input[name="tlecmp-side"]'), function (rb) {
      rb.addEventListener('change', function () { side = rb.value; render(); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
