/**
 * NAZAR — Comments & Feedback backend  →  AUTO-EMAILS every new comment.
 *
 * Each time a visitor submits feedback on the site, this script emails the
 * whole thing (comment + name + contact + IP + location + device) to you, so
 * you never have to monitor the site or download anything. It sends from your
 * own Gmail using Apps Script's built-in mailer — no third party ever sees the
 * data, and your email address is NOT exposed in the site's public code.
 * (Optionally it also logs every comment to a Google Sheet as a backup.)
 *
 * ════════════════════════════════════════════════════════════════════════
 *  SETUP — about 2 minutes, done ONCE  (only you can do this: it runs as
 *  your Google account so it can send mail as you)
 * ════════════════════════════════════════════════════════════════════════
 *  1. Sign in to the Google account for hdgala@gmail.com. Open
 *        https://script.google.com   →  New project.
 *  2. Delete the sample code, paste THIS entire file, and Save (💾).
 *  3. Deploy  →  New deployment  →  gear icon ⚙ → "Web app".
 *        • Description:    NAZAR feedback
 *        • Execute as:     Me (hdgala@gmail.com)
 *        • Who has access: Anyone
 *     Click Deploy. Google asks you to authorise — click through
 *     ("Advanced → Go to project (unsafe)" is normal for your own script),
 *     and allow "send email as you". COPY the Web-app URL (ends in /exec).
 *  4. In the site's feedback.js, set:
 *        endpoint: 'PASTE_YOUR_/exec_URL_HERE'
 *     Commit & push. Done.
 *  5. TEST: open the site, leave a comment, check the hdgala@gmail.com inbox —
 *     the email should arrive within a few seconds.
 *
 *  ── Optional: also keep a spreadsheet log ──
 *  Create a Google Sheet, and instead of step 1 open it via
 *  Extensions → Apps Script (paste there). Rows are appended automatically.
 *  Email works either way; the Sheet is just a bonus backup.
 * ════════════════════════════════════════════════════════════════════════
 */

var NOTIFY_EMAIL = 'hdgala@gmail.com';   // where each new comment is emailed
var LOG_TO_SHEET = true;                 // also append to a bound Sheet (if any)

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action !== 'add' || !body.record) return _json({ ok: false, error: 'bad request' });

    var r = body.record;
    if (LOG_TO_SHEET) { try { appendRow(r); } catch (ignore) {} }  // best-effort; email still sends
    sendNotification(r);
    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return _json({ ok: true, service: 'NAZAR feedback', hint: 'POST submissions here; each one is emailed to the owner.' });
}

// ── email ─────────────────────────────────────────────────────────────────
function sendNotification(r) {
  var name = (r.name && String(r.name).trim()) || 'Anonymous';
  var loc = [r.city, r.region, r.country].filter(function (x) { return x; }).join(', ') || '—';
  var when = r.ts ? new Date(r.ts) : new Date();

  var plain = [
    'New comment on NAZAR',
    '',
    'Name:      ' + name,
    'Submitted: ' + when,
    '',
    'COMMENT:',
    (r.comment || ''),
    '',
    '— Contact & technical details (private) —',
    'Contact:   ' + (r.contact || '—'),
    'IP:        ' + (r.ip || '—'),
    'Location:  ' + loc,
    'Device:    ' + (r.device || '—'),
    'Browser:   ' + (r.ua || '—'),
    'Page:      ' + (r.page || '—')
  ].join('\n');

  var row = function (k, v) {
    return '<tr><td style="padding:3px 12px 3px 0;color:#667;white-space:nowrap;vertical-align:top">' + esc(k) +
           '</td><td style="padding:3px 0;color:#111">' + esc(v || '—') + '</td></tr>';
  };
  var html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px">' +
    '<h2 style="margin:0 0 4px;color:#0b1b2a">New comment on NAZAR</h2>' +
    '<div style="color:#667;font-size:13px;margin-bottom:14px">' + esc(name) + ' · ' + esc(String(when)) + '</div>' +
    '<div style="background:#f4f7fb;border:1px solid #dbe4ee;border-radius:8px;padding:14px 16px;' +
    'font-size:15px;line-height:1.55;color:#111;white-space:pre-wrap">' + esc(r.comment || '') + '</div>' +
    '<h3 style="margin:18px 0 6px;color:#8a5a14;font-size:13px">Contact &amp; technical details (private)</h3>' +
    '<table style="font-size:13px;border-collapse:collapse">' +
    row('Contact', r.contact) + row('IP address', r.ip) + row('Location', loc) +
    row('Device', r.device) + row('Browser', r.ua) + row('Page', r.page) +
    '</table>' +
    '<div style="color:#99a;font-size:11px;margin-top:16px">Sent automatically by your NAZAR feedback form.</div>' +
    '</div>';

  var opts = { htmlBody: html, name: 'NAZAR Feedback' };
  // If the visitor left an email, make "Reply" go straight to them.
  if (r.contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.contact).trim())) {
    opts.replyTo = String(r.contact).trim();
  }
  MailApp.sendEmail(NOTIFY_EMAIL, 'NAZAR feedback from ' + name, plain, opts);
}

// ── optional spreadsheet log ────────────────────────────────────────────────
function appendRow(r) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return;                       // standalone script (email-only) — nothing to log to
  var sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Received (server)', 'Submitted (client)', 'Name', 'Comment',
                     'Contact (private)', 'IP', 'City', 'Region', 'Country', 'Device', 'User-Agent', 'Page']);
  }
  sheet.appendRow([new Date(), r.ts ? new Date(r.ts) : '', r.name || '', r.comment || '',
                   r.contact || '', r.ip || '', r.city || '', r.region || '', r.country || '',
                   r.device || '', r.ua || '', r.page || '']);
}

// ── helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
