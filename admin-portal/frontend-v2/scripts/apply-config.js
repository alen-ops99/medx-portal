#!/usr/bin/env node
// scripts/apply-config.js <staging|production> [--host https://x.onrender.com]
// Stamps config.<env>.js into index.html's MEDX_CONFIG block (idempotent) and, with --host,
// rewrites the backend host in config.staging.js + netlify/_redirects. Run from anywhere.
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.resolve(__dirname, '..');
const env = process.argv[2];
if (!['staging', 'production'].includes(env)) { console.error('usage: node scripts/apply-config.js <staging|production> [--host https://…]'); process.exit(2); }
const hostIdx = process.argv.indexOf('--host');
if (hostIdx > 0 && process.argv[hostIdx + 1]) {
  const host = process.argv[hostIdx + 1].replace(/\/+$/, '');
  for (const f of ['config.staging.js', path.join('netlify', '_redirects')]) {
    const p = path.join(dir, f); const s = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, s.replace(/https:\/\/[a-z0-9.-]+\.onrender\.com/g, host));
    console.log('apply-config: ' + f + ' → ' + host);
  }
}
const cfgFile = path.join(dir, 'config.' + env + '.js');
const block = fs.readFileSync(cfgFile, 'utf8').trim();
if (!/MEDX_CONFIG:start/.test(block) || !/MEDX_CONFIG:end/.test(block)) { console.error('apply-config: ' + cfgFile + ' lacks the MEDX_CONFIG markers'); process.exit(1); }
const idx = path.join(dir, 'index.html');
const html = fs.readFileSync(idx, 'utf8');
const re = /\/\* MEDX_CONFIG:start \*\/[\s\S]*?\/\* MEDX_CONFIG:end \*\//;
if (!re.test(html)) { console.error('apply-config: index.html has no MEDX_CONFIG block'); process.exit(1); }
const out = html.replace(re, block);
if (out !== html) { fs.writeFileSync(idx, out); console.log('apply-config: index.html → ' + env); } else console.log('apply-config: index.html already ' + env);
