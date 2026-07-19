
                    (function(){
                      function apiBase(){ return (typeof API_BASE!=='undefined')?API_BASE:''; }
                      function token(){ return (typeof UserPortal!=='undefined'&&UserPortal.token)||localStorage.getItem('medx_user_token'); }
                      function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
                      function MX(k,v){try{return (window.MedXI18n&&MedXI18n.t)?MedXI18n.t(k,v):k;}catch(e){return k;}}
                      var ICONS={plexus:'fa-users',gala:'fa-glass-cheers',accelerator:'fa-rocket',forum:'fa-landmark',bridges:'fa-globe-americas'};
                      var NAMES={plexus:'Plexus',gala:'Gala Evening',accelerator:'Accelerator',forum:'Biomedical Forum',bridges:'Building Bridges'};
                      var NAMES_HR={plexus:'Plexus',gala:'Gala večer',accelerator:'Accelerator',forum:'Biomedicinski forum',bridges:'Building Bridges'};
                      function PNM(k){ try{ if(window.MedXI18n&&MedXI18n.get&&MedXI18n.get()==='hr'&&NAMES_HR[k]) return NAMES_HR[k]; }catch(e){} return NAMES[k]||k; }
                      var CTA_HR={'Register':'proj.ctaRegister','Reserve seat':'proj.ctaReserve','Learn more':'proj.ctaLearnMore','Enter code':'proj.ctaEnterCode','View program':'proj.ctaViewProgram','Apply':'proj.ctaApply','Open':'home.ctaOpen'};
                      function CTA(label){ if(!label) return MX('home.ctaOpen'); try{ if(window.MedXI18n&&MedXI18n.get&&MedXI18n.get()==='hr'&&CTA_HR[label]) return MX(CTA_HR[label]); }catch(e){} return label; }
                      var KINDS={open:'open',soon:'soon',info:'info',closed:'closed'};
                      var NOTIFY_KEY='medx_notify_topics';
                      var STATUS_KEY='medx_project_status';
                      // Baked canonical fallback — mirrors the admin seed so the hub renders INSTANTLY
                      // from cache or this list. The words "Loading projects" are never user-visible.
                      var FALLBACK=[
                        {project_key:'plexus',status_label:'Pre-registration open',status_kind:'open',detail_line:'December 4-5, 2026 - Zagreb - Free entry',cta_label:'Register',cta_target:'plexus'},
                        {project_key:'gala',status_label:'Reserve your seat',status_kind:'open',detail_line:'Saturday December 5 - Hotel Esplanade - EUR 150 through 1 Sep',cta_label:'Reserve seat',cta_target:'gala'},
                        {project_key:'accelerator',status_label:'Applications open in November',status_kind:'soon',detail_line:'Placements across partner labs and clinics - November 2026',cta_label:'Learn more',cta_target:'accelerator'},
                        {project_key:'forum',status_label:'By invitation',status_kind:'info',detail_line:'Biomedical Forum gathering - May 2027',cta_label:'Enter code',cta_target:'forum'},
                        {project_key:'bridges',status_label:'Boston - September 2026',status_kind:'info',detail_line:'Building Bridges at Harvard Medical School',cta_label:'View program',cta_target:'bridges'}
                      ];
                      function cacheGet(){ try{ return JSON.parse(localStorage.getItem(NOTIFY_KEY)||'[]')||[]; }catch(e){ return []; } }
                      function cacheSet(a){ try{ localStorage.setItem(NOTIFY_KEY, JSON.stringify(a||[])); }catch(e){} }
                      function statusCacheGet(){ try{ var a=JSON.parse(localStorage.getItem(STATUS_KEY)||'null'); return (Array.isArray(a)&&a.length)?a:null; }catch(e){ return null; } }
                      function statusCacheSet(a){ try{ if(Array.isArray(a)&&a.length) localStorage.setItem(STATUS_KEY, JSON.stringify(a)); }catch(e){} }
                      var PH={ _projects:(statusCacheGet()||FALLBACK), _subs:cacheGet(),
                        // render = instant paint (cache/fallback) + silent background revalidate. Never a spinner.
                        render:function(){ var host=document.getElementById('mxProjectHub'); if(!host) return;
                          if(!PH._projects||!PH._projects.length) PH._projects=FALLBACK;
                          PH._subs=cacheGet(); PH._paint();
                          var tk=token(); if(!tk) return;
                          fetch(apiBase()+'/api/project-status',{headers:{'Authorization':'Bearer '+tk}})
                            .then(function(r){return r.ok?r.json():Promise.reject();})
                            .then(function(rows){ if(Array.isArray(rows)&&rows.length){ PH._projects=rows; statusCacheSet(rows); PH._paint(); } PH._loadSubs(tk); })
                            .catch(function(){ /* keep the instant cache/fallback paint */ }); },
                        _loadSubs:function(tk){ fetch(apiBase()+'/api/notify-topics',{headers:{'Authorization':'Bearer '+tk}})
                            .then(function(r){return r.ok?r.json():Promise.reject();})
                            .then(function(d){ PH._subs=(d&&Array.isArray(d.projects))?d.projects:[]; cacheSet(PH._subs); PH._paint(); if(window.MedXNotify)MedXNotify._reflect(); })
                            .catch(function(){}); },
                        _paint:function(){ var host=document.getElementById('mxProjectHub'); if(!host) return;
                          var list=(PH._projects&&PH._projects.length)?PH._projects:FALLBACK;
                          host.innerHTML=list.map(function(p){
                            var k=p.project_key; var kind=KINDS[p.status_kind]||'info'; var ico=ICONS[k]||'fa-star';
                            var on=PH._subs.indexOf(k)>=0; var target=p.cta_target||k;
                            return '<div class="mx-hub-card mx-hub-card--'+esc(k)+'" role="button" tabindex="0" onclick="MedXProjectHub.go(\''+esc(target)+'\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();MedXProjectHub.go(\''+esc(target)+'\');}">'
                              +'<div class="mx-hub-top"><div class="mx-hub-idname"><div class="mx-hub-ico"><i class="fas '+ico+'"></i></div>'
                              +'<div class="mx-hub-name">'+esc(PNM(k))+'</div></div>'
                              +'<button class="mx-hub-bell'+(on?' on':'')+'" title="'+(on?MX('home.notifyOn'):MX('home.notifyOff'))+'" aria-pressed="'+(on?'true':'false')+'" onclick="event.stopPropagation();MedXProjectHub.toggle(\''+esc(k)+'\',this)"><i class="fas fa-bell"></i></button></div>'
                              +'<span class="mx-hub-chip '+kind+'">'+esc(p.status_label||'')+'</span>'
                              +'<div class="mx-hub-detail">'+esc(p.detail_line||'')+'</div>'
                              +'<button class="mx-hub-cta" onclick="event.stopPropagation();MedXProjectHub.go(\''+esc(target)+'\')">'+esc(CTA(p.cta_label))+' <i class="fas fa-arrow-right"></i></button>'
                              +'</div>';
                          }).join(''); },
                        go:function(target){ if(typeof UserPortal!=='undefined'&&UserPortal.showSection) UserPortal.showSection(target); },
                        toggle:function(key,btn){ var tk=token(); if(!tk) return; var on=!(PH._subs.indexOf(key)>=0);
                          if(on){ if(PH._subs.indexOf(key)<0) PH._subs.push(key); } else { PH._subs=PH._subs.filter(function(x){return x!==key;}); }
                          cacheSet(PH._subs); if(window.MedXNotify)MedXNotify._reflect();
                          if(btn){ btn.classList.toggle('on',on); btn.title=on?MX('home.notifyOn'):MX('home.notifyOff'); btn.setAttribute('aria-pressed',on?'true':'false'); }
                          fetch(apiBase()+'/api/notify-topics',{method:'POST',headers:{'Authorization':'Bearer '+tk,'Content-Type':'application/json'},body:JSON.stringify({project:key,on:on})})
                            .then(function(r){return r.ok?r.json():Promise.reject();})
                            .catch(function(){ if(on){ PH._subs=PH._subs.filter(function(x){return x!==key;}); } else { PH._subs.push(key); } cacheSet(PH._subs); PH._paint(); if(window.MedXNotify)MedXNotify._reflect(); }); }
                      };
                      window.MedXProjectHub=PH;
                      document.addEventListener('medx:localechange',function(){ try{ PH._paint(); }catch(e){} });
                      // Instant synchronous paint — the grid element is already parsed just above this script.
                      try{ PH._paint(); }catch(e){}
                      if(document.readyState!=='loading'){ PH.render(); } else { document.addEventListener('DOMContentLoaded',function(){ PH.render(); }); }
                      window.addEventListener('hashchange',function(){ var h=(location.hash||'').replace('#',''); if(!h||h==='dashboard') PH.render(); });
                    })();
                    