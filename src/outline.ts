/**
 * Glyph outlines as polygons.
 * opentype.js gives Bezier path commands; we flatten them into closed polylines
 * so outlines from unrelated typefaces can be compared, measured and morphed.
 */
import type { Font, Glyph, Path } from 'opentype.js';

export type Pt = [number, number];
export type Contour = Pt[];

/** Flatten a glyph to contours. Coordinates: y down, baseline at y = 0, origin at the left side bearing. */
export function glyphContours(font: Font, char: string, size: number, steps = 14): Contour[] {
  return pathContours(font.getPath(char, 0, 0, size), steps);
}

/** Look a glyph up by its post-table name, e.g. Jost's single-story "a.alt". */
export function glyphByName(font: Font, name: string): Glyph {
  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs.get(i);
    if (g.name === name) return g;
  }
  throw new Error(`glyph ${name} not found`);
}

export function namedContours(font: Font, name: string, size: number, x = 0, steps = 14): Contour[] {
  return pathContours(glyphByName(font, name).getPath(x, 0, size), steps);
}

export function charContours(font: Font, ch: string, size: number, x = 0, steps = 14): Contour[] {
  return pathContours(font.charToGlyph(ch).getPath(x, 0, size), steps);
}

export function pathContours(path: Path, steps = 14): Contour[] {
  const out: Contour[] = [];
  let cur: Contour = [];
  let x = 0, y = 0;
  for (const c of path.commands) {
    if (c.type === 'M') {
      if (cur.length > 2) out.push(cur);
      cur = [[c.x, c.y]];
      x = c.x; y = c.y;
    } else if (c.type === 'L') {
      cur.push([c.x, c.y]); x = c.x; y = c.y;
    } else if (c.type === 'Q') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push([u * u * x + 2 * u * t * c.x1 + t * t * c.x, u * u * y + 2 * u * t * c.y1 + t * t * c.y]);
      }
      x = c.x; y = c.y;
    } else if (c.type === 'C') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push([
          u * u * u * x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        ]);
      }
      x = c.x; y = c.y;
    } else if (c.type === 'Z') {
      if (cur.length > 2) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 2) out.push(cur);
  // drop a duplicated closing point
  for (const k of out) {
    const a = k[0], b = k[k.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) k.pop();
  }
  return out;
}

export function signedArea(c: Contour): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    const [x1, y1] = c[i], [x2, y2] = c[(i + 1) % c.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function centroid(c: Contour): Pt {
  let x = 0, y = 0;
  for (const p of c) { x += p[0]; y += p[1]; }
  return [x / c.length, y / c.length];
}

export function perimeter(c: Contour): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

export function bbox(cs: Contour[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cs) for (const [x, y] of c) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Even-odd point in polygon. */
export function inside(p: Pt, c: Contour): boolean {
  let hit = false;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const [xi, yi] = c[i], [xj, yj] = c[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Nesting depth of each contour: 0 = outer, 1 = hole, 2 = island in a hole... */
export function depths(cs: Contour[]): number[] {
  return cs.map((c, i) => {
    const probe = c[0];
    return cs.reduce((d, other, j) => (j !== i && inside(probe, other) ? d + 1 : d), 0);
  });
}

/** Resample a closed polyline to n points spaced evenly along its length. */
export function resample(c: Contour, n: number): Contour {
  const L = perimeter(c);
  const step = L / n;
  const out: Contour = [];
  let seg = 0, segPos = 0;
  let a = c[0], b = c[1 % c.length];
  let segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (segPos + segLen < target && seg < c.length) {
      segPos += segLen;
      seg++;
      a = c[seg % c.length];
      b = c[(seg + 1) % c.length];
      segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const u = segLen > 0 ? (target - segPos) / segLen : 0;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

/** Translate contours. */
export function shift(cs: Contour[], dx: number, dy: number): Contour[] {
  return cs.map((c) => c.map(([x, y]) => [x + dx, y + dy] as Pt));
}
