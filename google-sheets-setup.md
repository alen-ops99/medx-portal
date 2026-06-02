# Google Sheets Registration Log — 3-Tab Setup (Plexus 2026)

Routes every registration into the correct tab of one spreadsheet
based on which events the person registered for.

## Step 1: Create the workbook

1. Go to https://sheets.google.com
2. Create a new blank spreadsheet
3. Rename it to **"Plexus 2026 Registration"**
4. Rename the default first sheet to **`Gala`**
5. Add two more tabs (click "+" at the bottom): **`Conference`** and **`Bridges`**
6. In each tab, paste these headers into Row 1 (same headers in all three):

```
Timestamp | Name | Email | Institution | Country | Role | Dietary | Notes | Items | Amount | Payment | Invoice | Invite Label | RegID
```

(14 columns. Copy that pipe-delimited line, paste into A1, then `Data → Split text to columns → Pipe`.)

## Step 2: Create the Apps Script webhook

1. Inside the spreadsheet, click **Extensions → Apps Script**
2. Delete any existing code
3. Paste this code (replaces the original 12-column version):

```javascript
function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data;
  try { data = JSON.parse(e.postData.contents); }
  catch (err) { return ContentService.createTextOutput('Invalid JSON'); }

  // 'events' is an array set by the portal: ['gala'], ['conference','bridges'], etc.
  // Backwards-compat: if events missing, infer from event_type.
  var events = Array.isArray(data.events) ? data.events.slice() : [];
  if (events.length === 0) {
    var et = (data.event_type || '').toLowerCase();
    if (et === 'gala' || et.indexOf('gala') >= 0) events.push('gala');
    else if (et === 'plexus' || et.indexOf('conference') >= 0) events.push('conference');
    else if (et.indexOf('bridges') >= 0) events.push('bridges');
  }

  var tabMap = { gala: 'Gala', conference: 'Conference', bridges: 'Bridges' };
  var row = [
    data.timestamp || new Date().toISOString(),
    data.name || '',
    data.email || '',
    data.institution || '',
    data.country || '',
    data.role || '',
    data.dietary || '',
    data.notes || '',
    data.items || '',
    data.amount || 0,
    data.payment || '',
    data.invoice || '',
    data.invite_label || '',
    data.registration_id || ''
  ];

  events.forEach(function(ev) {
    var name = tabMap[ev];
    if (!name) return;
    var sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    sheet.appendRow(row);
  });

  return ContentService.createTextOutput('OK · wrote to ' + events.length + ' tab(s)');
}
```

4. Click **Deploy → New deployment**
5. Type: **Web app**
6. Execute as: **Me**
7. Who has access: **Anyone**
8. Click **Deploy**
9. Click **Authorize access** → sign in → Allow
10. Copy the **Web app URL** (starts with `https://script.google.com/macros/s/.../exec`)

## Step 3: Put the URL in Render

1. Open Render dashboard → `medx-user-portal` service → **Environment** tab
2. Add (or update) env var:
   - Key: `GOOGLE_SHEETS_WEBHOOK`
   - Value: paste the URL from step 10 above
3. Click **Save Changes** → service auto-redeploys

## What goes where

| Registration source | Tabs written to |
|---|---|
| **Paid Gala invite link** | Gala |
| **VIP Gala invite link** | Gala |
| **Croatians Abroad — Conference only** | Conference |
| **Croatians Abroad — Bridges only** | Bridges |
| **Croatians Abroad — Conference + Bridges** | Conference, Bridges (one row each) |
| **Croatians Abroad — Gala + bundle** | Gala, Conference, Bridges (whichever bundled) |

The same person can show up in multiple tabs if they registered for
multiple events — that's intentional, so door staff at each event get
the relevant list.

## Updating an existing setup

If you already have a "MedX Registration Log" sheet from the original
single-tab setup, the simplest path:

1. Rename it to "Plexus 2026 Registration"
2. Rename the first sheet to `Gala`, add `Conference` and `Bridges` tabs
3. Paste the new 14-column header row into all three tabs
4. Open Apps Script → replace the old `doPost` with the new code above
5. Click **Deploy → Manage deployments** → on the existing deployment,
   click the pencil icon → choose **New version** → Deploy
6. The same web-app URL keeps working — no need to update Render env vars

## Verifying it works

After deploying both portals:
1. Open admin portal → dashboard → Quick Actions → **Send Test QR**
2. You'll get a test ticket emailed to your admin address
3. That same action also appends a test row to the **Conference** and
   **Bridges** tabs (the test person is "registered" for both, not Gala)
4. Open the sheet — confirm 2 new rows in the right tabs

If nothing shows up, check Render logs for `medx-user-portal`. The
sheet POST is silent (`.catch(() => {})`), so a misconfigured URL will
not crash the portal — but it will also not write anything. Common fixes:
- Apps Script "Who has access" was left as "Only me" → change to "Anyone"
- Forgot to deploy a NEW version after editing the script → repeat step 5
  of the update flow above
- `GOOGLE_SHEETS_WEBHOOK` env var spelled wrong on Render
