/**
 * FIRA Finance API Service
 * Thin wrapper around FIRA's Custom Webshop API for Croatian fiscal invoicing (fiskalizacija).
 *
 * API Docs: https://app.fira.finance — Settings → Webshop → Custom webshop
 * Endpoint: POST /api/v1/webshop/order/custom
 */

const FIRA_API_URL = process.env.FIRA_API_URL || 'https://app.fira.finance';
const FIRA_API_KEY = process.env.FIRA_API_KEY || '';

const VAT_RATE = 0.25; // Croatian VAT 25%

/**
 * Check if FIRA integration is configured
 */
function isConfigured() {
    return !!FIRA_API_KEY;
}

/**
 * Calculate VAT breakdown from a gross (brutto) amount.
 * Croatian standard: 25% VAT included in price.
 * netto = brutto / 1.25
 * taxValue = brutto - netto
 */
function calculateVAT(bruttoAmount) {
    const netto = Math.round((bruttoAmount / (1 + VAT_RATE)) * 100) / 100;
    const taxValue = Math.round((bruttoAmount - netto) * 100) / 100;
    return { netto, taxValue, brutto: bruttoAmount };
}

/**
 * Build line items for the FIRA order from registration data.
 * Each line item needs: description, quantity, unitPrice (netto), taxRate, netto, taxValue, brutto
 */
function buildLineItems(ticketName, ticketPrice, addons) {
    const items = [];

    // Main ticket
    if (ticketPrice > 0) {
        const vat = calculateVAT(ticketPrice);
        items.push({
            description: `Plexus 2026 Conference — ${ticketName}`,
            quantity: 1,
            unitPrice: vat.netto,
            taxRate: VAT_RATE,
            netto: vat.netto,
            taxValue: vat.taxValue,
            brutto: vat.brutto
        });
    }

    // Add-ons (gala dinner, workshop, etc.)
    if (addons && Array.isArray(addons)) {
        for (const addon of addons) {
            if (addon.price > 0) {
                const vat = calculateVAT(addon.price);
                items.push({
                    description: `Plexus 2026 — ${addon.name}`,
                    quantity: 1,
                    unitPrice: vat.netto,
                    taxRate: VAT_RATE,
                    netto: vat.netto,
                    taxValue: vat.taxValue,
                    brutto: vat.brutto
                });
            }
        }
    }

    return items;
}

/**
 * Map our registration data to FIRA's WebshopOrderModel.
 *
 * @param {Object} orderData
 * @param {string} orderData.invoiceNumber - Our PLX26-XXXXXX invoice number
 * @param {string} orderData.ticketName - e.g. "Professional Early Bird"
 * @param {number} orderData.ticketPrice - Gross ticket price in EUR
 * @param {Array}  orderData.addons - [{name, price}] optional add-ons
 * @param {Object} orderData.billing - {name, company, address, city, zip, country, oib, vatNumber, email}
 * @param {string} orderData.invoiceType - 'FISKALNI_RAČUN' (fiscal) or 'RAČUN' (regular)
 * @param {string} orderData.paymentType - 'TRANSAKCIJSKI' (bank transfer) or 'KARTICA' (card). Default: 'TRANSAKCIJSKI'
 */
function buildFiraOrder(orderData) {
    const lineItems = buildLineItems(orderData.ticketName, orderData.ticketPrice, orderData.addons);

    // Sum up totals from all line items
    const totals = lineItems.reduce((acc, item) => ({
        netto: acc.netto + item.netto,
        taxValue: acc.taxValue + item.taxValue,
        brutto: acc.brutto + item.brutto
    }), { netto: 0, taxValue: 0, brutto: 0 });

    // Round totals
    totals.netto = Math.round(totals.netto * 100) / 100;
    totals.taxValue = Math.round(totals.taxValue * 100) / 100;
    totals.brutto = Math.round(totals.brutto * 100) / 100;

    return {
        externalId: orderData.invoiceNumber,
        invoiceType: orderData.invoiceType || 'FISKALNI_RAČUN',
        paymentType: orderData.paymentType || 'TRANSAKCIJSKI', // TRANSAKCIJSKI = bank, KARTICA = card
        currency: 'EUR',
        lineItems: lineItems.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            netto: item.netto,
            taxValue: item.taxValue,
            brutto: item.brutto
        })),
        netto: totals.netto,
        taxValue: totals.taxValue,
        brutto: totals.brutto,
        billingAddress: {
            name: orderData.billing.company || orderData.billing.name,
            street: orderData.billing.address || '',
            city: orderData.billing.city || '',
            zip: orderData.billing.zip || '',
            country: orderData.billing.country || 'HR',
            oib: orderData.billing.oib || '',
            vatNumber: orderData.billing.vatNumber || ''
        },
        customerEmail: orderData.billing.email || '',
        note: `Plexus 2026 Conference Registration — ${orderData.invoiceNumber}`
    };
}

/**
 * Create a fiscal invoice via FIRA's Custom Webshop API.
 *
 * @param {Object} orderData - See buildFiraOrder() for shape
 * @returns {Object|null} FIRA response with invoice details, or null if not configured
 */
async function createFiscalInvoice(orderData) {
    if (!isConfigured()) {
        console.warn('[FIRA] FIRA_API_KEY not configured — running in demo mode. No fiscal invoice generated.');
        return null;
    }

    const firaOrder = buildFiraOrder(orderData);

    try {
        const response = await fetch(`${FIRA_API_URL}/api/v1/webshop/order/custom`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${FIRA_API_KEY}`
            },
            body: JSON.stringify(firaOrder)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[FIRA] API error ${response.status}: ${errorBody}`);
            throw new Error(`FIRA API returned ${response.status}: ${errorBody}`);
        }

        const result = await response.json();
        console.log(`[FIRA] Fiscal invoice created: ${result.invoiceNumber || result.id}`);

        return {
            firaId: result.id,
            invoiceNumber: result.invoiceNumber,
            status: result.status,
            pdfUrl: result.pdfUrl || result.pdf_url || null,
            rawResponse: result
        };
    } catch (err) {
        console.error('[FIRA] Failed to create fiscal invoice:', err.message);
        throw err;
    }
}

/**
 * Get invoice status from FIRA (for future use / webhook verification).
 */
async function getInvoiceStatus(firaId) {
    if (!isConfigured()) return null;

    try {
        const response = await fetch(`${FIRA_API_URL}/api/v1/webshop/order/${firaId}`, {
            headers: {
                'Authorization': `Bearer ${FIRA_API_KEY}`
            }
        });

        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('[FIRA] Failed to get invoice status:', err.message);
        return null;
    }
}

module.exports = {
    isConfigured,
    calculateVAT,
    buildLineItems,
    buildFiraOrder,
    createFiscalInvoice,
    getInvoiceStatus,
    VAT_RATE
};
