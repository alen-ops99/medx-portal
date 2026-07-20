# Per-event pricing + links + Stripe — commit delivery (2026-06-11)

The work is **committed as `bcf509e`** on top of `f458ae7` (current `origin/main`).
It could not be committed into the working repo directly because this MedX folder's
local `.git` is iCloud-evicted (dataless loose objects + refs that hang on read, and
iCloud download isn't materializing them in this environment). The files in the working
tree are already edited and verified; only the git commit had to be made elsewhere.

Three artifacts here, all containing the same single commit `bcf509e`:

| File | Use |
|------|-----|
| `pricing-build-bcf509e.patch` | `git am` it — preserves your local `feature` / `payment-hardening` branches |
| `medx-main-with-pricing.bundle` | self-contained full `main` (f458ae7 + bcf509e); clone/fetch from it |
| `pricing-build.diff` | plain unified diff, for reading only |

## Option A — apply the patch (recommended; keeps your local branches)
Once your iCloud `.git` is healthy again (Finder may need to re-download it):
```
cd ~/Documents/Claude_Code_Projects/MedX
git checkout main
git am _PRICING_BUILD_2026-06-11/pricing-build-bcf509e.patch
```
If `git am` complains the tree is dirty (the working files are already edited), reset the
four files first, then apply:
```
git checkout -- user-portal/backend/server.js admin-portal/backend/server.js \
                user-portal/frontend/index.html admin-portal/frontend/index.html
git am _PRICING_BUILD_2026-06-11/pricing-build-bcf509e.patch
```

## Option B — fetch from the bundle
```
cd ~/Documents/Claude_Code_Projects/MedX
git fetch _PRICING_BUILD_2026-06-11/medx-main-with-pricing.bundle main:pricing-build
git log --oneline pricing-build -1   # should show bcf509e
git merge --ff-only pricing-build    # if your main is at f458ae7
```

## Option C — fresh clone (if the local repo stays broken)
A full healthy clone with the commit already on `main` is at `/tmp/medx-fresh`
(ephemeral — copy it somewhere durable before relying on it).

## Then deploy
Push `main` when ready — Render auto-deploys the push. No new env vars are required
(`STRIPE_*` already wired). After deploy, set a price on a Building Bridges event in the
admin portal and test the registration link end-to-end.

## What's in bcf509e
Four files: `user-portal/backend/server.js`, `admin-portal/backend/server.js`,
`user-portal/frontend/index.html`, `admin-portal/frontend/index.html`.
Full summary in the commit message. Verified locally (both portals boot clean; paid/free
gates, Stripe pricing, Plexus regression, activate guard, and ticket-price editing all
tested green) and passed a 5-lens adversarial review with all confirmed findings fixed.
