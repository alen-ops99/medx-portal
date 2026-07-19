
        (function(){
          if(window.MedXAssistant) return;
          var DICT={
            'asst.title':{en:'Med&X Assistant',hr:'Med&X asistent'},
            'asst.subtitle':{en:'Here to help with events and membership',hr:'Tu smo za pitanja o događanjima i članstvu'},
            'asst.placeholder':{en:'Ask about tickets, dates, membership...',hr:'Pitajte o ulaznicama, datumima, članstvu...'},
            'asst.close':{en:'Close',hr:'Zatvorite'},
            'asst.send':{en:'Send',hr:'Pošaljite'},
            'asst.greeting':{en:'Hello. I can help with Med&X events, tickets, and membership. What would you like to know?',hr:'Dobar dan. Mogu pomoći oko Med&X događanja, ulaznica i članstva. Što Vas zanima?'},
            'asst.s1':{en:'When is the conference?',hr:'Kada je konferencija?'},
            'asst.s2':{en:'How much is a ticket?',hr:'Koliko košta ulaznica?'},
            'asst.s3':{en:'When is the gala?',hr:'Kada je gala?'},
            'asst.s4':{en:'Is membership free?',hr:'Je li članstvo besplatno?'},
            'asst.helpfulQ':{en:'Was this helpful?',hr:'Je li ovo bilo od pomoći?'},
            'asst.yes':{en:'Yes',hr:'Da'},
            'asst.no':{en:'No',hr:'Ne'},
            'asst.thanks':{en:'Thank you for the note.',hr:'Hvala Vam na povratnoj informaciji.'},
            'asst.connect':{en:'Connect me with the team',hr:'Povežite me s timom'},
            'asst.sent':{en:'Sent. Our team will reply to you by email.',hr:'Poslano. Naš tim javit će Vam se e-poštom.'},
            'asst.error':{en:'Something went wrong. Please try again in a moment.',hr:'Nešto je pošlo po zlu. Pokušajte ponovno za trenutak.'},
            'asst.offline':{en:'I could not reach the server. Please try again in a moment.',hr:'Nisam mogao doći do poslužitelja. Pokušajte ponovno za trenutak.'}
          };
          try{ if(window.MedXI18n && MedXI18n.extend) MedXI18n.extend(DICT); }catch(e){}
          function t(k){ try{ if(window.MedXI18n&&MedXI18n.t) return MedXI18n.t(k); }catch(e){} var d=DICT[k]; return d?(d.en):k; }
          function loc(){ try{ if(window.MedXI18n&&MedXI18n.get){ var l=MedXI18n.get(); return l==='hr'?'hr':'en'; } }catch(e){} return 'en'; }
          function esc(v){ return (v==null?'':String(v)).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
          function token(){ try{ return (window.UserPortal&&UserPortal.token)||localStorage.getItem('medx_user_token'); }catch(e){ return null; } }
          function apiBase(){ try{ return (typeof API_BASE!=='undefined')?API_BASE:''; }catch(e){ return ''; } }

          var panel,fab,body,input,sendBtn,started=false,busy=false;
          function el(id){ return document.getElementById(id); }

          function scrollDown(){ if(body) body.scrollTop=body.scrollHeight; }
          function addMsg(text,who){
            var m=document.createElement('div'); m.className='mxa-msg '+who; m.textContent=text; body.appendChild(m); scrollDown(); return m;
          }
          function addTyping(){
            var w=document.createElement('div'); w.className='mxa-typing'; w.id='mxaTyping';
            w.innerHTML='<span></span><span></span><span></span>'; body.appendChild(w); scrollDown(); return w;
          }
          function rmTyping(){ var w=el('mxaTyping'); if(w) w.remove(); }

          function greeting(){
            body.innerHTML='';
            addMsg(t('asst.greeting'),'bot');
            var wrap=document.createElement('div'); wrap.className='mxa-suggest';
            ['asst.s1','asst.s2','asst.s3','asst.s4'].forEach(function(k){
              var b=document.createElement('button'); b.type='button'; b.textContent=t(k);
              b.addEventListener('click',function(){ ask(t(k)); });
              wrap.appendChild(b);
            });
            body.appendChild(wrap); scrollDown();
          }

          // Render the "was this helpful?" row after a confident answer (no gamification, ever).
          function feedbackRow(logId){
            var wrap=document.createElement('div'); wrap.className='mxa-after';
            var row=document.createElement('div'); row.className='mxa-fbrow';
            var q=document.createElement('span'); q.textContent=t('asst.helpfulQ'); row.appendChild(q);
            function vote(v){
              try{ fetch(apiBase()+'/api/assistant/feedback',{method:'POST',headers:hdr(),body:JSON.stringify({log_id:logId,helpful:v})}).catch(function(){}); }catch(e){}
              wrap.innerHTML=''; var thx=document.createElement('div'); thx.className='mxa-note'; thx.textContent=t('asst.thanks'); wrap.appendChild(thx);
            }
            var yes=document.createElement('button'); yes.className='mxa-chip'; yes.type='button'; yes.textContent=t('asst.yes'); yes.addEventListener('click',function(){ vote(true); });
            var no=document.createElement('button'); no.className='mxa-chip'; no.type='button'; no.textContent=t('asst.no'); no.addEventListener('click',function(){ vote(false); });
            row.appendChild(yes); row.appendChild(no); wrap.appendChild(row); body.appendChild(wrap); scrollDown();
          }

          // Render the warm hand-off action after an escalation / medical / unsure answer.
          function connectRow(question,route,category,logId){
            var wrap=document.createElement('div'); wrap.className='mxa-after';
            var b=document.createElement('button'); b.className='mxa-connect'; b.type='button';
            b.innerHTML='<i class="fas fa-paper-plane" aria-hidden="true"></i> <span>'+esc(t('asst.connect'))+'</span>';
            b.addEventListener('click',function(){
              b.disabled=true;
              fetch(apiBase()+'/api/assistant/escalate',{method:'POST',headers:hdr(),body:JSON.stringify({question:question,target:route||'team',category:category||'general',log_id:logId||null,locale:loc()})})
                .then(function(r){ return r&&r.ok?r.json():null; })
                .then(function(d){ wrap.innerHTML=''; var n=document.createElement('div'); n.className='mxa-note'; n.textContent=t(d&&d.ok?'asst.sent':'asst.error'); wrap.appendChild(n); scrollDown(); })
                .catch(function(){ wrap.innerHTML=''; var n=document.createElement('div'); n.className='mxa-note'; n.textContent=t('asst.error'); wrap.appendChild(n); });
            });
            wrap.appendChild(b); body.appendChild(wrap); scrollDown();
          }

          function hdr(){ var h={'Content-Type':'application/json'}; var tk=token(); if(tk) h['Authorization']='Bearer '+tk; return h; }

          function ask(question){
            question=String(question||'').trim(); if(!question||busy) return;
            var sugg=body.querySelector('.mxa-suggest'); if(sugg) sugg.remove();
            addMsg(question,'user');
            input.value=''; autoGrow();
            busy=true; sendBtn.disabled=true; addTyping();
            fetch(apiBase()+'/api/assistant/ask',{method:'POST',headers:hdr(),body:JSON.stringify({question:question,locale:loc()})})
              .then(function(r){ return r&&r.ok?r.json():(r?r.json().then(function(e){throw e;}):null); })
              .then(function(d){
                rmTyping(); busy=false; sendBtn.disabled=false;
                if(!d||!d.ok){ addMsg(t('asst.error'),'bot'); return; }
                addMsg(d.answer,'bot');
                if(d.suggest_feedback) feedbackRow(d.log_id);
                else if(d.can_escalate) connectRow(question,d.escalate_route||'team',d.category||'general',d.log_id);
              })
              .catch(function(){ rmTyping(); busy=false; sendBtn.disabled=false; addMsg(t('asst.offline'),'bot'); });
          }

          function autoGrow(){ if(!input) return; input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,96)+'px'; }

          function open(){
            if(!token()) return;
            panel.classList.add('mxa-open'); panel.setAttribute('aria-hidden','false');
            fab.classList.add('mxa-hide-for-panel');
            if(!started){ started=true; greeting(); }
            setTimeout(function(){ try{ input.focus(); }catch(e){} },60);
          }
          function close(){ panel.classList.remove('mxa-open'); panel.setAttribute('aria-hidden','true'); fab.classList.remove('mxa-hide-for-panel'); try{ fab.focus(); }catch(e){} }
          function toggle(){ if(panel.classList.contains('mxa-open')) close(); else open(); }

          // Show the launcher only for a signed-in member (a utility for everyone; hidden when logged out).
          function reflectAuth(){ if(!fab) return; fab.style.display = token() ? 'flex' : 'none'; if(!token()) close(); }

          function boot(){
            panel=el('mxaPanel'); fab=el('mxaFab'); body=el('mxaBody'); input=el('mxaInput'); sendBtn=el('mxaSend');
            if(!panel||!fab) return;
            fab.addEventListener('click',toggle);
            el('mxaClose').addEventListener('click',close);
            sendBtn.addEventListener('click',function(){ ask(input.value); });
            input.addEventListener('input',autoGrow);
            input.addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); ask(input.value); } });
            document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&panel.classList.contains('mxa-open')) close(); });
            // re-localize the live greeting/suggestions when the member switches language
            document.addEventListener('medx:localechange',function(){ if(started&&panel.classList.contains('mxa-open')&&body.querySelector('.mxa-suggest')) greeting(); });
            reflectAuth();
            // catch a fresh login within the first moments without a reload
            var n=0,iv=setInterval(function(){ reflectAuth(); if(++n>12||token()) clearInterval(iv); },1500);
            window.addEventListener('storage',reflectAuth);
          }
          if(document.readyState!=='loading') boot(); else document.addEventListener('DOMContentLoaded',boot);
          window.MedXAssistant={ open:open, close:close, toggle:toggle, ask:ask, refresh:reflectAuth };
        })();
        