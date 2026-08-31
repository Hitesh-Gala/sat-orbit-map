// =============================================================================
// Data-Comparison — Space-Track vs CelesTrak, side by side.
//
// Reads two static summaries written by the daily GitHub Action:
//   data/spacetrack-summary.json  (scripts/fetch_spacetrack.py — needs secrets)
//   data/celestrak-summary.json   (scripts/gen_datacompare.py  — local files)
// The Space-Track file is absent until the repo owner adds their credentials as
// repository secrets, so every field degrades gracefully to "not connected".
// =============================================================================
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

  const fmtN = n => (n == null || isNaN(n)) ? null : Number(n).toLocaleString();
  function fmtWhen(iso) {
    if (!iso) return null;
    const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z');
    if (isNaN(d)) return iso;
    return d.toUTCString().slice(5, 22) + ' GMT';          // "31 Aug 2026 14:41 GMT"
  }
  function ago(iso) {
    if (!iso) return '';
    const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
    if (isNaN(d)) return '';
    const h = (Date.now() - d.getTime()) / 3.6e6;
    if (h < 1) return ' (just now)';
    if (h < 48) return ` (${Math.round(h)} h ago)`;
    return ` (${Math.round(h / 24)} days ago)`;
  }

  async function load(path) {
    try {
      const r = await fetch(path, { cache: 'no-cache' });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  // One comparison row: same metric from both sources, bars scaled to the max.
  function row(title, note, st, ct) {
    const vals = [st && st.count, ct && ct.count].filter(v => typeof v === 'number' && v > 0);
    const max = vals.length ? Math.max(...vals) : 0;
    const bar = (v, cls, srcLabel) => {
      const has = typeof v === 'number' && v > 0;
      const pct = has && max ? Math.max(12, (v / max) * 100) : 100;
      const src = cls === 'st' ? st : ct;
      const cap = has && src && src.capped ? '+' : '';
      return `<div class="bl"><span class="dot" style="background:${cls === 'st' ? '#6a3fb5' : '#1466c9'}"></span>${srcLabel}</div>
        <div class="bwrap"><div class="bfill ${has ? cls : 'na'}" style="width:${has ? pct : 100}%">${has ? fmtN(v) + cap : 'not connected'}</div></div>`;
    };
    let delta = '';
    if (vals.length === 2) {
      const d = Math.abs(st.count - ct.count);
      const pct = ((d / Math.max(st.count, ct.count)) * 100).toFixed(1);
      delta = `<div class="delta">Difference · <b>${fmtN(d)}</b> objects (${pct}%) — ${esc(note)}</div>`;
    } else {
      delta = `<div class="delta">${esc(note)}</div>`;
    }
    const extra = [];
    if (st && st.latestEpoch) extra.push('Space-Track newest element set · ' + fmtWhen(st.latestEpoch));
    if (ct && ct.latestEpoch) extra.push('CelesTrak newest element set · ' + fmtWhen(ct.latestEpoch));
    if (st && st.window) extra.push('Space-Track window · ' + fmtWhen(st.window.from) + ' → ' + fmtWhen(st.window.to));
    if (ct && ct.window) extra.push('CelesTrak window · ' + fmtWhen(ct.window.from) + ' → ' + fmtWhen(ct.window.to));

    return `<div class="row">
      <div class="rh"><span class="rt">${esc(title)}</span><span class="rn">${extra.length ? esc(extra[0]) : ''}</span></div>
      <div class="bars">
        ${bar(st && st.count, 'st', 'Space-Track')}
        ${bar(ct && ct.count, 'ct', 'CelesTrak')}
      </div>
      ${delta}
      ${extra.length > 1 ? `<div class="delta">${extra.slice(1).map(esc).join(' · ')}</div>` : ''}
    </div>`;
  }

  function cdmTable(st) {
    const rows = (st && st.conjunctions && st.conjunctions.sample) || [];
    if (!rows.length) return false;
    $('cdm-tbl').innerHTML =
      `<thead><tr><th>Primary</th><th>Secondary</th><th>TCA (GMT)</th><th>Miss</th><th>P<sub>c</sub></th></tr></thead>
       <tbody>${rows.map(r => `<tr>
         <td>${esc(r.sat1 || r.id1 || '—')}${r.type1 ? ` <span style="color:#8b9bad">${esc(String(r.type1).toLowerCase())}</span>` : ''}</td>
         <td>${esc(r.sat2 || r.id2 || '—')}${r.type2 ? ` <span style="color:#8b9bad">${esc(String(r.type2).toLowerCase())}</span>` : ''}</td>
         <td>${esc(fmtWhen(r.tca) || '—')}</td>
         <td>${r.missM ? fmtN(r.missM) + ' m' : '—'}</td>
         <td>${r.prob ? Number(r.prob).toExponential(1) : '—'}</td>
       </tr>`).join('')}</tbody>`;
    $('cdm-sec').hidden = false;
    return true;
  }

  (async function boot() {
    const [st, ct] = await Promise.all([
      load('data/spacetrack-summary.json'),
      load('data/celestrak-summary.json'),
    ]);

    // freshness stamps
    if (st && st.retrieved) {
      $('st-as').innerHTML = 'Data as of · <b>' + esc(fmtWhen(st.retrieved)) + '</b>' + esc(ago(st.retrieved));
      $('st-badge').textContent = 'DAILY'; $('st-badge').className = 'badge b-live';
    } else {
      $('st-as').innerHTML = 'Data as of · <b>not connected</b>';
      $('st-badge').textContent = 'SETUP NEEDED'; $('st-badge').className = 'badge b-wait';
      $('setup-sec').hidden = false;
    }
    if (ct && ct.retrieved) {
      $('ct-as').innerHTML = 'Data as of · <b>' + esc(fmtWhen(ct.retrieved)) + '</b>' + esc(ago(ct.retrieved));
      $('ct-badge').textContent = 'BUNDLED'; $('ct-badge').className = 'badge b-live';
    } else {
      $('ct-as').innerHTML = 'Data as of · <b>unavailable</b>';
      $('ct-badge').textContent = 'MISSING'; $('ct-badge').className = 'badge b-wait';
    }

    $('cmp').innerHTML = [
      row('Catalogued objects on orbit',
          'Space-Track counts every tracked object; NAZAR’s CelesTrak bundle counts active TLE sets.',
          st && st.tle, ct && ct.tle),
      row('Active payloads',
          'Working spacecraft only — the closest like-for-like comparison of the two catalogues.',
          st && st.satcat, ct && ct.satcat),
      row('Predicted close approaches',
          'Space-Track publishes operator CDMs; CelesTrak SOCRATES screens the public TLEs.',
          st && st.conjunctions, ct && ct.conjunctions),
    ].join('');

    cdmTable(st);
  })();
})();
