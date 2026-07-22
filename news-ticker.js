// NAZAR news ticker — numbered, China-first space headlines.
//
// All fetching, deduping and archiving lives in news-core.js (window.NazarNews);
// this file is purely the scrolling-ticker UI on index.html.  It paints instantly
// from the persistent archive, then refreshes the feeds in the background and
// repaints.  The "TICKER TAPE" label is a link to news-archive.html (the full
// repository + PDF export).

(function () {
  const NN = window.NazarNews;
  const track = document.getElementById('ticker-track');
  if (!NN || !track) return;

  function render(items) {
    if (!items.length) {
      track.innerHTML = '<span class="ticker-status">No space-news headlines yet — the feeds or CORS proxies may be temporarily unreachable. The ticker fills in as soon as a pull succeeds.</span>';
      track.style.animation = 'none';
      return;
    }
    const html = items.map((it, i) => {
      const date = NN.fmtShort(it.pubDate);
      const datePart = date ? `<span class="date">${NN.esc(date)}</span>` : '';
      const cn = NN.isChinaItem(it) ? ' cn' : '';
      return `<span class="ticker-item${cn}">` +
               `<span class="num">${i + 1}</span>` +
               datePart +
               `<a href="${NN.esc(it.link)}" target="_blank" rel="noopener noreferrer">${NN.esc(it.title)}</a>` +
               `<span class="source">${NN.esc(it.source)}</span>` +
             `</span>`;
    }).join('');
    // Duplicate the run so the -50% keyframe loop is seamless.
    track.innerHTML = html + html;
    track.style.animation = '';

    // Scale duration by content width so scroll speed stays ~constant whether
    // there are 6 items or 20.
    requestAnimationFrame(() => {
      const w = track.scrollWidth / 2;
      const seconds = Math.max(40, Math.round(w / 105));
      track.style.animationDuration = seconds + 's';
    });
  }

  // Instant paint from whatever the archive already holds.
  const cached = NN.getTickerItems();
  if (cached.length) render(cached);
  else track.innerHTML = '<span class="ticker-status">Loading space-news headlines…</span>';

  // Background refresh with an outer guard so a wedged proxy can't leave the
  // ticker stuck on the boot placeholder.
  const guard = new Promise(resolve => setTimeout(() => resolve('__timeout__'), 22000));
  Promise.race([NN.refresh(false), guard])
    .then(() => render(NN.getTickerItems()))
    .catch(e => { console.warn('News ticker refresh error:', e); if (!cached.length) render([]); });
})();
