(()=>{
const doc=document;
const $$=(s,el=doc)=>Array.prototype.slice.call(el.querySelectorAll(s));

/* toasts */
const stack=doc.querySelector('.app-toasts');
function toast(message,type){
  if(!stack||!message)return;
  const el=doc.createElement('div');
  el.className='app-toast'+(type==='error'?' is-error':'');
  el.setAttribute('role',type==='error'?'alert':'status');
  const text=doc.createElement('span');text.textContent=message;
  const close=doc.createElement('button');close.type='button';close.setAttribute('aria-label','Dismiss');close.textContent='×';
  el.append(text,close);stack.appendChild(el);
  const remove=()=>{el.classList.add('is-leaving');setTimeout(()=>el.remove(),260)};
  close.addEventListener('click',remove);
  setTimeout(remove,type==='error'?8000:4500);
}
window.fiseToast=toast;
/* turn server success notices into toasts (errors stay inline so they remain visible) */
$$('.alert.ok').forEach((alert)=>{toast(alert.textContent.trim(),'ok');alert.hidden=true});

/* mobile sidebar */
const sidebar=doc.getElementById('app-sidebar'),menu=doc.querySelector('.app-menu'),scrim=doc.querySelector('.app-scrim');
function setNav(open){
  if(!sidebar)return;
  sidebar.classList.toggle('is-open',open);menu?.setAttribute('aria-expanded',String(open));menu?.setAttribute('aria-label',open?'Close navigation':'Open navigation');
  if(scrim){scrim.hidden=!open;requestAnimationFrame(()=>scrim.classList.toggle('is-open',open))}
  if(open)sidebar.querySelector('a,button')?.focus();
}
menu?.addEventListener('click',()=>setNav(!sidebar.classList.contains('is-open')));
scrim?.addEventListener('click',()=>setNav(false));
doc.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&sidebar?.classList.contains('is-open')){setNav(false);menu?.focus()}});

/* inline validation with friendly messages */
function messageFor(input){
  const v=input.validity,label=(input.labels&&input.labels[0]?input.labels[0].textContent:input.name||'This field').replace(/\s+/g,' ').trim().replace(/\(optional\)/i,'').trim();
  if(v.valueMissing)return label+' is required.';
  if(v.typeMismatch&&input.type==='email')return 'Enter a full email address, like name@company.co.za.';
  if(v.typeMismatch&&input.type==='url')return 'Enter a full web address starting with https://';
  if(v.tooShort)return label+' must be at least '+input.minLength+' characters.';
  if(v.tooLong)return label+' must be '+input.maxLength+' characters or fewer.';
  if(v.patternMismatch)return input.title||('Check the format of '+label.toLowerCase()+'.');
  return input.validationMessage;
}
function showError(input){
  const id=(input.id||input.name)+'-error';let err=doc.getElementById(id);
  if(input.validity.valid){input.removeAttribute('aria-invalid');err?.remove();return true}
  if(!err){err=doc.createElement('p');err.className='app-field-error';err.id=id;input.insertAdjacentElement('afterend',err)}
  err.textContent=messageFor(input);input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',id);
  return false;
}
$$('form').forEach((form)=>{
  if(form.hasAttribute('data-no-enhance'))return;
  form.noValidate=true;
  const fields=$$('input,select,textarea',form).filter((f)=>f.willValidate);
  fields.forEach((f)=>{f.addEventListener('blur',()=>{if(f.value)showError(f)});f.addEventListener('input',()=>{if(f.getAttribute('aria-invalid')==='true')showError(f)})});
  form.addEventListener('submit',(e)=>{
    let first=null;fields.forEach((f)=>{if(!showError(f)&&!first)first=f});
    if(first){e.preventDefault();first.focus();toast('Please fix the highlighted fields.','error');return}
    const submitter=e.submitter||form.querySelector('[type="submit"]')||doc.querySelector('[type="submit"][form="'+form.id+'"]');
    if(submitter&&!form.hasAttribute('data-delete-form')){submitter.classList.add('is-loading');submitter.setAttribute('aria-busy','true')}
    dirty=false;
  });
});

/* unsaved-changes tracking on settings */
let dirty=false;
const tracked=doc.querySelector('form[data-track-changes]');
if(tracked){
  const bar=doc.createElement('div');bar.className='app-savebar';bar.setAttribute('role','region');bar.setAttribute('aria-label','Unsaved changes');
  bar.innerHTML='<span>You have unsaved changes</span><button class="btn" type="submit" form="'+tracked.id+'">Save changes</button>';
  (tracked.closest('main')||doc.body).appendChild(bar);
  const mark=()=>{if(!dirty){dirty=true;bar.classList.add('is-visible')}};
  tracked.addEventListener('input',mark);tracked.addEventListener('change',mark);
  addEventListener('beforeunload',(e)=>{if(dirty){e.preventDefault();e.returnValue=''}});
}

/* auth tabs */
const tabs=$$('.auth-tabs [role="tab"]');
if(tabs.length){
  const bar=doc.querySelector('.auth-tabs');bar.hidden=false;
  const initial=doc.getElementById('auth-tab-'+(bar.dataset.initial||'password'))||tabs[0];
  tabs.forEach((x)=>{const p=doc.getElementById(x.getAttribute('aria-controls'));if(p)p.hidden=x!==initial});
  const select=(t,focus)=>{tabs.forEach((x)=>{const on=x===t;x.setAttribute('aria-selected',String(on));x.tabIndex=on?0:-1;const p=doc.getElementById(x.getAttribute('aria-controls'));if(p)p.hidden=!on});if(focus)t.focus();const input=doc.getElementById(t.getAttribute('aria-controls'))?.querySelector('input:not([type=hidden])');if(!focus&&input)input.focus()};
  tabs.forEach((t,i)=>{t.addEventListener('click',()=>select(t));t.addEventListener('keydown',(e)=>{let n=-1;if(e.key==='ArrowRight')n=(i+1)%tabs.length;if(e.key==='ArrowLeft')n=(i-1+tabs.length)%tabs.length;if(n>=0){e.preventDefault();select(tabs[n],true)}})});
  $$('[data-auth-go]').forEach((b)=>b.addEventListener('click',()=>{const t=doc.getElementById('auth-tab-'+b.dataset.authGo);if(t)select(t)}));
}
})();
