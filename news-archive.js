// NAZAR news archive — the click-through repository behind the "TICKER TAPE"
// label.  Reads the persistent archive from news-core.js, renders it grouped by
// day, and exports plain-text PDFs (one combined chronological document, or one
// per article) via jsPDF.

(function () {
  const NN = window.NazarNews;
  const $ = id => document.getElementById(id);
  if (!NN) { $('news-list').innerHTML = '<div class="news-empty">news-core.js failed to load.</div>'; return; }
  const esc = NN.esc;

  let filterText = '';
  let chinaOnly = false;
  let sortNewestFirst = true;
  let currentItems = [];

  function setStatus(msg, isErr) {
    const el = $('news-status');
    el.textContent = msg || '';
    el.classList.toggle('err', !!isErr);
  }

  // ---- Selection ---------------------------------------------------------
  function getFiltered() {
    const q = filterText.trim().toLowerCase();
    let items = NN.getArchive();
    if (chinaOnly) items = items.filter(NN.isChinaItem);
    if (q) items = items.filter(it =>
      ((it.title || '') + ' ' + (it.desc || '') + ' ' + (it.source || '')).toLowerCase().includes(q));
    return items.slice().sort((a, b) => sortNewestFirst
      ? new Date(b.pubDate) - new Date(a.pubDate)
      : new Date(a.pubDate) - new Date(b.pubDate));
  }

  // ---- Render ------------------------------------------------------------
  function updateMeta() {
    const all = NN.getArchive();
    const el = $('news-meta');
    if (!all.length) { el.textContent = 'No headlines gathered yet — hit ⟳ Refresh to pull the feeds.'; return; }
    const meta = NN.getMeta();
    const dates = all.map(it => +new Date(it.pubDate)).filter(Number.isFinite).sort((a, b) => a - b);
    const first = NN.fmtLong(new Date(dates[0]).toISOString());
    const last  = NN.fmtLong(new Date(dates[dates.length - 1]).toISOString());
    const chinaN = all.filter(NN.isChinaItem).length;
    const refreshed = meta.last ? new Date(meta.last).toUTCString().replace('GMT', 'UTC') : '—';
    el.innerHTML =
      `<strong>${all.length}</strong> headlines · <strong>${chinaN}</strong> China-related · ` +
      `from <strong>${esc(first)}</strong> to <strong>${esc(last)}</strong><br>` +
      `Sources answering: <strong>${meta.okFeeds ?? '—'}</strong>/<strong>${meta.feeds ?? NN.FEEDS.length}</strong> · ` +
      `last refreshed <strong>${esc(refreshed)}</strong>`;
  }

  function render() {
    const items = getFiltered();
    currentItems = items;
    const list = $('news-list');

    if (!items.length) {
      list.innerHTML = `<div class="news-empty">${
        NN.getArchive().length ? 'No headlines match your filter.'
                               : 'No headlines gathered yet. Hit ⟳ Refresh to pull the feeds.'}</div>`;
      updateMeta();
      return;
    }

    const parts = [];
    let lastDay = null;
    items.forEach((it, i) => {
      const dayKey = NN.fmtDayKey(it.pubDate);
      if (dayKey !== lastDay) { parts.push(`<h2 class="news-day">${esc(NN.fmtDayLabel(it.pubDate))}</h2>`); lastDay = dayKey; }
      const cn = NN.isChinaItem(it);
      parts.push(
        `<article class="news-card${cn ? ' cn' : ''}">` +
          `<div class="news-card-top">` +
            `<span class="news-num">${i + 1}</span>` +
            `<span class="news-date">${esc(NN.fmtLong(it.pubDate))}</span>` +
            `<span class="news-src cat-${esc(it.cat || 'Press')}">${esc(it.source)}</span>` +
            (cn ? `<span class="news-cn-tag">China</span>` : '') +
          `</div>` +
          `<a class="news-title" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>` +
          (it.desc ? `<p class="news-desc">${esc(it.desc)}</p>` : '') +
          `<div class="news-card-actions">` +
            `<a class="news-open" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">Read source ↗</a>` +
            `<button type="button" class="news-pdf-one" data-idx="${i}">⬇ PDF</button>` +
          `</div>` +
        `</article>`
      );
    });
    list.innerHTML = parts.join('');
    list.querySelectorAll('.news-pdf-one').forEach(btn => {
      btn.addEventListener('click', () => {
        const it = currentItems[+btn.dataset.idx];
        if (it) downloadOnePdf(it);
      });
    });
    updateMeta();
  }

  // ---- PDF ---------------------------------------------------------------
  function newDoc() {
    const jsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDF) return null;
    return new jsPDF({ unit: 'pt', format: 'a4' });
  }

  // Plain-text renderer with manual pagination.  Each article: a rule, a grey
  // meta line, the headline (bold), the snippet, then the source URL.
  function writeArticles(doc, items, title, sub) {
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const M = 48, maxW = pw - M * 2;
    let y = M;
    const line = (text, size, style, color, lh) => {
      doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(color[0], color[1], color[2]);
      const lines = doc.splitTextToSize(String(text == null ? '' : text), maxW);
      for (const ln of lines) { if (y > ph - M) { doc.addPage(); y = M; } doc.text(ln, M, y); y += lh; }
    };

    line(title, 20, 'bold', [20, 20, 20], 26);
    if (sub) line(sub, 10.5, 'normal', [90, 90, 90], 15);
    y += 6;

    items.forEach((it, i) => {
      if (y > ph - M - 72) { doc.addPage(); y = M; }
      doc.setDrawColor(205); doc.setLineWidth(0.6); doc.line(M, y, pw - M, y); y += 15;
      line(`${i + 1}.  ${NN.fmtLong(it.pubDate)}  ·  ${it.source}${NN.isChinaItem(it) ? '  ·  CHINA' : ''}`, 9, 'bold', [110, 110, 110], 13);
      line(it.title, 13, 'bold', [15, 15, 15], 17);
      if (it.desc) line(it.desc, 10.5, 'normal', [45, 45, 45], 15);
      line(it.link, 8.5, 'normal', [40, 90, 180], 12);
      y += 10;
    });

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150);
      doc.text('NAZAR · Ticker Tape Archive', M, ph - 20);
      doc.text(`${p} / ${pages}`, pw - M, ph - 20, { align: 'right' });
    }
  }

  function downloadAllPdf() {
    const asc = getFiltered().slice().sort((a, b) => new Date(a.pubDate) - new Date(b.pubDate));
    if (!asc.length) { setStatus('Nothing to export yet.', true); return; }
    const doc = newDoc();
    if (!doc) { setStatus('PDF library not loaded — check your connection and retry.', true); return; }
    const range = `${NN.fmtLong(asc[0].pubDate)}  —  ${NN.fmtLong(asc[asc.length - 1].pubDate)}`;
    writeArticles(doc, asc, 'NAZAR — Space News Archive',
      `Chronological repository of ticker-tape headlines · ${asc.length} articles\n` +
      `${range}\nGenerated ${new Date().toUTCString()}`);
    doc.save('nazar-space-news-archive.pdf');
    setStatus(`Exported ${asc.length} articles to a chronological PDF.`);
  }

  function downloadOnePdf(it) {
    const doc = newDoc();
    if (!doc) { setStatus('PDF library not loaded — check your connection and retry.', true); return; }
    writeArticles(doc, [it], 'NAZAR — Space News', `Generated ${new Date().toUTCString()}`);
    const slug = (it.title || 'article').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'article';
    doc.save(`nazar-${slug}.pdf`);
  }

  // ---- Refresh -----------------------------------------------------------
  async function doRefresh(force) {
    const btn = $('news-refresh');
    btn.disabled = true;
    setStatus('Pulling feeds…');
    try {
      await NN.refresh(force === true);
      render();
      setStatus('Archive updated.');
    } catch (e) {
      console.warn('archive refresh failed', e);
      setStatus('Refresh failed — showing what we have.', true);
      render();
    } finally {
      btn.disabled = false;
    }
  }

  // ---- Wire up -----------------------------------------------------------
  $('news-filter').addEventListener('input', e => { filterText = e.target.value; render(); });
  $('news-cn-only').addEventListener('change', e => { chinaOnly = e.target.checked; render(); });
  $('news-sort').addEventListener('click', () => {
    sortNewestFirst = !sortNewestFirst;
    $('news-sort').textContent = sortNewestFirst ? '↓ Newest first' : '↑ Oldest first';
    render();
  });
  $('news-refresh').addEventListener('click', () => doRefresh(true));
  $('news-pdf-all').addEventListener('click', downloadAllPdf);

  // Instant paint from the archive, then a throttled background refresh.
  render();
  if (!NN.getArchive().length) setStatus('Fetching space-news feeds…');
  NN.refresh(false)
    .then(() => { render(); if (!$('news-status').classList.contains('err')) setStatus(''); })
    .catch(() => setStatus('Could not reach the feeds right now — try ⟳ Refresh.', true));
})();
