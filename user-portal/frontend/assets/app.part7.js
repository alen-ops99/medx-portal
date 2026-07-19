
                    (function(){
                      function MX(k,v){try{return (window.MedXI18n&&MedXI18n.t)?MedXI18n.t(k,v):k;}catch(e){return k;}}
                      var NHR={plexus:'Plexus',gala:'Gala večer',accelerator:'Accelerator',forum:'Biomedicinski forum',bridges:'Building Bridges'};
                      function NM(nm,k){ try{ if(window.MedXI18n&&MedXI18n.get&&MedXI18n.get()==='hr'&&NHR[k]) return NHR[k]; }catch(e){} return nm; }
                      var M={
                        KEY:'medx_notify_topics',
                        NAMES:{plexus:'Plexus',gala:'the Gala Evening',accelerator:'the Accelerator',forum:'the Biomedical Forum',bridges:'Building Bridges'},
                        SECTIONS:{plexus:'up-section-plexus',gala:'up-section-gala',accelerator:'up-section-accelerator',forum:'up-section-forum',bridges:'up-section-bridges'},
                        _tk:function(){ return (typeof UserPortal!=='undefined'&&UserPortal.token)||localStorage.getItem('medx_user_token'); },
                        _base:function(){ return (typeof API_BASE!=='undefined')?API_BASE:''; },
                        _esc:function(s){ return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); },
                        subs:function(){ try{ return JSON.parse(localStorage.getItem(this.KEY)||'[]')||[]; }catch(e){ return []; } },
                        _save:function(a){ try{ localStorage.setItem(this.KEY, JSON.stringify(a||[])); }catch(e){} },
                        isOn:function(k){ return this.subs().indexOf(k)>=0; },
                        toggle:function(k){ var tk=this._tk(); if(!tk) return; var on=!this.isOn(k); var s=this.subs();
                          if(on){ if(s.indexOf(k)<0) s.push(k); } else { s=s.filter(function(x){return x!==k;}); }
                          this._save(s); this._reflect(); this._syncHub(s);
                          fetch(this._base()+'/api/notify-topics',{method:'POST',headers:{'Authorization':'Bearer '+tk,'Content-Type':'application/json'},body:JSON.stringify({project:k,on:on})})
                            .then(function(r){return r.ok?r.json():Promise.reject();})
                            .catch(function(){ var s2=M.subs(); if(on){ s2=s2.filter(function(x){return x!==k;}); } else { if(s2.indexOf(k)<0) s2.push(k); } M._save(s2); M._reflect(); M._syncHub(s2); }); },
                        _syncHub:function(s){ if(window.MedXProjectHub){ try{ MedXProjectHub._subs=(s||[]).slice(); MedXProjectHub._paint(); }catch(e){} } },
                        _reflect:function(){ var s=this.subs(); document.querySelectorAll('[data-mx-notify]').forEach(function(row){ var k=row.getAttribute('data-mx-notify'); var on=s.indexOf(k)>=0; row.classList.toggle('on',on); var sw=row.querySelector('.mx-notify-switch'); if(sw) sw.setAttribute('aria-checked',on?'true':'false'); var st=row.querySelector('.mx-notify-state'); if(st) st.textContent=on?MX('home.stateOn'):MX('home.stateOff'); }); },
                        _rowHTML:function(k){ var name=this._esc(NM(this.NAMES[k]||k,k));
                          return '<div class="mx-notify-row" data-mx-notify="'+this._esc(k)+'">'
                            +'<div class="mx-notify-ico"><i class="fas fa-bell"></i></div>'
                            +'<div class="mx-notify-copy"><div class="mx-notify-title">'+MX('home.notifyFrom',{name:name})+'</div>'
                            +'<div class="mx-notify-sub">'+MX('home.notifySub')+'</div></div>'
                            +'<span class="mx-notify-state">'+MX('home.stateOff')+'</span>'
                            +'<button type="button" class="mx-notify-switch" role="switch" aria-checked="false" aria-label="'+MX('home.notifyAria',{name:name})+'" onclick="MedXNotify.toggle(\''+this._esc(k)+'\')"></button>'
                            +'</div>'; },
                        ensureRows:function(){ var self=this;
                          Object.keys(this.SECTIONS).forEach(function(k){
                            var host=document.getElementById(self.SECTIONS[k]); if(!host) return;
                            if(host.querySelector('[data-mx-notify="'+k+'"]')) return;
                            var statusEl=host.querySelector('[data-mx-status="'+k+'"]'); if(!statusEl) return;
                            var hero=statusEl;
                            while(hero&&hero.parentElement&&!/(^|\s)(up-container|bb-container)(\s|$)/.test(hero.parentElement.className||'')) hero=hero.parentElement;
                            if(!hero||!hero.parentElement) return;
                            var tmp=document.createElement('div'); tmp.innerHTML=self._rowHTML(k); var row=tmp.firstChild;
                            hero.parentElement.insertBefore(row, hero.nextSibling);
                          });
                          this._reflect(); }
                      };
                      window.MedXNotify=M;
                      document.addEventListener('medx:localechange',function(){ try{ document.querySelectorAll('[data-mx-notify]').forEach(function(row){ var k=row.getAttribute('data-mx-notify'); var tmp=document.createElement('div'); tmp.innerHTML=M._rowHTML(k); var nr=tmp.firstChild; if(nr&&row.parentElement){ row.parentElement.replaceChild(nr,row); } }); M._reflect(); }catch(e){} });
                      function boot(){ try{ M.ensureRows(); }catch(e){} }
                      if(document.readyState!=='loading') boot(); else document.addEventListener('DOMContentLoaded',boot);
                      window.addEventListener('load',boot);
                      window.addEventListener('hashchange',function(){ try{ M.ensureRows(); }catch(e){} });
                    })();
                    