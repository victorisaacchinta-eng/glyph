import opentype from 'opentype.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { namedContours, charContours, bbox, shift } from '../src/outline.js';
import { pixelate, traceGrid, largestHole, fitCircle } from '../src/measure.js';
import sharp from 'sharp';
const f = opentype.parse(readFileSync('assets/fonts/Jost-400-Book.ttf').buffer as ArrayBuffer);
const xh = f.charToGlyph('x').getBoundingBox().y2; const size = 1000 * f.unitsPerEm / xh;
const alt = namedContours(f, 'a.alt', size), dbl = charContours(f, 'a', size);
const h = largestHole(alt)!; const c = fitCircle(h); console.log('a.alt bowl circle rms/r', (c.rms / c.r * 100).toFixed(2) + '%');
let svg = ''; let x = 50;
for (const [name, cs] of [['alt', alt], ['dbl', dbl]] as const) for (const n of [7, 8, 9, 10, 12]) {
  const p = pixelate(cs, 1000 / n, 0); const loops = traceGrid(p.cells, p.ox, p.oy, p.cell);
  const b = bbox(cs); const s = 0.22;
  svg += `<path fill="#111" fill-rule="evenodd" d="${loops.map(l => 'M' + l.map(q => `${(x + (q[0]-b.x0) * s).toFixed(1)},${(300 + q[1] * s).toFixed(1)}`).join('L') + 'Z').join('')}"/><text x="${x}" y="360" font-size="20" font-family="DejaVu Sans">${name} ${n}px</text>`;
  x += 190;
}
writeFileSync('tools/pix.png', await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="400"><rect width="100%" height="100%" fill="#eee"/>${svg}</svg>`)).png().toBuffer());
