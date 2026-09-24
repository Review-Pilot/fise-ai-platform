(()=>{
const doc=document,root=doc.documentElement;
const reduce=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
const $$=(s,el=doc)=>Array.prototype.slice.call(el.querySelectorAll(s));

/* scroll reveal */
const reveals=$$('.fx-reveal');
if('IntersectionObserver' in window&&!reduce){
  root.classList.add('fx-js');
  const io=new IntersectionObserver((entries)=>{entries.forEach((e)=>{if(e.isIntersecting){e.target.classList.add('is-visible');io.unobserve(e.target)}})},{rootMargin:'0px 0px -8% 0px',threshold:.08});
  reveals.forEach((el)=>io.observe(el));
  const flow=doc.querySelector('.fx-flow');
  if(flow){const fo=new IntersectionObserver((e)=>{if(e[0].isIntersecting){flow.classList.add('is-visible');fo.disconnect()}},{threshold:.3});fo.observe(flow)}
}else{doc.querySelector('.fx-flow')?.classList.add('is-visible')}

/* nav: blur on scroll, active section, mobile menu */
const nav=doc.querySelector('.fx-nav');
if(nav){
  let ticking=false;
  const onScroll=()=>{nav.classList.toggle('is-scrolled',scrollY>8);ticking=false};
  addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(onScroll)}},{passive:true});onScroll();
  const btn=nav.querySelector('.fx-menu-btn'),menu=doc.getElementById('fx-mobile-menu');
  const setOpen=(open)=>{nav.classList.toggle('is-open',open);btn?.setAttribute('aria-expanded',String(open));btn?.setAttribute('aria-label',open?'Close menu':'Open menu');if(menu)menu.inert=!open;doc.body.style.overflow=open?'hidden':'';if(open)menu?.querySelector('a')?.focus()};
  if(menu)menu.inert=true;
  btn?.addEventListener('click',()=>setOpen(!nav.classList.contains('is-open')));
  menu?.addEventListener('click',(e)=>{if(e.target.closest('a'))setOpen(false)});
  doc.addEventListener('keydown',(e)=>{
    if(!nav.classList.contains('is-open'))return;
    if(e.key==='Escape'){setOpen(false);btn?.focus();return}
    if(e.key==='Tab'&&menu){const f=[btn].concat($$('a,button',menu));const i=f.indexOf(doc.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus()}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus()}}
  });
  matchMedia('(min-width: 901px)').addEventListener?.('change',(m)=>{if(m.matches)setOpen(false)});
  const links=$$('.fx-nav-links a[href^="/#"]');
  const sections=links.map((a)=>doc.getElementById(a.getAttribute('href').slice(2))).filter(Boolean);
  if(sections.length&&'IntersectionObserver' in window){
    const so=new IntersectionObserver((entries)=>{entries.forEach((e)=>{if(e.isIntersecting){links.forEach((a)=>a.classList.toggle('is-active',a.getAttribute('href')==='/#'+e.target.id))}})},{rootMargin:'-45% 0px -50% 0px'});
    sections.forEach((s)=>so.observe(s));
  }
}

/* hero parallax (subtle, rAF, desktop only) */
const browser=doc.querySelector('.fx-browser');
if(browser&&!reduce&&matchMedia('(min-width: 901px)').matches){
  let raf=0;addEventListener('scroll',()=>{if(raf)return;raf=requestAnimationFrame(()=>{raf=0;const y=Math.min(scrollY,700);browser.style.setProperty('--fx-parallax',(-y*0.06).toFixed(1)+'px')})},{passive:true});
}

/* card spotlight */
$$('.fx-card').forEach((card)=>card.addEventListener('pointermove',(e)=>{const r=card.getBoundingClientRect();card.style.setProperty('--mx',(e.clientX-r.left)+'px');card.style.setProperty('--my',(e.clientY-r.top)+'px')}));

/* count-up stats */
const counters=$$('[data-count]');
const fmt=(n)=>Math.round(n).toLocaleString('en-US');
const run=(el)=>{const target=Number(el.dataset.count),suffix=el.dataset.suffix||'',prefix=el.dataset.prefix||'';if(reduce||!isFinite(target)){el.textContent=prefix+fmt(target)+suffix;return}const t0=performance.now(),d=1400;const step=(t)=>{const p=Math.min(1,(t-t0)/d),e=1-Math.pow(1-p,3);el.textContent=prefix+fmt(target*e)+suffix;if(p<1)requestAnimationFrame(step)};requestAnimationFrame(step)};
if(counters.length){if('IntersectionObserver' in window){const co=new IntersectionObserver((entries)=>{entries.forEach((e)=>{if(e.isIntersecting){run(e.target);co.unobserve(e.target)}})},{threshold:.6});counters.forEach((c)=>co.observe(c))}else counters.forEach(run)}

