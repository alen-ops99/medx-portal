
                    (function(){
                      function apiBase(){ return (typeof API_BASE!=='undefined')?API_BASE:''; }
                      function token(){ return (typeof UserPortal!=='undefined'&&UserPortal.token)||localStorage.getItem('medx_user_token'); }
                      var S={ _rows:null,
                        fill:function(){ if(!S._rows) return; var map={}; S._rows.forEach(function(r){ map[r.project_key]=r; });
                          document.querySelectorAll('[data-mx-status]').forEach(function(el){ var r=map[el.getAttribute('data-mx-status')]; if(r&&r.status_label){ var _k=el.getAttribute('data-i18n'); if(_k&&window.MedXI18n&&MedXI18n.get&&MedXI18n.get()==='hr'&&MedXI18n.t){ var _tv=MedXI18n.t(_k); el.textContent=(_tv&&_tv!==_k)?_tv:r.status_label; } else { el.textContent=r.status_label; } } });
                          document.querySelectorAll('[data-mx-detail]').forEach(function(el){ var r=map[el.getAttribute('data-mx-detail')]; if(r&&r.detail_line) el.textContent=r.detail_line; }); },
                        refresh:function(){ var h={'Accept':'application/json'}; var tk=token(); if(tk) h['Authorization']='Bearer '+tk;
                          fetch(apiBase()+'/api/project-status',{headers:h})
                            .then(function(r){return r.ok?r.json():Promise.reject();})
                            .then(function(rows){ S._rows=Array.isArray(rows)?rows:[]; S.fill(); })
                            .catch(function(){ /* keep baked fallback text */ }); },
                        apply:function(){ if(S._rows) S.fill(); else S.refresh(); } };
                      window.MedXSectionStatus=S;
                      document.addEventListener('medx:localechange',function(){ try{ if(S._rows) S.fill(); }catch(e){} });
                      if(document.readyState!=='loading') S.refresh(); else window.addEventListener('load',function(){ S.refresh(); });
                      window.addEventListener('hashchange',function(){ if(S._rows) S.fill(); else S.refresh(); });
                    })();
                    