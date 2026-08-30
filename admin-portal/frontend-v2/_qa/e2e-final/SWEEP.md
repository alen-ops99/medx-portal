# Admin portal v2 — button sweep (E2E final)

Base: http://localhost:8911 · 2026-08-30 18:49:33 (session injected, admin)

| controls | working | skipped (destructive/mass-send) | no effect | empty toast | mailto | external | click errors | console errors | API 5xx | API 4xx |
|---|---|---|---|---|---|---|---|---|---|---|
| 283 | 235 | 21 | 4 | 0 | 0 | 7 | 0 | 3 | 2 | 0 |

## /today

controls: 36 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| ADMIN | a | NET | 24 call(s) |
| TODAY | a | NET | 24 call(s) |
| projects | act | DOM |  |
| PLEXUS Plexus Week 2026 Dec 4–5 | a | NAV | /projects/plexus |
| PEOPLE | a | NAV | /people |
| MONEY | a | NAV | /money |
| CALENDAR | a | NAV | /calendar |
| STUDIO | a | NAV | /studio |
| SETTINGS | a | NAV | /settings |
| TEAM CHAT 22 | a | NAV | /inbox/chat |
| profile | act | DOM |  |
| saveName | act | DOM |  |
| TEAM ACCESS → | a | NAV | /settings/team |
| DAYS TO PLEXUS 96 December 4–5, 2026 · Novinarski dom, Zagre | a | NAV | /projects/plexus |
| CONFERENCE REGISTERED 2 free entry · cap 100 | a | NAV | /registrations |
| GALA SEATS PAID 26 10 payments to chase · early bird ends Se | a | NAV | /gala |
| COLLECTED THIS YEAR €5,250 26 Gala payments · all of Money → | a | NAV | /money |
| LIVE · DEC 4–5 Plexus Week 2026 2 registered of 100 · 26 gal | a | NAV | /projects/plexus |
| APPLICATIONS OPEN DECEMBER 8 Accelerator 1 application 4 hos | a | NAV | /projects/accelerator |
| BY INVITATION Biomedical Forum 4 members · 0 candidates gath | a | NAV | /projects/forum |
| NEXT · BOSTON · SEP 2026 Building Bridges 4 past editions ·  | a | NAV | /projects/bridges |
| EVERYTHING ELSE More tools Website & portal text, team acces | a | NAV | /settings |
| REVIEW & SEND | a | SKIPPED (destructive/mass-send) |  |
| snooze | act | TOAST | SNOOZED FOR 1 DAY
UNDO |
| nagAct | act | TOAST | REMINDER QUEUED — APPROVE IT IN THE OUTBOX |
| OPEN | a | NAV | /projects/forum |
| showAll | act | DOM |  |
| OPEN | a | NAV | /studio |
| FULL CALENDAR → | a | NAV | /calendar |
| addToggle | act | DOM |  |
| addTask | act | TOAST | TYPE THE TASK FIRST |
| taskDone | act | TOAST | DONE — REMOVED FOR THE WHOLE TEAM
UNDO |
| ALL TASKS → | a | NAV | /calendar/tasks |
| SYSTEM HEALTH · 2 FAILING · 9 TO CHECK | a | NAV | /settings/health |
| AUDIT LOG | a | NAV | /settings/audit |
| VIEW MEMBER PORTAL ↗ | a | EXTERNAL | https://medx-staging.onrender.com |

## /projects/plexus

