/**
 * NAZAR — Comments & Feedback backend (Google Apps Script → Google Sheet).
 *
 * WHY: NAZAR is a static site (GitHub Pages) with no server, so a browser
 * cannot, on its own, collect feedback from every visitor into one place that
 * only you can see. This tiny script is that "one place": each submission from
 * the site is appended as a row (with the visitor's IP, approximate location
 * and device) to a private Google Sheet in YOUR Google account. Only you can
 * open it — that satisfies "visible only to me", and the Sheet gives you full
 * review / edit / delete natively.
 *
 * ── SETUP (about 5 minutes) ─────────────────────────────────────────────
 *  1. Create a new Google Sheet (sheet1). Note nothing else — the script fills
 *     the header row automatically on first submission.
 *  2. In that Sheet:  Extensions → Apps Script.  Delete the sample code and
 *     paste THIS entire file. Save.
 *  3. Deploy → New deployment → type "Web app".
 *        • Description: NAZAR feedback
 *        • Execute as:  Me (your account)
 *        • Who has access:  Anyone
 *     Click Deploy, authorise when prompted, and COPY the "/exec" web-app URL.
 *  4. In feedback.js set:   endpoint: 'PASTE_THE_/exec_URL_HERE'
 *     Commit & push. Done — every new comment now lands in your Sheet.
 *
 * Notes
 *  • Submissions are one-way (write-only) from the site, so nothing sensitive
 *    is ever exposed in the public JavaScript. You read/edit/delete in the
 *    Sheet, privately.
 *  • The site attaches the IP/geo it looks up client-side. This script also
 *    records the request's own timestamp as a cross-check.
 */

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    if (body.action !== 'add' || !body.record) {
      return _json({ ok: false, error: 'bad request' });
    }
    var r = body.record;
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    // Write a header row once.
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Received (server)', 'Submitted (client)', 'Name', 'Comment',
                       'Contact (private)', 'IP', 'City', 'Region', 'Country', 'Device', 'User-Agent', 'Page']);
    }
    sheet.appendRow([
      new Date(),
      r.ts ? new Date(r.ts) : '',
      r.name || '', r.comment || '', r.contact || '',
      r.ip || '', r.city || '', r.region || '', r.country || '',
      r.device || '', r.ua || '', r.page || ''
    ]);
    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return _json({ ok: true, service: 'NAZAR feedback', hint: 'POST submissions here.' });
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
