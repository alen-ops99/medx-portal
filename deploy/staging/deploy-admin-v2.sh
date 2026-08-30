#!/usr/bin/env bash
# deploy/staging/deploy-v2.sh — publish user-portal/frontend-v2 to the Netlify REVIEW site.
#
#   bash deploy/staging/deploy-v2.sh            # deploy to medx-admin-portal-v2.netlify.app
#   SITE_ID=<other netlify site id> bash deploy/staging/deploy-v2.sh
#
# What it does: copies frontend-v2 to a temp dir, selects config.staging.js as config.js,
# points _redirects proxies at the staging backend host, stamps sw.js CACHE_NAME with the git
# SHA (same convention as scripts/stamp-sw.sh), zips, uploads through the Netlify API, waits
# until the deploy is "ready", then smoke-checks /, /app/home and one proxied path.
# Never touches Render, main, or medx.hr.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${ROOT}/admin-portal/frontend-v2"
SITE_ID="${SITE_ID:-c7347e47-4f78-47a4-bd95-4f1cf72ecf93}"          # medx-admin-portal-v2
BACKEND_HOST="${BACKEND_HOST:-medx-staging.onrender.com}"
NT="$(python3 -c "import json;d=json.load(open('$HOME/Library/Preferences/netlify/config.json'));u=d['users'];print(u[list(u)[0]]['auth']['token'])")"
SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M)"

[ -d "$SRC" ] || { echo "missing $SRC"; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
rsync -a --exclude '_qa' --exclude 'node_modules' --exclude '.DS_Store' "$SRC/" "$TMP/site/"
cd "$TMP/site"

# netlify redirects live under netlify/ in the admin scaffold
if [ -f netlify/_redirects ] && [ ! -f _redirects ]; then cp netlify/_redirects _redirects; fi
# config: staging variant becomes the live config.js
if [ -f config.staging.js ]; then cp config.staging.js config.js; fi
# proxies: whatever placeholder host the files carry → the staging backend
grep -rl 'medx-staging.onrender.com\|BACKEND_HOST_PLACEHOLDER' _redirects netlify.toml config.js 2>/dev/null | while read -r f; do
  sed -i '' -e "s#BACKEND_HOST_PLACEHOLDER#${BACKEND_HOST}#g" -e "s#medx-staging\.onrender\.com#${BACKEND_HOST}#g" "$f"
done
# service worker cache stamp (keeps the "<base>-vN" prefix, appends the SHA)
if [ -f sw.js ] && grep -qE "const CACHE_NAME = '[^']+'" sw.js; then
  base="$(grep -oE "const CACHE_NAME = '[^']+'" sw.js | sed -E "s/.*'([^']+)'.*/\1/" | sed -E 's/(-v[0-9]+).*/\1/')"
  sed -i '' -E "s|const CACHE_NAME = '[^']+'|const CACHE_NAME = '${base}-${SHA}'|" sw.js
fi
echo "<!-- build ${SHA} $(date -u +%FT%TZ) staging backend ${BACKEND_HOST} -->" >> index.html

zip -qr ../site.zip .
echo "uploading $(du -h ../site.zip | cut -f1) to Netlify site ${SITE_ID} (build ${SHA})…"
DEP="$(curl -s -X POST -H "Authorization: Bearer ${NT}" -H "Content-Type: application/zip" --data-binary @../site.zip "https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys")"
DEP_ID="$(echo "$DEP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
URL="$(echo "$DEP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["ssl_url"])')"
for i in $(seq 1 40); do
  ST="$(curl -s -H "Authorization: Bearer ${NT}" "https://api.netlify.com/api/v1/deploys/${DEP_ID}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["state"])')"
  [ "$ST" = "ready" ] && break; [ "$ST" = "error" ] && { echo "deploy error"; exit 1; }; sleep 3
done
echo "deploy ${DEP_ID}: ${ST} → ${URL}"
for p in / /today /api/auth/me /api/v2/_status; do
  printf '  %-22s %s\n' "$p" "$(curl -s -o /dev/null -m 60 -w '%{http_code}' "${URL}${p}")"
done