controls: 40 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| PROJECTS | a | NAV | /today |
| ACCELERATOR | a | NAV | /projects/accelerator |
| BIOMEDICAL FORUM | a | NAV | /projects/forum |
| BUILDING BRIDGES | a | NAV | /projects/bridges |
| msFocus | act | DOM |  |
| formToggle | act | TOAST | FORM CLOSED — THE PAGE STOPS TAKING SIGN-UPS |
| RESPONSES → | a | NAV | /links |
| openSchedule | act | DOM |  |
| ssSave | act | TOAST | TYPE THE SESSION TITLE FIRST |
| TRAVEL Speaker itineraries 2 itineraries filed · flights, ho | a | NAV | /calendar |
| QUEUED Emails to registrants 11 batches queued in the Outbox | a | NAV | /inbox/outbox |
| AUTO Invitations & short links 15 live links · Paid, VIP, di | a | NAV | /links |
| ACCREDITED CME / HLK accreditation points not set · 0 consen | a | NAV | /settings |
| cmeExport | act | DOWNLOAD | plexus-cme-hlk.csv |
| openQa | act | DOM |  |
| qaAnswer | act | MODAL |  |
| qaHide | act | TOAST | QUESTION BACK ON THE BOARD |
| FULL VIEW → | a | NAV | /gala |
| ON THE DAY Check-in, ops map & stage Q&A Live tools in the E | a | NAV | /event-day |
| 3D ballroom planner ↗ | a | EXTERNAL | https://plexus-tables.netlify.app/planner.html |
| charity auctions | a | NAV | /money |
| start2027 | act | TOAST | AVAILABLE AFTER DEC 6 — THE 2026 EDITION CLOSES FIRST |
| peOpen | act | MODAL |  |
| editionsOpen | act | MODAL |  |
| msSave | act | NET | 2 call(s) |
| MANAGE THE FULL MEMBER PAGE → | a | NAV | /member-pages |
| Settings → documents | a | NAV | /settings |
| ovEdit | act | DOM |  |
| copyStats | act | TOAST | LINE COPIED — PASTE IT ANYWHERE |
| archiveNote | act | SKIPPED (destructive/mass-send) |  |

## /projects/accelerator

controls: 23 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| PLEXUS WEEK 2026 | a | NAV | /projects/plexus |
| BIOMEDICAL FORUM | a | NAV | /projects/forum |
| BUILDING BRIDGES | a | NAV | /projects/bridges |
| WHAT MEMBERS SEE — MANAGE ↗ | a | NAV | /member-pages |
| REVIEW ROOM → | a | NAV | /accelerator-review |
| APPLICATIONS 1 1 NEW · REVIEW ROOM → | a | NAV | /accelerator-review |
| PAST FELLOWS 18 three cohorts placed · 2024–2026 | a | NAV | /projects/accelerator#alumni |
| intakeEdit | act | DOM |  |
| edit on the Calendar → | a | NAV | /calendar |
| instEdit | act | DOM |  |
| instSave | act | TOAST | SAVED — LIVE ON THE MEMBER PAGE |
| addInst | act | TOAST | TYPE THE INSTITUTION NAME FIRST |
| addAlu | act | TOAST | TYPE THE FELLOW’S NAME FIRST |
| REVIEW | a | NAV | /accelerator-review |
| SCORE | a | NAV | /accelerator-review |
| INTERVIEW | a | NAV | /accelerator-review#interviews |
| RANK | a | NAV | /accelerator-review#ranking |
| PLACE | a | NAV | /accelerator-review#ranking |
| OPEN THE REVIEW ROOM → | a | NAV | /accelerator-review |
| critRemove | act | SKIPPED (destructive/mass-send) |  |
| addCrit | act | TOAST | TYPE THE CRITERION FIRST |
| see their side ↗ | a | EXTERNAL | https://medx-staging.onrender.com/app/accelerator |
| announce the opening → | a | NAV | /inbox/announcements |

## /projects/forum

controls: 24 · console errors: 2 · failed API: 0

```
pageerror: Failed to execute 'writeText' on 'Clipboard': Write permission denied.
pageerror: Failed to execute 'writeText' on 'Clipboard': Write permission denied.
```

| control | kind | effect | detail |
|---|---|---|---|
| PLEXUS WEEK 2026 | a | NAV | /projects/plexus |
| ACCELERATOR | a | NAV | /projects/accelerator |
| BUILDING BRIDGES | a | NAV | /projects/bridges |
| WHAT MEMBERS SEE — MANAGE ↗ | a | NAV | /member-pages |
| MEMBERS 4 196 of 200 seats open | a | NAV | /projects/forum#forum-members |
| CANDIDATES 0 in the pipeline below | a | NAV | /projects/forum#forum-pipeline |
| 0  invitation codes out | a | NAV | /projects/forum#forum-codes |
| CALENDAR → | a | NAV | /calendar |
| OPEN THE MEMBER FEED ↗ | a | EXTERNAL | https://medx-staging.onrender.com/app/forum |
| setSpot | act | DOM |  |
| setNews | act | DOM |  |
| setNote | act | DOM |  |
| publish | act | TOAST | HEADLINE AND TEXT ARE BOTH NEEDED |
| repub | act | TOAST | REPUBLISHED — BACK ON THE MEMBER PAGE |
| addCand | act | TOAST | TYPE A NAME AND EMAIL FIRST |
| PROFILE → | a | NAV | /people |
| copyCode | act | TOAST | CODE FRM-MBZT-HASF COPIED |
| mintCode | act | TOAST | NEW CODE MINTED — EXPIRES IN 30 DAYS |
| formToggle | act | DOM |  |
| removeQ | act | SKIPPED (destructive/mass-send) |  |
| addQ | act | TOAST | TYPE THE QUESTION FIRST |
| copyLink | act | TOAST | PUBLIC LINK COPIED |
| gatherToggle | act | DOM |  |
| gatherSave | act | TOAST | GATHERING SAVED — LIVE FOR MEMBERS |

