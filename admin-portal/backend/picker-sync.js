/**
 * Gala → table-picker invite sync engine (admin portal ⇄ Firestore plexus-gala-tables).
 *
 * The Plexus table-picker (plexus-tables.netlify.app, repo alen-ops99/plexus-gala-suite)
 * keeps its guest invites in Firestore: collection `invites/{token}` where the doc id IS
 * the guest's personal credential (crypto 16-hex, link = BASE_URL?t=token). Until now the
 * console imported a CSV exported from this portal by hand. This module makes the portal
 * the source of truth: paid/confirmed gala registrations are diffed against the live
 * invites collection — new paid guests get an invite doc (link works immediately),
 * refunded/deleted guests get their unpicked invite deleted (link dies instantly), and
 * refunded guests who already booked a table are FLAGGED for the organizer (never
 * auto-deleted — removing a booked table is a human call; the console roster can do it).
 *
 * Pure logic (diff, e-mail HTML) is separated from I/O so tests can drive everything
 * with an injected fetch; server.js wires the real DB + outbox around it.
 *
 * Firestore auth: the organizer account (president@medx.hr) via Identity Toolkit
 * signInWithPassword — the picker's security rules gate invite create/list/delete on
 * that account. Credentials come from PICKER_ADMIN_EMAIL / PICKER_ADMIN_PASSWORD env
 * vars (add them to the admin-service on Render); without them the engine reports
 * `configured:false` and does nothing.
 */
const crypto = require('crypto');

const PICKER_PROJECT = process.env.PICKER_FB_PROJECT_ID || 'plexus-gala-tables';
// Public Firebase web-config key (same one shipped in the picker's client bundle — not a secret).
const PICKER_API_KEY = process.env.PICKER_FB_API_KEY || 'AIzaSyCO5CofjtpsFpfz5NtBbjmVdvXH9TXo0sE';
const PICKER_BASE_URL = process.env.PICKER_BASE_URL || 'https://plexus-tables.netlify.app/';
const PICKER_LOGO_URL = PICKER_BASE_URL.replace(/\/$/, '') + '/assets/logo-white.png';
const DEFAULT_MAX_PARTY = 3; // registrant + up to 2 guests — same default as the console

// Test seams: the CI boot test points these at an in-process mock (never set in production).
const FS_BASE = process.env.PICKER_FS_BASE || 'https://firestore.googleapis.com/v1';
const AUTH_BASE = process.env.PICKER_AUTH_BASE || 'https://identitytoolkit.googleapis.com/v1';

const FS_ROOT = () => `${FS_BASE}/projects/${PICKER_PROJECT}/databases/(default)/documents`;

function genInviteToken() {
    // Same format the console generates client-side: 8 random bytes → 16 hex chars.
    return crypto.randomBytes(8).toString('hex');
}

function normEmail(e) { return String(e || '').trim().toLowerCase(); }

/**
 * Doc id for the picker's public `paid_emails/{id}` marker: hex(SHA-256(lower(trim(email)))).
 * MUST stay byte-identical to the picker's client-side sha256hex (guest_picker index.html /
 * admin.html: hex(SHA-256(TextEncoder(normEmail(email))))) — the guest page hashes an added
 * guest's e-mail this exact way and does a GET-by-id to decide whether that guest has paid.
 * Node's createHash('sha256').update(str) UTF-8-encodes the same bytes Web Crypto digests.
 */
