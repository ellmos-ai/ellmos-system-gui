import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const css=fs.readFileSync(new URL('../src/styles/main.css',import.meta.url),'utf8');
const block=(selector)=>css.slice(css.indexOf(selector+' {')+selector.length+2).split('}')[0];
const root=block(':root');
const vars=(body)=>Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,6});/g)].map(m=>[m[1],m[2]]));
const base=vars(root);
const rgb=h=>{h=h.slice(1);if(h.length===3)h=[...h].map(c=>c+c).join('');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255)};
const lum=h=>rgb(h).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const [low,high]=[lum(a),lum(b)].sort((a,b)=>a-b);return (high+.05)/(low+.05)};
for(const theme of ['dark','light','ocean','warm']){
 test(theme+' default text palette remains readable on layered surfaces',()=>{
  const values=theme==='dark'?base:{...base,...vars(block('[data-theme="'+theme+'"]'))};
  for(const foreground of ['--text','--text-muted','--text-dim'])
   for(const background of ['--bg-dark','--bg-panel','--bg-card','--bg-elevated'])
    assert.ok(contrast(values[foreground],values[background])>=4.5,theme+' '+foreground+' on '+background+': '+contrast(values[foreground],values[background]).toFixed(2));
 });
 test(theme+' primary action foreground is readable',()=>{
  const values=theme==='dark'?base:{...base,...vars(block('[data-theme="'+theme+'"]'))};
  assert.ok(values['--on-accent'],'explicit action foreground');
  for(const background of ['--accent','--accent-light']) assert.ok(contrast(values['--on-accent'],values[background])>=4.5,theme+' action on '+background+': '+contrast(values['--on-accent'],values[background]).toFixed(2));
 });
}
test('mobile navigation has a full row below the product identity',()=>{
 assert.ok(/@media \(max-width: 760px\)[\s\S]*?\.header-left\s*\{[^}]*flex-wrap:\s*wrap/.test(css));
 assert.ok(/@media \(max-width: 760px\)[\s\S]*?\.main-nav\s*\{[^}]*flex:\s*1 1 100%/.test(css));
});

test('filled actions use their foreground while underlined tabs retain the accent',()=>{
 assert.ok(!css.includes('.nav-item.active, .tab-btn.active { color: var(--on-accent); }'));
 const settings=fs.readFileSync(new URL('../src/pages/settings.astro',import.meta.url),'utf8');
 assert.ok(/\.tab-btn\.active\s*\{[^}]*background:\s*var\(--accent\);[^}]*color:\s*var\(--on-accent\)/.test(settings));
});

test('the final primary hover rule overrides the generic button hover foreground',()=>{
 const primary=css.lastIndexOf('\n.btn-primary:hover {');
 assert.ok(primary>css.lastIndexOf('.btn:hover {'));
 const body=css.slice(primary).split('}')[0];
 assert.ok(body.includes('color: var(--on-accent);'));
 assert.ok(css.includes('[data-theme="colorful"] .btn-primary:hover,'));
 assert.ok(css.includes('[data-theme="custom"] .btn-primary:hover { color: #fff; }'));
});