/* testimonials carousel */
$$('[data-carousel]').forEach((car)=>{
  const slides=$$('.fx-slide',car),dots=$$('.fx-dot',car);if(slides.length<2)return;
  let i=0,timer=0,paused=false;
  const show=(n)=>{i=(n+slides.length)%slides.length;slides.forEach((s,k)=>{s.classList.toggle('is-active',k===i);s.setAttribute('aria-hidden',String(k!==i))});dots.forEach((d,k)=>d.setAttribute('aria-current',String(k===i)))};
  const start=()=>{stop();if(!reduce&&!paused)timer=setInterval(()=>show(i+1),6500)};
  const stop=()=>{clearInterval(timer)};
  car.querySelector('[data-prev]')?.addEventListener('click',()=>{show(i-1);start()});
  car.querySelector('[data-next]')?.addEventListener('click',()=>{show(i+1);start()});
  dots.forEach((d,k)=>d.addEventListener('click',()=>{show(k);start()}));
  car.addEventListener('mouseenter',()=>{paused=true;stop()});car.addEventListener('mouseleave',()=>{paused=false;start()});
  car.addEventListener('focusin',()=>{paused=true;stop()});car.addEventListener('focusout',()=>{paused=false;start()});
  car.addEventListener('keydown',(e)=>{if(e.key==='ArrowLeft'){show(i-1)}else if(e.key==='ArrowRight'){show(i+1)}});
  let x0=null;car.addEventListener('touchstart',(e)=>{x0=e.touches[0].clientX},{passive:true});car.addEventListener('touchend',(e)=>{if(x0===null)return;const dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>40){show(i+(dx<0?1:-1));start()}x0=null});
  doc.addEventListener('visibilitychange',()=>{doc.hidden?stop():start()});
  show(0);start();
});

/* pricing toggle */
const toggle=doc.querySelector('[data-billing]');
if(toggle){
  const buttons=$$('button',toggle);
  const apply=(mode)=>{buttons.forEach((b)=>b.setAttribute('aria-checked',String(b.dataset.mode===mode)));$$('[data-monthly]').forEach((el)=>{el.textContent=mode==='annual'?el.dataset.annual:el.dataset.monthly});$$('[data-note-monthly]').forEach((el)=>{el.textContent=mode==='annual'?el.dataset.noteAnnual:el.dataset.noteMonthly});$$('[data-plan-link]').forEach((a)=>{try{const u=new URL(a.href,location.href);if(u.origin===location.origin&&u.pathname==='/checkout'){u.searchParams.set('billing',mode);a.href=u.pathname+u.search}}catch{}})};
  buttons.forEach((b)=>b.addEventListener('click',()=>apply(b.dataset.mode)));
  toggle.addEventListener('keydown',(e)=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const cur=buttons.findIndex((b)=>b.getAttribute('aria-checked')==='true');const next=buttons[(cur+1)%buttons.length];next.focus();apply(next.dataset.mode)}});
}

/* FAQ: animate native details, one open at a time */
$$('.fx-faq details').forEach((d)=>{
  const s=d.querySelector('summary'),body=d.querySelector('.fx-faq-body');if(!s||!body)return;
  s.addEventListener('click',(e)=>{
    if(reduce||!body.animate)return;
    e.preventDefault();
    if(d.open){const h=body.offsetHeight;body.animate([{height:h+'px',opacity:1},{height:'0px',opacity:0}],{duration:260,easing:'cubic-bezier(.2,.7,.2,1)'}).onfinish=()=>{d.open=false}}
    else{$$('.fx-faq details[open]').forEach((o)=>{if(o!==d)o.open=false});d.open=true;const h=body.offsetHeight;body.animate([{height:'0px',opacity:0},{height:h+'px',opacity:1}],{duration:320,easing:'cubic-bezier(.2,.7,.2,1)'})}
  });
});

