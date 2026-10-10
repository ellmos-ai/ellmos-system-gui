import test from 'node:test';
import assert from 'node:assert/strict';
import {AVATAR_PRESETS,ATLAS_PRESETS,GEMINI_AVATAR_PRESETS,PORTABLE_AVATAR_PRESETS,setAvatarPresetImages,setAvatarPresetUrls,avatarVisual,createAvatar,mountAvatarPicker} from '../src/lib/agent-avatar.mjs';

test('six atlas portraits use explicit atlas positions and default roles',()=>{
  assert.equal(ATLAS_PRESETS.length,6);assert.equal(AVATAR_PRESETS.length,70);
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
  setAvatarPresetImages(Object.fromEntries(PORTABLE_AVATAR_PRESETS.map((p,i)=>[p.id,'data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,i]).toString('base64')])));
  mountAvatarPicker(container,'preset:coordinator',{},'/_astro/portraits.abc.png',value=>{selected=value;});
  assert.equal(container.children.length,70);
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

async function portableImages(){
  const {readFile}=await import('node:fs/promises');
  return Object.fromEntries(await Promise.all(PORTABLE_AVATAR_PRESETS.map(async preset=>{
    const bytes=await readFile(new URL('../src/assets/agent-portraits-20261010/'+preset.id.slice(7)+'.png',import.meta.url));
    return [preset.id,'data:image/png;base64,'+bytes.toString('base64')];
  })));
}

test('all forty-five new portraits have unique bounded PNGs, provenance and static imports',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {createHash}=await import('node:crypto');
  const assetRoot=new URL('../src/assets/agent-portraits-20261010/',import.meta.url);
  const provenance=JSON.parse(await readFile(new URL('provenance.json',assetRoot),'utf8'));
  const imports=await readFile(new URL('../src/lib/new-agent-avatar-assets.mjs',import.meta.url),'utf8');
  assert.equal(PORTABLE_AVATAR_PRESETS.length,45);
  assert.equal(provenance.files.length,45);
  assert.equal(new Set(AVATAR_PRESETS.map(p=>p.id)).size,70);
  assert.deepEqual(provenance.files.map(({id,name})=>({id,name})),PORTABLE_AVATAR_PRESETS);
  assert.equal(provenance.originals_modified,false);
  for(const item of provenance.files){
    assert.match(item.file,/^[a-z0-9-]+\.png$/);
    assert.match(item.source_file,/^[a-z0-9_-]+\.png$/);
    assert.match(item.source_sha256,/^[0-9a-f]{64}$/);
    const bytes=await readFile(new URL(item.file,assetRoot));
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.deepEqual([bytes.readUInt32BE(16),bytes.readUInt32BE(20)],[256,256]);
    assert.deepEqual(item.dimensions,[256,256]);
    assert.equal(bytes.length,item.bytes);
    assert.ok(bytes.length<=180000);
    assert.ok(('data:image/png;base64,'+bytes.toString('base64')).length<=240000);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);
    assert.ok(imports.includes('agent-portraits-20261010/'+item.file+'?url&inline'));
    assert.ok(imports.includes("'"+item.id+"':image"));
  }
});

test('new choices emit image data and restore exactly one selected preset after persistence',async()=>{
  const images=await portableImages();
  setAvatarPresetImages(images);
  setAvatarPresetUrls(Object.fromEntries(GEMINI_AVATAR_PRESETS.map((p,i)=>[p.id,'/_astro/gemini-'+i+'.png'])));
  for(const preset of PORTABLE_AVATAR_PRESETS){
    const document=fakeDocument(),container=document.createElement('div');let selected;
    mountAvatarPicker(container,'preset:companion',{},'/_astro/portraits.abc.png',value=>{selected=value;});
    container.children.find(button=>button.dataset.preset===preset.id).click();
    assert.equal(selected,images[preset.id]);
    assert.match(selected,/^data:image\/png;base64,/);
    const stored=JSON.parse(JSON.stringify({avatar:selected}));
    assert.equal(avatarVisual(stored.avatar).id,preset.id);
    const picture=createAvatar(document,stored.avatar,{},null);
    assert.equal(picture.dataset.avatarPreset,preset.id);
    assert.equal(picture.style.backgroundImage,'url("'+images[preset.id]+'")');
    mountAvatarPicker(container,stored.avatar,{},'/_astro/portraits.abc.png',()=>{});
    assert.deepEqual(container.children.filter(button=>button.attributes['aria-pressed']==='true').map(button=>button.dataset.preset),[preset.id]);
  }
});

test('invalid or missing image maps fail without replacing the previous valid map',async()=>{
  const images=await portableImages(),id=PORTABLE_AVATAR_PRESETS[0].id;
  setAvatarPresetImages(images);
  for(const invalid of ['https://foreign.example/a.png','data:image/svg+xml;base64,AAAA','data:image/png;base64,A"','data:image/png;base64,'+'A'.repeat(240000)]){
    assert.throws(()=>setAvatarPresetImages({...images,[id]:invalid}),/Porträtquelle/);
    assert.equal(avatarVisual(images[id]).id,id);
  }
  assert.throws(()=>setAvatarPresetImages({}),/Porträtquelle/);
  assert.throws(()=>setAvatarPresetImages({...images,[id]:images[PORTABLE_AVATAR_PRESETS[1].id]}),/eindeutige/);
  assert.equal(avatarVisual(images[id]).id,id);
  const uploaded='data:image/png;base64,aGVsbG8=';
  assert.equal(avatarVisual(uploaded).kind,'upload');
  assert.equal(createAvatar(fakeDocument(),uploaded,{},null).src,uploaded);
});
