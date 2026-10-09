import {domainWorkbenchRoute} from '../lib/domain-routes.mjs';
import {loadDomainPins,setDomainPin,subscribePins,pinReadbackMatches} from '../lib/domain-pins.mjs';

const node=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=String(text??'');return n;};
function initialize(){
  const grid=document.getElementById('domains-grid');if(!grid)return;
  const status=document.getElementById('domains-pin-status'),orphans=document.getElementById('domains-orphan-pins');
  let inventory=[],snapshot=null,busy=false,loading=false;
  const feedback=(text,error=false)=>{status.textContent=text;status.dataset.error=String(error);};
  function makePinButton(id){
    const b=node('button','btn btn-secondary btn-sm','Pinstand prüfen');b.type='button';b.dataset.pinId=id;
    b.addEventListener('click',async()=>{
      if(!snapshot||busy)return;
      const desired=!snapshot.pins.some(pin=>pin.id===id);
      feedback('Pinänderung wird gespeichert…');
      try{
        await setDomainPin(id,desired);
        const readback=await loadDomainPins();
        if(!pinReadbackMatches(readback,id,desired)){
          feedback('Pinstand wurde inzwischen geändert. Menü und Karte zeigen den aktuellen Stand.',true);
          return;
        }
        feedback(desired?'Domäne ist angepinnt. Menü und gespeicherter Pinstand wurden geprüft.':'Pin ist entfernt. Menü und gespeicherter Pinstand wurden geprüft.');
      }catch(error){
        try{await loadDomainPins();feedback('Speichern nicht bestätigt; aktuellen Pinstand geladen. '+error.message,true);}
        catch{feedback('Pinstand nicht verfügbar. '+error.message,true);}
      }
    });return b;
  }
  function updatePins(){
    const count=document.getElementById('stat-count-pins');count.textContent=snapshot?String(snapshot.total):'?';
    for(const b of document.querySelectorAll('[data-pin-id]')){
      const pinned=!!snapshot?.pins.some(pin=>pin.id===b.dataset.pinId);
      b.disabled=busy||!snapshot;b.setAttribute('aria-pressed',String(pinned));
      b.textContent=!snapshot?'Pinstand nicht verfügbar':pinned?'📍 Pin entfernen':'📌 Anpinnen';
      b.title=snapshot?.persisted===false&&pinned?'Voreinstellung; noch keine Pin-Konfiguration gespeichert':'Im Domänenmenü anzeigen';
    }
    orphans.replaceChildren();
    if(snapshot){
      const missing=snapshot.pins.filter(pin=>!inventory.some(d=>d.id===pin.id));
      if(missing.length){
        orphans.append(node('h2','', 'Pins außerhalb des aktuellen Katalogs'));
        for(const pin of missing){const p=node('div','domain-orphan-pin');p.append(node('span','',pin.name),makePinButton(pin.id));orphans.append(p);}
        for(const b of orphans.querySelectorAll('[data-pin-id]')){b.textContent='📍 Pin entfernen';b.disabled=busy;b.setAttribute('aria-pressed','true');}
      }
    }
  }
  subscribePins((data,pending)=>{snapshot=data;busy=pending;updatePins();});
  function render(data){
    inventory=Array.isArray(data.domains)?data.domains:[];
    document.getElementById('stat-count-modules').textContent=data.source_available?String(inventory.length):'?';
    document.getElementById('stat-count-installed').textContent=data.installed_count!=null?String(data.installed_count):'?';
    document.getElementById('stat-count-running').textContent=data.running_count!=null?String(data.running_count):'?';
    grid.replaceChildren();
    if(!data.source_available){grid.append(node('p','text-muted','Manifestquelle nicht erreichbar. Modulregister am Host anbinden.'));updatePins();return;}
    if(!inventory.length){grid.append(node('p','text-muted','Keine Fachmodule gefunden. Modulregister prüfen.'));updatePins();return;}
    const selected=new URLSearchParams(location.search).get('domain');
    let selectionFound=false;
    for(const domain of inventory){
      if(typeof domain.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(domain.id))continue;
      const card=node('article','domain-card');card.dataset.domainId=domain.id;card.id='domain-'+domain.id;
      const header=node('div','domain-header');header.append(node('span','domain-icon',domain.icon||'🧩'));
      const title=node('div','domain-title-wrap');title.append(node('h3','',domain.name||domain.id),node('span','domain-type-badge',(domain.kind||'Fachmodul')+' · '+(domain.category||'domain')));
      header.append(title);card.append(header);
      const caps=Array.isArray(domain.capabilities)?domain.capabilities:[];
      card.append(node('p','domain-desc',domain.description||(caps.length?'Manifest-Funktionen: '+caps.join(', '):'Fachmodul für domänenspezifische Aufgaben.')));
      const states=domain.states||{},badges=node('div','domain-states');
      badges.append(node('span','domain-state-badge','📜 Manifest'),
        node('span','domain-state-badge'+(states.installed?' installed':''),states.installed?'📦 Installiert':'⚪ Nicht installiert'));
      const healthy=['healthy','available'].includes(states.probe),ready=['ready','running','active'].includes(states.runtime);
      badges.append(node('span','domain-state-badge'+(healthy?' healthy':' gated'),healthy?'🟢 Probe OK':'🟡 '+(states.probe||'Probe')),
        node('span','domain-state-badge'+(ready?' healthy':' gated'),ready?'⚡ Bereit':'⏸️ '+(states.runtime||'Inert')));
      if(domain.visibility==='private'||domain.is_private)badges.append(node('span','domain-state-badge private','🔒 Privat'));
      card.append(badges);
      const footer=node('div','domain-footer');footer.append(makePinButton(domain.id));
      const declared=domain.workbench_url||domain.fachseite_url,workbench=domainWorkbenchRoute(declared);
      if(workbench){const a=node('a','btn btn-primary btn-sm','Fachseite ↗');a.href=workbench;footer.append(a);}
      else {const hint=node('span','text-muted',declared?'Fachseite noch nicht angebunden':'Keine Fachseite angebunden');hint.setAttribute('aria-disabled','true');footer.append(hint);}
      card.append(footer);grid.append(card);
      if(domain.id===selected){selectionFound=true;card.tabIndex=-1;card.classList.add('selected-domain');requestAnimationFrame(()=>{card.scrollIntoView({block:'center'});card.focus({preventScroll:true});});}
    }
    if(selected&&!selectionFound)feedback('Die gewählte Domäne ist im aktuellen Katalog nicht vorhanden. Gespeicherte Pins bleiben erhalten und können unten entfernt werden.',true);
    updatePins();
  }
  async function load(){
    if(loading||busy)return;loading=true;
    grid.replaceChildren(node('p','loading-state','Lade Fachmodule…'));
    const pins=loadDomainPins().catch(error=>feedback(error.message,true));
    try{
      const response=await fetch('/api/domains/installed?scope=all&probe=true',{cache:'no-store'});
      if(!response.ok)throw new Error('Domänenkatalog nicht bestätigt');
      const data=await response.json();await pins;render(data);
    }catch(error){inventory=[];document.getElementById('stat-count-modules').textContent='?';grid.replaceChildren(node('p','text-danger','Fachmodule nicht verfügbar. API- und Modulquelle prüfen.'));feedback(error.message,true);updatePins();}
    finally{loading=false;}
  }
  document.getElementById('domains-refresh')?.addEventListener('click',load);load();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
