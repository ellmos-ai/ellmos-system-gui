import {domainWorkbenchRoute} from './domain-routes.mjs';
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export function validatePins(data){
  if(data?.schema!=='bach.domain-pins.v1'||!/^[a-f0-9]{64}$/.test(data.version||'')||
     typeof data.persisted!=='boolean'||!Array.isArray(data.pins)||data.pins.length>256||data.total!==data.pins.length)
    throw new Error('Pinstand nicht bestätigt. Backendadapter prüfen.');
  const seen=new Set();
  for(const pin of data.pins){
    if(!pin||typeof pin.id!=='string'||!ID.test(pin.id)||seen.has(pin.id)||typeof pin.name!=='string'||
       !pin.name||pin.name.length>120||typeof pin.icon!=='string'||pin.icon.length>80)
      throw new Error('Pinliste enthält unbestätigte Einträge.');
    seen.add(pin.id);
  }
  return data;
}
export function pinReadbackMatches(data,id,pinned){
  validatePins(data);
  if(typeof id!=='string'||!ID.test(id)||typeof pinned!=='boolean')throw new Error('Ungültige Pinprüfung.');
  return data.pins.some(pin=>pin.id===id)===pinned;
}
export function pinMenuRoute(pin){
  if(!pin||typeof pin.id!=='string'||!ID.test(pin.id))throw new Error('Ungültige Domain-ID');
  return domainWorkbenchRoute(pin.workbench_url)||'/domains?domain='+encodeURIComponent(pin.id);
}
export function validatePinAck(data,id,pinned){
  validatePins(data);
  if(data.success!==true||data.id!==id||data.pinned!==pinned||data.persisted!==true||
     data.pins.some(p=>p.id===id)!==pinned)throw new Error('Speichern nicht bestätigt. Aktuellen Pinstand neu prüfen.');
  return data;
}
let current=null,loading=null,epoch=0,busy=false;
const listeners=new Set();
const notify=()=>listeners.forEach(fn=>fn(current,busy));
export function subscribePins(callback){listeners.add(callback);callback(current,busy);return()=>listeners.delete(callback);}
async function request(url,options={}){
  const response=await fetch(url,{cache:'no-store',...options,headers:{'Content-Type':'application/json',...options.headers}});
  let data;try{data=await response.json();}catch{throw new Error('Pinantwort nicht lesbar; bitte aktualisieren.');}
  if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail+' (HTTP '+response.status+')':'Pinanfrage nicht bestätigt (HTTP '+response.status+')');
  return data;
}
export async function loadDomainPins(){
  if(loading)return loading;
  const initial=epoch;
  loading=(async()=>{
    try{
      const data=validatePins(await request('/api/domains/pins'));
      if(initial===epoch){current=data;notify();}
      if(!current)throw new Error('Pinstand wird neu geprüft.');
      return current;
    }catch(error){if(initial===epoch){current=null;notify();}throw error;}
    finally{loading=null;}
  })();
  return loading;
}
export async function setDomainPin(id,pinned){
  if(busy)throw new Error('Eine Pinänderung wird bereits geprüft.');
  if(!current)throw new Error('Aktuellen Pinstand zuerst laden.');
  if(typeof id!=='string'||!ID.test(id)||typeof pinned!=='boolean')throw new Error('Ungültige Pinänderung.');
  const version=current.version;busy=true;epoch++;notify();
  try{
    const data=validatePinAck(await request('/api/domains/'+encodeURIComponent(id)+'/pin',
      {method:'POST',body:JSON.stringify({pinned,version})}),id,pinned);
    current=data;notify();return data;
  }catch(error){current=null;notify();throw error;}
  finally{busy=false;notify();}
}
const DOMAIN_SVG_PATHS={
  wrench:'M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2-2z',
  coins:'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  stethoscope:'M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4',
  mask:'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  scale:'M12 3v18M5 7h14M5 7l-3 6h6L5 7zM19 7l-3 6h6l-3-6zM8 21h8',
  film:'M4 4h16v16H4zM4 8h16M4 16h16M8 4v4M16 4v4M8 16v4M16 16v4',
  puzzle:'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.3l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  calendar:'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18',
  users:'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'
};
export function createDomainIconElement(id,emoji,size=16){
  const wrap=document.createElement('span');
  const lineSpan=document.createElement('span');lineSpan.className='icon-glyph icon-glyph-line';lineSpan.setAttribute('aria-hidden','true');
  const svgNS='http://www.w3.org/2000/svg';const svg=document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width',String(size));svg.setAttribute('height',String(size));
  svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.9');
  svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
  const pid=(id||'').toLowerCase();
  const dPath=document.createElementNS(svgNS,'path');
  let key='puzzle';
  if(pid.includes('ati')||pid.includes('dev'))key='wrench';
  else if(pid.includes('steuer')||pid.includes('finan'))key='coins';
  else if(pid.includes('foerder')||pid.includes('therap'))key='stethoscope';
  else if(pid.includes('gesund')||pid.includes('health'))key='heart';
  else if(pid.includes('anonym')||pid.includes('privacy'))key='mask';
  else if(pid.includes('law')||pid.includes('recht'))key='scale';
  else if(pid.includes('clip')||pid.includes('media')||pid.includes('video'))key='film';
  else if(pid.includes('routine')||pid.includes('kalend'))key='calendar';
  else if(pid.includes('kontakt')||pid.includes('bezieh'))key='users';
  dPath.setAttribute('d',DOMAIN_SVG_PATHS[key]||DOMAIN_SVG_PATHS.puzzle);
  svg.append(dPath);lineSpan.append(svg);
  const emojiSpan=document.createElement('span');emojiSpan.className='icon-glyph icon-glyph-emoji';emojiSpan.setAttribute('aria-hidden','true');emojiSpan.textContent=emoji||'🧩';
  wrap.append(lineSpan,emojiSpan);
  return wrap;
}
export function enhancePageIconGlyphs(){
  if(typeof document==='undefined')return;
  const map=[
    ['👤','users'],['📅','calendar'],['💰','coins'],['🏥','heart'],
    ['👥','users'],['🧠','puzzle'],['🌐','puzzle'],['🌱','heart'],
    ['📋','calendar'],['🔒','mask'],['📜','calendar'],['📦','puzzle']
  ];
  for(const el of document.querySelectorAll('.page-header h1, .tab-btn, .card-icon')){
    if(el.querySelector('.icon-glyph'))continue;
    const first=el.firstChild;
    if(!first||first.nodeType!==3)continue;
    const txt=first.nodeValue||'';
    for(const [em,key] of map){
      if(txt.trimStart().startsWith(em)){
        const rest=txt.replace(em,'');
        first.nodeValue=rest;
        const g=createDomainIconElement(key,em,el.tagName==='H1'?22:16);
        el.insertBefore(g,first);
        break;
      }
    }
  }
}
export function initializeDomainMenu(){
  try{enhancePageIconGlyphs();}catch{}

  const root=document.getElementById('domain-pins-menu');if(!root)return;
  subscribePins((snapshot)=>{
    root.replaceChildren();
    if(!snapshot){
      const p=document.createElement('span');p.className='dropdown-item';
      p.textContent='Pins noch nicht bestätigt';p.setAttribute('role','status');root.append(p);return;
    }
    if(!snapshot.pins.length){const p=document.createElement('span');p.className='dropdown-item';p.textContent='Keine Domänen angepinnt';root.append(p);}
    for(const pin of snapshot.pins){
      const a=document.createElement('a');a.className='dropdown-item';a.href=pinMenuRoute(pin);a.dataset.domainPin=pin.id;
      const icon=document.createElement('span');icon.className='dropdown-item-icon';
      icon.append(createDomainIconElement(pin.id,pin.icon,16));
      const body=document.createElement('span');body.className='dropdown-item-text';
      const title=document.createElement('span');title.className='dropdown-item-title';title.textContent=pin.name;
      const desc=document.createElement('span');desc.className='dropdown-item-desc';
      desc.textContent=domainWorkbenchRoute(pin.workbench_url)?'Fachseite':'Domänenübersicht';
      body.append(title,desc);a.append(icon,body);root.append(a);
    }
  });
  loadDomainPins().catch(()=>{});
  setInterval(()=>{if(!document.hidden&&!busy)loadDomainPins().catch(()=>{});},30000);
}
