# medx.hr DNS migration to Cloudflare — Runbook (Path D)

**Goal:** verify `medx.hr` as a Resend sender domain so the portal can email real guests,
by moving DNS hosting from the unknown Vercel account to a Cloudflare account Alen controls.
The domain stays registered at CARNET; the website stays on Squarespace; @medx.hr email stays on Microsoft 365.

**Cost:** $0 (Cloudflare Free plan). **Total active work:** ~25 min. **Wait time:** NS propagation, typically 1–24 h.

---

## Phase 1 — Alen, ~15 min, zero risk (changes nothing live)

1. Log in / sign up at https://dash.cloudflare.com (Free plan).
2. Add site → `medx.hr` → Free. Cloudflare will auto-scan some records — **don't trust the scan**;
   instead: DNS → Records → Import and Export → **Import DNS records** → upload `medx.hr.zone` (this folder).
   Delete any scanned duplicates so the zone matches the file exactly.
3. Fill the two placeholders from the Resend dashboard (harvard team → Domains → medx.hr):
   - `resend._domainkey` TXT → the full `p=MIG...` DKIM value
   - `send` MX → the exact `feedback-smtp.<region>.amazonses.com` hostname Resend shows
4. **Set every record to "DNS only" (grey cloud, proxy OFF).** Proxying Squarespace through
   Cloudflare can break its TLS issuance; that experiment can wait until long after the migration.
5. Note the two nameservers Cloudflare assigns (e.g. `ada.ns.cloudflare.com` / `bob.ns.cloudflare.com`).
   They are shown on the zone Overview page while the zone is "Pending".

**Checkpoint:** zone in Cloudflare has 14 records (3 A, 2 CNAME, 2 MX, 4 TXT, 3 CAA), all grey-cloud, no placeholders left.

## Phase 2 — Miro, ~5 min (the only step that needs him)

Send Miro the prepared message (`miro_poruka.md`, fill in the two Cloudflare nameservers).
He logs into the CARNET .hr domain registry (https://domene.hr — AAI@EduHr or the account that
registered medx.hr for Udruga Med&X) and replaces:

    ns1.vercel-dns.com → <cloudflare NS 1>
    ns2.vercel-dns.com → <cloudflare NS 2>

Nothing breaks at this moment even if the switch is instant, because the Cloudflare zone
already serves identical website/email records.

## Phase 3 — Verification (Claude can run all of this)

1. Wait for Cloudflare to email "medx.hr is now active" (it polls automatically), or check:
   `dig +short NS medx.hr` → should show `*.ns.cloudflare.com`.
2. Smoke-test that nothing regressed:
   ```
   curl -sI https://www.medx.hr | head -5          # expect Squarespace 200
   dig +short MX medx.hr                            # expect outlook.com MX
   dig +short TXT resend._domainkey.medx.hr         # expect the DKIM key
   ```
3. Resend dashboard → Domains → medx.hr → **Verify**. Status should flip to Verified
   (the domain has been waiting there since 2026-04-08).
4. Render: set on BOTH services (user-portal + admin-portal):
   `EMAIL_FROM = Med&X <noreply@medx.hr>` → redeploy.
5. End-to-end test: trigger a portal invite email to a non-Harvard address and confirm delivery + QR.

## Rollback

If anything looks wrong post-switch, Miro sets the NS back to `ns1/ns2.vercel-dns.com`
at CARNET — the Vercel zone still exists untouched and resumes serving immediately.

## Fallback (if Miro can't access CARNET within ~72 h)

Path B: buy `medx.events` on Cloudflare Registrar (~$10/yr), verify it on Resend,
`EMAIL_FROM = Med&X <noreply@medx.events>`. Same-day, no dependencies.

---

### Live-DNS facts this runbook is built on (verified 2026-06-10, dig @1.1.1.1 + @8.8.8.8)

| Record | Value |
|---|---|
| NS | ns1/ns2.vercel-dns.com (the thing we're replacing) |
| A @ | 198.185.159.144, 198.185.159.145, 198.49.23.144 (Squarespace) |
| CNAME www | ext-cust.squarespace.com |
| MX @ | 0 medx-hr.mail.protection.outlook.com |
| TXT @ | v=spf1 include:spf.protection.outlook.com -all |
| CNAME autodiscover | autodiscover.outlook.com |
| CAA @ | 0 issue sectigo.com / letsencrypt.org / pki.goog |
| AAAA, DMARC, M365 DKIM, Intune/Teams records | none exist — nothing else to carry over |

Squarespace's standard apex set is four A records (the above three + 198.49.23.145); the live
zone serves three. The zone file replicates what is live. If Squarespace ever complains in its
domain panel, add the fourth — harmless either way.
