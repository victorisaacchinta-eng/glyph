/**
 * Signed-distance-field morphing.
 *
 * Point-to-point interpolation tears when two letters have different topology (a double-story
 * 'a' into a single-story one, a vector into pixels). Instead each glyph becomes a grid of signed
 * distances to its outline (negative inside). A morph blends two grids and extracts the zero
 * contour with marching squares. Holes open and close smoothly, nothing self-intersects, and the
 * result is still a crisp vector path.
 */
import type { Contour, Pt } from './outline.js';

export interface Frame { x0: number; y0: number; x1: number; y1: number }

export interface Field {
  cols: number; // grid points per row
  rows: number;
  x0: number;
  y0: number;
  cell: number;
  d: Float32Array;
}

export function unionFrame(sets: Contour[][], pad: number): Frame {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const cs of sets) for (const c of cs) for (const [x, y] of c) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** Exact signed distance to the outline at every grid point (inside by even-odd scanline). */
export function signedField(cs: Contour[], fr: Frame, cell: number): Field {
  const cols = Math.ceil((fr.x1 - fr.x0) / cell) + 1;
  const rows = Math.ceil((fr.y1 - fr.y0) / cell) + 1;
  const d = new Float32Array(cols * rows);
  // flatten segments once
  const seg: number[] = [];
  for (const c of cs) for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    seg.push(a[0], a[1], b[0], b[1]);
  }
  const S = new Float64Array(seg);
  const n = S.length / 4;
  const xs: number[] = [];
  for (let r = 0; r < rows; r++) {
    const y = fr.y0 + r * cell;
    // inside test: crossings of this scanline
    xs.length = 0;
    for (let k = 0; k < n; k++) {
      const ya = S[4 * k + 1], yb = S[4 * k + 3];
      if ((ya > y) !== (yb > y)) {
        const xa = S[4 * k], xb = S[4 * k + 2];
        xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
      }
    }
    xs.sort((p, q) => p - q);
    let ci = 0;
    let best = Infinity;
    let lastBestSeg = 0;
    for (let c = 0; c < cols; c++) {
      const x = fr.x0 + c * cell;
      while (ci < xs.length && xs[ci] < x) ci++;
      const inside = (ci & 1) === 1;
      // start from the previous best as an upper bound (moved by one cell at most)
      const s0 = lastBestSeg;
      best = segDist2(S, s0, x, y);
      let bi = s0;
      for (let k = 0; k < n; k++) {
        // cheap rejection on bounding box
        const ax = S[4 * k], ay = S[4 * k + 1], bx = S[4 * k + 2], by = S[4 * k + 3];
        const dxm = x < Math.min(ax, bx) ? Math.min(ax, bx) - x : x > Math.max(ax, bx) ? x - Math.max(ax, bx) : 0;
        if (dxm * dxm >= best) continue;
        const dym = y < Math.min(ay, by) ? Math.min(ay, by) - y : y > Math.max(ay, by) ? y - Math.max(ay, by) : 0;
        if (dxm * dxm + dym * dym >= best) continue;
        const dd = segDist2(S, k, x, y);
        if (dd < best) { best = dd; bi = k; }
      }
      lastBestSeg = bi;
      const dist = Math.sqrt(best);
      d[r * cols + c] = inside ? -dist : dist;
    }
  }
  return { cols, rows, x0: fr.x0, y0: fr.y0, cell, d };
}

function segDist2(S: Float64Array, k: number, x: number, y: number): number {
  const ax = S[4 * k], ay = S[4 * k + 1], bx = S[4 * k + 2], by = S[4 * k + 3];
  const vx = bx - ax, vy = by - ay;
  const L = vx * vx + vy * vy;
  let u = L > 0 ? ((x - ax) * vx + (y - ay) * vy) / L : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const px = ax + vx * u - x, py = ay + vy * u - y;
  return px * px + py * py;
}

/**
 * Zero contour of (1 - p) * A + p * B by marching squares, as closed loops in outline units.
 * Saddle cells are resolved with the cell-centre average.
 */
export function blendContours(A: Field, B: Field, p: number): Pt[][] {
  const { cols, rows, x0, y0, cell } = A;
  const n = cols * rows;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = A.d[i] + (B.d[i] - A.d[i]) * p;

  // edge ids: horizontal edge (r, c)-(r, c+1) = 2*(r*cols+c); vertical (r, c)-(r+1, c) = 2*(r*cols+c)+1
  const pointOf = new Map<number, Pt>();
  const nextOf = new Map<number, number>();
  const edgePoint = (id: number): Pt => {
    let pt = pointOf.get(id);
    if (pt) return pt;
    const base = id >> 1, r = Math.floor(base / cols), c = base % cols;
    const a = v[base];
    if ((id & 1) === 0) {
      const b = v[base + 1];
      const u = a / (a - b);
      pt = [x0 + (c + u) * cell, y0 + r * cell];
    } else {
      const b = v[base + cols];
      const u = a / (a - b);
      pt = [x0 + c * cell, y0 + (r + u) * cell];
    }
    pointOf.set(id, pt);
    return pt;
  };
  // directed segment from edge e1 to edge e2, inside on the left (y down: consistent winding)
  const link = (e1: number, e2: number) => { nextOf.set(e1, e2); edgePoint(e1); edgePoint(e2); };

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      const tl = v[i], tr = v[i + 1], br = v[i + cols + 1], bl = v[i + cols];
      const code = (tl < 0 ? 8 : 0) | (tr < 0 ? 4 : 0) | (br < 0 ? 2 : 0) | (bl < 0 ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = 2 * i, bottom = 2 * (i + cols), left = 2 * i + 1, right = 2 * (i + 1) + 1;
      switch (code) {
        case 1: link(left, bottom); break;
        case 2: link(bottom, right); break;
        case 3: link(left, right); break;
        case 4: link(right, top); break;
        case 6: link(bottom, top); break;
        case 7: link(left, top); break;
        case 8: link(top, left); break;
        case 9: link(top, bottom); break;
        case 11: link(top, right); break;
        case 12: link(right, left); break;
        case 13: link(right, bottom); break;
        case 14: link(bottom, left); break;
        case 5: {
          const centre = (tl + tr + br + bl) / 4;
          if (centre < 0) { link(left, top); link(right, bottom); } else { link(left, bottom); link(right, top); }
          break;
        }
        case 10: {
          const centre = (tl + tr + br + bl) / 4;
          if (centre < 0) { link(top, right); link(bottom, left); } else { link(top, left); link(bottom, right); }
          break;
        }
      }
    }
  }
  const loops: Pt[][] = [];
  const seen = new Set<number>();
  for (const start of nextOf.keys()) {
    if (seen.has(start)) continue;
    const loop: Pt[] = [];
    let e: number | undefined = start;
    let guard = 0;
    while (e !== undefined && !seen.has(e) && guard++ < 200000) {
      seen.add(e);
      loop.push(pointOf.get(e)!);
      e = nextOf.get(e);
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}
