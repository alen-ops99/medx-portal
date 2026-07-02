#!/usr/bin/env bash
# stamp-sw.sh — cache-bust the service workers on every deploy.
#
# Appends the current git short SHA to each service worker's CACHE_NAME so a new
# deploy always invalidates the old app-shell cache and returning visitors get
# the fresh shell (network-first already handles the SPA doc, but the precached
# shell + static assets otherwise live under one stable cache name across builds).
#
# It PRESERVES the existing "<base>-v<N>" prefix and only appends "-<sha>":
#   medx-portal-v7   -> medx-portal-v7-a1b2c3d
#   medx-staff-v2    -> medx-staff-v2-a1b2c3d
# This keeps the prod smoke test's /medx-portal-v\d+/ assertion passing, and is
# idempotent — re-running strips any prior "-<sha>" before appending.
#
# BUILD-SAFE: it NEVER fails the build. If it can't resolve a SHA or find a
# file, it warns and exits 0. Rewrites go through a temp file + non-empty check
# (never an in-place edit) so a file can't be truncated to zero.
#
# Called from render.yaml build for each portal service. Safe to run locally to
# preview the change — then `git checkout` the sw.js files to revert.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Prefer Render's build-time commit env, then git, then a timestamp fallback.
SHA="${RENDER_GIT_COMMIT:-}"
if [ -z "${SHA}" ]; then
  SHA="$(git -C "${ROOT}" rev-parse --short HEAD 2>/dev/null || true)"
fi
if [ -z "${SHA}" ]; then
  SHA="$(date -u +%Y%m%d%H%M%S)"
fi
SHORT="$(printf '%s' "${SHA}" | tr -cd 'a-zA-Z0-9' | cut -c1-7)"
if [ -z "${SHORT}" ]; then
  echo "stamp-sw: WARN could not resolve a version tag, leaving service workers unchanged"
  exit 0
fi

stamp_one() {
  sw="$1"
  if [ ! -f "${sw}" ]; then
    echo "stamp-sw: skip (not found) ${sw}"
    return 0
  fi

  current="$(grep -oE "const CACHE_NAME = ['\"][^'\"]+['\"]" "${sw}" | head -1 \
            | sed -E "s/.*['\"]([^'\"]+)['\"].*/\1/")"
  if [ -z "${current}" ]; then
    echo "stamp-sw: WARN no CACHE_NAME line in ${sw}, left unchanged"
    return 0
  fi

  # Stable base = everything up to and including the "-v<digits>" version.
  # Drops any previously-appended "-<sha>" so this is idempotent.
  base="$(printf '%s' "${current}" | sed -E 's/(-v[0-9]+).*/\1/')"
  new="${base}-${SHORT}"

  if [ "${new}" = "${current}" ]; then
    echo "stamp-sw: ${sw} already at CACHE_NAME='${current}'"
    return 0
  fi

  tmp="$(mktemp)"
  sed -E "s|(const CACHE_NAME = ')[^']*(')|\1${new}\2|; s|(const CACHE_NAME = \")[^\"]*(\")|\1${new}\2|" \
    "${sw}" > "${tmp}"

  # Guard: never overwrite with an empty/short result.
  if [ -s "${tmp}" ] && grep -q "const CACHE_NAME = ['\"]${new}['\"]" "${tmp}"; then
    mv "${tmp}" "${sw}"
    echo "stamp-sw: ${sw} -> CACHE_NAME='${new}'"
  else
    rm -f "${tmp}"
    echo "stamp-sw: WARN rewrite verification failed for ${sw}, left unchanged"
  fi
}

stamp_one "${ROOT}/user-portal/frontend/sw.js"
stamp_one "${ROOT}/admin-portal/frontend/sw.js"

exit 0
