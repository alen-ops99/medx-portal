
                    (function(){
                      function apiBase(){ return (typeof API_BASE!=='undefined')?API_BASE:''; }
                      function token(){ return (typeof UserPortal!=='undefined'&&UserPortal.token)||localStorage.getItem('medx_user_token'); }
                      function daysUntil(d){ try{ var t=new Date(d+'T00:00:00'); var now=new Date(); now.setHours(0,0,0,0); return Math.round((t-now)/86400000);}catch(e){return null;} }
                      function fmtRange(s,e){ try{ var sd=new Date(s+'T00:00:00'); if(e&&e!==s){var ed=new Date(e+'T00:00:00'); return sd.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' – '+ed.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});} return sd.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});}catch(e){return s;} }
                      function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
                      window.medxICS=function(r){ if(!r||!r.start_date)return; var ds=(r.start_date||'').replace(/-/g,''); var eb=r.end_date||r.start_date; var ed=new Date(eb+'T00:00:00'); ed.setDate(ed.getDate()+1); var de=''+ed.getFullYear()+String(ed.getMonth()+1).padStart(2,'0')+String(ed.getDate()).padStart(2,'0'); var loc=[r.venue_name,r.venue_city].filter(Boolean).join(', '); var ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Med&X//Portal//EN','BEGIN:VEVENT','UID:medx-'+(r.id||Math.random().toString(36).slice(2))+'@medx.hr','DTSTART;VALUE=DATE:'+ds,'DTEND;VALUE=DATE:'+de,'SUMMARY:'+(r.conference_name||'Med&X event'),'LOCATION:'+loc,'END:VEVENT','END:VCALENDAR'].join('\r\n'); var b=new Blob([ics],{type:'text/calendar;charset=utf-8'}); var u=URL.createObjectURL(b); var a=document.createElement('a'); a.href=u; a.download=(r.conference_name||'medx-event').replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'.ics'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function(){URL.revokeObjectURL(u);},1000); };
                      function T(k,v){try{return (window.MedXI18n&&MedXI18n.t)?MedXI18n.t(k,v):k;}catch(e){return k;}}
                      var NE={ _reg:null, _lastRegs:[],
                        render:function(){ var host=document.getElementById('upNextEvent'); if(!host) return; var tk=token(); if(!tk){ host.innerHTML=''; return; }
                          NE._paint([]); // paint the greeting hero immediately — no empty flash
                          fetch(apiBase()+'/api/registrations/my',{headers:{'Authorization':'Bearer '+tk}})
                            .then(function(r){return r.ok?r.json():Promise.reject();})
                            .then(function(regs){ NE._paint(Array.isArray(regs)?regs:[]); })
                            .catch(function(){ /* keep the greeting hero already painted */ }); },
                        _paint:function(regs){ var host=document.getElementById('upNextEvent'); if(!host) return; NE._lastRegs=regs||[];
                          var u=(typeof UserPortal!=='undefined'&&UserPortal.user)||{};
                          if(!u.first_name){ try{ u=JSON.parse(localStorage.getItem('medx_user_data')||'{}')||u; }catch(e){} }
                          var name=u.first_name||(u.name?String(u.name).split(' ')[0]:'')||'';
                          var hr=new Date().getHours(); var greet=hr<12?T('home.greetMorning'):(hr<18?T('home.greetAfternoon'):T('home.greetEvening'));
                          var today=new Date(); today.setHours(0,0,0,0);
                          var up=(regs||[]).filter(function(r){ var d=r.end_date||r.start_date; return d && new Date(d+'T00:00:00')>=today; })
                                     .sort(function(a,b){ return new Date((a.start_date||'')+'T00:00:00')-new Date((b.start_date||'')+'T00:00:00'); });
                          var body;
                          if(up.length){
                            var r=up[0]; NE._reg=r; var d=daysUntil(r.start_date);
                            var countdown=d===0?T('home.heroToday'):(d===1?T('home.heroTomorrow'):(d>1?T('home.heroInDays',{n:d}):''));
                            var paid=(r.payment_status==='paid'); var free=(!r.amount_paid||Number(r.amount_paid)===0);
                            var status=paid?T('home.statusPaid'):(free?T('home.statusConfirmed'):T('home.statusPending'));
                            var venue=[r.venue_name,r.venue_city].filter(Boolean).join(', ');
                            body='<div class="up-hero-eyebrow">'+T('home.heroYourNext')+(countdown?(' · '+countdown):'')+'<span class="up-hero-status">'+status+'</span></div>'
                              +'<div class="up-hero-event">'+esc(r.conference_name||T('home.eventFallback'))+'</div>'
                              +'<div class="up-hero-meta">'+esc(fmtRange(r.start_date,r.end_date))+(venue?(' · '+esc(venue)):'')+'</div>'
                              +'<div class="up-hero-actions"><button onclick="UserPortal.showSection(\'mymedx\')" class="up-hero-btn primary"><i class="fas fa-qrcode"></i> '+T('home.showTicket')+'</button>'
                              +'<button onclick="medxICS(MedXNextEvent._reg)" class="up-hero-btn ghost"><i class="fas fa-calendar-plus"></i> '+T('home.addCalendar')+'</button>'
                              +'<button onclick="if(typeof showQuickQR===\'function\')showQuickQR()" class="up-hero-btn ghost"><i class="fas fa-qrcode"></i> '+T('home.checkIn')+'</button>'
                              +'<button onclick="UserPortal.showSection(\'mymedx\')" class="up-hero-btn ghost"><i class="fas fa-user-circle"></i> '+T('home.myMedx')+'</button></div>';
                          } else {
                            body='<div class="up-hero-eyebrow">'+T('home.heroYourNext')+'</div>'
                              +'<div class="up-hero-event">'+T('home.discoverNext')+'</div>'
                              +'<div class="up-hero-meta">'+T('home.plexusOpen')+'</div>'
                              +'<div class="up-hero-actions"><button onclick="UserPortal.showSection(\'plexus\')" class="up-hero-btn primary"><i class="fas fa-arrow-right"></i> '+T('home.explorePlexus')+'</button>'
                              +'<button onclick="if(typeof showQuickQR===\'function\')showQuickQR()" class="up-hero-btn ghost"><i class="fas fa-qrcode"></i> '+T('home.checkIn')+'</button>'
                              +'<button onclick="UserPortal.showSection(\'mymedx\')" class="up-hero-btn ghost"><i class="fas fa-user-circle"></i> '+T('home.myMedx')+'</button></div>';
                          }
                          host.innerHTML='<div class="up-hero"><div class="up-hero-greeting">'+greet+(name?(', '+esc(name)):'')+'</div>'+body+'</div>'; }
                      };
                      window.MedXNextEvent=NE;
                      document.addEventListener('medx:localechange',function(){ try{ NE._paint(NE._lastRegs||[]); }catch(e){} });
                      function maybeRender(){ var h=(location.hash||'').replace('#',''); if(!h||h==='dashboard'){ NE.render(); } }
                      // Paint at DOMContentLoaded (all scripts parsed) instead of window.load + 250ms —
                      // waiting for every image/font left the hero slot empty on slow first loads.
                      if(document.readyState!=='loading') setTimeout(maybeRender,0); else document.addEventListener('DOMContentLoaded',function(){ setTimeout(maybeRender,0); });
                      window.addEventListener('hashchange',maybeRender);
                    })();
                    