import opentype from 'opentype.js';
import { readFileSync } from 'node:fs';
import { glyphContours, depths, signedArea } from '../src/outline.js';
import { stressAxis } from '../src/measure.js';
const F = (pkg: string, file: string) => opentype.parse(readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`).buffer as ArrayBuffer);
const jost = F('jost', 'jost-latin-400-normal.woff');
const names: string[] = [];
for (let i = 0; i < jost.glyphs.length; i++) { const g = jost.glyphs.get(i); if (g.name && /^a(\.|$)/.test(g.name)) names.push(`${i}:${g.name}`); }
console.log('jost a glyphs', names.join(' '));
console.log('gsub features', (jost.tables.gsub as any)?.features?.map((f: any) => f.tag).join(','));
const fonts = [['texturina','texturina-latin-500-normal.woff'],['eb-garamond','eb-garamond-latin-400-normal.woff'],['libre-baskerville','libre-baskerville-latin-400-normal.woff'],['bodoni-moda','bodoni-moda-latin-400-normal.woff'],['schibsted-grotesk','schibsted-grotesk-latin-400-normal.woff'],['jost','jost-latin-400-normal.woff']];
for (const [p, f] of fonts) {
  const font = F(p, f);
  const cs = glyphContours(font, 'o', 1000);
  const d = depths(cs);
  const hole = cs[d.indexOf(1)], outer = cs[d.indexOf(0)];
  // ring thickness: from each inner point, distance to the nearest outer point
  const th = hole.map(pt => Math.min(...outer.map(q => Math.hypot(pt[0]-q[0], pt[1]-q[1]))));
  const n = th.length, k = Math.max(2, Math.round(n/40));
  const sm = th.map((_, i) => { let s = 0; for (let j=-k;j<=k;j++) s += th[(i+j+n)%n]; return s/(2*k+1); });
  const ax = stressAxis(cs);
  console.log(p.padEnd(18), 'o contrast', (Math.max(...sm)/Math.min(...sm)).toFixed(2), 'axis', ax?.angle.toFixed(1));
}
