/**
 * Everything expensive happens once, before the first frame: parse fonts, extract and normalise
 * outlines, measure them, rasterize the bitmap era, and pre-pair every morph. Drawing a frame is
 * then just interpolation, which keeps the film a pure function of time.
 */
import opentype, { type Font } from 'opentype.js';
import { ERAS } from './eras.js';
import { type Contour, type Pt, bbox, charContours, namedContours, shift } from './outline.js';
import { type Field, type Frame, signedField, unionFrame } from './sdf.js';
import { fitCircle, largestHole, ringStress, traceGrid } from './measure.js';

/** Every letter is scaled so its x-height is this many units. */
export const XH = 1000;
/**
 * The 1984 glyphs are drawn by hand on a 6-pixel x-height, the way screen fonts of the time were made.
 * Sampling a vector outline at this size gives mush; that is why bitmap faces were drawn, not converted.
 */
const BITMAP: Record<string, string[]> = {
  a: ['.###.', '....#', '.####', '#...#', '#..##', '.##.#'],
  o: ['.###.', '#...#', '#...#', '#...#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '#.#..', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  '9': ['.###.', '#...#', '#...#', '#...#', '.####', '....#', '....#', '#...#', '.###.'],
  '8': ['.###.', '#...#', '#...#', '#...#', '.###.', '#...#', '#...#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#..#.', '#####', '...#.', '...#.', '...#.'],
};
const PIXEL_ROWS_XH = 6;

export interface Shape {
  a: Contour[];
  o: Contour[];
  year: Contour[][]; // one entry per digit, laid out and centred
}

export interface EraGeo extends Shape {
  contrast?: number;
  axis?: { angle: number; a: Pt; b: Pt } | null;
  circle?: { cx: number; cy: number; r: number; rms: number };
  grid?: { cell: number; ox: number; oy: number; cols: number; rows: number; cells: boolean[][] };
}

export interface Fields { a: Field; o: Field; year: Field[]; yearOff: number[] }

export interface Scene {
  eras: EraGeo[]; // eras[7] is the variable era at weight 400 (Book)
  hair: Shape; // weight 100
  black: Shape; // weight 900
  /** Distance fields: one per era, then hairline (ERAS.length) and black (ERAS.length + 1). */
  fields: Fields[];
  /** Specimen-strip outlines for the finale (variable shown at weight 400). */
  title: Contour[][]; // G l y p h, each from a different era
}

async function load(url: string): Promise<Font> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font ${url}: ${res.status}`);
  return opentype.parse(await res.arrayBuffer());
}

function xHeightSize(font: Font): number {
  const bb = font.charToGlyph('x').getBoundingBox();
  return (XH * font.unitsPerEm) / bb.y2;
}

const centreX = (cs: Contour[]): Contour[] => {
  const b = bbox(cs);
  return shift(cs, -(b.x0 + b.x1) / 2, 0);
};

function yearShape(font: Font, year: string, size: number, aName?: string): Contour[][] {
  void aName;
  let x = 0;
  const digits: Contour[][] = [];
  for (const ch of year) {
    const g = font.charToGlyph(ch);
    digits.push(charContours(font, ch, size, x));
    x += ((g.advanceWidth ?? font.unitsPerEm * 0.6) * size) / font.unitsPerEm;
  }
  return digits.map((d) => shift(d, -x / 2, 0));
}

function shapeOf(font: Font, year: string, aGlyph?: string): Shape {
  const size = xHeightSize(font);
  const a = centreX(aGlyph ? namedContours(font, aGlyph, size) : charContours(font, 'a', size));
  const o = centreX(charContours(font, 'o', size));
  return { a, o, year: yearShape(font, year, size) };
}

function bitmapShape(year: string): { shape: Shape; grid: NonNullable<EraGeo['grid']> } {
  const cell = XH / PIXEL_ROWS_XH;
  const glyph = (ch: string, x: number) => {
    const rows = BITMAP[ch];
    const cells = rows.map((r) => [...r].map((c) => c === '#'));
    const oy = -rows.length * cell; // sits on the baseline
    return { cs: traceGrid(cells, x, oy, cell), cells, oy };
  };
  const w = 5 * cell;
  const a = glyph('a', -w / 2);
  const o = glyph('o', -w / 2);
  const adv = 6 * cell;
  const total = adv * year.length - cell;
  const digits = [...year].map((ch, i) => glyph(ch, -total / 2 + i * adv).cs);
  return {
    shape: { a: a.cs, o: o.cs, year: digits },
    grid: { cell, ox: -w / 2, oy: a.oy, cols: 5, rows: a.cells.length, cells: a.cells },
  };
}

/** Grid spacing in outline units (x-height = 1000). Finer for the hero, which is drawn largest. */
const CELL = { a: 7, o: 12, year: 9 };

/** Horizontal centre of each digit: digits are blended centred on themselves and moved separately. */
export function digitOffsets(s: Shape): number[] {
  return s.year.map((d) => { const b = bbox(d); return (b.x0 + b.x1) / 2; });
}

function fieldsFor(shapes: Shape[]): Fields[] {
  const offs = shapes.map(digitOffsets);
  const centred = shapes.map((s, k) => s.year.map((d, i) => shift(d, -offs[k][i], 0)));
  const fa: Frame = unionFrame(shapes.map((s) => s.a), 60);
  const fo: Frame = unionFrame(shapes.map((s) => s.o), 60);
  const fy: Frame[] = [0, 1, 2, 3].map((i) => unionFrame(centred.map((c) => c[i]), 60));
  return shapes.map((s, k) => ({
    a: signedField(s.a, fa, CELL.a),
    o: signedField(s.o, fo, CELL.o),
    year: centred[k].map((d, i) => signedField(d, fy[i], CELL.year)),
    yearOff: offs[k],
  }));
}

export async function buildScene(base: string): Promise<Scene> {
  const outlineEras = ERAS.filter((e) => e.kind === 'outline');
  const fonts = await Promise.all(outlineEras.map((e) => load(`${base}/${e.font}`)));
  const [hairFont, blackFont] = await Promise.all([load(`${base}/Jost-100-Hairline.ttf`), load(`${base}/Jost-900-Black.ttf`)]);

  const eras: EraGeo[] = outlineEras.map((e, i) => {
    const s = shapeOf(fonts[i], e.year, e.aGlyph);
    const st = ringStress(s.o);
    const geo: EraGeo = { ...s, contrast: st?.contrast, axis: st?.axis };
    if (e.aGlyph) {
      const hole = largestHole(s.a);
      if (hole) {
        const c = fitCircle(hole);
        geo.circle = { cx: c.cx, cy: c.cy, r: c.r, rms: c.rms };
      }
    }
    return geo;
  });

  const pix = bitmapShape('1984');
  eras.push({ ...pix.shape, grid: pix.grid });

  const book = shapeOf(fonts[fonts.length - 1], '2016', 'a.alt');
  const hair = shapeOf(hairFont, '2016', 'a.alt');
  const heavy = shapeOf(blackFont, '2016', 'a.alt');
  eras.push({ ...book });

  const t0 = performance.now();
  const fields = fieldsFor([...eras, hair, heavy]);
  console.info(`[glyph] distance fields in ${(performance.now() - t0).toFixed(0)} ms`);

  const sizeOf = (f: Font) => xHeightSize(f);
  const title = [
    centreX(charContours(fonts[0], 'G', sizeOf(fonts[0]))),
    centreX(charContours(fonts[1], 'l', sizeOf(fonts[1]))),
    centreX(charContours(fonts[2], 'y', sizeOf(fonts[2]))),
    centreX(charContours(fonts[3], 'p', sizeOf(fonts[3]))),
    centreX(charContours(fonts[5], 'h', sizeOf(fonts[5]))),
  ];
  return { eras, hair, black: heavy, fields, title };
}
