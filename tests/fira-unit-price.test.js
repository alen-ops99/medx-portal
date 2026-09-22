#!/usr/bin/env node
/**
 * FIRA line items: unit price × quantity must equal the order total — in the VAT path AND in the
 * 0%-VAT retry (the account is not in the PDV system, so the retry is what every real invoice goes
 * through). Found 2026-09-22 on four Gala invoices: 2 seats × €150 printed as "2 × €300 = €600" with
 * a €300 total because the retry wrote the ORDER TOTAL into the unit price.
 */
const assert = require('node:assert');
const path = require('node:path');
process.env.FIRA_API_KEY = 'test-key';
const fira = require(path.join(__dirname, '..', 'user-portal', 'backend', 'fira-service.js'));

// capture what would be POSTed; first call rejects like a non-PDV account, second succeeds
const posted = [];
global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body); posted.push(body);
    if (posted.length === 1) return { ok: false, status: 400, text: async () => 'Cannot add taxes while company is not in the PDV system' };
    return { ok: true, status: 200, json: async () => ({ id: 'f1', invoiceNumber: '99/1/1', status: 'ok' }) };
};

let passed = 0, failed = 0;
const check = (n, f) => { try { f(); passed++; console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + e.message); } };

(async () => {
    await fira.createFiscalInvoice({
        invoiceNumber: 'CA-GALA-2026-TEST', ticketName: 'Plexus 2026 — Gala Evening seat',
        ticketPrice: 150, quantity: 2, addons: [],
        billing: { name: 'Test Guest', country: 'HR', email: 't@example.org' }, invoiceType: 'FISKALNI_RAČUN', paymentType: 'KARTICA'
    });
    check('two requests: VAT attempt, then the 0% retry', () => assert.strictEqual(posted.length, 2));
    const first = posted[0].lineItems[0], retry = posted[1].lineItems[0];
    check('VAT attempt: netto unit 120 × 2 = 240 netto, 300 brutto', () => { assert.strictEqual(first.price, 120); assert.strictEqual(first.quantity, 2); assert.strictEqual(posted[0].brutto, 300); });
    check('0% retry: unit price is the GROSS seat price (150), quantity 2', () => { assert.strictEqual(retry.price, 150); assert.strictEqual(retry.quantity, 2); assert.strictEqual(retry.taxRate, 0); });
    check('0% retry: unit × quantity equals the order total (300), never 600', () => assert.strictEqual(Math.round(retry.price * retry.quantity * 100) / 100, posted[1].brutto));
    check('single seat still prints 150 × 1', async () => {});
    posted.length = 0;
    await fira.createFiscalInvoice({ invoiceNumber: 'GALA26-TEST', ticketName: 'Plexus 2026 Conference — Gala Evening', ticketPrice: 150, quantity: 1, addons: [], billing: { name: 'Solo', country: 'HR' } });
    check('single seat: retry unit 150 × 1 = 150 total', () => { const r = posted[1].lineItems[0]; assert.strictEqual(r.price, 150); assert.strictEqual(r.quantity, 1); assert.strictEqual(posted[1].brutto, 150); });
    console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
