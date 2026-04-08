# Google Sheets Registration Log — Setup (2 minutes)

## Step 1: Create the Sheet
1. Go to https://sheets.google.com
2. Create a new blank spreadsheet
3. Name it "MedX Registration Log"
4. In Row 1, type these headers:
   A1: Timestamp | B1: Name | C1: Email | D1: Institution | E1: Event | F1: Items | G1: Guests | H1: Dietary | I1: Allergies | J1: Amount | K1: Payment | L1: RegID

## Step 2: Create the Apps Script webhook
1. In the spreadsheet, click **Extensions → Apps Script**
2. Delete any existing code
3. Paste this code:

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.name || '',
    data.email || '',
    data.institution || '',
    data.event || '',
    data.items || '',
    data.guests || 0,
    data.dietary || '',
    data.allergies || '',
    data.amount || 0,
    data.payment || '',
    data.registration_id || ''
  ]);
  return ContentService.createTextOutput('OK');
}
```

4. Click **Deploy → New deployment**
5. Type: **Web app**
6. Execute as: **Me**
7. Who has access: **Anyone**
8. Click **Deploy**
9. Click **Authorize access** → sign in → Allow
10. Copy the **Web app URL** (starts with https://script.google.com/...)
11. Give the URL to Claude

That's it! Every registration will auto-append to the sheet.
