/**
 * shared/branded-qr.js — the Med&X branded QR: a white plate alpha-composited into the middle
 * of a high-error-correction QR.
 *
 * EXTRACTED (not copied) from user-portal/backend/boston.js, where it shipped first for the
 * Building Bridges Boston entry code — boston.js now calls through here, so there is exactly one
 * implementation and one place where the compositing maths can be wrong. The pixel output is
 * unchanged: 900 px, error-correction level 'H' (30 % recoverable), margin 2, real alpha
 * compositing of the plate over the centre.
 *
 * Plates:
 *   user-portal/backend/qr-plate.png       Med&X × HMPA (Boston)
 *   user-portal/backend/qr-plate-medx.png  Med&X only   (Plexus Week meetups — spec §3 "Wallet + QR")
 *
 * Dependency-free by design: `qrcode` and `pngjs` are handed in by the caller (each backend
 * resolves them from its own node_modules, and a checkout without them degrades per-route
 * exactly as boston.js always did).
 */
'use strict';

const fs = require('fs');

const plateCache = new Map();                 // path → PNG | null (null = tried and unavailable)

/** Read + decode a plate once. Returns null when the file or pngjs is unavailable. */
function loadPlate(platePath, pngjs) {
    if (!platePath || !pngjs) return null;
    if (plateCache.has(platePath)) return plateCache.get(platePath);
    let img = null;
    try { img = pngjs.PNG.sync.read(fs.readFileSync(platePath)); }
    catch (e) { console.warn('[branded-qr] plate unavailable — serving a plain QR:', platePath, e.message); img = null; }
    plateCache.set(platePath, img);
    return img;
}

/**
 * Composite `plate` over the centre of `qrBuf` (both PNG buffers) with real alpha blending.
 * Returns a PNG buffer. A missing/oversized plate returns the QR untouched.
 */
function compositePlate(qrBuf, plate, pngjs) {
    if (!plate || !pngjs) return qrBuf;
    const img = pngjs.PNG.sync.read(qrBuf);
    if (plate.width > img.width || plate.height > img.height) return qrBuf;
    const x0 = Math.round((img.width - plate.width) / 2), y0 = Math.round((img.height - plate.height) / 2);
    for (let y = 0; y < plate.height; y++) {
        for (let x = 0; x < plate.width; x++) {
            const ps = (plate.width * y + x) << 2, pd = (img.width * (y0 + y) + (x0 + x)) << 2;
            const a = plate.data[ps + 3] / 255;                       // real alpha compositing
            for (let c = 0; c < 3; c++) img.data[pd + c] = Math.round(plate.data[ps + c] * a + img.data[pd + c] * (1 - a));
            img.data[pd + 3] = 255;
        }
    }
    return pngjs.PNG.sync.write(img);
}

/**
 * Render one branded QR.
 *   render({ payload, platePath, qrcode, pngjs, width?, margin? }) → Promise<Buffer>
 * `payload` is the exact string encoded in the code (JSON for the scanner families, a bare id
 * for the meetup family). Without qrcode the call throws — callers fall back to a plain QR URL.
 */
async function render({ payload, platePath, qrcode, pngjs, width, margin }) {
    if (!qrcode) throw new Error('qrcode_unavailable');
    const qrBuf = await qrcode.toBuffer(String(payload), {
        errorCorrectionLevel: 'H',
        width: Number(width) || 900,
        margin: Number.isFinite(margin) ? margin : 2,
        color: { dark: '#000000', light: '#ffffff' }
    });
    return compositePlate(qrBuf, loadPlate(platePath, pngjs), pngjs);
}

module.exports = { render, compositePlate, loadPlate, _plateCache: plateCache };
