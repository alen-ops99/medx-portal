/**
 * Med&X registrations → Google Sheets, ONE TAB PER EVENT — NON-DESTRUCTIVE.
 * ----------------------------------------------------------------------------
 * Drop-in replacement for the existing webhook. It:
 *   • Routes each registration to the tab for its event. The portal sends an
 *     `events` array (["gala"], ["conference","bridges"], …); a Croatians-Abroad
 *     sign-up for conference+bridges lands in BOTH tabs.
 *   • MATCHES your existing tabs by name (case-insensitive keyword), so "Gala",
 *     "Conference", "Bridges" are reused — it does NOT create duplicates.
 *   • Writes every value BY COLUMN NAME, so your existing column order is kept.
 *     New fields (Custom Answers, Applied For, Allergies, Coupon, Discount, Event,
 *     Guests) are appended as new columns at the end of a tab only when present.
 *
 * UPDATE STEPS (you already have a Sheet + a deployed webhook):
 *   1. Open the Sheet → Extensions → Apps Script.
 *   2. Select all existing code (Cmd-A), delete, paste this, Save (Cmd-S).
 *   3. Deploy → Manage deployments → (your existing Web app) → ✏️ Edit →
 *        Version: "New version" → Deploy.
 *      Editing the EXISTING deployment keeps the SAME /exec URL, so you do NOT
 *      need to change anything in Render. (If you instead make a brand-new
 *      deployment, copy the new /exec URL into GOOGLE_SHEETS_WEBHOOK on BOTH
 *      Render services: medx-user-portal and medx-admin-portal.)
 *   4. (Optional) run testAppend() once from the editor to see the new columns
 *      appear on the Gala tab.
 *
 * NOTE on "Bridges": this routes both the within-Plexus Croatian "Building
 * Bridges" component AND any standalone Building Bridges event to the "Bridges"
 * tab. If you ever want those separated, add a distinct tab + matcher below.
 */

// Map each event key the portal sends → how to find/create its tab.
var EVENT_TABS = [
  { key: 'gala',             canonical: 'Gala',             match: /gala/i },
  { key: 'conference',       canonical: 'Conference',       match: /conf|plexus/i },
  { key: 'forum',            canonical: 'Forum',            match: /forum/i },
  { key: 'bridges',          canonical: 'Bridges',          match: /bridge/i },
  { key: 'croatians-abroad', canonical: 'Croatians Abroad', match: /croat|abroad|diaspor/i }
];

