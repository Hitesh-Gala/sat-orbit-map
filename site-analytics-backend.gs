/**
 * NAZAR — Site Analytics backend (Google Sheet + Apps Script).
 *
 * Every visit to the site becomes one row in a Google Sheet that only you can
 * open: IP address and approximate location, device, OS, browser, pages seen
 * and time spent (to the second).  The owner-only dashboard
 * (site-analytics.html) reads the rows back, but this script hands them out
 * only when the owner password checks out — the password itself is not stored
 * anywhere public (this file and the site keep only its SHA-256).
 *
 * ════════════════════════════════════════════════════════════════════════
 *  SETUP — about 3 minutes, done ONCE (it runs as your Google account)
 * ════════════════════════════════════════════════════════════════════════
 *  1. Sign in to Google and create a new Google Sheet (https://sheets.new).
 *     Name it e.g. "NAZAR site analytics".
 *  2. In that Sheet: Extensions → Apps Script.  Delete the sample code, paste
 *     THIS entire file, and Save (💾).
 *  3. Deploy → New deployment → gear icon ⚙ → "Web app".
 *        • Description:    NAZAR site analytics
 *        • Execute as:     Me
 *        • Who has access: Anyone
 *     Click Deploy and authorise when asked ("Advanced → Go to … (unsafe)" is
 *     normal for your own script).  COPY the Web-app URL (it ends in /exec).
 *  4. Put that URL in the site's site-analytics.js:
 *        endpoint: 'https://script.google.com/macros/s/…/exec',
 *     then commit & push.
 *  5. TEST: open the site in a private window, click around for a minute and
 *     close it — a row appears in the Sheet's "Visits" tab.  Then open
 *     About → Site Analytics and enter the password.
 *
 *  Editing this script later: Deploy → Manage deployments → ✏ → Version:
 *  "New version" → Deploy (keeps the same /exec URL).
 *  Changing the password: put the new password's SHA-256 in PASSWORD_SHA256
 *  below (then deploy a new version as above) AND in site-analytics.js
 *  (passwordSha256) and nazar-gate.js (SHA256) — one owner password for
 *  analytics, Indi-Space and Space Stuff.
 * ════════════════════════════════════════════════════════════════════════
 *
 * The tag below makes Google ask for access to THIS spreadsheet only, not
 * to all of your Sheets.
 * @OnlyCurrentDoc
 */

var PASSWORD_SHA256 = '073c5d092744e265c7726e0ab4c911c0295a91f022eb8d98fa8391b64769dbd1';
var SHEET_NAME = 'Visits';
var MAX_READ   = 5000;   // newest visits returned to the dashboard

// Sheet columns.  'start' / 'last' are server times; 'seconds' is the visitor's
// foreground time on the site, summed across every page of the visit.
var COLS = ['sid', 'vid', 'start', 'last', 'seconds', 'pages', 'landing', 'lastPage',
            'ip', 'country', 'region', 'city', 'isp', 'deviceName', 'deviceType', 'os', 'browser',
            'screen', 'lang', 'tz', 'referrer', 'ua'];
var INFO = ['ip', 'country', 'region', 'city', 'isp', 'deviceName', 'deviceType', 'os', 'browser',
            'screen', 'lang', 'tz', 'referrer', 'ua'];

function doGet() {
  return json_({ ok: true, service: 'NAZAR site analytics' });
}

function doPost(e) {
  var b;
  try { b = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad request' }); }
  if (b.type === 'read') return json_(read_(b));
  if (b.type !== 'visit') return json_({ ok: false, error: 'bad request' });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ ok: false, error: 'busy' });
  try { return json_(visit_(b)); }
  finally { lock.releaseLock(); }
}

// One row per visit (session id).  Beacons can arrive in any order, so this is
// an upsert: create the row if needed, keep the largest time and page counts,
// and fill any detail still blank (e.g. location arriving after a quick exit).
function visit_(b) {
  var sid = String(b.sid || '');
  if (!/^[A-Za-z0-9-]{8,40}$/.test(sid)) return { ok: false, error: 'bad sid' };
  var sh = sheet_(), now = new Date(), info = b.info || {};
  var seconds = Math.max(0, Math.min(Number(b.seconds) || 0, 7 * 86400));
  var pages = Math.max(1, Math.min(Number(b.pages) || 1, 10000));

  var hit = sh.getRange('A:A').createTextFinder(sid).matchEntireCell(true).findNext();
  if (!hit) {
    var rec = { sid: sid, vid: b.vid, seconds: seconds, pages: pages,
                landing: info.page || b.page, lastPage: b.page };
    INFO.forEach(function (k) { rec[k] = info[k]; });
    sh.appendRow(COLS.map(function (c) {
      if (c === 'start' || c === 'last') return now;
      if (c === 'seconds' || c === 'pages') return rec[c];
      return cell_(rec[c], c === 'ua' ? 400 : 200);
    }));
    return { ok: true, created: true };
  }

  var range = sh.getRange(hit.getRow(), 1, 1, COLS.length), row = range.getValues()[0];
  var at = function (c) { return COLS.indexOf(c); };
  var storedPages = Number(row[at('pages')]) || 0;
  row[at('last')] = now;
  row[at('seconds')] = Math.max(Number(row[at('seconds')]) || 0, seconds);
  if (pages >= storedPages && b.page) row[at('lastPage')] = cell_(b.page, 200);   // only the newest page moves it
  row[at('pages')] = Math.max(storedPages, pages);
  var fill = { vid: b.vid, landing: info.page };
  INFO.forEach(function (k) { fill[k] = info[k]; });
  Object.keys(fill).forEach(function (k) {
    if (fill[k] && !row[at(k)]) row[at(k)] = cell_(fill[k], k === 'ua' ? 400 : 200);
  });
  range.setValues([row]);
  return { ok: true };
}

function read_(b) {
  if (!b.pw || sha256_(b.pw) !== PASSWORD_SHA256) return { ok: false, error: 'auth' };
  var sh = sheet_(), last = sh.getLastRow(), n = last - 1;
  if (n < 1) return { ok: true, cols: COLS, rows: [], totalVisits: 0, uniqueUsers: 0, truncated: false };

  var users = {};
  sh.getRange(2, 2, n, 1).getValues().forEach(function (r) { if (r[0]) users[r[0]] = 1; });
  var from = Math.max(2, last - MAX_READ + 1);
  var rows = sh.getRange(from, 1, last - from + 1, COLS.length).getValues().map(function (r) {
    return r.map(function (v) { return v instanceof Date ? v.toISOString() : v; });
  });
  return { ok: true, cols: COLS, rows: rows, totalVisits: n,
           uniqueUsers: Object.keys(users).length, truncated: from > 2 };
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) { sh.appendRow(COLS); sh.setFrozenRows(1); }
  return sh;
}

// Visitor-supplied text: capped, and never allowed to start a formula.
function cell_(v, max) {
  var s = String(v == null ? '' : v).slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (x) { return ('0' + ((x + 256) % 256).toString(16)).slice(-2); }).join('');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