## /projects/bridges

controls: 18 · console errors: 1 · failed API: 0

```
pageerror: Failed to execute 'writeText' on 'Clipboard': Write permission denied.
```

| control | kind | effect | detail |
|---|---|---|---|
| PLEXUS WEEK 2026 | a | NAV | /projects/plexus |
| ACCELERATOR | a | NAV | /projects/accelerator |
| BIOMEDICAL FORUM | a | NAV | /projects/forum |
| WHAT MEMBERS SEE — MANAGE ↗ | a | NAV | /member-pages |
| 4 EVENTS · 4 CITIES, 3 COUNTRIES | a | NAV | /projects/bridges#bridges-events |
| 0 BOSTON SIGN-UPS · OF 80 | a | NAV | /registrations |
| newCityToggle | act | DOM |  |
| ncAdd | act | TOAST | TYPE THE CITY FIRST |
| evEdit | act | DOM |  |
| evSave | act | TOAST | EVENT SAVED — LIVE EVERYWHERE |
| recap | act | DOM |  |
| rcPhotoRemove | act | SKIPPED (destructive/mass-send) |  |
| rcSave | act | TOAST | RECAP SAVED — LIVE ON THE MEMBER PAGE |
| fuAdd | act | TOAST | TYPE WHO TO FOLLOW UP WITH FIRST |
| PREPARE THANK-YOU EMAIL → | a | NAV | /inbox |
| scAll | act | DOM |  |
| scYear | act | DOM |  |
| copyLine | act | TOAST | PRESS LINE COPIED |

## /inbox

controls: 13 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| EMAIL & OUTBOX 11 | a | NAV | /inbox/outbox |
| MEMBER MESSAGES | a | NAV | /inbox/messages |
| ANNOUNCEMENTS | a | NAV | /inbox/announcements |
| NEWSLETTER | a | NAV | /inbox/newsletter |
| TEAM CHAT 22 | a | NAV | /inbox/chat |
| approveAll | act | SKIPPED (destructive/mass-send) |  |
| preview | act | NET | 1 call(s) |
| approve | act | SKIPPED (destructive/mass-send) |  |
| later | act | TOAST | SCHEDULED — SENDS TOMORROW 09:00 |
| discard | act | NET | 5 call(s) |
| cancelLater | act | SKIPPED (destructive/mass-send) |  |
| manualTg | act | DOM |  |
| pickTg | act | NO EFFECT |  |

## /people

controls: 8 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| exportCsv | act | DOWNLOAD | medx-people.csv |
| addToggle | act | DOM |  |
| npAdd | act | TOAST | THE NAME IS THE ONE THING I NEED |
| seg | act | DOM |  |
| PLEXUS → | a | NAV | /registrations?event=plexus |
| BRIDGES → | a | NAV | /registrations?event=bridges |
| ALL → | a | NAV | /registrations |
| openRow | act | DOM |  |

## /money

controls: 26 · console errors: 0 · failed API: 1

Failed API responses:
- 503 GET http://localhost:8911/api/admin/transparency/board-pack.pdf?year=2026&lang=en

