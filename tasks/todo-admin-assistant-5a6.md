# Admin Assistant deterministic core upgrade (queue 5a6, NO-KEY half)

## Scope: admin-portal/ ONLY. No schema changes (KB is static in code, data is read-only).

- [ ] Backend: KB corpus (12 handbook + 4 runbook + 3 feature articles) with keywords + deep-link targets
- [ ] Backend: assistDataMatch() — grounded live-data intents (seats left, campaign status, counts, revenue)
- [ ] Backend: assistKbMatch() — how-to + can-I-build retrieval, scored, threshold-gated
- [ ] Backend: assistNotSupported() — can-build NO answers with real alternatives (SMS, social, auto-charge, wipe, website)
- [ ] Backend: wire into assistDeterministicAnswer (order: precise draft/contact -> data -> kb -> null)
- [ ] Backend: make howto/canbuild/data PRECISE (grounded, both modes); notice stays no-key
- [ ] Backend: no-key branch -> action-shaped = clean gate card; else graceful handbook fallback; return deepLink
- [ ] Frontend: capture deepLink + gated on assistant history; render Open-X button + gate card treatment
- [ ] Frontend: assistDeepLink(target) resolver map; assistAsk(chip) example prompts; richer empty state
- [ ] Frontend: CSS .assist-chip / .assist-deeplink
- [ ] VERIFY: node --check both; check-schema-sync exit 0; launch :3002 PORT explicit no-key; 10-Q matrix desktop+mobile, 0 console errors
- [ ] CAMPAIGN_LOG dated section; clean test junk
