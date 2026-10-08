import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TICKET_SYMBOLS,createSymbol,withSkillSymbol} from '../src/lib/ticket-symbol.mjs';

test('sixteen existing Ticket-Master symbols are bundled with no active SVG content',()=>{
  assert.equal(TICKET_SYMBOLS.length,16);
  for(const item of TICKET_SYMBOLS){
    const svg=readFileSync(new URL('../src/assets/ticket-symbols/'+item.id+'.svg',import.meta.url),'utf8');
    assert.match(svg,/<svg\s/);
    assert.doesNotMatch(svg,/<(?:script|foreignObject)|\bon\w+\s*=|(?:href|src)\s*=["'](?:https?:|javascript:|data:)/i);
  }
});

test('symbol images resolve only known bundled assets',()=>{
  const doc={createElement:tag=>({tag,dataset:{},setAttribute(){}})};
  const urls={wissen:'/_astro/wissen.abc.svg'};
  assert.equal(createSymbol(doc,'https://foreign.example/bad.svg',urls,'wissen').src,urls.wissen);
  assert.throws(()=>createSymbol(doc,'wissen',{wissen:'https://foreign.example/bad.svg'}),/Symbolquelle/);
});

test('the skill symbol lives in frontmatter and preserves the remaining source and newlines',()=>{
  const text='---\r\nname: Grüße\r\nsymbol: wissen\r\ndescription: |\r\n  Österreich\r\n---\r\n# Inhalt\r\n';
  const changed=withSkillSymbol(text,'scripts');
  assert.match(changed,/symbol: scripts\r\n/);assert.doesNotMatch(changed,/symbol: wissen/);
  assert.ok(changed.endsWith('description: |\r\n  Österreich\r\n---\r\n# Inhalt\r\n'));
  assert.equal(withSkillSymbol('# Neu\n','wissen'),'---\nsymbol: wissen\n---\n# Neu\n');
  assert.throws(()=>withSkillSymbol('---\nsymbol: |\n  alt\n---\n# X','scripts'),/mehrzeilig/);
});

test('quoted, escaped and indented YAML root keys are rejected without changing source',()=>{
  for(const header of ['"symbol": wissen\nname: X','name: X\n\'symbol\': wissen',
    'name: X\n"sy\\u006dbol": wissen','  name: X\n  symbol: wissen','? symbol\n: wissen','- symbol: wissen',
    'name: X\n!!str symbol: wissen','name: X\n&key symbol: wissen','name: X\n<<: *root']) {
    const source='---\n'+header+'\n---\n# Inhalt';
    assert.throws(()=>withSkillSymbol(source,'scripts'),/komplexe Form/);
    assert.equal(source,'---\n'+header+'\n---\n# Inhalt');
  }
});

test('light SVG strokes have a constant dark backing and visible selection and keyboard focus',()=>{
  const css=readFileSync(new URL('../src/styles/ticket-symbols.css',import.meta.url),'utf8');
  assert.match(css,/\.ticket-symbol\s*\{[^}]*background:#172033/);
  assert.match(css,/\.symbol-choice\s*\{[^}]*background:#172033/);
  assert.match(css,/aria-pressed=true[^}]*#f8fafc/);
  assert.match(css,/focus-visible[^}]*outline:3px/);
  const luminance=hex=>{
    const channels=hex.match(/[0-9a-f]{2}/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  };
  for(const item of TICKET_SYMBOLS){
    const svg=readFileSync(new URL('../src/assets/ticket-symbols/'+item.id+'.svg',import.meta.url),'utf8');
    const colors=[...svg.matchAll(/(?:stroke|fill)="#([0-9a-f]{6})"/gi)].map(x=>x[1]);
    assert.ok(colors.length>0,item.id);
    for(const color of colors)assert.ok((luminance(color)+.05)/(luminance('172033')+.05)>=3,item.id+' '+color);
  }
});
test('artifact title and navigation use the requested floppy disk icon',()=>{
  const page=readFileSync(new URL('../src/pages/artefakte.astro',import.meta.url),'utf8');
  const nav=JSON.parse(readFileSync(new URL('../src/config/nav_config.json',import.meta.url),'utf8'));
  const link=nav.flatMap(section=>section.children||[]).find(link=>link.href==='/artefakte');
  assert.equal(link.icon,'💾');assert.match(page,/<span class="icon">💾<\/span> Artefakte/);
});
