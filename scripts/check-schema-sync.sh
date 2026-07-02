#!/usr/bin/env bash
#
# check-schema-sync.sh — dual-portal schema mirror guard (menu 14).
#
# Both portal backends boot the SAME Turso DB in production, so the shared
# CREATE TABLE definitions live in BOTH server.js files and MUST stay
# byte-identical. Each file wraps that shared region between the markers:
#
#     // ===== SCHEMA-MIRROR:BEGIN ... =====
#     ...shared CREATE TABLE statements...
#     // ===== SCHEMA-MIRROR:END =====
#
# This script extracts that region from both files and diffs it. It exits 1 on
# any drift so CI (and a solo maintainer running it by hand) catches a portal
# that mirrored a new table imperfectly before it reaches production.
#
# Usage: bash scripts/check-schema-sync.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UP="$ROOT/user-portal/backend/server.js"
AD="$ROOT/admin-portal/backend/server.js"

BEGIN='SCHEMA-MIRROR:BEGIN'
END='SCHEMA-MIRROR:END'

for f in "$UP" "$AD"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: expected server file not found: $f"
    exit 1
  fi
done

# Print every line from the BEGIN marker through the END marker, inclusive.
extract() {
  awk -v b="$BEGIN" -v e="$END" '
    index($0, b) { f = 1 }
    f            { print }
    index($0, e) { exit }
  ' "$1"
}

tmp_up="$(mktemp)"
tmp_ad="$(mktemp)"
cleanup() { rm -f "$tmp_up" "$tmp_ad"; }
trap cleanup EXIT

extract "$UP" > "$tmp_up"
extract "$AD" > "$tmp_ad"

# Both blocks must actually exist (guards against a marker being deleted).
for pair in "user-portal:$tmp_up" "admin-portal:$tmp_ad"; do
  name="${pair%%:*}"
  file="${pair#*:}"
  if ! grep -q "$BEGIN" "$file" || ! grep -q "$END" "$file"; then
    echo "ERROR: SCHEMA-MIRROR markers missing from $name/backend/server.js"
    exit 1
  fi
done

if diff -u "$tmp_ad" "$tmp_up" > "$ROOT/scripts/.schema-sync.diff" 2>&1; then
  lines="$(wc -l < "$tmp_up" | tr -d ' ')"
  echo "OK: schema mirror block is byte-identical across both portals (${lines} lines)."
  rm -f "$ROOT/scripts/.schema-sync.diff"
  exit 0
else
  echo "DRIFT: the SCHEMA-MIRROR blocks differ between the two server.js files."
  echo "----- diff (admin vs user) -----"
  cat "$ROOT/scripts/.schema-sync.diff"
  echo "--------------------------------"
  echo "Reconcile both blocks to the additive union and re-run this script."
  rm -f "$ROOT/scripts/.schema-sync.diff"
  exit 1
fi
