
        (function(){
          var PROJECT_SET={plexus:1,gala:1,accelerator:1,forum:1,bridges:1,af26:1,speaker:1};
          function setActive(sec){
            var bar=document.getElementById('upTopbar'); if(!bar) return;
            bar.querySelectorAll('.up-tb-item[data-nav]').forEach(function(el){
              var nav=el.getAttribute('data-nav');
              var on=(nav===sec)||(nav==='projects'&&!!PROJECT_SET[sec]);
              el.classList.toggle('active',on);
              if(on){el.setAttribute('aria-current','page');}else{el.removeAttribute('aria-current');}
            });
          }
          function readUser(){ var u={}; try{ u=JSON.parse(localStorage.getItem('medx_user_data')||'{}')||{}; }catch(e){}
            if((!u.first_name)&&typeof UserPortal!=='undefined'&&UserPortal.user) u=UserPortal.user; return u||{}; }
          function txt(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; }
          function setUser(){ var u=readUser();
            var nm=((u.first_name||'')+' '+(u.last_name||'')).trim()||(u.name||'')||(u.email?String(u.email).split('@')[0]:'Member');
            var av=((u.first_name||u.name||u.email||'M').charAt(0)||'M').toUpperCase();
            var email=u.email||''; var tier=(function(){ try{ if(window.MedXI18n&&MedXI18n.t){ var _v=MedXI18n.t('mmx.cardMemberFallback'); if(_v&&_v!=='mmx.cardMemberFallback') return _v; } }catch(e){} return 'Med&X Member'; })();
            txt('upTbUserName',nm); txt('upTbAvatar',av); txt('upTbTier',tier);
            txt('upAcctName',nm); txt('upAcctAvatar',av); txt('upAcctEmail',email); txt('upAcctTierText',tier);
          }
          window.MedXRail={ set:function(sec){ setActive(sec); setUser(); }, setUser:setUser };
          // Keep the per-navigation sync hook so the top-bar active state always matches the section.
          if(window.MedXBottomNav){ var _o=window.MedXBottomNav.syncFromSection;
            window.MedXBottomNav.syncFromSection=function(sec){ if(_o){try{_o.call(this,sec);}catch(e){}} try{ setActive(sec); }catch(e){} }; }
          window.addEventListener('load',function(){ var sc=(location.hash||'').replace('#','')||'dashboard'; setActive(sc); setUser(); });
          if(document.readyState!=='loading'){ setUser(); }
          document.addEventListener('medx:localechange', function(){ try{ setUser(); }catch(e){} });
          // Faint shadow on the sticky top bar after scroll.
          window.addEventListener('scroll',function(){ var b=document.getElementById('upTopbar'); if(b) b.classList.toggle('scrolled', window.scrollY>4); },{passive:true});
        })();
        