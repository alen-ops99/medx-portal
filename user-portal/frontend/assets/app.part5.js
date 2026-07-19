
                    (function(){
                      var LS_KEY='medx_profile_nudge_dismissed';
                      function token(){ return (typeof UserPortal!=='undefined'&&UserPortal.token)||localStorage.getItem('medx_user_token'); }
                      function apiBase(){ return (typeof API_BASE!=='undefined')?API_BASE:''; }
                      function MX(k,v){try{return (window.MedXI18n&&MedXI18n.t)?MedXI18n.t(k,v):k;}catch(e){return k;}}
                      var N={
                        render:function(){
                          var host=document.getElementById('upProfileNudge'); if(!host) return;
                          var tk=token(); if(!tk){ host.style.display='none'; return; }
                          if(localStorage.getItem(LS_KEY)==='1'){ host.style.display='none'; return; }
                          // Client persona gate — the server re-checks with the same quiet derivation.
                          if(window.MedXQuiet&&MedXQuiet.isQuiet()){ host.style.display='none'; return; }
                          fetch(apiBase()+'/api/member/profile-nudge',{headers:{'Authorization':'Bearer '+tk}})
                            .then(function(r){ return r.ok?r.json():{show:false}; })
                            .then(function(d){
                              if(!d||!d.show){ host.style.display='none'; return; }
                              if(window.MedXQuiet&&MedXQuiet.isQuiet()){ host.style.display='none'; return; }
                              host.innerHTML='<div class="up-nudge-card" role="status">'
                                +'<div class="up-nudge-ico"><i class="fas fa-user-circle"></i></div>'
                                +'<div class="up-nudge-text">'+MX('home.nudgeText')+'</div>'
                                +'<button class="up-nudge-btn" onclick="MedXProfileNudge.addPhoto()"><i class="fas fa-camera"></i> '+MX('home.nudgeAddPhoto')+'</button>'
                                +'<button class="up-nudge-x" aria-label="'+MX('home.dismiss')+'" title="'+MX('home.dismiss')+'" onclick="MedXProfileNudge.dismiss()">&times;</button>'
                                +'</div>';
                              host.style.display='';
                            })
                            .catch(function(){ host.style.display='none'; });
                        },
                        dismiss:function(){
                          try{ localStorage.setItem(LS_KEY,'1'); }catch(e){}
                          var host=document.getElementById('upProfileNudge');
                          if(host){ host.style.display='none'; host.innerHTML=''; }
                          var tk=token(); if(!tk) return;
                          fetch(apiBase()+'/api/member/profile-nudge/dismiss',{method:'POST',headers:{'Authorization':'Bearer '+tk}}).catch(function(){});
                        },
                        addPhoto:function(){
                          try{ UserPortal.showSection('settings'); }catch(e){}
                          setTimeout(function(){ try{ if(window.SettingsPortal&&SettingsPortal.uploadPhoto) SettingsPortal.uploadPhoto(); }catch(e){} },350);
                        }
                      };
                      window.MedXProfileNudge=N;
                      document.addEventListener('medx:localechange',function(){ try{ N.render(); }catch(e){} });
                      function maybe(){ var h=(location.hash||'').replace('#',''); if(!h||h==='dashboard'){ setTimeout(function(){ N.render(); },80); } }
                      if(document.readyState!=='loading') setTimeout(maybe,0); else document.addEventListener('DOMContentLoaded',function(){ setTimeout(maybe,0); });
                      window.addEventListener('hashchange',maybe);
                    })();
                    