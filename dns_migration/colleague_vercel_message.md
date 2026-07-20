# Message for the colleague with Vercel access to medx.hr

> Could you add the following DNS records to **medx.hr** in Vercel?
> (Vercel dashboard → the team that owns medx.hr → **Domains → medx.hr → DNS Records**.)
> These let our email service (Resend) send the Plexus event emails from @medx.hr.
>
> **IMPORTANT: please only ADD these records — do not edit or delete anything that's
> already there.** The website (Squarespace) and our @medx.hr inboxes (Microsoft 365)
> rely on the existing records. All four below are on new names, so they won't conflict.

| Type | Name (Vercel "Name" field) | Value | Priority |
|------|------|-------|----------|
| MX  | `send`               | `feedback-smtp.eu-west-1.amazonses.com` | 10 |
| TXT | `send`               | `v=spf1 include:amazonses.com ~all` | — |
| TXT | `resend._domainkey`  | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCqCtlRwGDwdA5K5KZhVlPUgF1D+Kz4iZjV1rkJEnPHHZpvWB1ByS4QRZcAHpooNIj0n0705JaaJdVWT/KCVf4cWnZQ0pl97GCyo41GNbk2DAnnRDLMGPieCNo1g9t5rl/WXZPDa2/cJii8rWpDYXRrgEi7VFS1J4a3dQVAHnOoLQIDAQAB` | — |
| TXT | `_dmarc`             | `v=DMARC1; p=none;` (optional) | — |

> Notes:
> - In Vercel's **Name** field, enter only the prefix (`send`, `resend._domainkey`, `_dmarc`).
>   Vercel appends `.medx.hr` for you. Don't type the full domain.
> - Leave TTL at the default.
> - The root MX (Outlook) and root SPF stay as-is — these new mail records live on the
>   `send.medx.hr` subdomain, so there's no clash with our Microsoft 365 email.
>
> Let me know once they're saved and I'll verify on our side. Thank you!

---

## Alen's follow-up after records are live
1. Resend ("harvard" team, medx.hr already pending) → Domains → medx.hr → **Verify**.
2. When Verified: set `EMAIL_FROM = Med&X <noreply@medx.hr>` on BOTH Render services
   (medx-user-portal + medx-admin-portal), redeploy.
3. Send a test invite to a NON-Harvard email to confirm real delivery.
4. Optional: ask the colleague to add you to the Vercel team for future DNS control.

## Why this replaces the Cloudflare migration (Path D)
Path D (recreate the zone at Cloudflare + Miro swaps nameservers at CARNET) was only
needed because the Vercel account owner was unknown. With a colleague who has Vercel
access, the records go straight into the live DNS — no migration, no nameserver swap,
no multi-day Miro dependency. Source values from the prepared zone file (region eu-west-1,
DKIM pulled from the Resend dashboard 2026-06-10).
