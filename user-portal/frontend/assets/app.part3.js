
        // GLOBAL SEARCH — spotlight over pages, events, members, talks, and the member's own
        // items. Pages are indexed client-side (minus rewards for quiet profiles); everything
        // else comes from the additive read-only GET /api/member/search endpoint, which mirrors
        // the existing directory privacy rules (Forum directory stays members-only).
        (function(){
          function esc(v){ return (v==null?'':String(v)).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
          function token(){ return (typeof UserPortal!=='undefined'&&UserPortal.token)||localStorage.getItem('medx_user_token'); }
          function apiBase(){ return (typeof API_BASE!=='undefined')?API_BASE:''; }
          var PAGES=[
            {title:'Home', section:'dashboard', icon:'fa-home', kw:'home dashboard start overview'},
            {title:'Plexus Conference', section:'plexus', icon:'fa-users', kw:'plexus conference 2026 zagreb registration tickets abstracts'},
            {title:'Gala Evening 2026', section:'gala', icon:'fa-glass-cheers', kw:'gala evening dinner black tie seat'},
            {title:'Accelerator Program', section:'accelerator', icon:'fa-rocket', kw:'accelerator program application research'},
            {title:'Biomedical Forum', section:'forum', icon:'fa-landmark', kw:'biomedical forum members community'},
            {title:'Annual Forum 2026', section:'af26', icon:'fa-calendar-star', kw:'annual forum af26 convening'},
            {title:'Building Bridges', section:'bridges', icon:'fa-handshake', kw:'building bridges event zagreb'},
            {title:'Talk Library', section:'talks', icon:'fa-video', kw:'talk library talks videos lectures recordings'},
            {title:'My Network', section:'network', icon:'fa-network-wired', kw:'network connections people attendees directory members'},
            {title:'My Med&X', section:'mymedx', icon:'fa-id-badge', kw:'my medx tickets qr code registrations certificates record'},
            {title:'Settings', section:'settings', icon:'fa-cog', kw:'settings profile account password photo email preferences'},
            {title:'Rewards', section:'rewards', icon:'fa-gift', kw:'rewards points redeem', playful:true}
          ];
          var GROUPS=[['pages','Pages'],['events','Events'],['members','Members'],['talks','Talks'],['mine','Your items']];
          var ICONS={conference:'fa-users',bridges:'fa-handshake',forum_event:'fa-landmark',attendee:'fa-user',forum_member:'fa-user',talk:'fa-video',ticket:'fa-ticket-alt',gala_registration:'fa-glass-cheers',bridges_registration:'fa-ticket-alt'};
          var GS={
            _open:false,_timer:null,_seq:0,_flat:[],_active:-1,_lastQ:'',
            open:function(){
              if(!token()) return; // members only — the portal search means nothing logged out
              var ov=document.getElementById('upSearchOverlay'); if(!ov) return;
              ov.classList.add('open'); this._open=true; this._active=-1; this._flat=[];
              var inp=document.getElementById('upSearchInput');
              if(inp){ inp.value=''; setTimeout(function(){ inp.focus(); },30); }
              this._lastQ='';
              this._renderHint();
            },
            close:function(){
              var ov=document.getElementById('upSearchOverlay'); if(ov) ov.classList.remove('open');
              this._open=false; clearTimeout(this._timer);
            },
            toggle:function(){ if(this._open) this.close(); else this.open(); },
            _renderHint:function(){
              var box=document.getElementById('upSearchResults'); if(!box) return;
              box.innerHTML='<div class="up-gs-hint">Try &ldquo;plexus&rdquo;, &ldquo;gala&rdquo;, a colleague&rsquo;s name, or a talk title.</div>';
            },
            _pagesFor:function(q){
              var quiet = !!(window.MedXQuiet && MedXQuiet.isQuiet());
              var ql=q.toLowerCase();
              return PAGES.filter(function(p){
                if(p.playful && quiet) return false; // quiet profiles never see rewards entries
                return p.title.toLowerCase().indexOf(ql)>-1 || p.kw.indexOf(ql)>-1;
              }).slice(0,5).map(function(p){ return {kind:'page', title:p.title, detail:'Go to '+p.title, section:p.section, icon:p.icon}; });
            },
            onInput:function(q){
              var self=this;
              clearTimeout(this._timer);
              q=String(q||'').trim();
              this._lastQ=q;
              if(q.length<2){ this._renderHint(); this._flat=[]; this._active=-1; return; }
              this._timer=setTimeout(function(){ self._run(q); },180);
            },
            _run:function(q){
              var self=this, seq=++this._seq;
              var groups={pages:this._pagesFor(q),events:[],members:[],talks:[],mine:[]};
              this._render(groups,true);
              fetch(apiBase()+'/api/member/search?q='+encodeURIComponent(q),{headers:{'Authorization':'Bearer '+token()}})
                .then(function(r){ return r.ok?r.json():null; })
                .then(function(d){
                  if(seq!==self._seq||!self._open) return; // a newer query superseded this one
                  if(d){ groups.events=d.events||[]; groups.members=d.members||[]; groups.talks=d.talks||[]; groups.mine=d.mine||[]; }
                  self._render(groups,false);
                })
                .catch(function(){ if(seq===self._seq&&self._open) self._render(groups,false); });
            },
            _render:function(groups,loading){
              var box=document.getElementById('upSearchResults'); if(!box) return;
              var html='', flat=[], idx=0;
              GROUPS.forEach(function(g){
                var items=groups[g[0]]||[];
                if(!items.length) return;
                html+='<div class="up-gs-group">'+g[1]+'</div>';
                items.forEach(function(it){
                  flat.push(it);
                  var icon=it.icon||ICONS[it.kind]||'fa-arrow-right';
                  html+='<div class="up-gs-item" role="option" data-idx="'+idx+'" onmousemove="GlobalSearch._hover('+idx+')" onclick="GlobalSearch._go('+idx+')">'
                      +'<span class="up-gs-ico"><i class="fas '+icon+'"></i></span>'
                      +'<span style="min-width:0;"><div class="up-gs-ttl">'+esc(it.title)+'</div>'
                      +(it.detail?('<div class="up-gs-sub">'+esc(it.detail)+'</div>'):'')+'</span></div>';
                  idx++;
                });
              });
              if(!html) html='<div class="up-gs-empty">'+(loading?'Searching&hellip;':'Nothing found for &ldquo;'+esc(this._lastQ)+'&rdquo;.')+'</div>';
              box.innerHTML=html;
              this._flat=flat;
              if(this._active>=flat.length) this._active=flat.length?0:-1;
              if(this._active<0&&flat.length) this._active=0;
              this._paintActive();
            },
            _paintActive:function(){
              var box=document.getElementById('upSearchResults'); if(!box) return;
              var self=this;
              box.querySelectorAll('.up-gs-item').forEach(function(el){
                var on=Number(el.getAttribute('data-idx'))===self._active;
                el.classList.toggle('active',on);
                if(on&&el.scrollIntoView) el.scrollIntoView({block:'nearest'});
              });
            },
            _hover:function(i){ if(this._active!==i){ this._active=i; this._paintActive(); } },
            _move:function(d){
              if(!this._flat.length) return;
              this._active=(this._active+d+this._flat.length)%this._flat.length;
              this._paintActive();
            },
            _go:function(i){
              var it=this._flat[i]; if(!it) return;
              this.close();
              try{ if(it.section&&typeof UserPortal!=='undefined') UserPortal.showSection(it.section); }catch(e){}
            },
            onKey:function(e){
              if(e.key==='ArrowDown'){ e.preventDefault(); this._move(1); }
              else if(e.key==='ArrowUp'){ e.preventDefault(); this._move(-1); }
              else if(e.key==='Enter'){ e.preventDefault(); if(this._active>-1) this._go(this._active); }
              else if(e.key==='Escape'){ e.preventDefault(); this.close(); }
            }
          };
          window.GlobalSearch=GS;
          document.addEventListener('keydown',function(e){
            if((e.metaKey||e.ctrlKey)&&(e.key==='k'||e.key==='K')){ e.preventDefault(); e.stopImmediatePropagation(); GS.toggle(); return; }
            if(GS._open&&e.key==='Escape'){ e.preventDefault(); GS.close(); }
          });
          document.addEventListener('DOMContentLoaded',function(){
            var ov=document.getElementById('upSearchOverlay');
            if(ov) ov.addEventListener('mousedown',function(e){ if(e.target===ov) GS.close(); });
            var inp=document.getElementById('upSearchInput');
            if(inp){
              inp.addEventListener('input',function(){ GS.onInput(inp.value); });
              inp.addEventListener('keydown',function(e){ GS.onKey(e); });
            }
          });
        })();
        