
    window.GuestPass = (function(){
        function api(path, opts){ return (typeof UserPortal !== 'undefined' && UserPortal.api) ? UserPortal.api(path, opts) : fetch(path, opts).then(function(r){ return r.json(); }); }
        function t(k, v){ try{ return (window.MedXI18n && MedXI18n.t) ? MedXI18n.t(k, v) : k; }catch(e){ return k; } }
        function esc(x){ return String(x==null?'':x).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
        function toast(kind, msg){ try{ if(typeof Toast !== 'undefined' && Toast[kind]) Toast[kind](msg); else console.log(msg); }catch(e){} }

        var EVENT_META = {
            plexus:  { icon:'fa-microscope', nameKey:'gp.eventPlexus' },
            bridges: { icon:'fa-handshake',  nameKey:'gp.eventBridges' }
        };
        // Registry of mounted surfaces so create/revoke can re-render every one of them.
        var mounts = [];
        function register(containerId, eventKey){
            if (!mounts.some(function(m){ return m.containerId === containerId && m.eventKey === eventKey; })) mounts.push({ containerId: containerId, eventKey: eventKey });
        }
        function refresh(){ mounts.forEach(function(m){ if (m.eventKey === 'hub') renderHub(m.containerId, true); else renderEventCard(m.containerId, m.eventKey, true); }); }

        function statusChip(p){
            var label, color, bg;
            if (p.status === 'revoked') { label = t('gp.statusRevoked'); color = 'var(--muted,#6b6258)'; bg = 'var(--paper-2,#f3efe9)'; }
            else if (p.status === 'checked_in' || p.checked_in) { label = t('gp.statusCheckedIn'); color = '#2f6b3a'; bg = 'rgba(47,107,58,.12)'; }
            else { label = t('gp.statusInvited'); color = '#8a6d1f'; bg = 'rgba(201,169,98,.16)'; }
            return '<span style="font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:'+color+';background:'+bg+';border-radius:999px;padding:3px 9px;white-space:nowrap;">'+esc(label)+'</span>';
        }

        function passRow(p){
            var revokeBtn = (p.status !== 'revoked')
                ? '<button onclick="GuestPass.revoke(\''+p.id+'\')" style="background:transparent;border:1px solid var(--line-strong,#d8d1c6);color:var(--ink,#15110f);border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit;">'+esc(t('gp.revoke'))+'</button>'
                : '';
            var strike = (p.status === 'revoked') ? 'text-decoration:line-through;opacity:.6;' : '';
            return '<div style="display:flex;align-items:center;gap:10px;justify-content:space-between;padding:9px 0;border-top:1px solid var(--line,#e2dcd3);">'
                + '<div style="min-width:0;'+strike+'"><div style="font-size:13px;font-weight:600;color:var(--ink,#15110f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(p.guest_name)+'</div>'
                + '<div style="font-size:11.5px;color:var(--muted,#6b6258);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(p.guest_email)+'</div></div>'
                + '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'+statusChip(p)+revokeBtn+'</div>'
                + '</div>';
        }

        function cardHtml(eventKey, d){
            var meta = EVENT_META[eventKey] || EVENT_META.plexus;
            var name = (d && d.event_name) ? d.event_name : t(meta.nameKey);
            var limit = (d && d.limit != null) ? d.limit : 2;
            var remaining = (d && d.remaining != null) ? d.remaining : limit;
            var passes = (d && Array.isArray(d.passes)) ? d.passes : [];
            var full = remaining <= 0;
            var btn = '<button class="gp-card-btn" onclick="GuestPass.open(\''+eventKey+'\')"'+(full?' disabled':'')+' style="display:inline-flex;align-items:center;gap:8px;background:'+(full?'var(--paper-2,#eee)':'var(--crimson,#9b1b22)')+';color:'+(full?'var(--muted,#6b6258)':'#fff')+';border:none;border-radius:10px;padding:10px 16px;font-size:13px;font-weight:700;cursor:'+(full?'not-allowed':'pointer')+';font-family:inherit;flex-shrink:0;"><i class="fas fa-user-plus"></i> '+esc(t('gp.cta'))+'</button>';
            var counter = full
                ? '<div style="font-size:12px;color:var(--crimson,#9b1b22);margin-top:12px;font-weight:600;"><i class="fas fa-circle-info"></i> '+esc(t('gp.limitReached'))+'</div>'
                : '<div style="font-size:12px;color:var(--muted,#6b6258);margin-top:12px;">'+esc(t('gp.remaining', { n: remaining, limit: limit }))+'</div>';
            var list = '';
            if (passes.length){
                list = '<div style="margin-top:14px;"><div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted,#6b6258);margin-bottom:2px;">'+esc(t('gp.yourPasses'))+'</div>'
                    + passes.map(passRow).join('') + '</div>';
            }
            return '<div style="background:var(--surface,#fff);border:1px solid var(--line,#e2dcd3);border-radius:16px;padding:18px 20px;box-shadow:var(--shadow-sm,0 1px 2px rgba(21,17,15,.04));">'
                + '<div class="gp-card-head" style="display:flex;align-items:flex-start;gap:14px;justify-content:space-between;flex-wrap:wrap;">'
                    + '<div style="display:flex;gap:12px;align-items:center;min-width:0;flex:1;">'
                        + '<span style="width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,var(--crimson,#9b1b22),var(--crimson-deep,#7d161c));color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;"><i class="fas '+meta.icon+'"></i></span>'
                        + '<div style="min-width:0;"><div style="font-size:15px;font-weight:700;color:var(--ink,#15110f);font-family:var(--serif,\'Fraunces\',serif);line-height:1.15;">'+esc(name)+'</div>'
                        + '<div style="font-size:12.5px;color:var(--muted,#6b6258);margin-top:3px;line-height:1.5;">'+esc(t('gp.cardDesc'))+'</div></div>'
                    + '</div>'
                    + btn
                + '</div>'
                + counter
                + list
                + '</div>';
        }

        function renderEventCard(containerId, eventKey, skipRegister){
            var el = document.getElementById(containerId);
            if (!el) return;
            if (!skipRegister) register(containerId, eventKey);
            api('/api/guest-passes?event=' + encodeURIComponent(eventKey))
                .then(function(d){ if (document.getElementById(containerId)) el.innerHTML = cardHtml(eventKey, d); })
                .catch(function(){ if (document.getElementById(containerId)) el.innerHTML = '<div style="font-size:12.5px;color:var(--muted,#6b6258);padding:12px;">'+esc(t('gp.loadError'))+'</div>'; });
        }

        function renderHub(containerId, skipRegister){
            var el = document.getElementById(containerId);
            if (!el) return;
            if (!skipRegister) register(containerId, 'hub');
            el.innerHTML = '<div id="'+containerId+'_plexus" style="margin-bottom:12px;"></div><div id="'+containerId+'_bridges"></div>';
            renderEventCard(containerId + '_plexus', 'plexus', true);
            renderEventCard(containerId + '_bridges', 'bridges', true);
        }

        function close(){ var m = document.getElementById('gpModal'); if (m) m.remove(); }

        function renderModal(eventKey, d){
            close();
            var meta = EVENT_META[eventKey] || EVENT_META.plexus;
            var name = (d && d.event_name) ? d.event_name : t(meta.nameKey);
            var limit = (d && d.limit != null) ? d.limit : 2;
            var remaining = (d && d.remaining != null) ? d.remaining : limit;
            var full = remaining <= 0;
            var overlay = document.createElement('div');
            overlay.id = 'gpModal';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(21,17,15,.55);z-index:100000;display:flex;align-items:center;justify-content:center;padding:18px;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);';
            overlay.onclick = function(e){ if (e.target === overlay) close(); };
            var sendDisabled = full ? ' disabled' : '';
            overlay.innerHTML =
                '<div role="dialog" aria-modal="true" style="background:var(--surface,#fff);border:1px solid var(--line,#e2dcd3);border-radius:20px;max-width:460px;width:100%;overflow:hidden;box-shadow:0 24px 60px rgba(21,17,15,.28);">'
                + '<div style="background:linear-gradient(135deg,var(--crimson,#9b1b22),var(--crimson-deep,#7d161c));padding:20px 24px;color:#fff;">'
                    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">'
                        + '<div><div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.82;font-weight:700;">'+esc(name)+'</div>'
                        + '<h2 style="margin:4px 0 0;font-size:20px;font-weight:700;font-family:var(--serif,\'Fraunces\',serif);">'+esc(t('gp.modalTitle'))+'</h2></div>'
                        + '<button onclick="GuestPass.close()" aria-label="Close" style="background:rgba(255,255,255,.16);border:none;width:30px;height:30px;border-radius:50%;color:#fff;font-size:13px;cursor:pointer;flex-shrink:0;"><i class="fas fa-times"></i></button>'
                    + '</div>'
                + '</div>'
                + '<div style="padding:20px 24px;">'
                    + '<div style="display:flex;gap:9px;align-items:flex-start;background:rgba(201,169,98,.12);border:1px solid rgba(201,169,98,.4);border-radius:11px;padding:11px 13px;margin-bottom:16px;">'
                        + '<i class="fas fa-user-shield" style="color:var(--gold,#c9a962);margin-top:2px;"></i>'
                        + '<div style="font-size:12.5px;color:var(--ink,#15110f);line-height:1.5;">'+esc(t('gp.attendsUnder', { limit: limit }))+'</div>'
                    + '</div>'
                    + (full ? '<div style="font-size:13px;color:var(--crimson,#9b1b22);font-weight:600;margin-bottom:14px;">'+esc(t('gp.limitReached'))+'</div>' : '')
                    + '<label style="display:block;font-size:12px;font-weight:700;color:var(--ink,#15110f);margin:0 0 5px;">'+esc(t('gp.guestName'))+'</label>'
                    + '<input id="gpName" type="text" maxlength="100" placeholder="'+esc(t('gp.guestNamePh'))+'" style="width:100%;box-sizing:border-box;border:1px solid var(--line-strong,#d8d1c6);border-radius:10px;padding:11px 13px;font-size:14px;font-family:inherit;margin-bottom:13px;background:var(--paper,#fbf9f6);color:var(--ink,#15110f);">'
                    + '<label style="display:block;font-size:12px;font-weight:700;color:var(--ink,#15110f);margin:0 0 5px;">'+esc(t('gp.guestEmail'))+'</label>'
                    + '<input id="gpEmail" type="email" maxlength="254" placeholder="'+esc(t('gp.guestEmailPh'))+'" style="width:100%;box-sizing:border-box;border:1px solid var(--line-strong,#d8d1c6);border-radius:10px;padding:11px 13px;font-size:14px;font-family:inherit;margin-bottom:13px;background:var(--paper,#fbf9f6);color:var(--ink,#15110f);">'
                    + '<label style="display:block;font-size:12px;font-weight:700;color:var(--ink,#15110f);margin:0 0 5px;">'+esc(t('gp.note'))+'</label>'
                    + '<textarea id="gpNote" maxlength="280" rows="2" placeholder="'+esc(t('gp.notePh'))+'" style="width:100%;box-sizing:border-box;border:1px solid var(--line-strong,#d8d1c6);border-radius:10px;padding:11px 13px;font-size:14px;font-family:inherit;margin-bottom:18px;resize:vertical;background:var(--paper,#fbf9f6);color:var(--ink,#15110f);"></textarea>'
                    + '<div style="display:flex;gap:10px;justify-content:flex-end;">'
                        + '<button onclick="GuestPass.close()" style="background:transparent;border:1px solid var(--line-strong,#d8d1c6);color:var(--ink,#15110f);border-radius:10px;padding:11px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">'+esc(t('gp.cancel'))+'</button>'
                        + '<button id="gpSendBtn" onclick="GuestPass.submit(\''+eventKey+'\')"'+sendDisabled+' style="background:var(--crimson,#9b1b22);color:#fff;border:none;border-radius:10px;padding:11px 20px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;"><i class="fas fa-paper-plane"></i> '+esc(t('gp.send'))+'</button>'
                    + '</div>'
                + '</div>'
                + '</div>';
            document.body.appendChild(overlay);
            var nameEl = document.getElementById('gpName'); if (nameEl && !full) nameEl.focus();
        }

        function open(eventKey){
            api('/api/guest-passes?event=' + encodeURIComponent(eventKey))
                .then(function(d){ renderModal(eventKey, d); })
                .catch(function(){ renderModal(eventKey, { limit: 2, remaining: 2, passes: [] }); });
        }

        function submit(eventKey){
            var name = (document.getElementById('gpName') || {}).value; name = (name || '').trim();
            var email = (document.getElementById('gpEmail') || {}).value; email = (email || '').trim();
            var note = (document.getElementById('gpNote') || {}).value; note = (note || '').trim();
            if (!name) { toast('error', t('gp.errName')); return; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('error', t('gp.errEmail')); return; }
            var btn = document.getElementById('gpSendBtn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + esc(t('gp.sending')); }
            api('/api/guest-passes', { method: 'POST', body: JSON.stringify({ event: eventKey, guest_name: name, guest_email: email, note: note }) })
                .then(function(){ toast('success', t('gp.sentToast', { name: name })); close(); refresh(); })
                .catch(function(err){
                    var msg = (err && err.body && err.body.error) || t('gp.loadError');
                    toast('error', msg);
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> ' + esc(t('gp.send')); }
                });
        }

        async function revoke(id){
            if (!(await mxConfirm({ destructive: true, title: t('gp.revokeTitle'), message: t('gp.confirmRevoke'), confirmText: t('gp.revoke') }))) return;
            api('/api/guest-passes/' + encodeURIComponent(id) + '/revoke', { method: 'POST' })
                .then(function(){ toast('success', t('gp.revokedToast')); refresh(); })
                .catch(function(err){ toast('error', (err && err.body && err.body.error) || t('gp.loadError')); });
        }

        return { renderHub: renderHub, renderEventCard: renderEventCard, open: open, close: close, submit: submit, revoke: revoke, refresh: refresh };
    })();
    