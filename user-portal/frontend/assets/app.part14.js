
        (function(){
          "use strict";

          var TICK_MS = 30000;      // client tick: recompute + auto-advance, no reload
          var PREROLL_MIN = 60;     // board wakes 60 min before the first session
          var POSTROLL_MIN = 30;    // and rests 30 min after the last
          var DEFAULT_DUR_MIN = 60; // assumed length when a session has no endTime
          var DISPLAY_PAGE = 3;     // NOW cards per projector page before it cycles
          var DISPLAY_CYCLE_MS = 7000;

          // Event registry — reusable per event. getSchedule() returns the SAME array the
          // program tab reads (ConferenceData.schedule); dayDates maps the day index to a real
          // calendar date (the labels already shown on the program), it does NOT fork the data.
          var EVENTS = {
            'plexus-2026': {
              id: 'plexus-2026',
              title: 'Plexus 2026',
              dayDates: { 1: '2026-12-04', 2: '2026-12-05' },
              getSchedule: function(){
                return (typeof ConferenceData !== 'undefined' && Array.isArray(ConferenceData.schedule)) ? ConferenceData.schedule : [];
              }
            }
          };
          var ACTIVE_EVENT = 'plexus-2026';
          function ev(){ return EVENTS[ACTIVE_EVENT]; }

          // ---------- clock (real, or a mock that still advances in real time) ----------
          var _clockBase = null, _clockRef = 0;
          function setMockNow(iso){ var tt = Date.parse(iso); if (isNaN(tt)) return false; _clockBase = tt; _clockRef = Date.now(); return true; }
          function now(){ return _clockBase != null ? new Date(_clockBase + (Date.now() - _clockRef)) : new Date(); }

          function params(){
            var out = {};
            try {
              var qs = new URLSearchParams(location.search); qs.forEach(function(v,k){ out[k]=v; });
              if (location.hash && location.hash.indexOf('=') >= 0){
                var hs = new URLSearchParams(location.hash.replace(/^#/,'')); hs.forEach(function(v,k){ if(!(k in out)) out[k]=v; });
              }
            } catch(e){}
            return out;
          }
          var _p = params();
          var _isDisplay = (_p.display === '1' || _p.display === 'true');
          var _isPreview = _isDisplay || (_p.livepreview === '1' || _p.livepreview === 'true');

          // ---------- i18n ----------
          function t(k, vars){
            try { if (window.MedXI18n && MedXI18n.t){ var v = MedXI18n.t(k, vars||{}); if (v && v !== k) return v; } } catch(e){}
            var fb = _FALLBACK[k] || k; // English fallback if MedXI18n absent
            if (vars) { for (var kk in vars) fb = fb.replace('{'+kk+'}', vars[kk]); }
            return fb;
          }
          var _FALLBACK = {
            'plb.live':'Live','plb.preview':'Preview','plb.happeningNow':'Happening now','plb.upNext':'Up next',
            'plb.laterToday':'Later today','plb.completedCount':'{n} completed','plb.betweenSessions':'Between sessions',
            'plb.nextAt':'Up next at {time}','plb.startingNow':'starting now','plb.inMin':'in {n} min',
            'plb.inHrMin':'in {h} h {m} min','plb.inHr':'in {h} h','plb.endsInMin':'ends in {n} min',
            'plb.endsInHrMin':'ends in {h} h {m} min','plb.endsInHr':'ends in {h} h','plb.endingNow':'ending now',
            'plb.dayLabel':'Day {n}','plb.noSessions':'No sessions scheduled','plb.allDone':'The program for today has ended',
            'plb.viewProgram':'View full program','plb.boardHint':'Live during the conference: where to be, right now',
            'plb.liveProgram':'Live program','plb.beginsOn':'The program begins on {date}'
          };
          function registerI18n(){
            if (!window.MedXI18n || !MedXI18n.extend) return;
            MedXI18n.extend({
              'plb.live':          {en:'Live',            hr:'Uživo'},
              'plb.preview':       {en:'Preview',         hr:'Pregled'},
              'plb.happeningNow':  {en:'Happening now',   hr:'Trenutačno u tijeku'},
              'plb.upNext':        {en:'Up next',         hr:'Slijedi'},
              'plb.laterToday':    {en:'Later today',     hr:'Kasnije danas'},
              'plb.completedCount':{en:'{n} completed',   hr:'Završeno: {n}'},
              'plb.betweenSessions':{en:'Between sessions',hr:'Pauza između sesija'},
              'plb.nextAt':        {en:'Up next at {time}',hr:'Slijedi u {time}'},
              'plb.startingNow':   {en:'starting now',    hr:'počinje sada'},
              'plb.inMin':         {en:'in {n} min',      hr:'za {n} min'},
              'plb.inHrMin':       {en:'in {h} h {m} min',hr:'za {h} h {m} min'},
              'plb.inHr':          {en:'in {h} h',        hr:'za {h} h'},
              'plb.endsInMin':     {en:'ends in {n} min', hr:'završava za {n} min'},
              'plb.endsInHrMin':   {en:'ends in {h} h {m} min',hr:'završava za {h} h {m} min'},
              'plb.endsInHr':      {en:'ends in {h} h',   hr:'završava za {h} h'},
              'plb.endingNow':     {en:'ending now',      hr:'uskoro završava'},
              'plb.dayLabel':      {en:'Day {n}',         hr:'{n}. dan'},
              'plb.noSessions':    {en:'No sessions scheduled', hr:'Nema zakazanih sesija'},
              'plb.allDone':       {en:'The program for today has ended', hr:'Program za danas je završen'},
              'plb.viewProgram':   {en:'View full program', hr:'Pogledajte cijeli program'},
              'plb.boardHint':     {en:'Live during the conference: where to be, right now', hr:'Uživo tijekom konferencije: gdje trebate biti, upravo sada'},
              'plb.liveProgram':   {en:'Live program',     hr:'Program uživo'},
              'plb.beginsOn':      {en:'The program begins on {date}', hr:'Program počinje u {date}'}
            });
          }

          // ---------- datetime helpers ----------
          function mkDate(day, hhmm){ var d = ev().dayDates[day]; if (!d || !hhmm) return null; var tt = Date.parse(d + 'T' + hhmm + ':00'); return isNaN(tt) ? null : new Date(tt); }
          function startOf(s){ return mkDate(s.day, s.time); }
          function endOf(s){ var e = s.endTime ? mkDate(s.day, s.endTime) : null; if (e) return e; var st = startOf(s); return st ? new Date(st.getTime() + DEFAULT_DUR_MIN*60000) : null; }
          function pad2(n){ return String(n).padStart(2,'0'); }
          function hhmm(d){ return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
          function esc(x){ try { return escapeHtml(String(x==null?'':x)); } catch(e){ return String(x==null?'':x); } }

          function iconFor(s){
            var ty = s.type || '', ti = (s.title||'').toLowerCase();
            if (ty === 'break') return ti.indexOf('lunch') >= 0 ? 'fa-utensils' : 'fa-coffee';
            if (ty === 'networking') return ti.indexOf('gala') >= 0 ? 'fa-glass-cheers' : 'fa-users';
            if (ty === 'workshop') return 'fa-chalkboard-teacher';
            if (ty === 'oral') return 'fa-file-alt';
            return 'fa-star';
          }
          function relStart(mins){ if (mins <= 0) return t('plb.startingNow'); if (mins < 60) return t('plb.inMin',{n:mins}); var h=Math.floor(mins/60), m=mins%60; return m>0 ? t('plb.inHrMin',{h:h,m:m}) : t('plb.inHr',{h:h}); }
          function relEnd(mins){ if (mins <= 0) return t('plb.endingNow'); if (mins < 60) return t('plb.endsInMin',{n:mins}); var h=Math.floor(mins/60), m=mins%60; return m>0 ? t('plb.endsInHrMin',{h:h,m:m}) : t('plb.endsInHr',{h:h}); }

          // ---------- state machine ----------
          function annotate(nowD){
            var list = ev().getSchedule().slice().map(function(s){
              var st = startOf(s), en = endOf(s), state = 'upcoming';
              if (st && en){ if (nowD >= en) state='done'; else if (nowD >= st) state='now'; else state='upcoming'; }
              return { s:s, start:st, end:en, state:state };
            }).filter(function(x){ return x.start && x.end; });
            list.sort(function(a,b){ return a.start - b.start; });
            return list;
          }
          function windowFor(list){ if (!list.length) return null; var first = list[0].start.getTime(); var last = list.reduce(function(m,x){ return Math.max(m, x.end.getTime()); }, 0); return { open:first - PREROLL_MIN*60000, close:last + POSTROLL_MIN*60000 }; }
          function inWindow(nowD, list){ var w = windowFor(list); if (!w) return false; var tt = nowD.getTime(); return tt >= w.open && tt <= w.close; }
          function focusedDay(list, nowD){
            var nowItems = list.filter(function(x){ return x.state==='now'; });
            if (nowItems.length) return nowItems[0].s.day;
            var next = list.filter(function(x){ return x.state==='upcoming'; })[0];
            if (next) return next.s.day;
            var last = list[list.length-1];
            return last ? last.s.day : (parseInt(Object.keys(ev().dayDates)[0],10) || 1);
          }
          function model(nowD){
            var list = annotate(nowD);
            var day = focusedDay(list, nowD);
            var dayItems = list.filter(function(x){ return String(x.s.day) === String(day); });
            var nowItems = dayItems.filter(function(x){ return x.state==='now'; });
            var upcoming = dayItems.filter(function(x){ return x.state==='upcoming'; });
            var done = dayItems.filter(function(x){ return x.state==='done'; });
            var nextStart = upcoming.length ? upcoming[0].start.getTime() : null;
            var nextItems = nextStart != null ? upcoming.filter(function(x){ return x.start.getTime() === nextStart; }) : [];
            var laterItems = nextStart != null ? upcoming.filter(function(x){ return x.start.getTime() > nextStart; }) : [];
            return { list:list, day:day, nowItems:nowItems, nextItems:nextItems, laterItems:laterItems, doneItems:done, inWindow:inWindow(nowD, list), nowD:nowD };
          }

          function dayLabelText(day){
            var d = ev().dayDates[day], ds = '';
            try { if (window.MedXI18n && MedXI18n.formatDate) ds = MedXI18n.formatDate(d + 'T00:00:00', { weekday:'long', day:'numeric', month:'long' }); else ds = new Date(d + 'T00:00:00').toLocaleDateString(); } catch(e){}
            var dl = t('plb.dayLabel', { n:day });
            return ds ? (dl + ' · ' + ds) : dl;
          }

          // ---------- in-page render (Schedule tab) ----------
          function nowCardHTML(x){
            var s = x.s, nowD = model._lastNow || now();
            var total = (x.end - x.start) || 1, elapsed = Math.min(Math.max(nowD - x.start, 0), total);
            var pct = Math.round((elapsed/total)*100);
            var minsLeft = Math.max(0, Math.round((x.end - nowD)/60000));
            return '<div class="pxlb-now-card">'
              + '<div class="pxlb-now-live"><span class="pxlb-dot"></span> ' + esc(t('plb.live')) + '</div>'
              + '<div class="pxlb-room"><i class="fas fa-map-marker-alt"></i> ' + esc(s.room||'') + '</div>'
              + '<h3 class="pxlb-title">' + esc(s.title||'') + '</h3>'
              + (s.speaker ? '<div class="pxlb-speaker">' + esc(s.speaker) + '</div>' : '<div class="pxlb-speaker" style="margin-bottom:16px;"></div>')
              + '<div class="pxlb-progress"><div class="pxlb-progress-bar" style="width:' + pct + '%"></div></div>'
              + '<div class="pxlb-meta">' + esc(s.time) + (s.endTime ? ' – ' + esc(s.endTime) : '') + ' · ' + esc(relEnd(minsLeft)) + '</div>'
              + '</div>';
          }
          function nextCardHTML(x){
            var s = x.s, nowD = model._lastNow || now();
            var minsTo = Math.max(0, Math.round((x.start - nowD)/60000));
            return '<div class="pxlb-next-card">'
              + '<div class="pxlb-next-when">' + esc(relStart(minsTo)) + ' · ' + esc(s.time) + '</div>'
              + '<div class="pxlb-room"><i class="fas fa-map-marker-alt"></i> ' + esc(s.room||'') + '</div>'
              + '<h4 class="pxlb-title-sm">' + esc(s.title||'') + '</h4>'
              + (s.speaker ? '<div class="pxlb-speaker">' + esc(s.speaker) + '</div>' : '')
              + '</div>';
          }
          function boardHTML(m){
            model._lastNow = m.nowD;
            var live = m.inWindow;
            var statusCls = live ? 'pxlb-status-live' : 'pxlb-status-preview';
            var statusTxt = live ? t('plb.live') : t('plb.preview');
            var h = '<div class="pxlb-card"><div class="pxlb">';
            h += '<div class="pxlb-head"><div class="pxlb-head-l">'
               + '<span class="pxlb-status ' + statusCls + '"><span class="pxlb-dot"></span> ' + esc(statusTxt) + '</span>'
               + '<span class="pxlb-day">' + esc(dayLabelText(m.day)) + '</span></div>'
               + '<div class="pxlb-clock">' + esc(hhmm(m.nowD)) + '</div></div>';
            h += '<p class="pxlb-intro">' + esc(t('plb.boardHint')) + '</p>';

            // NOW
            h += '<div class="pxlb-section"><div class="pxlb-label">' + esc(t('plb.happeningNow')) + '</div>';
            if (m.nowItems.length){ h += '<div class="pxlb-now-grid">' + m.nowItems.map(nowCardHTML).join('') + '</div>'; }
            else {
              var sub = m.nextItems.length ? t('plb.nextAt', { time: m.nextItems[0].s.time }) : t('plb.allDone');
              var head = m.nextItems.length ? t('plb.betweenSessions') : t('plb.allDone');
              h += '<div class="pxlb-idle"><div class="pxlb-title">' + esc(head) + '</div>'
                 + (m.nextItems.length ? '<div class="pxlb-idle-sub">' + esc(sub) + '</div>' : '') + '</div>';
            }
            h += '</div>';

            // UP NEXT
            if (m.nextItems.length && m.nowItems.length){
              h += '<div class="pxlb-section"><div class="pxlb-label">' + esc(t('plb.upNext')) + '</div>'
                 + '<div class="pxlb-next-grid">' + m.nextItems.map(nextCardHTML).join('') + '</div></div>';
            } else if (m.nextItems.length && !m.nowItems.length){
              // between sessions: still surface the next cards for room clarity
              h += '<div class="pxlb-section"><div class="pxlb-label">' + esc(t('plb.upNext')) + '</div>'
                 + '<div class="pxlb-next-grid">' + m.nextItems.map(nextCardHTML).join('') + '</div></div>';
            }

            // LATER + completed count
            if (m.laterItems.length){
              var countTxt = m.doneItems.length ? '<span class="pxlb-count">' + esc(t('plb.completedCount', { n:m.doneItems.length })) + '</span>' : '';
              h += '<div class="pxlb-section"><div class="pxlb-label">' + esc(t('plb.laterToday')) + countTxt + '</div><ul class="pxlb-later">';
              h += m.laterItems.map(function(x){ var s=x.s; return '<li class="pxlb-later-item"><span class="pxlb-later-time">' + esc(s.time) + '</span><span class="pxlb-later-title">' + esc(s.title||'') + '</span><span class="pxlb-later-room">' + esc(s.room||'') + '</span></li>'; }).join('');
              h += '</ul></div>';
            } else if (!m.nowItems.length && !m.nextItems.length){
              h += '<div class="pxlb-section"><div class="pxlb-idle"><div class="pxlb-title">' + esc(m.list.length ? t('plb.allDone') : t('plb.noSessions')) + '</div></div></div>';
            }

            h += '</div></div>';
            return h;
          }

          // Quiet pre-event state: outside event days the board holds a slim card
          // naming the first program date instead of vanishing. After the event it rests.
          function preEventHTML(m){
            var firstDay = m.list.length ? m.list[0].s.day : (parseInt(Object.keys(ev().dayDates)[0],10) || 1);
            var dateIso = ev().dayDates[firstDay], ds = '';
            try {
              if (window.MedXI18n && MedXI18n.formatDate) ds = MedXI18n.formatDate(dateIso + 'T00:00:00', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
              else ds = new Date(dateIso + 'T00:00:00').toLocaleDateString();
            } catch(e){}
            return '<div class="pxlb-card"><div class="pxlb pxlb-pre">'
              + '<div class="pxlb-pre-icon"><i class="fas fa-calendar-day"></i></div>'
              + '<div class="pxlb-pre-text"><div class="pxlb-label pxlb-pre-eyebrow">' + esc(ev().title) + ' · ' + esc(t('plb.liveProgram')) + '</div>'
              + '<div class="pxlb-pre-line">' + esc(t('plb.beginsOn', { date: ds })) + '</div>'
              + '<div class="pxlb-idle-sub">' + esc(t('plb.boardHint')) + '</div></div>'
              + '</div></div>';
          }
          function renderPageInto(mountEl, m){
            if (m.inWindow || _isPreview){
              mountEl.style.display = 'block';
              mountEl.innerHTML = boardHTML(m);
              return;
            }
            var w = windowFor(m.list);
            if (w && m.nowD.getTime() < w.open){
              mountEl.style.display = 'block';
              mountEl.innerHTML = preEventHTML(m);
              return;
            }
            mountEl.style.display = 'none';
            mountEl.innerHTML = '';
          }
          function reflectTabIndicator(on){ var tab = document.querySelector('.px-tab[data-tab="schedule"]'); if (tab) tab.classList.toggle('pxlb-tab-live', on); }

          // ---------- projector render (?display=1) ----------
          var _dispIdx = 0, _dispShell = null;
          function buildDisplayShell(){
            if (_dispShell) return;
            _dispShell = document.createElement('div');
            _dispShell.id = 'pxlbDisplay';
            document.body.appendChild(_dispShell);
            document.documentElement.classList.add('pxlb-display-lock');
          }
          function displayHTML(m){
            model._lastNow = m.nowD;
            var pages = Math.max(1, Math.ceil(m.nowItems.length / DISPLAY_PAGE));
            if (_dispIdx >= pages) _dispIdx = 0;
            var slice = m.nowItems.slice(_dispIdx*DISPLAY_PAGE, _dispIdx*DISPLAY_PAGE + DISPLAY_PAGE);
            var h = '<div class="pxlbd-top"><div><div class="pxlbd-brand">' + esc(ev().title) + '</div>'
                  + '<div class="pxlbd-day">' + esc(dayLabelText(m.day)) + '</div></div>'
                  + '<div class="pxlbd-clockwrap"><div class="pxlbd-clock">' + esc(hhmm(m.nowD)) + '<small>CET</small></div></div></div>';
            h += '<div class="pxlbd-mid">';
            h += '<div><div class="pxlbd-label"><span class="pxlbd-livepill"><span class="pxlb-dot"></span> ' + esc(t('plb.live')) + '</span> ' + esc(t('plb.happeningNow')) + '</div>';
            if (slice.length){
              h += '<div class="pxlbd-now">' + slice.map(function(x){ var s=x.s, minsLeft=Math.max(0,Math.round((x.end-m.nowD)/60000));
                return '<div class="pxlbd-now-card"><div class="pxlbd-room">' + esc(s.room||'') + '</div>'
                  + '<div class="pxlbd-title">' + esc(s.title||'') + '</div>'
                  + (s.speaker ? '<div class="pxlbd-speaker">' + esc(s.speaker) + '</div>' : '')
                  + '<div class="pxlbd-meta">' + esc(s.time) + (s.endTime ? ' – ' + esc(s.endTime) : '') + ' · ' + esc(relEnd(minsLeft)) + '</div></div>';
              }).join('') + '</div>';
              if (pages > 1){ var dots=''; for (var i=0;i<pages;i++) dots += '<span class="' + (i===_dispIdx?'on':'') + '"></span>'; h += '<div class="pxlbd-dots">' + dots + '</div>'; }
            } else {
              var head = m.nextItems.length ? t('plb.betweenSessions') : (m.list.length ? t('plb.allDone') : t('plb.noSessions'));
              h += '<div class="pxlbd-idle"><div class="pxlbd-title">' + esc(head) + '</div></div>';
            }
            h += '</div></div>';
            if (m.nextItems.length){
              h += '<div class="pxlbd-next"><div class="pxlbd-label">' + esc(t('plb.upNext')) + '</div>'
                 + m.nextItems.map(function(x){ var s=x.s, minsTo=Math.max(0,Math.round((x.start-m.nowD)/60000));
                     return '<div class="pxlbd-next-item"><span class="pxlbd-next-when">' + esc(relStart(minsTo)) + '</span><b>' + esc(s.title||'') + '</b><span class="pxlbd-next-room">' + esc(s.room||'') + '</span></div>'; }).join('')
                 + '</div>';
            }
            return h;
          }
          function renderDisplay(m){ buildDisplayShell(); _dispShell.innerHTML = displayHTML(m); }

          // ---------- loop ----------
          var _started = false, _dispTimer = null;
          function refresh(){
            var m = model(now());
            var mounts = document.querySelectorAll('.pxlb-mount');
            for (var i=0;i<mounts.length;i++) renderPageInto(mounts[i], m);
            reflectTabIndicator(m.inWindow || _isPreview);
            if (_isDisplay) renderDisplay(m);
          }

          // Schedule poll (~60s, visible tab only): re-reads /api/plexus/sessions so a
          // program change made in the EXISTING admin schedule tooling reaches the board
          // mid-event with no reload. Change-detected — the page's own loader (which also
          // re-renders the program tab) runs ONLY when the payload actually changed.
          var POLL_MS = 60000, _lastPollRaw = null;
          function pollSchedule(){
            if (document.hidden) return;
            var m = model(now());
            if (!(m.inWindow || _isPreview)) return; // poll only while the board is awake
            fetch('/api/plexus/sessions').then(function(r){ return r.ok ? r.json() : null; }).then(function(rows){
              if (!rows || !rows.length) return;
              var raw = JSON.stringify(rows);
              if (_lastPollRaw === null){ _lastPollRaw = raw; return; } // baseline = what init already rendered
              if (raw === _lastPollRaw) return;
              _lastPollRaw = raw;
              try {
                if (typeof PlexusPortal !== 'undefined' && PlexusPortal.loadScheduleFromDB){
                  Promise.resolve(PlexusPortal.loadScheduleFromDB()).then(refresh, refresh);
                  return;
                }
              } catch(e){}
              refresh();
            }).catch(function(){});
          }

          function start(){
            if (_started) return; _started = true;
            if (_p.now) setMockNow(_p.now);
            try { if (typeof ConferenceData !== 'undefined' && (!ConferenceData.schedule || !ConferenceData.schedule.length)) ConferenceData.init(); } catch(e){}
            registerI18n();
            if (_isDisplay) buildDisplayShell();
            refresh();
            setInterval(function(){ if (!document.hidden) refresh(); }, TICK_MS);
            setInterval(pollSchedule, POLL_MS);
            document.addEventListener('visibilitychange', function(){ if (!document.hidden){ refresh(); pollSchedule(); } });
            if (_isDisplay) _dispTimer = setInterval(function(){ _dispIdx++; renderDisplay(model(now())); }, DISPLAY_CYCLE_MS);
            document.addEventListener('medx:localechange', refresh);
            try { if (typeof ConferenceData !== 'undefined' && ConferenceData.onChange) ConferenceData.onChange(refresh); } catch(e){}
            var tabs = document.getElementById('pxTabs');
            if (tabs) tabs.addEventListener('click', function(){ setTimeout(refresh, 40); });
          }

          function boot(){ start(); }
          if (document.readyState !== 'loading') boot(); else document.addEventListener('DOMContentLoaded', boot);

          window.PlexusLiveBoard = {
            refresh: refresh, start: start, now: now, setMockNow: function(iso){ var ok=setMockNow(iso); refresh(); return ok; },
            model: function(){ return model(now()); }, isDisplay: function(){ return _isDisplay; }, isPreview: function(){ return _isPreview; },
            poll: pollSchedule
          };
        })();
        