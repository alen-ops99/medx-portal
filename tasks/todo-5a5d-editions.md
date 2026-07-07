# 5a5d — Event Edition Cycling (admin-portal)

Design: `event_editions` = registry/history overlay over existing event tables. The
ACTIVE edition's live config STAYS in conferences / plexus_page_settings / ticket_types /
sessions / speakers (never forked). Archive = state change (snapshot + flag), never delete.
Carry-over = new active conference (member portal reads it automatically via getActiveConference
year DESC) + optional cloned pricing/program/sponsors + fresh reset of speakers/registrations.

## Build
- [ ] Schema: event_editions table + indexes (admin server, OUTSIDE mirror, after auction idx)
- [ ] Helpers: ensureEditionsSeeded, snapshot, archive-preview, carryover-preview builders
- [ ] Routes: GET /editions, GET /editions/:id, archive-preview, archive, carryover-preview, carryover
- [ ] Frontend: nav + section + sectionNames + showSection hook + EditionsAdmin module
- [ ] node --check + check-schema-sync exit 0

## Verify E2E (curl + browser, admin :3002, shared dev DB)
- [ ] Seed test user/conference(2035)/ticket_type/registration(paid)/certificate
- [ ] verify ticket via /api/admin/checkin/verify (conference, mark=false) -> response A
- [ ] archive-preview matches; archive edition; verify again -> response B; assert A===B byte-identical
- [ ] cert + purchase fields intact after archive
- [ ] carryover-preview matches; carryover -> new conference(2036) active + new edition
- [ ] user portal /api/conferences/active + /api/public/site show new edition (2036)
- [ ] export old conference regs -> test reg present
- [ ] GET /editions returns both; /year-calendar/events returns both conferences
- [ ] browser: Editions section desktop 1440x900 + mobile 390x844, 0 console errors
- [ ] CLEANUP: delete test confs/editions/regs/tickets/sessions/certs; restore plexus_page_settings; keep seeded real editions
