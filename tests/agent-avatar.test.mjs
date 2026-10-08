import test from 'node:test';
import assert from 'node:assert/strict';
import {AVATAR_PRESETS,ATLAS_PRESETS,GEMINI_AVATAR_PRESETS,setAvatarPresetUrls,avatarVisual,createAvatar,mountAvatarPicker} from '../src/lib/agent-avatar.mjs';

test('six atlas portraits use explicit atlas positions and default roles',()=>{
  assert.equal(ATLAS_PRESETS.length,6);assert.equal(AVATAR_PRESETS.length,12);
  assert.equal(avatarVisual('',{id:'buddha_always_on'}).id,'preset:guardian');
  assert.equal(avatarVisual('',{role_id:'boss_routing'}).id,'preset:coordinator');
  assert.equal(avatarVisual('preset:researcher',{}).position,'100% 100%');
});

test('uploads are preserved and unknown or remote picture values stay inert',()=>{
  const upload='data:image/png;base64,aGVsbG8=';
  assert.equal(avatarVisual(upload).url,upload);
  for(const unsafe of ['https://example.org/remote.png','javascript:alert(1)','data:image/svg+xml;base64,AAAA','preset:unknown'])
    assert.equal(avatarVisual(unsafe,{id:'buddha_chat'}).id,'preset:companion');
});

function fakeDocument(){
  const document={createElement:tag=>({tag,dataset:{},style:{},attributes:{},children:[],setAttribute(name,value){this.attributes[name]=value;},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},addEventListener(name,action){this[name]=action;},ownerDocument:document})};
  return document;
}

test('preset images use owned Astro assets without copying image bytes into settings',()=>{
  const document=fakeDocument(),image=createAvatar(document,'preset:engineer',{},'/_astro/portraits.abc.png');
  assert.equal(image.tag,'span');assert.equal(image.dataset.avatarPreset,'preset:engineer');
  assert.equal(image.style.backgroundSize,'300% 200%');
  assert.throws(()=>createAvatar(document,'preset:engineer',{},'https://foreign.example/portraits.png'),/Porträtquelle/);
});

test('a preset choice passes its ID and marks the current selection',()=>{
  const document=fakeDocument(),container=document.createElement('div');let selected;
  setAvatarPresetUrls(Object.fromEntries(GEMINI_AVATAR_PRESETS.map((p,i)=>[p.id,'/_astro/gemini-'+i+'.png'])));
  mountAvatarPicker(container,'preset:coordinator',{},'/_astro/portraits.abc.png',value=>{selected=value;});
  assert.equal(container.children.length,12);
  assert.equal(container.children[3].attributes['aria-pressed'],'true');
  container.children[4].click();assert.equal(selected,'preset:engineer');
});

test('Gemini portraits use local immutable preset assets and keep ID on reselection',()=>{
  const urls=Object.fromEntries(GEMINI_AVATAR_PRESETS.map((p,i)=>[p.id,'/_astro/gemini-'+i+'.png']));
  setAvatarPresetUrls(urls);
  for(const preset of GEMINI_AVATAR_PRESETS){
    const picture=createAvatar(fakeDocument(),preset.id,{},'/_astro/portraits.abc.png');
    assert.equal(picture.dataset.avatarPreset,preset.id);
    assert.equal(picture.style.backgroundSize,'cover');
    assert.equal(picture.style.backgroundImage,'url("'+urls[preset.id]+'")');
    assert.equal(avatarVisual(preset.id).id,preset.id);
  }
  assert.throws(()=>setAvatarPresetUrls({...urls,[GEMINI_AVATAR_PRESETS[0].id]:'https://foreign.example/a.png'}),/Porträtquelle/);
  assert.throws(()=>setAvatarPresetUrls({}),/Porträtquelle/);
  assert.equal(createAvatar(fakeDocument(),GEMINI_AVATAR_PRESETS[0].id,{},null).style.backgroundImage,'url("'+urls[GEMINI_AVATAR_PRESETS[0].id]+'")');
});
