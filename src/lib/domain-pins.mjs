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
export function initializeDomainMenu(){
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
      const lineSpan=document.createElement('span');lineSpan.className='icon-glyph icon-glyph-line';lineSpan.setAttribute('aria-hidden','true');
      const svgNS='http://www.w3.org/2000/svg';const svg=document.createElementNS(svgNS,'svg');
      svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','16');svg.setAttribute('height','16');
      svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.9');
      svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
      const pid=(pin.id||'').toLowerCase();
      const dPath=document.createElementNS(svgNS,'path');
      if(pid.includes('ati')||pid.includes('dev'))dPath.setAttribute('d','M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2-2z');
      else if(pid.includes('steuer')||pid.includes('finan'))dPath.setAttribute('d','M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6');
      else if(pid.includes('foerder')||pid.includes('gesund')||pid.includes('therap'))dPath.setAttribute('d','M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4');
      else if(pid.includes('anonym'))dPath.setAttribute('d','M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z');
      else if(pid.includes('law')||pid.includes('recht'))dPath.setAttribute('d','M12 3v18M5 7h14M5 7l-3 6h6L5 7zM19 7l-3 6h6l-3-6zM8 21h8');
      else if(pid.includes('clip')||pid.includes('media')||pid.includes('video'))dPath.setAttribute('d','M4 4h16v16H4zM4 8h16M4 16h16M8 4v4M16 4v4M8 16v4M16 16v4');
      else dPath.setAttribute('d','M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5');
      svg.append(dPath);lineSpan.append(svg);
      const emojiSpan=document.createElement('span');emojiSpan.className='icon-glyph icon-glyph-emoji';emojiSpan.setAttribute('aria-hidden','true');emojiSpan.textContent=pin.icon;
      icon.append(lineSpan,emojiSpan);
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
