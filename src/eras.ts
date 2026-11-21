/** The eight stops of the film. Fonts are open-licensed revivals or designs in each tradition, credited on screen. */
export interface Era {
  year: string;
  style: string;
  note: string;
  font?: string;
  aGlyph?: string; // glyph name override for the hero letter
  credit: string;
  kind: 'outline' | 'pixel' | 'variable';
}

export const ERAS: Era[] = [
  { year: '1455', style: 'Blackletter', note: 'Gutenberg prints the Bible in Mainz.', font: 'texturina-500.woff', credit: 'Texturina', kind: 'outline' },
  { year: '1530', style: 'Old-style', note: 'Garamond cuts romans for Robert Estienne in Paris.', font: 'eb-garamond-400.woff', credit: 'EB Garamond', kind: 'outline' },
  { year: '1757', style: 'Transitional', note: 'Baskerville prints his Virgil in Birmingham.', font: 'baskervville-400.woff', credit: 'Baskervville', kind: 'outline' },
  { year: '1790', style: 'Didone', note: 'Bodoni thins the strokes to a hairline in Parma.', font: 'bodoni-moda-400.woff', credit: 'Bodoni Moda', kind: 'outline' },
  { year: '1898', style: 'Grotesque', note: 'Berthold releases Akzidenz-Grotesk in Berlin.', font: 'schibsted-grotesk-400.woff', credit: 'Schibsted Grotesk', kind: 'outline' },
  { year: '1927', style: 'Geometric', note: 'Paul Renner draws Futura from circles and lines.', font: 'Jost-400-Book.ttf', aGlyph: 'a.alt', credit: 'Jost', kind: 'outline' },
  { year: '1984', style: 'Bitmap', note: 'The Macintosh sets type on a screen, pixel by pixel.', credit: 'a bitmap drawn for this film', kind: 'pixel' },
  { year: '2016', style: 'Variable', note: 'One font file holds every weight in between.', credit: 'Jost, Hairline to Black', kind: 'variable' },
];

/** Section length in seconds: two bars at 120 BPM. */
export const SECTION = 4;
export const FINALE = ERAS.length * SECTION;
export const DURATION = FINALE + 6;
export const BPM = 120;

export const PALETTE = {
  paper: '#ECEBE7',
  ink: '#151515',
  rubric: '#DE3B1B',
  muted: 'rgba(21,21,21,0.56)',
  faint: 'rgba(21,21,21,0.14)',
};
