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
      const icon=document.createElement('span');icon.className='dropdown-item-icon';icon.textContent=pin.icon;
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
