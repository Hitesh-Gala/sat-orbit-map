// Site Analytics dashboard (site-analytics.html) — owner only.
//
// Reads the visitor log from the Apps Script backend (site-analytics-backend.gs),
// which returns rows only when the password checks out.  Shows the headline
// counts and one row per visit, newest first.  The endpoint, the password hash
// and the hand-off from the About page's gate come from site-analytics.js.

(function () {
  'use strict';

  const NA = window.NazarAnalytics;
  const PAGE_SIZE = 100;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let visits = [], shown = [], page = 0;

  function show(id) {
    for (const s of ['va-setup', 'va-gate', 'va-dash']) $(s).hidden = s !== id;
  }
  function setState(msg, isErr) {
    $('va-state').textContent = msg || '';
    $('va-state').classList.toggle('err', !!isErr);
  }
  function savedPw() { try { return sessionStorage.getItem(NA.PW_KEY); } catch { return null; } }
  function forgetPw() { try { sessionStorage.removeItem(NA.PW_KEY); } catch { /* storage blocked */ } }

  // ── formatting ─────────────────────────────────────────────────────────
  const pad2 = n => String(n).padStart(2, '0');
  const isToday = iso => new Date(iso).toDateString() === new Date().toDateString();

  function fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric',
                                      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    if (h) return `${h}h ${pad2(m)}m ${pad2(s)}s`;
    if (m) return `${m}m ${pad2(s)}s`;
    return `${s}s`;
  }
  function pageName(p) {
    const file = String(p || '').split('/').pop();
    return file ? file.replace(/\.html$/, '') : 'home';
  }
  function refHost(u) {
    if (!u) return 'Direct';
    try { return new URL(u).hostname || u; } catch { return u; }
  }

  // ── data ───────────────────────────────────────────────────────────────
  async function load(pw) {
    setState('Loading the visitor log…');
    let res;
    try {
      const r = await fetch(NA.CFG.endpoint, { method: 'POST', body: JSON.stringify({ type: 'read', pw }) });
      res = await r.json();
    } catch (e) {
      return setState(`Could not reach the analytics backend (${e.message}).`, true);
    }
    if (!res.ok) {
      if (res.error === 'auth') { forgetPw(); return gate('Incorrect password.'); }
      return setState(`The analytics backend replied: ${res.error}`, true);
    }
    try { sessionStorage.setItem(NA.PW_KEY, pw); } catch { /* storage blocked */ }

    const cols = res.cols || [];
    visits = (res.rows || []).map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])))
      .sort((a, b) => new Date(a.start) - new Date(b.start));
    const seen = {};
    for (const v of visits) {                                   // nth visit from this browser
      seen[v.vid] = (seen[v.vid] || 0) + 1;
      v.visitNo = seen[v.vid];
      v.hay = [v.ip, v.country, v.region, v.city, v.isp, v.deviceName, v.deviceType, v.os, v.browser,
               v.landing, v.lastPage, v.referrer, v.lang, v.tz].join(' ').toLowerCase();
    }
    visits.reverse();                                           // newest first

    renderStats(res);
    show('va-dash');
    setState(`Updated ${fmtWhen(new Date().toISOString())}` +
             (res.truncated ? ` · showing the newest ${visits.length.toLocaleString()} visits` : ''));
    applyFilter();
  }

  function renderStats(res) {
    const today = visits.filter(v => isToday(v.start));
    const timed = visits.filter(v => Number(v.seconds) > 0);
    const avg = timed.length ? timed.reduce((t, v) => t + Number(v.seconds), 0) / timed.length : 0;
    $('st-users').textContent = (res.uniqueUsers ?? 0).toLocaleString();
    $('st-today').textContent = new Set(today.map(v => v.vid || v.sid)).size.toLocaleString();
    $('st-visits').textContent = (res.totalVisits ?? visits.length).toLocaleString();
    $('st-vtoday').textContent = today.length.toLocaleString();
    $('st-avg').textContent = fmtDur(avg);
    $('st-countries').textContent = new Set(visits.map(v => v.country).filter(Boolean)).size.toLocaleString();
  }

  // ── table ──────────────────────────────────────────────────────────────
  function applyFilter() {
    const q = $('va-q').value.trim().toLowerCase(), todayOnly = $('va-todayonly').checked;
    shown = visits.filter(v => (!todayOnly || isToday(v.start)) && (!q || v.hay.includes(q)));
    page = 0;
    render();
  }

  function render() {
    const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    page = Math.min(Math.max(page, 0), pages - 1);
    const start = page * PAGE_SIZE;
    $('va-rows').innerHTML = shown.slice(start, start + PAGE_SIZE).map((v, i) => {
      const from = pageName(v.landing), to = pageName(v.lastPage);
      return `<tr class="${isToday(v.start) ? 'today' : ''}">
        <td class="dim num">${start + i + 1}</td>
        <td class="nowrap">${esc(fmtWhen(v.start))}</td>
        <td class="nowrap dur">${fmtDur(v.seconds)}</td>
        <td class="ip">${esc(v.ip) || '—'}</td>
        <td title="${esc(v.ua)}">${esc(v.deviceName) || '—'}</td>
        <td>${esc(v.deviceType) || '—'}</td>
        <td>${esc(v.os) || '—'}</td>
        <td>${esc(v.browser) || '—'}</td>
        <td>${esc(v.country) || '—'}</td>
        <td>${esc(v.region) || '—'}</td>
        <td>${esc(v.city) || '—'}</td>
        <td class="num">${Number(v.pages) || 1}</td>
        <td>${esc(from === to ? from : `${from} → ${to}`)}</td>
        <td title="${esc(v.referrer)}">${esc(refHost(v.referrer))}</td>
        <td>${esc(v.isp) || '—'}</td>
        <td class="nowrap">${esc(v.screen) || '—'}</td>
        <td>${esc(v.lang) || '—'}</td>
        <td>${esc(v.tz) || '—'}</td>
        <td class="nowrap">${v.visitNo > 1 ? `Returning · visit ${v.visitNo}` : 'New'}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="19" class="empty">${visits.length ? 'No visits match.' : 'No visits logged yet.'}</td></tr>`;
    $('va-count').textContent = shown.length.toLocaleString();
    $('va-page').textContent = `${page + 1} / ${pages}`;
  }

  // ── gate ───────────────────────────────────────────────────────────────
  function gate(msg) {
    show('va-gate');
    setState('');
    $('va-err').textContent = msg || '';
    $('va-pw').value = '';
    setTimeout(() => $('va-pw').focus(), 50);
  }

  async function unlock() {
    const pw = $('va-pw').value;
    let hash;
    try { hash = await NA.sha256(pw); }
    catch { $('va-err').textContent = 'This browser can’t check the password here (it needs HTTPS).'; return; }
    if (hash !== NA.CFG.passwordSha256) { $('va-err').textContent = 'Incorrect password.'; $('va-pw').select(); return; }
    try { localStorage.setItem(NA.OWNER_FLAG, '1'); } catch { /* storage blocked */ }
    $('va-err').textContent = '';
    load(pw);
  }

  function boot() {
    $('va-unlock').addEventListener('click', unlock);
    $('va-pw').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
    $('va-q').addEventListener('input', applyFilter);
    $('va-todayonly').addEventListener('change', applyFilter);
    $('va-prev').addEventListener('click', () => { page--; render(); });
    $('va-next').addEventListener('click', () => { page++; render(); });
    $('va-refresh').addEventListener('click', () => { const pw = savedPw(); if (pw) load(pw); else gate(); });
    $('va-lock').addEventListener('click', () => { forgetPw(); visits = []; shown = []; gate(); });

    if (!NA) return setState('site-analytics.js did not load.', true);
    if (!NA.CFG.endpoint) return show('va-setup');
    const pw = savedPw();
    if (pw) load(pw); else gate();
  }

  boot();
})();