| control | kind | effect | detail |
|---|---|---|---|
| openTx | act | DOM |  |
| toolClose | act | DOM |  |
| 10 | a | NAV | /inbox/outbox |
| Member 004 Test Gala seat · reserved July 15, 2026 | a | NAV | /gala |
| chaseQueue | act | TOAST | REMINDER QUEUED — SENDS AFTER YOUR OK IN THE OUTBOX |
| Member 016 Test Gala seat · reserved July 15, 2026 | a | NAV | /gala |
| chasePaid | act | MODAL |  |
| Member 028 Test Gala seat · reserved August 3, 2026 | a | NAV | /gala |
| Member 061 Test Gala seat · reserved August 3, 2026 | a | NAV | /gala |
| Member 050 Test Gala seat · reserved August 11, 2026 | a | NAV | /gala |
| Member 028 Test Gala seat · reserved August 11, 2026 | a | NAV | /gala |
| Member 040 Test Gala seat · reserved August 22, 2026 | a | NAV | /gala |
| Member 086 Test Gala seat · reserved August 24, 2026 | a | NAV | /gala |
| Member 088 Test Gala seat · reserved August 25, 2026 | a | NAV | /gala |
| E2E Party Gala seat · reserved August 30, 2026 | a | NAV | /gala |
| pledgeToggle | act | DOM |  |
| pledgeAdd | act | TOAST | NEED A NAME AND AN AMOUNT |
| expenseAdd | act | TOAST | NEED A DESCRIPTION AND AN AMOUNT |
| bpWord | act | DOWNLOAD | medx-board-pack-2026.doc |
| bpPreview | act | NET | 1 call(s) |
| bpPdf | act | TOAST | THE PRINT ENGINE (HEADLESS CHROME) IS NOT AVAILABLE HERE. SET CHROME_PATH TO ENABLE PDF EXPORT. THE  |
| surveySweep | act | TOAST | NOTHING DUE — IT QUEUES AT 08:00 AFTER EACH EVENT |

## /calendar

controls: 8 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| exportPdf | act | TOAST | PRINT-READY YEAR BOARD — CHOOSE “SAVE AS PDF” IN THE DIALOG |
| exportCsv | act | DOWNLOAD | medx-calendar-2026.csv |
| addToggle | act | DOM |  |
| OPEN GALA → | a | NAV | /gala |
| toggleEdit | act | DOM |  |
| removeEntry | act | SKIPPED (destructive/mass-send) |  |
| taskDone | act | TOAST | DONE — REMOVED FOR THE WHOLE TEAM
UNDO |
| UNDO | span | NET | 2 call(s) |

## /event-day

controls: 14 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| reh | act | NET | 1 call(s) |
| rehReset | act | SKIPPED (destructive/mass-send) |  |
| gate | act | NET | 2 call(s) |
| instant | act | DOM |  |
| cam | act | DOM |  |
| rehSim | act | NET | 3 call(s) |
| scanSubmit | act | TOAST | SCAN OR TYPE A CODE FIRST |
| admitMore | act | SKIPPED (destructive/mass-send) |  |
| doorIn | act | NET | 3 call(s) |
| mintDoor | act | TOAST | DOOR LINK READY — TEXT IT OR SHOW THE QR |
| qrDoor | act | DOM |  |
| revokeDoor | act | SKIPPED (destructive/mass-send) |  |
| notesSave | act | TOAST | NOTES SAVED — THE WHOLE TEAM SEES THEM |
| OPEN LIVE Q&A → | a | NAV | /projects/plexus |

## /settings

controls: 10 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| run | act | TOAST | ALL 26 CHECKS RAN — 9 WANT A LOOK, 2 FAILING |
| inviteToggle | act | NET | 1 call(s) |
| sendInvite | act | TOAST | TYPE A REAL EMAIL FIRST |
| permsToggle | act | DOM |  |
| permFull | act | TOAST | THE FOUNDER ALWAYS HAS EVERYTHING |
| revoke | act | SKIPPED (destructive/mass-send) |  |
| permTg | act | NO EFFECT |  |
| teamAll | act | DOM |  |
| Publish news one post — member portal, website, or both → | a | NAV | /inbox/announcements |

## /studio

