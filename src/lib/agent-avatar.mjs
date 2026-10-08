export const ATLAS_PRESETS = [
  {id:'preset:companion',name:'Begleiter',x:0,y:0},
  {id:'preset:guardian',name:'Hintergrund',x:1,y:0},
  {id:'preset:connector',name:'Verbindung',x:2,y:0},
  {id:'preset:coordinator',name:'Koordination',x:0,y:1},
  {id:'preset:engineer',name:'Entwicklung',x:1,y:1},
  {id:'preset:researcher',name:'Recherche',x:2,y:1},
];
export const GEMINI_AVATAR_PRESETS = [{"id": "preset:gemini-claude-friendly", "name": "Claude · Begleiter"}, {"id": "preset:gemini-claude-neon", "name": "Claude · Neon"}, {"id": "preset:gemini-claude-opus", "name": "Claude · Opus"}, {"id": "preset:gemini-copilot", "name": "Copilot"}, {"id": "preset:gemini-gemini", "name": "Gemini · Sternenlicht"}, {"id": "preset:gemini-gemini-umbruch", "name": "Gemini · Um:bruch"}];
export const AVATAR_PRESETS = [...ATLAS_PRESETS,...GEMINI_AVATAR_PRESETS];
let presetUrls = Object.freeze({});
export function setAvatarPresetUrls(urls) {
  const next = {};
  for (const preset of GEMINI_AVATAR_PRESETS) {
    const url = urls?.[preset.id];
    if (typeof url !== 'string' || !/^\/_astro\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp)$/.test(url))
      throw new Error('Porträtquelle nicht verfügbar.');
    next[preset.id] = url;
  }
  presetUrls = Object.freeze(next);
}
const DEFAULTS = {buddha_chat:'companion',buddha_always_on:'guardian',buddha_connector:'connector',
  buddha_boss:'coordinator',buddha_developer:'engineer',buddha_research:'researcher',
  boss_routing:'coordinator',entwickler:'engineer',recherche:'researcher',connector:'connector'};

export function avatarVisual(value, identity={}) {
  if (typeof value === 'string' && value.length <= 240000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value))
    return {kind:'upload',url:value};
  const fallback = 'preset:' + (DEFAULTS[identity.id] || DEFAULTS[identity.role_id || identity.persona_role] || 'companion');
  const preset = AVATAR_PRESETS.find(item=>item.id===value) || AVATAR_PRESETS.find(item=>item.id===fallback);
  return {kind:'preset',id:preset.id,name:preset.name,asset:!('x' in preset),position:('x' in preset)?(preset.x*50)+'% '+(preset.y*100)+'%':null};
}

export function createAvatar(document, value, identity, atlasUrl, className='') {
  const visual=avatarVisual(value,identity);
  const element=document.createElement(visual.kind==='upload'?'img':'span');
  element.className=className;
  element.setAttribute('aria-hidden','true');
  if(visual.kind==='upload') {element.src=visual.url;element.alt='';}
  else {
    if (visual.asset) {
      const url=presetUrls[visual.id];
      if (!url) throw new Error('Porträtquelle nicht verfügbar.');
      element.dataset.avatarPreset=visual.id;
      element.style.backgroundImage='url("'+url+'")';
      element.style.backgroundSize='cover';element.style.backgroundPosition='center';
      element.style.display='inline-block';return element;
    }
    if(typeof atlasUrl!=='string'||!/^\/_astro\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|webp)$/.test(atlasUrl)) throw new Error('Porträtquelle nicht verfügbar.');
    element.dataset.avatarPreset=visual.id;
    element.style.backgroundImage='url("'+atlasUrl+'")';
    element.style.backgroundSize='300% 200%';element.style.backgroundPosition=visual.position;
    element.style.display='inline-block';
  }
  return element;
}

export function mountAvatarPicker(container,value,identity,atlasUrl,onSelect) {
  container.replaceChildren();
  const selected=avatarVisual(value,identity);
  for(const preset of AVATAR_PRESETS) {
    const button=container.ownerDocument.createElement('button');button.type='button';
    button.className='avatar-preset-choice';button.dataset.preset=preset.id;button.title=preset.name;
    button.setAttribute('aria-label',preset.name);
    button.setAttribute('aria-pressed',String(selected.kind==='preset'&&selected.id===preset.id));
    button.append(createAvatar(container.ownerDocument,preset.id,identity,atlasUrl,'avatar-preset-image'));
    const name=container.ownerDocument.createElement('span');name.textContent=preset.name;button.append(name);
    button.addEventListener('click',()=>onSelect(preset.id));container.append(button);
  }
}

if(typeof window!=='undefined') window.BachAvatars={createAvatar,mountAvatarPicker};
