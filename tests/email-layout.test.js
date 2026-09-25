/**
 * tests/email-layout.test.js — THE Med&X email layout (shared/email-layout.js): every email both
 * portals send leaves in one design, with its words, links and images untouched.
 *   - both buildEmailTemplate() letterheads, the v2 shell and the send boundary share the layout
 *   - restyle() changes colours only: every href / src and every text run survive byte for byte
 *   - older queued outbox rows (the navy letterheads, the v2 shell, hand-built ink bands, raw
 *     fragments, plain text) are re-dressed at send time, once (idempotent)
 *   - the retired blue / slate palette never reaches a recipient; the plain-text twin keeps links
 * Pure functions, no I/O.   Run:  node tests/email-layout.test.js
 */
'use strict';
const assert = require('node:assert');
const EL = require('../shared/email-layout.js');
const tpl = require('../user-portal/backend/v2/email-templates.js');

let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ok    ' + name); } catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); } }

const hrefs = h => [...String(h).matchAll(/<a\b[^>]*?\shref="([^"]*)"/gi)].map(m => m[1]);
const srcs = h => [...String(h).matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/gi)].map(m => m[1]);
const words = h => String(h).replace(/<head[\s\S]*?<\/head>/i, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(div|span)\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/\1>/gi, '')
    .split(/<[^>]+>/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
const BLUE = /#(0f172a|1e293b|334155|475569|64748b|94a3b8|e2e8f0|f8fafc|1e40af|2563eb|3b82f6|22d3ee|22c55e|ecfdf5|a7f3d0|065f46|eff6ff)\b/i;
const layoutCount = h => (String(h).match(/data-mx-layout="/g) || []).length;
const PAY = 'https://medx-staging.onrender.com/pay/gala/k7Q2mP9xW4?seats=2&amp;src=email';
const FRAG = `<p>Dear Ana,</p>
<p style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 14px 18px; border-radius: 8px; color: #065f46; font-weight: 600;">Your payment has been received.</p>
<table style="width: 100%; border-collapse: collapse;"><tr><td style="padding: 10px; background: #f8fafc; color: #64748b;">Amount Paid</td><td style="padding: 10px; font-weight: 600; color: #0f172a;">€150.00</td></tr></table>
<p style="text-align:center"><a href="${PAY}" style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Complete Payment</a></p>
<p>Questions? <a href="mailto:info@medx.hr">info@medx.hr</a> · <img src="https://medx-staging.onrender.com/qr/abc.png" alt="QR" width="160"></p>`;

console.log('email-layout.test.js — one layout, words and links untouched\n');

t('restyle changes colours only: hrefs, image sources and every word survive', () => {
    const out = EL.restyle(FRAG);
    assert.deepStrictEqual(hrefs(out), hrefs(FRAG));
    assert.deepStrictEqual(srcs(out), srcs(FRAG));
    assert.deepStrictEqual(words(out), words(FRAG));
    assert.ok(!BLUE.test(out), 'no old blue / slate / Bootstrap green left');
    assert.ok(out.includes(`href="${PAY}"`), 'the pay link is byte-identical (entities included)');
    assert.ok(/background:#9b1b22;color:#f7f1e6/.test(out), 'a button link takes the crimson house button');
});

t('both letterheads (member + admin buildEmailTemplate) render in the layout with the old footer words and links', () => {
    for (const fam of ['member', 'admin']) {
        const html = EL.letterhead({ family: fam, title: 'Payment Confirmed', bodyHtml: FRAG, newsletterUrl: 'https://admin.example/newsletter' });
        assert.strictEqual(layoutCount(html), 1);
        assert.ok(!BLUE.test(html.replace(/<head[\s\S]*?<\/head>/i, '')), fam + ': no old palette');
        for (const h of hrefs(FRAG)) assert.ok(hrefs(html).includes(h), fam + ': keeps ' + h);
        assert.ok(hrefs(html).includes('https://medx-user-portal.onrender.com/privacy') && hrefs(html).includes('https://medx-user-portal.onrender.com/terms'), fam + ': privacy + terms kept');
        assert.ok(/Your personal data is processed in accordance with the EU General Data Protection Regulation/.test(html), fam + ': GDPR line kept');
        assert.ok(html.includes('Payment Confirmed'), fam + ': the title is the headline');
        assert.ok(html.includes('logo-white.png'), fam + ': the real wordmark');
    }
    const hr = EL.letterhead({ family: 'member', title: 'Potvrda', bodyHtml: '<p>Hvala.</p>', locale: 'hr' });
    assert.ok(/<html lang="hr"/.test(hr) && hr.includes('Pravila privatnosti') && hr.includes('Sva prava pridržana.'), 'Croatian footer');
    assert.ok(EL.letterhead({ family: 'admin', title: 'x', bodyHtml: 'y', newsletterUrl: 'https://a.example/newsletter' }).includes('https://a.example/newsletter'), 'admin keeps its newsletter sign-up link');
});

t('the v2 shell is the layout; a dark-toned body is translated to the cream family', () => {
    const light = tpl.confirmEmail({ firstName: 'Ana', verifyUrl: 'https://portal.test/api/auth/verify?token=abc' });
    assert.strictEqual(layoutCount(light), 1);
    assert.ok(light.includes('href="https://portal.test/api/auth/verify?token=abc"'));
    const dark = tpl.shell({ tone: 'dark', title: 'x', bodyHtml: '<div style="color:#f2e7d6;background:#342718;">Held <b style="color:#d3c5b2;">4</b> <a href="https://x.test/a" style="color:#d7b56c;">open</a></div>' });
    assert.ok(!/#f2e7d6|#342718|#d3c5b2|background:#291e14|background:#120e0a/.test(dark), 'no espresso left');
    assert.ok(dark.includes('href="https://x.test/a"') && dark.includes('Held') && dark.includes('>4<'), 'words and link kept');
});

t('the send boundary: branded mail passes through untouched (idempotent)', () => {
    const html = tpl.confirmEmail({ firstName: 'Ana', verifyUrl: 'https://portal.test/v?t=1' });
    assert.strictEqual(EL.ensureBranded(html, { subject: 'x' }), html);
    const once = EL.ensureBranded(FRAG, { subject: 'Paid' });
    assert.strictEqual(EL.ensureBranded(once, { subject: 'Paid' }), once);
});

t('the send boundary: a raw fragment, plain text and a hand-built ink band all arrive in the layout', () => {
    const frag = EL.ensureBranded(FRAG, { subject: 'Paid' });
    assert.strictEqual(layoutCount(frag), 1);
    assert.deepStrictEqual(hrefs(frag).filter(h => hrefs(FRAG).includes(h)), hrefs(FRAG));
    const text = EL.ensureBranded('Hello Ana,\n\nYour seat is confirmed & ready.', { subject: 's' });
    assert.ok(text.includes('<p style="margin:0 0 14px;">Hello Ana,</p>') && text.includes('confirmed &amp; ready.'));
    const lite = `<!doctype html><body style="margin:0;background:#f7f1e6"><div style="max-width:600px;margin:0 auto;padding:28px 20px">
  <div style="background:#191512;color:#f7f1e6;padding:18px 24px;border-bottom:2px solid #c9a962"><div style="font-size:20px">Med&amp;X</div><div style="font:600 9px Arial">GALA EVENING · DECEMBER 5</div></div>
  <div style="background:#fdfaf3;border:1px solid rgba(25,21,18,.16);padding:26px 24px"><p>Dear Ana,</p><a href="${PAY}" style="display:inline-block;background:#9b1b22;color:#fff;padding:13px 30px">TAKE THE SEAT</a></div></div></body>`;
    const b = EL.ensureBranded(lite, { subject: 'Seat' });
    assert.strictEqual(layoutCount(b), 1);
    assert.strictEqual((b.match(/background:#191512;padding:22px/g) || []).length, 1, 'one ink band, not two');
    assert.ok(b.includes('GALA EVENING · DECEMBER 5') && b.includes(`href="${PAY}"`) && b.includes('TAKE THE SEAT'));
});

t('the send boundary: an older queued navy letterhead is re-dressed with the same words and links', () => {
    const old = `<!DOCTYPE html><html lang="en"><body style="background: #f0f0f3;"><table><tr><td>
    <!-- Header with logo --><tr><td style="background: linear-gradient(135deg, #0f172a 0%, #1a2744 100%);"><div>Building Bridges in Biomedicine</div></td></tr>
    <!-- Title bar --><tr><td style="background: #1e293b;"><h1 style="margin: 0; color: #C9A962;">Reset Your Password</h1></td></tr>
    <!-- Body -->
    <tr><td style="background: #ffffff; padding: 36px 40px;">
        <div style="color: #334155; font-size: 15px; line-height: 1.75;">
            <p>Hi Ana,</p><p><a href="https://medx-staging.onrender.com/reset-password/9f8e" style="background:#C9A962;padding:14px 36px;">Reset Password</a></p>
        </div>
    </td></tr>
    <!-- Footer --><tr><td style="background: #0f172a;">© 2026 Med&amp;X</td></tr></table></body></html>`;
    const out = EL.ensureBranded(old, { subject: 'Reset your Med&X password' });
    assert.strictEqual(layoutCount(out), 1);
    assert.ok(out.includes('href="https://medx-staging.onrender.com/reset-password/9f8e"') && out.includes('Reset Your Password') && out.includes('Hi Ana,'));
    assert.ok(!BLUE.test(out.replace(/<head[\s\S]*?<\/head>/i, '')));
});

t('plain-text twin: links stay as URLs, the layout frame stays out', () => {
    const txt = EL.toText(EL.letterhead({ family: 'member', title: 'Payment Confirmed', bodyHtml: FRAG }));
    assert.ok(txt.startsWith('Payment Confirmed'), 'starts with the message, not the wordmark');
    assert.ok(txt.includes('Complete Payment (https://medx-staging.onrender.com/pay/gala/k7Q2mP9xW4?seats=2&src=email)'));
    assert.ok(!/MEDX\.HR|logo-white|display:none/.test(txt));
});

t('bulletproof frame: tables, a 600px card, the phone query, light colour-scheme, one </body>', () => {
    const html = EL.layout({ title: 't', body: '<p>x</p>' });
    assert.ok(/<table role="presentation" width="600"[^>]*class="em-cardbg mx-card"/.test(html));
    assert.ok(/@media only screen and \(max-width:480px\)/.test(html));
    assert.ok(/<meta name="color-scheme" content="light">/.test(html));
    assert.strictEqual((html.match(/<\/body>/g) || []).length, 1, 'hub code appends markers before </body>');
});

t('forced dark mode: the ink band keeps its ink three ways, so the white wordmark always reads', () => {
    const html = EL.layout({ title: 't', body: '<p>x</p>' });
    const head = /<td class="mx-head"([^>]*)>([\s\S]*?)<\/td><\/tr>\s*<tr><td height="2"/.exec(html);
    assert.ok(head, 'the band cell');
    assert.ok(/bgcolor="#191512"/.test(head[1]) && /background:#191512/.test(head[1]), 'bgcolor + background');
    assert.ok(/background-image:linear-gradient\(#191512,#191512\)/.test(head[1]), 'a gradient image (Gmail iOS leaves images alone)');
    assert.ok(/<!--\[if gte mso 9\]><v:rect[^>]*fillcolor="#191512"[\s\S]*<v:fill type="solid" color="#191512"/.test(head[2]) && /<\/v:textbox><\/v:rect><!\[endif\]-->/.test(head[2]), 'a VML fill for Outlook, opened and closed');
    assert.ok(head[2].includes('logo-white.png'), 'the wordmark sits inside');
    assert.ok(/<!--\[if mso\]><style>\*\{font-family:Arial/.test(html), 'Outlook gets a web-safe font, not Times');
});

t('small gold labels on cream use the dark gold (readable), the pale gold stays on the ink band', () => {
    const b = EL.block({ eyebrow: 'THE FORUM', headline: 'x' });
    assert.ok(/class="em-goldlab" style="[^"]*color:#6e5626/.test(b) && !/color:#c9a962/.test(b));
});

t('buttons: the same link and label everywhere, with the Outlook link-button spacers in mso comments only', () => {
    const a = EL.btn('OPEN THE BOARD', PAY.replace(/&amp;/g, '&'));
    assert.ok(a.includes(`href="${PAY}"`) && />OPEN THE BOARD</.test(a), 'the raw URL, escaped once');
    assert.ok(/mso-padding-alt:0/.test(a) && /<!--\[if mso\]><i [^>]*mso-text-raise:30pt[^>]*hidden>&nbsp;<\/i><!\[endif\]-->/.test(a));
    assert.deepStrictEqual(words(a), ['OPEN THE BOARD'], 'no visible text added');
});

t('readability: pale body text re-dressed at send time reads at 4.5:1; large text keeps 3:1', () => {
    const out = EL.restyle('<p style="color:#94a3b8;font-size:14px;">Body copy</p><p style="color:#94a3b8;font-size:22px;">Big</p>');
    const colours = [...out.matchAll(/color:(#[0-9a-f]{6})/gi)].map(m => m[1]);
    const P = c => EL._internals.parseColor(c), cream = P('#f7f1e6');
    assert.ok(EL._internals.contrast(P(colours[0]), cream) >= 4.5, 'body text ' + colours[0]);
    assert.ok(EL._internals.contrast(P(colours[1]), cream) >= 3, 'large text ' + colours[1]);
});

t('plain-text twin: a body\'s own hidden preheader and its &zwnj; filler stay out', () => {
    const body = '<div style="display:none;max-height:0px;overflow:hidden;mso-hide:all;">Saturday · 19:00&nbsp;&zwnj;&nbsp;&#8204;&#x200c;<span>x</span></div><p>Dear Ana,</p><p>See you&zwnj; there.</p>';
    const txt = EL.toText(EL.ensureBranded(body, { subject: 'Reminder' }));
    assert.ok(!/zwnj|&#8204;|&#x200c;|‌/i.test(txt), 'no filler');
    assert.ok(!/Saturday · 19:00/.test(txt), 'no hidden preheader');
    assert.ok(/Dear Ana,\nSee you there\./.test(txt), txt);
});

t('brand-lite at send time: a padding-only wrapper loses its indent, a leading Georgia title becomes the headline', () => {
    const lite = `<!doctype html><html><body style="margin:0;background:#f7f1e6"><div style="max-width:600px;margin:0 auto">
  <div style="background:#191512;color:#f7f1e6;padding:18px 24px"><div style="font-size:20px">Med&amp;X</div><div style="font:600 9px Arial">MONEY DESK</div></div>
  <div style="padding:28px"><div style="font-family:Georgia,serif;font-size:21px;color:#191512">Invoice sent</div><p>Dear Ana, <a href="${PAY}">pay here</a>.</p></div></div></body></html>`;
    const out = EL.ensureBranded(lite, { subject: 'Invoice' });
    assert.ok(/<div class="mx-h1" style="margin:0;font-family:Fraunces[^"]*font-size:28px/.test(out), 'the title is the 28px Fraunces headline');
    assert.ok(!/padding:28px/.test(out), 'no double indent');
    assert.ok(out.includes(`href="${PAY}"`) && out.includes('Invoice sent') && out.includes('Dear Ana,'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
