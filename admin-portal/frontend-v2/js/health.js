// js/health.js — the "ALL SYSTEMS OK" pill (note 0b: a DOOR to /settings/health) and the footer
// SYSTEM HEALTH line. Three probes, all real:
//   1. GET /health                      admin backend up (no auth)
//   2. GET <memberBase>/api/public/status   member portal up (through the /__member proxy on staging /
//                                       dev; production: same origin or an opaque no-cors reachability probe)
//   3. GET /api/admin/system-health     the 24-check report (auth; 403 for admins without `tech`)
// State: ok (green, "ALL SYSTEMS OK →") · warn (amber, "17 OK · 7 TO CHECK →") · fail (crimson) ·
// unknown (locked/unreachable). Cached in state.health; refreshed every 5 minutes while mounted.
import cfg from './config.js';
import { api, ApiError } from './api.js';
import { state, session } from './state.js';

const TTL_MS = 5 * 60 * 1000;
let lastAt = 0, inflight = null;

async function probeMember() {
  const url = cfg.memberBase + '/api/public/status';
  try {
    const r = await fetch(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
    if (r.ok) { const d = await r.json().catch(() => null); return { ok: true, detail: d && Array.isArray(d.projects) ? d.projects.length + ' project cards served' : 'reachable' }; }
    return { ok: false, detail: 'HTTP ' + r.status };
  } catch (e) {
    // cross-origin without CORS: an opaque response still proves the server answered
    try { await fetch(url, { mode: 'no-cors', credentials: 'omit' }); return { ok: true, detail: 'reachable (opaque)' }; }
    catch (e2) { return { ok: false, detail: 'unreachable' }; }
  }
}

export const health = {
  get() { return state.get().health; },
  async refresh({ force = false } = {}) {
    if (!force && inflight) return inflight;
    if (!force && state.get().health && Date.now() - lastAt < TTL_MS) return state.get().health;
    inflight = (async () => {
      const [admin, member, report] = await Promise.all([
        api.get('/health', { noAuth: true }).then(d => ({ ok: !!(d && d.ok), detail: 'responding' })).catch(e => ({ ok: false, detail: e.message })),
        probeMember(),
        session.isAuthed ? api.get('/api/admin/system-health', { keepSession: true }).then(d => ({ ok: true, data: d })).catch(e => ({ ok: false, locked: e instanceof ApiError && e.isLocked, detail: e.message })) : Promise.resolve({ ok: false, detail: 'signed out' })
      ]);
      const counts = report.ok && report.data && report.data.counts ? report.data.counts : { ok: 0, warn: 0, fail: 0 };
      const probesFailed = (admin.ok ? 0 : 1) + (member.ok ? 0 : 1);
      const fail = (counts.fail || 0) + probesFailed;
      const warn = counts.warn || 0;
      const ok = (counts.ok || 0) + (admin.ok ? 1 : 0) + (member.ok ? 1 : 0);
      let st = 'ok';
      if (fail > 0) st = 'fail'; else if (warn > 0) st = 'warn'; else if (!report.ok) st = report.locked ? 'locked' : 'unknown';
      const label = st === 'ok' ? 'ALL SYSTEMS OK' : st === 'fail' ? `${fail} FAILING · ${warn} TO CHECK` : st === 'warn' ? `${ok} OK · ${warn} TO CHECK` : st === 'locked' ? 'HEALTH · LOCKED' : 'HEALTH · UNKNOWN';
      const color = st === 'ok' ? '#2f7d4f' : st === 'fail' ? '#9b1b22' : st === 'warn' ? '#b7791f' : '#6d6459';
      const h = { state: st, ok, warn, fail, label, color, probes: { admin, member, report: report.ok ? { ok: true, overall: report.data.overall, generated_at: report.data.generated_at } : report }, groups: report.ok ? report.data.groups : null, at: new Date().toISOString() };
      lastAt = Date.now();
      state.set({ health: h });
      return h;
    })();
    try { return await inflight; } finally { inflight = null; }
  }
};
export default health;
