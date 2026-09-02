# Admin portal v2 — button sweep (E2E final)

Base: https://medx-admin-portal-v2.netlify.app · 2026-08-31 00:08:29 (session injected, admin)

| controls | working | skipped (destructive/mass-send) | no effect | empty toast | mailto | external | click errors | console errors | API 5xx | API 4xx |
|---|---|---|---|---|---|---|---|---|---|---|
| 283 | 213 | 34 | 4 | 0 | 0 | 7 | 0 | 3 | 1 | 1 |

## /today

controls: 39 · console errors: 0 · failed API: 0

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
| TEAM CHAT 15 | a | NAV | /inbox/chat |
| profile | act | DOM |  |
| saveName | act | DOM |  |
| TEAM ACCESS → | a | NAV | /settings/team |
| DAYS TO PLEXUS 95 December 4–5, 2026 · Novinarski dom, Zagre | a | NAV | /projects/plexus |
| CONFERENCE REGISTERED 2 free entry · cap 100 | a | NAV | /registrations |
| GALA SEATS PAID 27 9 payments to chase · early bird ends Dec | a | SKIPPED (destructive/mass-send) |  |
| COLLECTED THIS YEAR €5,250 27 Gala payments · all of Money → | a | NAV | /money |
| LIVE · DEC 4–5 Plexus Week 2026 2 registered of 100 · 27 gal | a | NAV | /projects/plexus |
| APPLICATIONS OPEN DECEMBER 8 Accelerator 1 application 4 hos | a | NAV | /projects/accelerator |
| BY INVITATION Biomedical Forum 4 members · 0 candidates gath | a | NAV | /projects/forum |
| NEXT · BOSTON · SEP 2026 Building Bridges 4 past editions ·  | a | NAV | /projects/bridges |
| EVERYTHING ELSE More tools Website & portal text, team acces | a | NAV | /settings |
| REVIEW & SEND | a | SKIPPED (destructive/mass-send) |  |
| snooze | act | TOAST | SNOOZED FOR 1 DAY
UNDO |
| nagAct | act | TOAST | REMINDER QUEUED — APPROVE IT IN THE OUTBOX |
| OPEN | a | NAV | /projects/forum |
| OPEN | a | NAV | /studio |
| showAll | act | DOM |  |
| IN OUTBOX → | a | NAV | /inbox/outbox |
| POST NEWS TO MEMBERS | a | NAV | /inbox/announcements |
| FIND A PERSON | a | NAV | /people |
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
| GALA SEATS 35 26 PAID · 9 TO CHASE → | a | SKIPPED (destructive/mass-send) |  |
| formToggle | act | TOAST | FORM CLOSED — THE PAGE STOPS TAKING SIGN-UPS |
| RESPONSES → | a | NAV | /links |
| openSchedule | act | DOM |  |
| ssSave | act | TOAST | TYPE THE SESSION TITLE FIRST |
| TRAVEL Speaker itineraries 2 itineraries filed · flights, ho | a | NAV | /calendar |
| QUEUED Emails to registrants 11 batches queued in the Outbox | a | SKIPPED (destructive/mass-send) |  |
| AUTO Invitations & short links 14 live links · Paid, VIP, di | a | NAV | /links |
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
| MANAGE THE FULL MEMBER PAGE → | a | NAV | /member-pages/plexus |
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
| WHAT MEMBERS SEE — MANAGE ↗ | a | NAV | /member-pages/accelerator |
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
| WHAT MEMBERS SEE — MANAGE ↗ | a | NAV | /member-pages/forum |
| MEMBERS 4 196 of 200 seats open | a | NAV | /projects/forum#forum-members |
| CANDIDATES 0 in the pipeline below | a | NAV | /projects/forum#forum-pipeline |
| 0  invitation codes out | a | NAV | /projects/forum#forum-codes |
| CALENDAR → | a | NAV | /calendar |
| OPEN THE MEMBER FEED ↗ | a | EXTERNAL | https://medx-staging.onrender.com/app/forum |
| setSpot | act | DOM |  |
| setNews | act | DOM |  |
| setNote | act | DOM |  |
| publish | act | SKIPPED (destructive/mass-send) |  |
| repub | act | TOAST | REPUBLISHED — BACK ON THE MEMBER PAGE |
| addCand | act | TOAST | TYPE A NAME AND EMAIL FIRST |
| PROFILE → | a | NAV | /people |
| copyCode | act | TOAST | CODE FRM-QCVK-H336 COPIED |
| mintCode | act | SKIPPED (destructive/mass-send) |  |
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
| WHAT MEMBERS SEE — MANAGE ↗ | a | NAV | /member-pages/bridges |
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
| TEAM CHAT 15 | a | NAV | /inbox/chat |
| approveAll | act | SKIPPED (destructive/mass-send) |  |
| preview | act | NET | 1 call(s) |
| approve | act | SKIPPED (destructive/mass-send) |  |
| later | act | TOAST | SCHEDULED — SENDS TOMORROW 09:00 |
| discard | act | NET | 7 call(s) |
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

