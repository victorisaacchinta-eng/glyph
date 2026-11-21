import opentype from 'opentype.js';
import { readFileSync } from 'node:fs';
import { glyphContours, depths } from '../src/outline.js';
import { stressAxis } from '../src/measure.js';
const jost = opentype.parse(readFileSync('assets/fonts/Jost-400-Book.ttf').buffer as ArrayBuffer);
const names: string[] = [];
for (let i = 0; i < jost.glyphs.length; i++) { const g = jost.glyphs.get(i); if (g.name && /^a(\.|$)/.test(g.name)) names.push(`${i}:${g.name}`); }
console.log('jost a glyphs', names.join(' '));
console.log('features', [...new Set((jost.tables.gsub as any)?.features?.map((f: any) => f.tag))].join(','));
const bask = opentype.parse(readFileSync('node_modules/@fontsource/baskervville/files/baskervville-latin-400-normal.woff').buffer as ArrayBuffer);
const cs = glyphContours(bask, 'o', 1000); const d = depths(cs); const hole = cs[d.indexOf(1)], outer = cs[d.indexOf(0)];
const th = hole.map(pt => Math.min(...outer.map(q => Math.hypot(pt[0]-q[0], pt[1]-q[1])))); const n = th.length, k = Math.max(2, Math.round(n/40));
const sm = th.map((_, i) => { let s = 0; for (let j=-k;j<=k;j++) s += th[(i+j+n)%n]; return s/(2*k+1); });
console.log('baskervville o contrast', (Math.max(...sm)/Math.min(...sm)).toFixed(2), 'axis', stressAxis(cs)?.angle.toFixed(1));
