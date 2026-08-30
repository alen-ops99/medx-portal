/**
 * v2/studio.js — server pieces for the STUDIO destination (Admin Studio.dc.html). Most of the
 * Studio rides on EXISTING routes untouched (print suite /api/admin/print/*, team files
 * /api/admin/files*, cards roster /api/admin/cards/*); this module adds only what the redesigned
 * screen needs and nothing else. Mounted by v2/index.js.
 *
 *   GET  /api/v2/studio/attendance-cards        recent member attendance/share cards — reads the
 *        member portal's v2_attendance_cards table (ONE shared DB); images are served by the
 *        MEMBER origin at /api/v2/attendance-cards/:id/image (the frontend prefixes memberBase).
 *   GET  /api/v2/studio/certificates/summary    issued-certificate counts + the latest few rows.
 *   POST /api/v2/studio/certificates/preview    { name?, type?, event? } → { html } — a brand-true
 *        A4-landscape certificate the drawer shows in an iframe and prints; picks a real
 *        checked-in attendee when no name is given so the preview is never lorem.
 */
'use strict';

module.exports = function mountStudio(app, ctx) {
    const { db, auth, adminOnly, log } = ctx;

    const q = {
        get(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const r = s.step() ? s.getAsObject() : null; s.free(); return r; },
        all(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; }
    };
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ---- recent member share cards (make-and-store row for "Social cards") ----
    app.get('/api/v2/studio/attendance-cards', auth, adminOnly, (req, res) => {
        try {
            const rows = q.all(`SELECT id, kind, event_name, email_to, generated_at, emailed_at
                                FROM v2_attendance_cards ORDER BY generated_at DESC, created_at DESC LIMIT 12`);
            res.json({
                cards: rows.map(r => ({
                    id: r.id, kind: r.kind, event_name: r.event_name, email_to: r.email_to,
                    generated_at: r.generated_at, emailed_at: r.emailed_at,
                    image_path: `/api/v2/attendance-cards/${r.id}/image`   // MEMBER-origin path; client prefixes memberBase
                }))
            });
        } catch (e) {
            // the member portal owns this table — before its first boot it may not exist yet
            res.json({ cards: [], note: 'No cards yet — the member portal generates them on registration.' });
        }
    });

    // ---- certificates ----
    app.get('/api/v2/studio/certificates/summary', auth, adminOnly, (req, res) => {
        try {
            const byType = q.all('SELECT certificate_type AS type, COUNT(*) AS n FROM certificates GROUP BY certificate_type ORDER BY n DESC');
            const recent = q.all('SELECT recipient_name, certificate_type, certificate_number, conference_name, issue_date FROM certificates ORDER BY issue_date DESC LIMIT 5');
            const total = byType.reduce((n, r) => n + (Number(r.n) || 0), 0);
            res.json({ total, by_type: byType, recent });
        } catch (e) { res.json({ total: 0, by_type: [], recent: [] }); }
    });

    app.post('/api/v2/studio/certificates/preview', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const type = ['attendance', 'speaker', 'cme'].includes(String(b.type)) ? String(b.type) : 'attendance';
            let name = String(b.name || '').trim().slice(0, 90);
            let eventName = String(b.event_name || '').trim().slice(0, 120);
            if (!eventName) {
                try { const c = q.get('SELECT name FROM conferences WHERE is_active = 1 ORDER BY year DESC LIMIT 1'); eventName = (c && c.name) || 'Plexus Conference 2026'; } catch (e) { eventName = 'Plexus Conference 2026'; }
            }
            if (!name) {
                // prefer a real checked-in attendee; else a real issued certificate's recipient; else the sample
                try { const r = q.get("SELECT first_name, last_name FROM registrations WHERE checked_in = 1 AND COALESCE(first_name,'') != '' LIMIT 1"); if (r) name = `${r.first_name || ''} ${r.last_name || ''}`.trim(); } catch (e) {}
                if (!name) { try { const c = q.get("SELECT recipient_name FROM certificates WHERE COALESCE(recipient_name,'') != '' ORDER BY issue_date DESC LIMIT 1"); if (c) name = c.recipient_name; } catch (e) {} }
                if (!name) name = 'Ime i prezime';
            }
            const number = 'PLX26-CERT-PREVIEW';
            const title = type === 'speaker' ? 'Certificate of Appreciation' : type === 'cme' ? 'Certificate of Attendance · CME' : 'Certificate of Attendance';
            const line = type === 'speaker'
                ? `for speaking at ${esc(eventName)} and sharing knowledge with the Med&amp;X community`
                : `for attending ${esc(eventName)} in Zagreb, Croatia`;
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400..700&display=swap" rel="stylesheet">
<style>@page{size:A4 landscape;margin:0}body{margin:0;background:#f7f1e6;color:#191512;font-family:Inter,sans-serif}
.sheet{width:297mm;height:210mm;box-sizing:border-box;padding:16mm;display:flex}
.frame{flex:1;border:1px solid rgba(25,21,18,.35);outline:1px solid rgba(25,21,18,.16);outline-offset:-5mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:14mm;gap:7mm;background:#fdfaf3}
.micro{font:600 10px Inter,sans-serif;letter-spacing:.3em;color:#9b1b22}
.rule{width:34mm;height:2px;background:linear-gradient(90deg,#9b1b22 50%,#c9a962 50%)}
h1{font-family:Fraunces,serif;font-weight:400;font-size:34px;margin:0}
.name{font-family:Fraunces,serif;font-style:italic;font-size:52px;line-height:1.05;margin:0}
.line{font-size:14px;color:#4a4239;max-width:150mm;line-height:1.6}
.foot{display:flex;gap:24mm;align-items:flex-end;margin-top:6mm}
.sig{display:flex;flex-direction:column;gap:2mm;align-items:center}
.sig .bar{width:52mm;border-top:1px solid rgba(25,21,18,.4)}
.sig span{font:600 8.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459}
.no{font:500 9px ui-monospace,monospace;color:#9a9086;letter-spacing:.08em}</style></head>
<body><div class="sheet"><div class="frame">
<span class="micro">MED&amp;X · ZAGREB</span>
<h1>${esc(title)}</h1><span class="rule"></span>
<p class="name">${esc(name)}</p>
<p class="line">${line}. Awarded with the appreciation of the Med&amp;X organising team.</p>
<div class="foot">
  <div class="sig"><span class="bar"></span><span>ALEN JUGINOVIĆ, MD · PRESIDENT</span></div>
  <div class="sig"><span class="bar"></span><span>MED&amp;X ORGANISING TEAM</span></div>
</div>
<span class="no">${esc(number)} · verify at medx.hr</span>
</div></div></body></html>`;
            res.json({ ok: true, html, name, type, event_name: eventName });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    log('studio: attendance-card window + certificate preview ready');
};