function paidEmailDocId(email) {
    return crypto.createHash('sha256').update(normEmail(email)).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Firestore REST value helpers
// ─────────────────────────────────────────────────────────────────────────────
function fsVal(field) {
    if (field == null || typeof field !== 'object') return null;
    if ('stringValue' in field) return field.stringValue;
    if ('integerValue' in field) return parseInt(field.integerValue, 10);
    if ('booleanValue' in field) return field.booleanValue;
    if ('doubleValue' in field) return field.doubleValue;
    if ('nullValue' in field) return null;
    return null;
}

function fsWrap(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    return { stringValue: String(v) };
}

// ─────────────────────────────────────────────────────────────────────────────
// PickerClient — authed Firestore REST client (fetch injectable for tests)
// ─────────────────────────────────────────────────────────────────────────────
class PickerClient {
    constructor(opts = {}) {
        this.fetch = opts.fetch || global.fetch;
        this.email = opts.email !== undefined ? opts.email : process.env.PICKER_ADMIN_EMAIL;
        this.password = opts.password !== undefined ? opts.password : process.env.PICKER_ADMIN_PASSWORD;
        this.apiKey = opts.apiKey || PICKER_API_KEY;
        this._auth = { idToken: null, exp: 0 };
    }

    get configured() { return !!(this.email && this.password); }

    async _token() {
        const now = Date.now() / 1000;
        if (this._auth.idToken && now < this._auth.exp - 300) return this._auth.idToken;
        const r = await this.fetch(
            AUTH_BASE + '/accounts:signInWithPassword?key=' + this.apiKey,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.email, password: this.password, returnSecureToken: true }),
            });
        if (!r.ok) throw new Error('picker sign-in failed (' + r.status + ')');
        const j = await r.json();
        this._auth = { idToken: j.idToken, exp: now + parseInt(j.expiresIn || '3600', 10) };
        return this._auth.idToken;
    }

    async _req(url, { method = 'GET', body } = {}) {
        const token = await this._token();
        const r = await this.fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!r.ok) {
            const detail = await r.text().catch(() => '');
            throw new Error('picker ' + method + ' ' + url.split('/documents')[1] + ' → ' + r.status + ' ' + detail.slice(0, 200));
        }
        return r.json();
    }

    /** All invite docs → [{ token, name, email (lowercased), maxParty, picked, table }]. */
    async listInvites() {
        const out = [];
        let pageToken = null;
        do {
            let url = FS_ROOT() + '/invites?pageSize=300';
            if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
            const data = await this._req(url);
            for (const doc of (data.documents || [])) {
                const f = doc.fields || {};
                out.push({
                    token: doc.name.split('/').pop(),
                    name: fsVal(f.name) || '',
                    email: normEmail(fsVal(f.email)),
                    maxParty: fsVal(f.maxParty) || DEFAULT_MAX_PARTY,
                    picked: fsVal(f.picked) === true,
                    table: fsVal(f.table),
                });
            }
            pageToken = data.nextPageToken || null;
        } while (pageToken);
        return out;
    }

    /** Create invites/{token} exactly like the console does (create-only: precondition exists=false). */
    async createInvite({ token, name, email, maxParty }) {
        const url = FS_ROOT() + '/invites/' + encodeURIComponent(token) + '?currentDocument.exists=false';
        await this._req(url, {
            method: 'PATCH',
            body: {
                fields: {
                    token: fsWrap(token),
                    name: fsWrap(String(name || '').trim()),
                    email: fsWrap(String(email || '').trim()),
                    maxParty: fsWrap(maxParty || DEFAULT_MAX_PARTY),
                    picked: fsWrap(false),
                    table: fsWrap(null),
                },
            },
        });
    }

    /** Delete invites/{token} — the personal link stops working immediately. */
    async deleteInvite(token) {
        await this._req(FS_ROOT() + '/invites/' + encodeURIComponent(token), { method: 'DELETE' });
    }

    /**
     * Upsert the public paid-marker `paid_emails/{sha256hex(lower email)}` a paid registrant
     * needs so the picker's guest page recognises them as a valid, paid guest. Full-document
     * PATCH with no precondition = idempotent create-or-overwrite (re-running writes the same
     * {email, ts} doc). Runs through _req → the organizer bearer token, which the picker's
     * rules require for paid_emails writes (public GET-by-id, admin-only write).
     */
    async upsertPaidEmail(email) {
        const em = normEmail(email);
        if (!em) return;
        const url = FS_ROOT() + '/paid_emails/' + encodeURIComponent(paidEmailDocId(em));
        await this._req(url, {
            method: 'PATCH',
            body: { fields: { email: fsWrap(em), ts: fsWrap(new Date().toISOString()) } },
        });
    }

    /** Delete the paid_emails marker (refund/reject). Firestore DELETE is idempotent — a
     *  missing doc is a no-op (200), so this is safe even if the marker was never written. */
    async deletePaidEmail(email) {
        const em = normEmail(email);
        if (!em) return;
        await this._req(FS_ROOT() + '/paid_emails/' + encodeURIComponent(paidEmailDocId(em)), { method: 'DELETE' });
    }
}

/**
 * Table-choice deadlines from the picker's public config (config/settings —
 * chooseDeadlineHr / chooseDeadlineEn, public read by design; the console sets them).
 * Unauthenticated GET, so it works even before sync creds are configured.
 * Returns { hr, en } (nulls when unset → the deadline sentence is dropped).
 */
