/**
 * shared/photo-files.js — removing a member's portrait FILES (not the users.photo_url column), for both backends:
 *   user-portal/backend/v2/profile.js      DELETE /api/v2/profile/photo, and account deletion (server.js)
 *   admin-portal/backend/v2/safety-ops.js  CLEAR PROFILE on a report (the team removes an offending portrait)
 *
 * Where a portrait can live:
 *   <uploadsRoot>/profile/<id>.(jpg|png|webp)      the member portal's own upload (served under /uploads)
 *   Cloudinary medx/profile/<id>                    the same upload when CLOUDINARY_URL is set
 *   a separate URL we issued earlier                 /uploads/(profile|photos)/<file>, or a medx/… Cloudinary id
 * The separate URL is removed only when opts.stillUsed(url) does not report another owner.
 *
 * Split in two so a caller can answer first and do the slow part after: removeLocal() is synchronous disk work;
 * destroyCloud() talks to Cloudinary (a no-op without CLOUDINARY_URL). Both are best effort and never throw.
 * The Cloudinary SDK is installed per backend (not under shared/), so the caller hands it in: opts.cloud is a
 * function returning the SDK's v2 object, e.g. () => require('cloudinary').v2 called from that backend.
 * Sends nothing and calls no other network service.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PORTRAIT_EXTS = ['jpg', 'png', 'webp'];
const safeId = id => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');

// uploads/profile/<id>.* on disk (every extension except `keep`, the file just written by an upload)
function removeLocalPortraits(uploadsRoot, userId, keep) {
    PORTRAIT_EXTS.forEach(ext => {
        const f = path.join(uploadsRoot, 'profile', `${safeId(userId)}.${ext}`);
        if (f !== keep) { try { fs.unlinkSync(f); } catch (e) { /* not there */ } }
    });
}

// Destroy one Cloudinary asset given its delivery URL, only when its public id sits under `prefix`
// (e.g. 'medx/profile/'). No CLOUDINARY_URL → nothing to do. Resolves true when a destroy was sent.
const sdk = (opts) => { try { return opts && typeof opts.cloud === 'function' ? opts.cloud() : null; } catch (e) { return null; } };
async function destroyCloudAsset(url, prefix, opts) {
    try {
        if (!process.env.CLOUDINARY_URL || typeof url !== 'string') return false;
        const cloud = sdk(opts);
        if (!cloud) return false;
        const m = url.split('?')[0].match(/^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|raw|video)\/upload\/(?:[^/]*,[^/]*\/)?(?:v\d+\/)?(.+?)(\.[A-Za-z0-9]+)?$/);
        if (!m) return false;
        const resourceType = m[1];
        const publicId = resourceType === 'raw' ? m[2] + (m[3] || '') : m[2];
        if (prefix && !publicId.startsWith(prefix)) return false;
        await cloud.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
        return true;
    } catch (e) { return false; }
}

const cleanUrl = (photoUrl) => (typeof photoUrl === 'string' ? photoUrl.trim() : '');
const inUse = (opts, url) => { try { return !!(opts && typeof opts.stillUsed === 'function' && opts.stillUsed(url)); } catch (e) { return true; } };

// the disk part: the member's own portrait files, plus a separate /uploads/(profile|photos) file nobody else uses
function removeLocal(uploadsRoot, userId, photoUrl, opts) {
    try { removeLocalPortraits(uploadsRoot, userId, null); } catch (e) { /* best effort */ }
    const url = cleanUrl(photoUrl);
    if (!url || inUse(opts, url)) return;
    const local = url.split('?')[0].match(/^\/uploads\/(profile|photos)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/);
    if (local) { try { fs.unlinkSync(path.join(uploadsRoot, local[1], local[2])); } catch (e) { /* already gone */ } }
}

// the Cloudinary part: medx/profile/<id>, plus a separate medx/… asset nobody else uses
async function destroyCloud(userId, photoUrl, opts) {
    const cloud = process.env.CLOUDINARY_URL ? sdk(opts) : null;
    if (!cloud) return;
    try { await cloud.uploader.destroy('medx/profile/' + safeId(userId), { invalidate: true }); } catch (e) { /* best effort */ }
    const url = cleanUrl(photoUrl);
    if (!url || inUse(opts, url) || /^\/uploads\//.test(url)) return;
    await destroyCloudAsset(url, 'medx/', opts);
}

// both, in order
async function removePhotoFor(uploadsRoot, userId, photoUrl, opts) {
    removeLocal(uploadsRoot, userId, photoUrl, opts);
    await destroyCloud(userId, photoUrl, opts);
}

module.exports = { PORTRAIT_EXTS, safeId, removeLocalPortraits, destroyCloudAsset, removeLocal, destroyCloud, removePhotoFor };