controls: 23 · console errors: 0 · failed API: 1

Failed API responses:
- 400 POST https://medx-admin-portal-v2.netlify.app/api/v2/money/work-units

| control | kind | effect | detail |
|---|---|---|---|
| goMoneyIn | act | DOM |  |
| openTx | act | NET | 1 call(s) |
| wuCsv | act | DOWNLOAD | medx-radne-jedinice-2026.csv |
| wuToggle | act | DOM |  |
| wuAdd | act | TOAST | ŠIFRA RADNE JEDINICE IS REQUIRED. |
| repRun | act | NET | 1 call(s) |
| toolClose | act | DOM |  |
| toolOpen | act | NET | 1 call(s) |
| surveySweep | act | SKIPPED (destructive/mass-send) |  |

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
| UNDO | span | SKIPPED (destructive/mass-send) |  |

## /event-day

controls: 12 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| reh | act | NET | 1 call(s) |
| rehReset | act | SKIPPED (destructive/mass-send) |  |
| gate | act | NET | 2 call(s) |
| instant | act | SKIPPED (destructive/mass-send) |  |
| cam | act | DOM |  |
| rehSim | act | NET | 3 call(s) |
| scanSubmit | act | TOAST | SCAN OR TYPE A CODE FIRST |
| admitMore | act | SKIPPED (destructive/mass-send) |  |
| doorIn | act | NET | 3 call(s) |
| mintDoor | act | SKIPPED (destructive/mass-send) |  |
| notesSave | act | TOAST | NOTES SAVED — THE WHOLE TEAM SEES THEM |
| OPEN LIVE Q&A → | a | NAV | /projects/plexus |

## /settings

controls: 11 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| run | act | TOAST | ALL 26 CHECKS RAN — 9 WANT A LOOK, 2 FAILING |
| inviteToggle | act | NET | 1 call(s) |
| sendInvite | act | SKIPPED (destructive/mass-send) |  |
| permsToggle | act | DOM |  |
| permFull | act | TOAST | THE FOUNDER ALWAYS HAS EVERYTHING |
| revoke | act | SKIPPED (destructive/mass-send) |  |
| permTg | act | NO EFFECT |  |
| teamAll | act | DOM |  |
| Publish news one post — member portal, website, or both → | a | SKIPPED (destructive/mass-send) |  |
| Member portal text home-screen cards, project pages → | a | NAV | /member-pages |

## /studio

controls: 9 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| MERCH → | a | EXTERNAL | https://medx-staging.onrender.com/shop |
| tool | act | DOM |  |
| OPEN THE 3D PLANNER ↗ | a | EXTERNAL | https://plexus-tables.netlify.app |
| GALA SEATING → | a | NAV | /gala |
| DOWNLOAD THE LOGO · PNG → | a | DOWNLOAD | medx-logo.png |
| WHITE · PNG → | a | DOWNLOAD | medx-logo-white.png |
| THE MARK · PNG → | a | DOWNLOAD | medx-mark.png |
| copyHex | act | TOAST | #9B1B22 COPIED |
| libTag | act | DOM |  |

## /gala

controls: 16 · console errors: 0 · failed API: 0

| control | kind | effect | detail |
|---|---|---|---|
| ← PLEXUS WEEK | a | NAV | /projects/plexus |
| kitchenCsv | act | DOWNLOAD | gala-kitchen-sheet.csv |
| EVENT DAY ROOM → | a | NAV | /event-day |
| kpiAll | act | DOM |  |
| kpiPaid | act | DOM |  |
| kpiChase | act | SKIPPED (destructive/mass-send) |  |
| kpiSeated | act | NO EFFECT |  |
| addToggle | act | DOM |  |
| addGuest | act | TOAST | TYPE THE GUEST’S NAME FIRST |
| catManage | act | MODAL |  |
| clearFilter | act | SKIPPED (destructive/mass-send) |  |
| chipFilter | act | DOM |  |
| cancel | act | SKIPPED (destructive/mass-send) |  |
| catEdit | act | DOM |  |
| pay | act | SKIPPED (destructive/mass-send) |  |

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
- 500 GET https://medx-admin-portal-v2.netlify.app/api/accelerator/documents/6a1f11a9-934c-47e2-8b6b-118d2d5378d0/download

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
| accept | act | SKIPPED (destructive/mass-send) |  |
| decline | act | SKIPPED (destructive/mass-send) |  |
| send | act | SKIPPED (destructive/mass-send) |  |
| critRemove | act | SKIPPED (destructive/mass-send) |  |
| addCrit | act | TOAST | TYPE THE CRITERION FIRST |
| intRemove | act | SKIPPED (destructive/mass-send) |  |
| intToggle | act | DOM |  |
| addInt | act | TOAST | NAME AND EMAIL — THE LINK NEEDS AN ADDRESS |
| host institutions | a | NAV | /projects/accelerator |
