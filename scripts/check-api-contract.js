#!/usr/bin/env node
// check-api-contract.js — frontend↔backend API contract guard.
//
// Every '/api/...' path a frontend calls must have a matching Express route on the
// server that serves that frontend. The 2026-07-17 audit found the member Settings
// password form posting to an endpoint that never existed, with the UI faking success;
// this tripwire makes that class of bug fail CI the day it is written.
//
// Surfaces checked:
//   admin-portal/frontend/index.html  -> admin-portal/backend/server.js
//   user-portal/frontend/index.html   -> user-portal/backend/server.js
//   inline client JS inside each server.js's template pages -> that same server
//
// Dynamic segments: `${expr}` in template literals and trailing string
// concatenation both normalize to a wildcard segment. Legitimately dynamic or
// cross-origin paths that cannot be matched statically go in
// scripts/api-contract-allowlist.txt (one path prefix per line, # comments).
//
// Usage: node scripts/check-api-contract.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ALLOWLIST = (() => {
    try {
        return read('scripts/api-contract-allowlist.txt')
            .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    } catch (e) { return []; }
})();

// ---- route extraction ----
function extractRoutes(src) {
    const routes = new Set();
    const re = /app\.(?:get|post|put|delete|patch|all|use)\(\s*['"`](\/api\/[^'"`]*)['"`]/g;
    let m;
    while ((m = re.exec(src))) routes.add(m[1]);
    return [...routes].map(r => r.split('/').filter(Boolean).map(seg => seg.includes(':') || seg === '*' ? ':p' : seg));
}

// ---- call extraction ----
// Captures fetch('/api/..'), fetch(`/api/..${x}`..), App.api('..'), this.api('..'), api('..')
function extractCalls(src, label) {
    const calls = new Map(); // normalized path -> {raw, label, openTail}
    const re = /(?:fetch|\.api|\bapi)\(\s*(['"`])(\/api\/[^'"`]*)\1?/g;
    let m;
    while ((m = re.exec(src))) {
        const raw = m[2];
        let norm = raw.replace(/\$\{[^}]*\}/g, ':p');
        let openTail = false;
        // An interpolation whose expression contains a quote breaks the capture mid-way
        // (`${x ? 'a' : 'b'}`): whatever remains after replacing the complete ones is an
        // unterminated ${ — treat everything from there as a dynamic tail.
        const brokenAt = norm.indexOf('${');
        if (brokenAt !== -1) {
            norm = norm.slice(0, brokenAt);
            openTail = true;
        }
        // Mid-segment dynamics ("board-pack.${fmt}" -> "board-pack.:p") wildcard the segment.
        norm = norm.split('/').map(s => s.includes(':p') ? ':p' : s).join('/');
        // String concatenation continuing the path ("/api/x/" + id) can span any number
        // of further segments -> open tail, prefix-match against routes.
        const after = src.slice(re.lastIndex, re.lastIndex + 12);
        if (/^\s*\+/.test(after) || norm.endsWith('/')) { norm = norm.replace(/\/+$/, ''); openTail = true; }
        norm = norm.split('?')[0];
        if (!norm.startsWith('/api/')) continue;
        if (!calls.has(norm + (openTail ? '/*' : ''))) calls.set(norm + (openTail ? '/*' : ''), { raw, label, norm, openTail });
    }
    return calls;
}

function matches(callSegs, routeSegs, openTail) {
    if (openTail ? routeSegs.length < callSegs.length : callSegs.length !== routeSegs.length) return false;
    for (let i = 0; i < callSegs.length; i++) {
        const c = callSegs[i], r = routeSegs[i];
        if (c === ':p' || r === ':p') continue;
        // An open tail can cut MID-segment ('board-pack.' + fmt): the last captured
        // segment only needs to be a prefix of the route's segment.
        if (openTail && i === callSegs.length - 1 && r.startsWith(c)) continue;
        if (c !== r) return false;
    }
    return true;
}

function checkSurface(name, callSrcs, routeSrc) {
    const routes = extractRoutes(routeSrc);
    const failures = [];
    for (const src of callSrcs) {
        const calls = extractCalls(src.text, src.label);
        for (const [key, info] of calls) {
            if (ALLOWLIST.some(a => info.norm.startsWith(a))) continue;
            const segs = info.norm.split('/').filter(Boolean).map(s => s === ':p' ? ':p' : s);
            // An open tail with no literal tail segments matches too loosely to assert on.
            if (info.openTail && segs.length <= 1) continue;
            if (!routes.some(r => matches(segs, r, info.openTail))) failures.push({ norm: key, ...info });
        }
    }
    return failures;
}

const adminServer = read('admin-portal/backend/server.js');
const userServer = read('user-portal/backend/server.js');

const failures = [
    ...checkSurface('admin', [
        { text: read('admin-portal/frontend/index.html'), label: 'admin SPA' },
        { text: adminServer, label: 'admin server templates' },
    ], adminServer),
    ...checkSurface('user', [
        { text: read('user-portal/frontend/index.html'), label: 'user SPA' },
        { text: userServer, label: 'user server templates' },
    ], userServer),
];

if (failures.length) {
    console.error('CONTRACT DRIFT: frontend calls with no matching backend route:\n');
    for (const f of failures) console.error(`  [${f.label}] ${f.norm}    (raw: ${f.raw})`);
    console.error('\nEither add the missing route, fix the call, or (only if genuinely dynamic/');
    console.error('cross-origin) add a prefix to scripts/api-contract-allowlist.txt.');
    process.exit(1);
}
console.log('OK: every frontend /api call has a matching backend route.');
