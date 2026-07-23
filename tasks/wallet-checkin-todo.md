# Google Wallet + unified per-event QR check-in — build plan

Branch: wallet-checkin (worktree medx-portal-wallet). Do NOT merge.

## Verified reality (from 5-agent audit)
- No `events` table; each event family = own reg table. `registrations` (conference) is the anchor pass. One reg = one event (except croatians_abroad).
- `ticket_qr_code` = variable value derived from the reg UUID PK (path / dataURL / MEDX:id / NULL). NOT a secure standalone credential, and the UUID is exposed publicly at `/qr/:id.png`. → add dedicated crypto `checkin_token`.
- Check-in = `checked_in` columns per table, via FROZEN `POST /api/admin/checkin/verify`. Scanner = EventCheckin modal (already has an event selector) + Global QR FAB. html5-qrcode/jsQR vendored.
- Wallet: user-portal has RS256 `savetowallet` JWT (genericObjects) gated on env. No REST class/object mgmt. `jsonwebtoken`, `qrcode`, `uuid`, `libsql` already deps. Node 26 (global fetch).
- No transactions in codebase; atomic primitive = `getRowsModified()` after a conditional write (promo-claim pattern).
- Mirror block: admin 3900-4426 / user 9012-9538. registrations+conferences are OUTSIDE it. Admin-only tables go after END.
- Tests: boot both servers `NODE_ENV=test` + `DATABASE_PATH` scratch + `JWT_SECRET`; seeded admin `juginovic.alen@gmail.com`/`admin123`. CI gates: check-schema-sync.sh, check-api-contract.js, boot probes.

## Design
- `checkin_token` on `registrations` (crypto 48-hex). Same token → Google Wallet barcode.value, printed/email/Apple all resolve to it. Backfilled.
- `wallet_class_id` on `conferences`. Plexus 2026 maps to the approved class id; new confs auto-mint `<ISSUER>.<slug>`.
- New admin-only tables (after END): `checkin_events` (gates w/ dates), `event_checkins` (UNIQUE(reg,event), atomic), `checkin_scans` (audit).
- `shared/wallet.js` passProviders module: google implemented (OAuth SA JWT-bearer → walletobjects REST get-or-create class/object, PATCH state, savetowallet link, pure field/JWT builders); apple = documented stub reading the SAME record.
- Extend EventCheckin scanner modal → new `POST /api/admin/checkin/ticket` (atomic per-event, audit, rich states) + manual lookup. Legacy verifier untouched.

## Tasks
1. [ ] shared/wallet.js
2. [ ] admin: schema (ALTERs + 3 tables + seed + backfill), require wallet, helpers
3. [ ] admin: endpoints (events, ticket check-in, lookup, revoke, audit) + conference-create class hook
4. [ ] admin frontend: extend EventCheckin modal (selector default-by-date, rich result, manual lookup)
5. [ ] user: mirror ALTERs, upgrade google ticket endpoint → EventTicketObject + REST, ensure token, eager provision hook
6. [ ] tests: wallet-checkin.test.js (all scan states, concurrency, manual, multi-event, audit, JWT shape) + api-allowlist if needed
7. [ ] gates: node --check both, schema-sync, api-contract, boot smoke, Playwright scanner screenshots
8. [ ] commit + PR (no merge)
