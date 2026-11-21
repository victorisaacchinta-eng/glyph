import opentype from 'opentype.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { glyphContours, depths, bbox } from '../src/outline.js';
import { strokeWidths, stressAxis, fitCircle, largestHole, pixelate, traceGrid } from '../src/measure.js';
import { prepareMorph } from '../src/morph.js';
import sharp from 'sharp';
const F = (pkg: string, file: string) => opentype.parse(readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`).buffer as ArrayBuffer);
const fonts = [
  ['1455 blackletter', F('texturina', 'texturina-latin-500-normal.woff')],
  ['1530 garalde', F('eb-garamond', 'eb-garamond-latin-400-normal.woff')],
  ['1757 transitional', F('libre-baskerville', 'libre-baskerville-latin-400-normal.woff')],
  ['1790 didone', F('bodoni-moda', 'bodoni-moda-latin-400-normal.woff')],
  ['1898 grotesque', F('schibsted-grotesk', 'schibsted-grotesk-latin-400-normal.woff')],
  ['1927 geometric', F('jost', 'jost-latin-400-normal.woff')],
] as const;
const S = 1000;
let svg = '';
const all: any[] = [];
fonts.forEach(([name, f], i) => {
  const cs = glyphContours(f, 'a', S);
  const sw = strokeWidths(cs, 0.5);
  const ax = stressAxis(cs);
  const hole = largestHole(cs);
  const fc = hole ? fitCircle(hole) : null;
  const xh = (f.tables.os2 as any).sxHeight / f.unitsPerEm;
  console.log(name.padEnd(18), 'contours', cs.length, 'depths', depths(cs).join(','), 'pts', cs.map(c=>c.length).join('/'),
    'contrast', sw.contrast.toFixed(2), `(${sw.thick.toFixed(0)}/${sw.thin.toFixed(0)})`, 'axis', ax ? ax.angle.toFixed(1) : '-', 'xh', xh.toFixed(3), 'circle rms', fc ? (fc.rms / fc.r).toFixed(3) : '-');
  all.push(cs);
  const ox = 80 + i * 700, oy = 900;
  svg += `<path fill="#111" fill-rule="evenodd" d="${cs.map(c => 'M' + c.map(p => `${(p[0]+ox).toFixed(1)},${(p[1]+oy).toFixed(1)}`).join('L') + 'Z').join('')}"/>`;
  if (ax) svg += `<line x1="${ax.a[0]+ox}" y1="${ax.a[1]+oy}" x2="${ax.b[0]+ox}" y2="${ax.b[1]+oy}" stroke="#e03c1f" stroke-width="6"/>`;
  svg += `<text x="${ox}" y="${oy+120}" font-size="44" font-family="DejaVu Sans">${name}</text>`;
});
// morph midpoints between consecutive glyphs
for (let i = 0; i < all.length - 1; i++) {
  const pairs = prepareMorph(all[i], all[i+1], 500);
  const ox = 80 + i * 700 + 350, oy = 1500;
  let d = '';
  for (const { a, b } of pairs) { for (let k = 0; k < a.length; k += 2) d += (k ? 'L' : 'M') + ((a[k]+b[k])/2+ox).toFixed(1) + ',' + ((a[k+1]+b[k+1])/2+oy).toFixed(1); d += 'Z'; }
  svg += `<path fill="#555" fill-rule="evenodd" d="${d}"/>`;
  console.log('morph', i, '->', i+1, 'pairs', pairs.length, pairs.map(p=>p.hole?'h':'o').join(''));
}
// pixelate the geometric a
const px = pixelate(all[5], 46, 0);
const loops = traceGrid(px.cells, px.ox, px.oy, px.cell);
console.log('pixel grid', px.cells.length, 'x', px.cells[0].length, 'loops', loops.length, loops.map(l=>l.length).join('/'));
svg += `<path fill="#111" fill-rule="evenodd" d="${loops.map(c => 'M' + c.map(p => `${(p[0]+80+6*700).toFixed(1)},${(p[1]+900).toFixed(1)}`).join('L') + 'Z').join('')}"/>`;
writeFileSync('tools/probe.png', await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4900" height="1900"><rect width="100%" height="100%" fill="#f4f4f2"/>${svg}</svg>`)).resize(2450).png().toBuffer());
