import test from 'node:test';
import assert from 'node:assert/strict';
import {AVATAR_PRESETS,ATLAS_PRESETS,GEMINI_AVATAR_PRESETS,setAvatarPresetUrls,avatarVisual,createAvatar,mountAvatarPicker} from '../src/lib/agent-avatar.mjs';

test('six atlas portraits use explicit atlas positions and default roles',()=>{
  assert.equal(ATLAS_PRESETS.length,6);assert.equal(AVATAR_PRESETS.length,25);
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
  assert.equal(container.children.length,25);
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

test('all nineteen Gemini originals are hash-bound, uniquely registered and imported',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {createHash}=await import('node:crypto');
  const assetRoot=new URL('../src/assets/gemini-agent-portraits/',import.meta.url);
  const provenance=JSON.parse(await readFile(new URL('provenance.json',assetRoot),'utf8'));
  const imports=await readFile(new URL('../src/lib/gemini-avatar-assets.mjs',import.meta.url),'utf8');
  assert.equal(GEMINI_AVATAR_PRESETS.length,19);
  assert.equal(provenance.files.length,19);
  assert.equal(new Set(GEMINI_AVATAR_PRESETS.map(x=>x.id)).size,19);
  assert.deepEqual(provenance.files.map(({id,name})=>({id,name})),GEMINI_AVATAR_PRESETS);
  for(const item of provenance.files){
    assert.match(item.file,/^[a-z0-9-]+\.jpg$/);
    assert.ok(provenance.source_sessions.includes(item.source_session));
    const bytes=await readFile(new URL(item.file,assetRoot));
    assert.equal(bytes.subarray(0,3).toString('hex'),'ffd8ff');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.source_sha256);
    assert.ok(imports.includes("gemini-agent-portraits/"+item.file+"?url&no-inline"));
    assert.ok(imports.includes("'"+item.id+"':image"));
  }
});