/* capability tabs: roving tabindex + gentle autoplay until the visitor interacts */
$$('[data-tabs]').forEach((wrap)=>{
  const tabs=$$('[role="tab"]',wrap);let auto=!reduce,timer=0,visible=false;
  const select=(t,focus)=>{tabs.forEach((x)=>{const on=x===t;x.setAttribute('aria-selected',String(on));x.tabIndex=on?0:-1;const p=doc.getElementById(x.getAttribute('aria-controls'));if(p)p.hidden=!on});if(focus)t.focus()};
  const schedule=()=>{clearTimeout(timer);if(!auto||!visible)return;wrap.classList.add('is-auto');timer=setTimeout(()=>{const i=tabs.findIndex((t)=>t.getAttribute('aria-selected')==='true');select(tabs[(i+1)%tabs.length]);const bar=tabs[(i+1)%tabs.length].querySelector('.fx-tab-progress i');if(bar){bar.style.animation='none';void bar.offsetWidth;bar.style.animation=''}schedule()},7000)};
  const stopAuto=()=>{auto=false;clearTimeout(timer);wrap.classList.remove('is-auto')};
  tabs.forEach((t,i)=>{
    t.addEventListener('click',()=>{stopAuto();select(t)});
    t.addEventListener('keydown',(e)=>{let n=-1;if(e.key==='ArrowDown'||e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowUp'||e.key==='ArrowLeft')n=(i-1+tabs.length)%tabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;if(n>=0){e.preventDefault();stopAuto();select(tabs[n],true)}});
  });
  wrap.addEventListener('pointerenter',()=>{clearTimeout(timer);wrap.classList.remove('is-auto')});
  wrap.addEventListener('pointerleave',()=>{if(auto)schedule()});
  if('IntersectionObserver' in window){new IntersectionObserver((e)=>{visible=e[0].isIntersecting;visible?schedule():clearTimeout(timer)},{threshold:.4}).observe(wrap)}
});

/* video: lazy-attach on click */
$$('[data-video]').forEach((box)=>{
  const btn=box.querySelector('.fx-play');
  btn?.addEventListener('click',()=>{
    const v=doc.createElement('video');
    v.src=box.dataset.video;v.controls=true;v.playsInline=true;v.autoplay=true;v.preload='auto';
    v.setAttribute('aria-label',btn.getAttribute('aria-label')||'Product walkthrough');
    box.appendChild(v);
    box.querySelector('.fx-video-scrim')?.remove();btn.remove();
    v.addEventListener('error',()=>{const note=doc.createElement('p');note.className='fx-video-fallback';note.innerHTML='This browser can\u2019t play the video inline. <a href="'+box.dataset.video+'">Download the walkthrough</a>.';box.appendChild(note)},{once:true});
    const p=v.play();if(p&&p.catch)p.catch(()=>{});v.focus();
  });
});

/* newsletter */
const form=doc.getElementById('fx-newsletter');
if(form){
  form.addEventListener('submit',async(e)=>{
    e.preventDefault();
    const msg=form.querySelector('.fx-form-msg'),input=form.querySelector('input[type="email"]'),btn=form.querySelector('button');
    const email=String(input.value||'').trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){msg.textContent='Enter a valid email address.';input.setAttribute('aria-invalid','true');input.focus();return}
    input.removeAttribute('aria-invalid');btn.disabled=true;msg.textContent='Subscribing…';
    try{
      const r=await fetch('/api/newsletter',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(data.error||'Something went wrong. Please try again.');
      msg.textContent='Thanks — you’re subscribed.';form.reset();
    }catch(err){msg.textContent=err.message||'Something went wrong. Please try again.'}
    finally{btn.disabled=false}
  });
}

/* open the in-page account dialog instead of navigating to /login */
doc.addEventListener('click',(e)=>{
  const a=e.target.closest&&e.target.closest('a[href^="/login"]');
  const account=doc.getElementById('account-button');
  if(!a||a===account||!account||!doc.getElementById('account-modal')||account.dataset.authenticated==='true'||e.metaKey||e.ctrlKey||e.shiftKey)return;
  e.preventDefault();
  nav&&nav.classList.contains('is-open')&&nav.querySelector('.fx-menu-btn')?.click();
  account.click();
  if(/mode=signup/.test(a.getAttribute('href')))setTimeout(()=>doc.querySelector('[data-account-view="register"]')?.click(),0);
});
})();
