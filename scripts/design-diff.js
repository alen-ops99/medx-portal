#!/usr/bin/env node
/**
 * scripts/design-diff.js — what changed between two Claude Design exports?
 *
 *   node scripts/design-diff.js <old-export-dir> <new-export-dir> [--out report.md]
 *
 * Example (member portal, weekend revision):
 *   node scripts/design-diff.js design/handoff/member-portal-2026-08-28 ~/Downloads/uploads/export/medx-member-portal-final --out design/handoff/DIFF-member-$(date +%F).md
 *
 * For every *.dc.html / *.md / *.css file in either folder it reports: added / removed /
 * unchanged / CHANGED, and for changed artboards a readable list of (a) text that was
 * removed or added (labels, copy, prices, dates), (b) changed data-props defaults,
 * (c) style-only edits (count), (d) a compact unified diff of the pretty-printed markup,
 * grouped under the artboard's own section eyebrows so a block can be found in the v2
 * view by its `<!-- dc: <file> › "<section>" -->` marker.
 * No dependencies; uses `git diff --no-index` for the hunks.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const dirs = args.filter((a, i) => a !== '--out' && i !== outIdx + 1);
if (dirs.length !== 2) {
    console.error('usage: node scripts/design-diff.js <old-export-dir> <new-export-dir> [--out report.md]');
    process.exit(2);
}
const [OLD, NEW] = dirs.map(d => path.resolve(d.replace(/^~/, os.homedir())));

const listFiles = dir => fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => /\.(dc\.html|md|css)$/i.test(f) && f !== 'index.html').sort()
    : [];

const decode = s => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");

// Pretty-print: one tag or text run per line, whitespace collapsed → stable line diffs.
function pretty(html) {
    return html
        .replace(/>\s*</g, '>\n<')
        .replace(/(<[^>]+>)([^<\n]+)/g, '$1\n$2')
        .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}
const textRuns = html => new Set(
    pretty(html).split('\n').filter(l => !l.startsWith('<')).map(decode).map(t => t.trim()).filter(t => t.length > 1 && !/^\{\{.*\}\}$/.test(t))
);
function props(html) {
    const m = html.match(/data-props="([^"]*)"/);
    if (!m) return {};
    try { return JSON.parse(decode(m[1])); } catch (e) { return { _unparsed: m[1].slice(0, 200) }; }
}
const styleCount = html => (html.match(/style="/g) || []).length;
// Section eyebrows the design uses ("01 · THE PROGRAM", data-screen-label, section headings)
const sections = html => Array.from(new Set(
    Array.from(html.matchAll(/(?:data-screen-label="([^"]+)"|>(\d{2} · [A-Z0-9 &'’\-]+)<|<h[1-3][^>]*>([^<]{3,60})<)/g))
        .map(m => decode(m[1] || m[2] || m[3]).trim())
));

function unified(aText, bText, label) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcdiff-'));
    const a = path.join(tmp, 'old'), b = path.join(tmp, 'new');
    fs.writeFileSync(a, aText); fs.writeFileSync(b, bText);
    let out = '';
    try {
        execFileSync('git', ['diff', '--no-index', '--no-color', '-U2', '--', a, b], { encoding: 'utf8' });
    } catch (e) { out = e.stdout || ''; } // git exits 1 when files differ
    fs.rmSync(tmp, { recursive: true, force: true });
    return out.split('\n').slice(4).join('\n').replace(/^(---|\+\+\+) .*$/gm, '').trim();
}

const oldFiles = listFiles(OLD), newFiles = listFiles(NEW);
const all = Array.from(new Set([...oldFiles, ...newFiles])).sort();
const report = [];
const summary = { added: [], removed: [], changed: [], unchanged: [] };
report.push(`# Design diff — ${path.basename(OLD)} → ${path.basename(NEW)}`, '', `Generated ${new Date().toISOString()} by scripts/design-diff.js`, '');

for (const f of all) {
    const o = oldFiles.includes(f) ? fs.readFileSync(path.join(OLD, f), 'utf8') : null;
    const n = newFiles.includes(f) ? fs.readFileSync(path.join(NEW, f), 'utf8') : null;
    if (o === null) { summary.added.push(f); report.push(`## ➕ ADDED: ${f}`, '', `New screen/file (${(n.length / 1024).toFixed(1)} KB). Sections: ${sections(n).join(' · ') || '—'}`, ''); continue; }
    if (n === null) { summary.removed.push(f); report.push(`## ➖ REMOVED: ${f}`, ''); continue; }
    if (o === n) { summary.unchanged.push(f); continue; }
    summary.changed.push(f);
    report.push(`## ✏️ CHANGED: ${f}`, '');
    if (/\.dc\.html$/i.test(f)) {
        const to = textRuns(o), tn = textRuns(n);
        const removed = [...to].filter(t => !tn.has(t)), added = [...tn].filter(t => !to.has(t));
        const po = props(o), pn = props(n);
        const propKeys = Array.from(new Set([...Object.keys(po), ...Object.keys(pn)]));
        const propChanges = propKeys.filter(k => JSON.stringify(po[k]) !== JSON.stringify(pn[k]));
        const so = sections(o), sn = sections(n);
        report.push(`- Sections: ${sn.join(' · ') || '—'}`);
        const secAdded = sn.filter(s => !so.includes(s)), secRemoved = so.filter(s => !sn.includes(s));
        if (secAdded.length) report.push(`- Sections added: ${secAdded.join(' · ')}`);
        if (secRemoved.length) report.push(`- Sections removed: ${secRemoved.join(' · ')}`);
        report.push(`- Text removed (${removed.length}):${removed.length ? '' : ' —'}`);
        removed.slice(0, 80).forEach(t => report.push(`    - ~~${t.slice(0, 160)}~~`));
        report.push(`- Text added (${added.length}):${added.length ? '' : ' —'}`);
        added.slice(0, 80).forEach(t => report.push(`    - **${t.slice(0, 160)}**`));
        if (propChanges.length) {
            report.push(`- data-props changed: ${propChanges.map(k => `${k}: ${JSON.stringify(po[k] && po[k].default)} → ${JSON.stringify(pn[k] && pn[k].default)}`).join('; ')}`);
        }
        report.push(`- Inline style attributes: ${styleCount(o)} → ${styleCount(n)}${removed.length + added.length === 0 ? ' (style/markup-only change)' : ''}`);
        const diff = unified(pretty(o), pretty(n), f);
        const lines = diff.split('\n');
        report.push('', `<details><summary>Markup diff (${lines.length} lines, pretty-printed)</summary>`, '', '```diff', lines.slice(0, 600).join('\n'), lines.length > 600 ? `… (${lines.length - 600} more lines — run git diff on the pretty-printed files for the rest)` : '', '```', '</details>', '');
    } else {
        const diff = unified(o, n, f);
        report.push('```diff', diff.split('\n').slice(0, 300).join('\n'), '```', '');
    }
}

report.splice(4, 0,
    `| | count | files |`, `|---|---|---|`,
    `| ✏️ changed | ${summary.changed.length} | ${summary.changed.join(', ') || '—'} |`,
    `| ➕ added | ${summary.added.length} | ${summary.added.join(', ') || '—'} |`,
    `| ➖ removed | ${summary.removed.length} | ${summary.removed.join(', ') || '—'} |`,
    `| = unchanged | ${summary.unchanged.length} | ${summary.unchanged.join(', ') || '—'} |`, '',
    `Next step: for each CHANGED artboard open the matching v2 view (see user-portal/frontend-v2/ARCHITECTURE.md "Artboard → view module") and patch the blocks whose \`<!-- dc: … › "section" -->\` marker matches the sections listed.`, '');

const text = report.join('\n');
if (outFile) { fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true }); fs.writeFileSync(outFile, text); console.log(`wrote ${outFile}`); }
console.log(`changed ${summary.changed.length}, added ${summary.added.length}, removed ${summary.removed.length}, unchanged ${summary.unchanged.length}`);
if (!outFile) console.log(text);
