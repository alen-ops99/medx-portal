# MedX Portal

Event registration portal for Plexus Conference with Stripe payments and FIRA invoicing.

## Stack
- Node.js + Express backend
- Stripe for payments, FIRA for Croatian invoicing
- Deployed on Render (free tier)

## Key URLs
- Live: https://medx-user-portal.onrender.com
- GitHub: github.com/alen-ops99/medx-portal
- FIRA dashboard: https://app.fira.finance

## Quick Reference
- See `@memory/payment-integrations.md` for full FIRA field names, Stripe webhook setup, and discount pipeline
- Dual server.js pattern — check both files for schema changes
- Render env vars hold FIRA API key and Stripe secrets