async function fetchChooseDeadlines(fetchImpl) {
    const f = fetchImpl || global.fetch;
    try {
        const r = await f(FS_ROOT() + '/config/settings');
        if (!r.ok) return { hr: null, en: null };
        const fields = (await r.json()).fields || {};
        let hr = fsVal(fields.chooseDeadlineHr) || null;
        let en = fsVal(fields.chooseDeadlineEn) || null;
        if (!hr && !en) {
            // legacy single bilingual field "15. studenoga 2026. · November 15, 2026"
            const legacy = fsVal(fields.chooseDeadline) || '';
            if (legacy.includes('·')) {
                const [a, b] = legacy.split('·');
                hr = (a || '').trim() || null;
                en = (b || '').trim() || null;
            } else if (legacy.trim()) hr = legacy.trim();
        }
        return { hr, en };
    } catch (e) {
        return { hr: null, en: null };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff engine (pure — no I/O)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * computeInviteDiff({ eligible, invites, portalEmails })
 *
 *  eligible      [{ email, name }]  — paid/confirmed gala registrants (email lowercased, deduped)
 *  invites       [{ token, email, name, picked, table }] — live Firestore invites
 *  portalEmails  Set<string>       — every email the portal knows about: ALL
 *                gala_registrations rows (any status) + every gala_picker_invites row.
 *                An invite whose email the portal has never seen (a special guest the
 *                organizer created directly in the console) is FOREIGN — left alone.
 *
 * → { toCreate:[{email,name}], keep:[{email,name}], toRevoke:[{token,email,name}],
 *     flagged:[{token,email,name,table}], foreign:[{token,email}], unchanged:n }
 *
 * `keep` is the eligible registrants that already hold an invite (still-paid, no invite
 * change) — surfaced so the caller can (re-)assert their public paid_emails marker, which
 * a pre-feature invite or a console import may be missing.
 */
function computeInviteDiff({ eligible, invites, portalEmails }) {
    const eligibleByEmail = new Map();
    for (const e of eligible) {
        const em = normEmail(e.email);
        if (em && !eligibleByEmail.has(em)) eligibleByEmail.set(em, { email: em, name: e.name || '' });
    }
    const known = portalEmails || new Set();
    const invitedEmails = new Set();
    const toRevoke = [], flagged = [], foreign = [];
    let unchanged = 0;

    for (const inv of invites) {
        const em = inv.email;
        if (em && eligibleByEmail.has(em)) {
            if (!invitedEmails.has(em)) unchanged++;   // still-eligible guest already invited
            invitedEmails.add(em);
            continue;
        }
        if (!em || !known.has(em)) {                    // portal never saw this guest → hands off
            foreign.push({ token: inv.token, email: em });
            continue;
        }
        if (inv.picked) {                               // refunded but already booked a table → human call
            flagged.push({ token: inv.token, email: em, name: inv.name, table: inv.table });
        } else {
            toRevoke.push({ token: inv.token, email: em, name: inv.name });
        }
    }

    const toCreate = [], keep = [];
    for (const [em, e] of eligibleByEmail) {
        (invitedEmails.has(em) ? keep : toCreate).push(e);
    }
    return { toCreate, keep, toRevoke, flagged, foreign, unchanged };
}

/**
 * runInviteSync — full engine pass. All I/O injected:
 *   deps.getEligible()      → [{ email, name }]
 *   deps.getPortalEmails()  → Set<string>
 *   deps.client             → PickerClient (or mock)
 *   deps.maxParty           → invite maxParty (default 3)
 *   deps.onCreated({ email, name, token, maxParty })  — record in gala_picker_invites
 *   deps.onRevoked({ email, token })                  — stamp revoked_at
 *   deps.genToken()         → optional token generator override
 *
 * → sync report { ok, configured, created, revoked, flagged, foreign, unchanged,
 *                 paidMarked, paidUnmarked, errors, ranAt }
 * Individual create/delete failures are collected in `errors`, never thrown — the
 * next pass retries them (the diff is idempotent).
 *
 * Alongside each invite it maintains the picker's public paid_emails markers on the SAME
 * authed client: every eligible registrant (created OR kept) gets paid_emails/{hash(email)}
 * upserted so the guest page recognises them as paid; every revoked invite has its marker
 * deleted. Marker writes are best-effort — failures land in `errors`, never abort the sync
 * (a missed upsert self-heals on the next pass via `keep`, a missed delete via retry).
 */
async function runInviteSync(deps) {
    const report = { ok: true, configured: true, created: [], revoked: [], flagged: [], foreign: [], unchanged: 0, paidMarked: [], paidUnmarked: [], errors: [], ranAt: new Date().toISOString() };
    const client = deps.client;
    if (!client.configured) {
        return { ...report, ok: false, configured: false, errors: ['sync not configured — set PICKER_ADMIN_EMAIL / PICKER_ADMIN_PASSWORD'] };
    }
    const [eligible, portalEmails, invites] = await Promise.all([
        deps.getEligible(), deps.getPortalEmails(), client.listInvites(),
    ]);
    const diff = computeInviteDiff({ eligible, invites, portalEmails });
    report.flagged = diff.flagged;
    report.foreign = diff.foreign;
    report.unchanged = diff.unchanged;

    // paid_emails markers ride the same authed client; guarded so a mock client without the
    // methods (or a client build predating this feature) degrades to invite-only, never throws.
    const canMark = typeof client.upsertPaidEmail === 'function';
    const canUnmark = typeof client.deletePaidEmail === 'function';
    const markPaid = async (email) => {
        if (!canMark) return;
        try { await client.upsertPaidEmail(email); report.paidMarked.push(email); }
        catch (err) { report.ok = false; report.errors.push('paid-mark ' + email + ': ' + err.message); }
    };

    for (const e of diff.toCreate) {
        const token = (deps.genToken || genInviteToken)();
        const maxParty = deps.maxParty || DEFAULT_MAX_PARTY;
        try {
            await client.createInvite({ token, name: e.name, email: e.email, maxParty });
            await deps.onCreated({ email: e.email, name: e.name, token, maxParty });
            report.created.push({ email: e.email, name: e.name, token });
            await markPaid(e.email); // new invite → mark the registrant paid
        } catch (err) {
            report.ok = false;
            report.errors.push('create ' + e.email + ': ' + err.message);
        }
    }
    // Kept invites: re-assert the marker so invites created before this feature (or console
    // imports) still get a paid_emails doc. Idempotent upsert, so re-running is harmless.
    for (const e of diff.keep) await markPaid(e.email);

    for (const r of diff.toRevoke) {
        try {
            await client.deleteInvite(r.token);
            await deps.onRevoked({ email: r.email, token: r.token });
            report.revoked.push({ email: r.email, name: r.name, token: r.token });
            if (canUnmark) { // invite gone → the marker must go too (link + paid status both die)
                try { await client.deletePaidEmail(r.email); report.paidUnmarked.push(r.email); }
                catch (err) { report.ok = false; report.errors.push('paid-unmark ' + r.email + ': ' + err.message); }
            }
        } catch (err) {
            report.ok = false;
            report.errors.push('revoke ' + r.email + ': ' + err.message);
        }
    }
    return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// Invitation e-mail — the approved "Odaberite svoj stol" design, ported 1:1 from
// guest_picker/send_invites.py (templates/invite_hr.md + brevo_html)
// ─────────────────────────────────────────────────────────────────────────────
const INVITE_SUBJECT = 'Odaberite svoj stol — Plexus Gala 2026 · Choose your table';

const INVITE_BODY_HR = `Poštovani/Poštovana {{name}},

hvala Vam na prijavi za Gala večer Plexusa 2026 — veselimo se što ćete biti s nama!

Vrijeme je da odaberete svoj stol u Smaragdnoj dvorani hotela Esplanade. Otvorite svoju osobnu poveznicu, pogledajte tlocrt dvorane i odaberite mjesto koje Vam najbolje odgovara. Ako dolazite u pratnji, istom poveznicom odabirete stol i za svoje goste — svatko od njih dobit će vlastitu ulaznicu e-poštom.

  {{link}}

Poveznica je osobna i vrijedi samo za Vas. Odabir kasnije možete promijeniti istom poveznicom. Molimo odaberite svoj stol do {{deadline}} — nakon toga preostalim gostima stolove dodjeljujemo nasumično.

Vidimo se 5. prosinca u Esplanadi.

Srdačan pozdrav,
Med&X · Plexus 2026`;

const INVITE_BODY_EN = `Dear {{name}},

thank you for registering for the Plexus 2026 Gala Evening — we look forward to having you with us!

It is time to choose your table in the Emerald Ballroom of Hotel Esplanade. Open your personal link, view the floor plan and pick the seat that suits you best. If you are coming with company, the same link lets you choose the table for your guests as well — each of them will receive their own ticket by e-mail.

  {{link}}

The link is personal and valid only for you. You can change your choice later using the same link. Please choose your table by {{deadline}} — after that date, remaining guests are assigned tables at random.

See you on December 5th at the Esplanade.

Warm regards,
Med&X · Plexus 2026`;

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Fill {{deadline}}; when no date is set, drop just the sentence(s) that mention it. */
function applyDeadline(text, deadline) {
    if (deadline) return text.split('{{deadline}}').join(deadline);
    return text.split('\n').map((para) => {
        if (!para.includes('{{deadline}}')) return para;
        return para.split(/(?<=\.)\s+/).filter((s) => !s.includes('{{deadline}}')).join(' ');
    }).join('\n');
}

function renderBlock(tpl, { name, link, deadline }) {
    let out = applyDeadline(tpl, deadline);
    out = out.split('{{name}}').join(name || 'gošćo/gostu');
    out = out.split('{{link}}').join(link);
    return out;
}

/**
 * buildInviteEmail({ name, link, deadlineHr, deadlineEn })
 * → { subject, html, text } — ink header with the hosted med&X logo, HR block,
 * red button "Rezervirajte svoj stol · Reserve your table" with the fallback link
 * beneath it, gold divider, equal-styling EN block, pr@medx.hr footer.
 */
function buildInviteEmail({ name, link, deadlineHr, deadlineEn }) {
    const hrText = renderBlock(INVITE_BODY_HR, { name, link, deadline: deadlineHr });
    const enText = renderBlock(INVITE_BODY_EN, { name, link, deadline: deadlineEn });
    const text = hrText + '\n\n—EN—\n\n' + enText;

    const block = (txt) => {
        const lines = txt.split('\n').filter((l) => l.trim() !== link.trim());
        const html = lines.map((l) => (l.trim() ? escapeHtml(l) : '')).join('<br>');
        return '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:16px;line-height:1.8;color:#242019">' + html + '</div>';
    };

    const button =
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:34px auto 14px"><tr><td style="background:#9b1b22;">'
        + '<a href="' + link + '" style="display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:#ffffff;text-decoration:none">Rezervirajte svoj stol · Reserve your table</a>'
        + '</td></tr></table>'
        + '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9b9186;text-align:center;margin:0 auto 30px;line-height:1.6;word-break:break-all">'
        + 'Ako gumb ne radi, otvorite · If the button does not work, open:<br>'
        + '<a href="' + link + '" style="color:#9b1b22">' + link + '</a></div>';

    const divider =
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:28px 0 34px">'
        + '<div style="border-top:1px solid #c9a962"></div></td></tr></table>';

    const header =
        '<div style="background:#15110f;padding:46px 24px 42px;text-align:center">'
        + '<img src="' + PICKER_LOGO_URL + '" alt="med&amp;X" width="150" style="display:block;margin:0 auto;border:0;max-width:150px;height:auto">'
        + '<div style="margin:26px auto 0;width:56px;border-top:1px solid #c9a962"></div>'
        + '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:30px;font-weight:400;color:#f7f3ec;margin-top:24px;letter-spacing:6px">PLEXUS GALA 2026</div>'
        + '<div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:3px;color:#c9a962;margin-top:14px;text-transform:uppercase">Gala večer · Hotel Esplanade Zagreb · 5. 12. 2026.</div></div>';

    const foot =
        '<div style="border-top:1px solid #eee8dd;font-family:Arial,Helvetica,sans-serif;text-align:center;padding:24px 22px 30px;line-height:1.7">'
        + '<div style="font-size:11px;color:#9b9186">Trebate pomoć ili imate pitanja? Pišite nam na '
        + '<a href="mailto:pr@medx.hr" style="color:#9b1b22;text-decoration:none">pr@medx.hr</a>'
        + ' · Need help or have questions? Contact us at '
        + '<a href="mailto:pr@medx.hr" style="color:#9b1b22;text-decoration:none">pr@medx.hr</a></div>'
        + '<div style="font-size:10.5px;letter-spacing:1.5px;text-transform:uppercase;color:#9b9186;margin-top:10px">Med&amp;X · Plexus Gala 2026 · Hotel Esplanade Zagreb</div></div>';

    const html =
        '<div style="background:#ffffff;padding:24px 8px">'
        + '<div style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #eee8dd;box-sizing:border-box">'
        + header
        + '<div style="padding:46px 34px 14px">' + block(hrText) + button + divider + block(enText) + '</div>'
        + foot
        + '</div></div>';

    return { subject: INVITE_SUBJECT, html, text };
}

function inviteLink(token) { return PICKER_BASE_URL + '?t=' + token; }

module.exports = {
    PICKER_PROJECT,
    PICKER_BASE_URL,
    PICKER_LOGO_URL,
    DEFAULT_MAX_PARTY,
    genInviteToken,
    normEmail,
    paidEmailDocId,
    PickerClient,
    fetchChooseDeadlines,
    computeInviteDiff,
    runInviteSync,
    buildInviteEmail,
    inviteLink,
    INVITE_SUBJECT,
};