controls: 9 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| MERCH → | a | EXTERNAL | https://medx-staging.onrender.com/shop |
| tool | act | DOM |  |
| NEW FORM PAGE → | a | NAV | /links |
| OPEN THE 3D PLANNER ↗ | a | EXTERNAL | https://plexus-tables.netlify.app/planner.html |
| GALA SEATING → | a | NAV | /gala |
| DOWNLOAD THE LOGO · PNG → | a | DOWNLOAD | medx-logo.png |
| WHITE · PNG → | a | DOWNLOAD | medx-logo-white.png |
| THE MARK · PNG → | a | DOWNLOAD | medx-mark.png |
| copyHex | act | TOAST | #9B1B22 COPIED |

## /gala

controls: 15 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| ← PLEXUS WEEK | a | NAV | /projects/plexus |
| kitchenCsv | act | DOWNLOAD | gala-kitchen-sheet.csv |
| EVENT DAY ROOM → | a | NAV | /event-day |
| kpiAll | act | DOM |  |
| kpiPaid | act | DOM |  |
| kpiChase | act | DOM |  |
| kpiSeated | act | NO EFFECT |  |
| addToggle | act | DOM |  |
| addGuest | act | TOAST | TYPE THE GUEST’S NAME FIRST |
| clearFilter | act | SKIPPED (destructive/mass-send) |  |
| chipFilter | act | DOM |  |
| pay | act | TOAST | MARKED PAID — MONEY UPDATES TOO |
| cancel | act | SKIPPED (destructive/mass-send) |  |
| chase | act | TOAST | REMINDER QUEUED IN THE OUTBOX |

## /registrations

controls: 9 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| ← PEOPLE | a | NAV | /people |
| emailSel | act | TOAST | TICK AT LEAST ONE ROW FIRST |
| exportCsv | act | DOWNLOAD | medx-registrations.csv |
| statAll | act | NET | 1 call(s) |
| statConf | act | NET | 1 call(s) |
| statGala | act | NET | 1 call(s) |
| statBoston | act | NET | 1 call(s) |
| chip | act | NET | 1 call(s) |
| selAll | act | DOM |  |

## /links

controls: 6 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| ← PLEXUS WEEK | a | NAV | /projects/plexus |
| Registrations | a | NAV | /registrations |
| signups | act | NAV | /registrations?link=24bb36266aca9fe8751859bd69c48e28&label=E2E%20Final%20link |
| pause | act | SKIPPED (destructive/mass-send) |  |
| copy | act | TOAST | LINK COPIED — PASTE IT ANYWHERE |
| qr | act | MODAL |  |

## /member-pages

controls: 7 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| tab | act | NO EFFECT |  |
| OPEN THE LIVE PAGE ↗ | a | EXTERNAL | https://medx-staging.onrender.com/#plexus |
| blockToggle | act | DOM |  |
| kdToggle | act | DOM |  |
| kdRemove | act | SKIPPED (destructive/mass-send) |  |
| kdAdd | act | DOM |  |
| /projects/plexus | nav | NAV | /projects/plexus |

## /accelerator-review

controls: 17 · console errors: 0 · failed API: 1

Failed API responses:
- 500 GET http://localhost:8911/api/accelerator/documents/6a1f11a9-934c-47e2-8b6b-118d2d5378d0/download

| control | kind | effect | detail |
|---|---|---|---|
| PLEXUS WEEK 2026 | a | NAV | /projects/plexus |
| BIOMEDICAL FORUM | a | NAV | /projects/forum |
| BUILDING BRIDGES | a | NAV | /projects/bridges |
| ← ACCELERATOR | a | NAV | /projects/accelerator |
| export | act | DOWNLOAD | accelerator-ranking-2026.csv |
| filter | act | DOM |  |
| file | act | NET | 1 call(s) |
| doc | act | TOAST | THAT DOCUMENT DID NOT DOWNLOAD — TRY AGAIN |
| accept | act | TOAST | ACCEPTED — OFFER + PAPERWORK QUEUED IN THE OUTBOX
UNDO |
| decline | act | SKIPPED (destructive/mass-send) |  |
| send | act | SKIPPED (destructive/mass-send) |  |
| critRemove | act | SKIPPED (destructive/mass-send) |  |
| addCrit | act | TOAST | TYPE THE CRITERION FIRST |
| intRemove | act | SKIPPED (destructive/mass-send) |  |
| intToggle | act | DOM |  |
| addInt | act | TOAST | NAME AND EMAIL — THE LINK NEEDS AN ADDRESS |
| host institutions | a | NAV | /projects/accelerator |