// Payload field → spreadsheet column header. Order here is the order used only when
// creating a brand-new tab; existing tabs keep their own order.
var FIELD_MAP = [
  { header: 'Timestamp',     key: 'timestamp' },
  { header: 'Name',          key: 'name' },
  { header: 'Email',         key: 'email' },
  { header: 'Institution',   key: 'institution' },
  { header: 'Country',       key: 'country' },
  { header: 'Role',          key: 'role' },
  { header: 'Dietary',       key: 'dietary' },
  { header: 'Notes',         key: 'notes' },
  { header: 'Items',         key: 'items' },
  { header: 'Applied For',   key: 'applied_for' },
  { header: 'Allergies',     key: 'allergies' },
  { header: 'Custom Answers', key: '__custom__' },   // special: built summary string
  { header: 'Guests',        key: 'guests' },
  { header: 'Amount',        key: 'amount' },
  { header: 'Payment',       key: 'payment' },
  { header: 'Coupon',        key: 'coupon' },
  { header: 'Discount',      key: 'discount' },
  { header: 'Invoice',       key: 'invoice' },
  { header: 'Invite Label',  key: 'invite_label' },
  { header: 'RegID',         key: 'registration_id' },
  { header: 'Event',         key: 'event' },
  { header: 'Ticket Code',   key: 'ticket_code' }
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // serialize appends so concurrent registrations don't collide
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var customStr = data.custom_summary || customSummaryFromObj(data.custom_answers) || '';
    var targets = (data.events && data.events.length) ? data.events.slice() : [data.event_type || 'Other'];

    targets.forEach(function (key) {
      var sheet = findOrCreateSheet(ss, key);
      writeRow(sheet, data, customStr);
    });

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// Reuse an existing tab whose name matches the event keyword; otherwise create one.
function findOrCreateSheet(ss, eventKey) {
  var def = null;
  for (var i = 0; i < EVENT_TABS.length; i++) { if (EVENT_TABS[i].key === eventKey) { def = EVENT_TABS[i]; break; } }
  var sheets = ss.getSheets();
  if (def) {
    for (var j = 0; j < sheets.length; j++) { if (def.match.test(sheets[j].getName())) return sheets[j]; }
    return ss.insertSheet(def.canonical);
  }
  var name = titleCase(eventKey);
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// Append one row, placing each value under its named column and adding any missing
// columns (for new fields) at the end — never reordering existing columns.
function writeRow(sheet, data, customStr) {
  // Ensure a header row exists. A brand-new tab gets the full FIELD_MAP header.
  if (sheet.getLastRow() === 0) {
    var fresh = FIELD_MAP.map(function (f) { return f.header; });
    sheet.appendRow(fresh);
    sheet.getRange(1, 1, 1, fresh.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colOf = {};
  for (var c = 0; c < header.length; c++) { if (header[c] !== '' && header[c] != null) colOf[String(header[c])] = c; }

  // For each field that has a value but no column yet, append the column to the header.
  FIELD_MAP.forEach(function (f) {
    var v = valueFor(f, data, customStr);
    var hasValue = !(v === '' || v === null || v === undefined);
    if (hasValue && colOf[f.header] === undefined) {
      header.push(f.header);
      colOf[f.header] = header.length - 1;
      sheet.getRange(1, header.length, 1, 1).setValue(f.header).setFontWeight('bold');
    }
  });

  // Build the row positioned by the (possibly extended) header.
  var row = new Array(header.length).fill('');
  FIELD_MAP.forEach(function (f) {
    if (colOf[f.header] !== undefined) row[colOf[f.header]] = valueFor(f, data, customStr);
  });
  sheet.appendRow(row);
}

function valueFor(f, data, customStr) {
  var v = (f.key === '__custom__') ? customStr : data[f.key];
  if (v === undefined || v === null) return '';
  return sanitizeCell(v);
}

// Neutralize spreadsheet formula injection: a value starting with = + - @ (or tab/CR) would be
// interpreted by Sheets as a formula. Prefix with a single quote so it's stored as literal text.
function sanitizeCell(v) {
  if (typeof v === 'number') return v;
  var s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

// Build "Q: A | Q2: A2" from {field_key:{label,value}} if a prebuilt summary wasn't sent.
function customSummaryFromObj(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return Object.keys(obj).map(function (k) {
    var a = obj[k];
    var label = (a && a.label) ? a.label : k;
    var value = (a && a.value != null) ? a.value : a;
    return label + ': ' + value;
  }).join(' | ');
}

function titleCase(s) { s = String(s || 'Other'); return s.charAt(0).toUpperCase() + s.slice(1); }

// Run once from the editor to confirm routing + the new Custom Answers column.
function testAppend() {
  doPost({ postData: { contents: JSON.stringify({
    timestamp: new Date().toISOString(),
    events: ['gala'],
    name: 'Test Person', email: 'test@example.com', institution: 'Test U', country: 'Croatia',
    event: 'Plexus 2026 — Gala Evening', event_type: 'gala',
    applied_for: 'Gala Evening', items: 'Gala Evening', guests: 0,
    dietary: 'Vegetarian', allergies: 'None',
    custom_summary: 'T-shirt Size: L | Arrival date: May 24',
    amount: 150, payment: 'Paid', coupon: 'VIP15', discount: '15',
    invite_label: 'Sponsor link', registration_id: 'test-123'
  }) } });
}
