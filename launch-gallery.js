// launch-gallery.js — thumbnails of the world's launch sites; click for a lightbox.
(function () {
  'use strict';
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var DIR = 'data/launch-gallery/';
  var grid = document.getElementById('lg-grid');
  var empty = document.getElementById('lg-empty');
  var lb = document.getElementById('lg-lightbox');

  function openLB(p) {
    document.getElementById('lg-lb-img').src = DIR + p.file;
    document.getElementById('lg-lb-site').textContent = p.site;
    document.getElementById('lg-lb-what').textContent = p.caption;
    var by = (p.author && p.author !== '?') ? p.author : 'Wikimedia Commons';
    document.getElementById('lg-lb-cred').innerHTML =
      'Photo: ' + esc(by) + ' · ' + esc(p.license) +
      ' — <a href="' + esc(p.page) + '" target="_blank" rel="noopener noreferrer">Wikimedia Commons ↗</a>';
    lb.hidden = false;
  }
  function closeLB() { lb.hidden = true; }

  function render(items) {
    empty.hidden = true;
    grid.innerHTML = items.map(function (p, i) {
      return '<button type="button" class="lg-thumb" data-i="' + i + '">' +
        '<img src="' + DIR + esc(p.file) + '" alt="' + esc(p.caption) + '" loading="lazy">' +
        '<div class="lg-cap"><div class="site">' + esc(p.site) + '</div>' +
        '<div class="what">' + esc(p.caption) + '</div>' +
        '<div class="cred">' + esc(p.license) + '</div></div></button>';
    }).join('');
    grid.addEventListener('click', function (e) {
      var b = e.target.closest('.lg-thumb'); if (b) openLB(items[+b.dataset.i]);
    });
  }

  document.getElementById('lg-lb-close').addEventListener('click', closeLB);
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLB(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !lb.hidden) closeLB(); });

  empty.hidden = false;
  fetch(DIR + 'manifest.json')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(render)
    .catch(function (err) { empty.hidden = false; empty.textContent = 'Could not load gallery: ' + err.message; });
})();
