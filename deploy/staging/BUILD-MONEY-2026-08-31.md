# BUILD — ADMIN Money rebuild (Miro's spec) — 2026-08-31

Scope: TEAM-REVIEW-CONSOLIDATED-2026-08.md §C "Money rebuild" + Miro's raw MONEY section (review
docx, Croatian — authoritative). Branch `redesign/member-portal`. No git/deploy/email/DB actions
were performed; all DDL is `CREATE TABLE IF NOT EXISTS` in code, applied only when the server runs.

## Files touched (the three owned files + this report)
- `admin-portal/backend/v2/money.js` — kept the existing ledger/chase/survey endpoints (their cards
  moved off the screen; project screens + queued survey links still need them) and appended the
  rebuild: 24 new routes, 5 new tables. 1,393 lines, `node --check` clean.
- `admin-portal/frontend-v2/js/views/money.js` — full rewrite to the new screen (1,194 lines, ESM
  syntax-checked; COPY/SOURCE exports, dc-block markers, data-act + ui.bind, api.settle, inline
  ink/cream/crimson/gold styles kept).
- `admin-portal/frontend-v2/css/views/money.css` — responsive hooks for the new accounting tables
  (each table scrolls in its own overflow wrapper; forms/edit-grid collapse ≤620px).

## What the screen now is (top → bottom)
1. **Header tiles** — `GET /api/v2/money/summary?year=`:
   - **COLLECTED IN 2026** = ALL income across every project: legacy `finance_transactions` income
     (every Stripe/webhook/mark-paid/reconcile flow books there) + paid `gala_registrations` rows
     NOT yet booked (deduped by invoice-number ↔ `finance_transactions.reference`) + collected
     outgoing-book rows (same dedup) + received expected income + sponsor-ledger paid/thanked.
   - **STILL OWED TO US** = open expected income (the new manual receivables — e.g. an awarded MZO
     grant whose payment has not landed) + unpaid reserved Gala seats × price-by-the-clock (from
     `gala_settings`) + legacy outgoing invoices still open + outgoing-book rows without datum
     naplate + sponsor-ledger rows at "invoiced". "+ OČEKIVANA UPLATA" control lives on this card.
   - **SPENT** = legacy expense transactions + knjiga ulaznih računa + putni nalozi. Payment orders
     are shown with their own total but NOT added (they usually execute an incoming invoice — the
     card's footer says so).
   - NET tile kept (collected − spent).
2. **RECENT MONEY IN** — one stream, every source, tagged (CARD/BANK/GALA/PLEXUS/RAČUN/GRANT/
   SPONSOR), same dedup as the tile.
3. **STILL OWED TO US card** — breakdown lines (doors: Gala → /gala, book rows → the book below) +
   the expected-income list with add / edit / PRIMLJENO (with UNDO) / delete.
4. **KNJIGA IZLAZNIH RAČUNA** — summary chips (ukupno · naplaćeno · nenaplaćeno · fiskalizirani ·
   nefiskalizirani), filters (projekt · radna jedinica · od/do), columns exactly per spec: broj
   računa, naziv kupca, OIB kupca, datum računa, iznos, datum knjiženja (≠ datum računa), vrsta
   (fisk./nefisk.), radna jedinica, projekt (+ naplata state, edit/delete). Legacy
   `finance_invoices` outgoing rows are listed read-only underneath (tagged LEGACY) so "all
   invoices" really is all of them. **FIRA rule enforced**: a fiskalizirani row REQUIRES the FIRA
   number typed in (server 400 otherwise); the portal never generates an invoice number or
   document; the card footer states it.
5. **KNJIGA ULAZNIH RAČUNA** — same machinery; columns broj računa, naziv dobavljača, OIB, datum
   računa, iznos, datum knjiženja, radna jedinica, projekt (+ plaćanje state). This is now THE
   entry form for costs (the old free-form EXPENSES quick-add is gone, per Miro).
6. **PUTNI NALOZI** — separated card; summary (ukupan trošak godine), filter by osoba/jedinica/
   projekt/raspon; columns per spec: broj naloga, ime i prezime, datum putovanja, odredište, svrha,
   ukupan trošak, datum otvaranja, radna jedinica, projekt. Auto order numbers (PUT-YYYY-NNN,
   overtypeable). No "send to sign" anywhere.
7. **NALOZI ZA PLAĆANJE** — own list (broj, primatelj, opis, iznos, datum, jedinica, projekt),
   auto numbers PN-YYYY-NNN.
8. **RADNE JEDINICE** — registry with šifra, naziv, (pod)opis, prihod tekuće godine, rashod tekuće
   godine, preneseno stanje iz prethodne godine, konačno stanje (= preneseno + prihod − rashod;
   prihod = izlazni računi na jedinici, rashod = ulazni računi + putni nalozi). Full add/edit
   (incl. aktivna/neaktivna); delete blocked (409) while any row references the unit.
9. **IZVJEŠTAJI** — group by projekt / radna jedinica / osoba + date range; the by-project cut
   folds in the legacy ledger (labeled) so it reconciles with the tiles; CSV button states exactly
   what it exports (group · year · row count).
10. **FINANCE TOOLS** (trimmed) — All transactions (legacy ledger, lazy-loaded), Stripe payments
    (read-only), Close fiscal year (unchanged double-confirm flow). Reconcile-bank-transfers
    REMOVED per Miro.
11. **Morning-after survey card kept** (not on Miro's remove list; its backend sweep keeps running).

**Removed from Money per spec:** payments-to-chase card, sponsors & donors card, board pack,
reconcile bank transfers, expenses quick-add, send-to-sign. Croatian headings carry small English
subtitles; € everywhere, diacritics intact.

## New tables (v2_ prefix, guarded DDL, shared DB — no migration run by this build)
- `v2_money_book_entries` (direction out|in, invoice_number, party_name, party_oib, invoice_date,
  amount, booking_date, vrsta, settled_date, work_unit_id, project, notes, audit cols)
- `v2_money_travel_orders` (order_number, traveler_name, travel_date, destination, purpose,
  total_cost, opened_date, work_unit_id, project, notes, audit cols)
- `v2_money_payment_orders` (order_number, recipient_name, description, amount, order_date,
  work_unit_id, project, notes, audit cols)
- `v2_money_work_units` (code, name, description, carryover_prev, active, audit cols)
- `v2_money_expected_income` (source, description, amount, expected_date, project, work_unit_id,
  status open|received|cancelled, received_date, notes, audit cols)

## New endpoints (all `auth, adminOnly`, under /api/v2/money/*)
- `GET/POST /book?direction=out|in` + `PUT/DELETE /book/:id` (filters year/project/work_unit/
  from/to/person; returns v2 rows + sums + read-only legacy rows; OIB = 11 digits when present;
  duplicate broj → 409; closed-fiscal-year guard on booking year)
- `GET/POST/PUT/DELETE /travel-orders(/:id)` and `/payment-orders(/:id)` (same filters + person)
- `GET/POST/PUT/DELETE /work-units(/:id)` (GET computes prihod/rashod/konačno for ?year=)
- `GET/POST/PUT/DELETE /expected(/:id)` + `POST /expected/:id/receive`
- `GET /summary?year=` (tiles + recent money in, composition documented in the module header)
- `GET /report?group=project|work_unit|person&year=&from=&to=&project=&work_unit=&person=`
- `GET /export.csv?set=book_out|book_in|travel|payment|units|expected|report` + the same filters —
  always exports the filtered set; UTF-8 BOM, quoted cells, formula-injection guard, Croatian
  headers; `include_legacy=1` folds legacy invoice rows into the book CSVs.

## Verification done
- `node --check` on backend module and on the view (as ESM) — clean; CSS is plain CSS.
- Backend mounted with a stub app: 35 routes register; empty-DB reads return zeroed shapes;
  FIRA-number, OIB and source validations return the right 400s.
- **Full integration test against an in-memory libsql DB** (same wrapper as production, seeded
  legacy tables): work-unit CRUD + duplicate-šifra 409; book add (fisk + nefisk + ulazni) +
  duplicate-broj 409; travel/payment auto-numbering; expected income add → receive flow;
  tile math verified by hand (COLLECTED 4800 → 9800 after MZO received; OWED 8650 → 3650;
  SPENT 1450; gala row already booked via reference is NOT double counted); unit balances
  (preneseno 1000 + prihod 6000 − rashod 1250 = 5750); delete-while-referenced 409; project report
  folds legacy and reconciles; person + date-range filters; CSVs carry diacritics + legacy rows;
  closed-2025 guard blocks writes with the right message.
- Frontend render smoke with a stubbed module graph: 31 checks — all Miro columns present in both
  books/travel/units, FIRA footer, legacy section, CSV button labels, removed cards absent from
  visible text, no `undefined`/`NaN`/`EUR` leaks, deep-link tab + destroy() clean.
- Static wiring check: every `data-act` in markup has a handler; every `data-role` read is rendered.

## Notes / not done (deliberately, or out of my file ownership)
- **Both portals' servers must restart** for the new tables/routes to exist; nothing was deployed
  and no live DB was touched by this build.
- Legacy `finance_invoices` rows are read-only in the books (datum knjiženja shown as — because the
  legacy table has none); they keep being edited in their old tool if ever needed.
- `plexus.js`/`gala.js` still link to `/money` for sponsors/auctions — those cards now live with
  their projects per Miro, so those views' owners should re-point their links (endpoints
  `/api/v2/money/ledger|chase|survey` are alive and unchanged for them).
- ARCHITECTURE.md's route/status table (says Money is a stub) is not mine to edit — it needs a
  one-line refresh by the doc owner.
- `scripts/qa-admin-money-cal.py` exercises the old screen's endpoints — they all still respond,
  but its UI click-path assertions will need updating to the new cards.
- Croatian pluralization uses the house `fmt.plural` (binary) — "21 redaka" instead of "21 redak"
  in CSV button labels; cosmetic.
- Reports by work-unit/person cover the v2 books/orders (legacy rows carry no person and a
  different unit registry); the by-project cut folds legacy in and says so with a chip.
