/**
 * Measurements taken from the outlines themselves, so every number on screen is computed, not typed.
 *  - rasterize: scanline even-odd fill into a bitmap
 *  - strokeWidths: exact Euclidean distance transform (Felzenszwalb and Huttenlocher), then the
 *    medial ridge gives local stroke widths; contrast = thick / thin
 *  - stressAxis: thinnest points of the bowl ring define the axis of stress
 *  - fitCircle: least-squares circle (Kasa) for geometric construction
 *  - pixelate + traceGrid: the vector letter as a coarse bitmap, traced back into polygons
 */
import { type Contour, type Pt, bbox, depths, signedArea } from './outline.js';

export interface Raster { w: number; h: number; x0: number; y0: number; scale: number; px: Uint8Array }

export function rasterize(cs: Contour[], scale: number, pad = 2): Raster {
  const b = bbox(cs);
  const w = Math.ceil((b.x1 - b.x0) * scale) + pad * 2;
  const h = Math.ceil((b.y1 - b.y0) * scale) + pad * 2;
  const x0 = b.x0 - pad / scale, y0 = b.y0 - pad / scale;
  const px = new Uint8Array(w * h);
  const xs: number[] = [];
  for (let r = 0; r < h; r++) {
    const y = y0 + (r + 0.5) / scale;
    xs.length = 0;
    for (const c of cs) {
      for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
        const [xa, ya] = c[j], [xb, yb] = c[i];
        if ((ya > y) !== (yb > y)) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil((xs[k] - x0) * scale - 0.5));
      const e = Math.min(w - 1, Math.floor((xs[k + 1] - x0) * scale - 0.5));
      for (let col = a; col <= e; col++) px[r * w + col] = 1;
    }
  }
  return { w, h, x0, y0, scale, px };
}

/** 1D squared distance transform of f (Felzenszwalb and Huttenlocher, 2012). */
function dt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}

/** Euclidean distance (in pixels) from each inked pixel to the nearest blank one. */
export function distanceTransform(r: Raster): Float64Array {
  const { w, h, px } = r;
  const INF = 1e20;
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = px[i] ? INF : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1), v = new Int32Array(n);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    dt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    dt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]);
  }
  return g;
}

export interface StrokeStats {
  thick: number; // in outline units
  thin: number;
  contrast: number; // thick / thin
  ridge: Pt[]; // medial points (outline units) with width in [2]
  widths: number[];
}

/** Stroke widths along the medial ridge: 2 x distance-to-edge at ridge pixels. */
export function strokeWidths(cs: Contour[], scale = 2): StrokeStats {
  const r = rasterize(cs, scale);
  const dist = distanceTransform(r);
  const { w, h } = r;
  const ridge: Pt[] = [];
  const widths: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, dv = dist[i];
      if (dv < 1.5) continue;
      // ridge: not smaller than either neighbour along at least one axis pair
      const hx = dv >= dist[i - 1] && dv >= dist[i + 1];
      const hy = dv >= dist[i - w] && dv >= dist[i + w];
      const hd = dv >= dist[i - w - 1] && dv >= dist[i + w + 1];
      const ha = dv >= dist[i - w + 1] && dv >= dist[i + w - 1];
      if (hx || hy || hd || ha) {
        ridge.push([r.x0 + (x + 0.5) / scale, r.y0 + (y + 0.5) / scale]);
        widths.push((2 * dv) / scale);
      }
    }
  }
  const sorted = [...widths].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const thick = q(0.97), thin = q(0.06);
  return { thick, thin, contrast: thick / thin, ridge, widths };
}

/**
 * Axis of stress from the bowl: for each point on the counter (the hole), the stroke thickness is the
 * distance to the nearest outer-contour point. The two thinnest places sit at either end of the axis.
 */
export function stressAxis(cs: Contour[]): { angle: number; a: Pt; b: Pt } | null {
  const d = depths(cs);
  const holes = cs.filter((_, i) => d[i] === 1);
  const outers = cs.filter((_, i) => d[i] === 0);
  if (!holes.length) return null;
  const bowl = holes.reduce((m, c) => (Math.abs(signedArea(c)) > Math.abs(signedArea(m)) ? c : m));
  const outerPts = outers.flat();
  const thick = bowl.map((p) => {
    let best = Infinity;
    for (const q of outerPts) {
      const dd = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
      if (dd < best) best = dd;
    }
    return Math.sqrt(best);
  });
  // smooth around the loop, then take the thinnest point and the thinnest one roughly opposite
  const n = bowl.length, k = Math.max(2, Math.round(n / 40));
  const sm = thick.map((_, i) => {
    let s = 0;
    for (let j = -k; j <= k; j++) s += thick[(i + j + n) % n];
    return s / (2 * k + 1);
  });
  let i0 = 0;
  for (let i = 1; i < n; i++) if (sm[i] < sm[i0]) i0 = i;
  let i1 = -1;
  for (let i = 0; i < n; i++) {
    const sep = Math.min(Math.abs(i - i0), n - Math.abs(i - i0));
    if (sep < n * 0.3) continue;
    if (i1 < 0 || sm[i] < sm[i1]) i1 = i;
  }
  const a = bowl[i0], b = bowl[i1];
  // angle from vertical, positive = leaning right at the top (y is down)
  const [top, bot] = a[1] < b[1] ? [a, b] : [b, a];
  const angle = (Math.atan2(top[0] - bot[0], bot[1] - top[1]) * 180) / Math.PI;
  return { angle, a: top, b: bot };
}

/**
 * Stroke contrast of an 'o': walk the counter and, at every point, take the distance to the outer
 * contour (the local stroke thickness). Thick / thin of the smoothed ring is the classical contrast;
 * the two thinnest places give the axis of stress.
 */
export function ringStress(cs: Contour[]): { contrast: number; thick: number; thin: number; axis: { angle: number; a: Pt; b: Pt } | null } | null {
  const d = depths(cs);
  const hi = d.indexOf(1), oi = d.indexOf(0);
  if (hi < 0 || oi < 0) return null;
  const hole = cs[hi], outer = cs[oi];
  const th = hole.map((p) => {
    let best = Infinity;
    for (const q of outer) best = Math.min(best, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2);
    return Math.sqrt(best);
  });
  const n = th.length, k = Math.max(2, Math.round(n / 40));
  const sm = th.map((_, i) => {
    let s = 0;
    for (let j = -k; j <= k; j++) s += th[(i + j + n) % n];
    return s / (2 * k + 1);
  });
  const thick = Math.max(...sm), thin = Math.min(...sm);
  return { contrast: thick / thin, thick, thin, axis: stressAxis(cs) };
}

/** Kasa least-squares circle fit. */
export function fitCircle(pts: Pt[]): { cx: number; cy: number; r: number; rms: number } {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [A B C]^T = [sxz syz sz]^T for x^2+y^2 = A x + B y + C
  const M = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, n, sz]];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  const A = M[0][3] / M[0][0], B = M[1][3] / M[1][1], C = M[2][3] / M[2][2];
  const cx = A / 2, cy = B / 2, r = Math.sqrt(C + cx * cx + cy * cy);
  const rms = Math.sqrt(pts.reduce((s, [x, y]) => s + (Math.hypot(x - cx, y - cy) - r) ** 2, 0) / n);
  return { cx, cy, r, rms };
}

/** The bowl counter of a glyph: its largest hole. */
export function largestHole(cs: Contour[]): Contour | null {
  const d = depths(cs);
  const holes = cs.filter((_, i) => d[i] === 1);
  if (!holes.length) return null;
  return holes.reduce((m, c) => (Math.abs(signedArea(c)) > Math.abs(signedArea(m)) ? c : m));
}

/** Coarse bitmap of a glyph: cell size in outline units, sampled at cell centres. */
export function pixelate(cs: Contour[], cell: number, baseline = 0): { cells: boolean[][]; ox: number; oy: number; cell: number } {
  const b = bbox(cs);
  const ox = Math.floor(b.x0 / cell) * cell;
  // snap rows to the baseline so the bitmap sits on it
  const oy = baseline - Math.ceil((baseline - b.y0) / cell) * cell;
  const cols = Math.ceil((b.x1 - ox) / cell), rows = Math.ceil((b.y1 - oy) / cell);
  const r = rasterize(cs, 4 / cell * 4, 0);
  const cells: boolean[][] = [];
  for (let y = 0; y < rows; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < cols; x++) {
      // majority vote of a 4x4 sub-sample
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const px = ox + (x + (sx + 0.5) / 4) * cell, py = oy + (y + (sy + 0.5) / 4) * cell;
        const cx = Math.floor((px - r.x0) * r.scale), cy = Math.floor((py - r.y0) * r.scale);
        if (cx >= 0 && cy >= 0 && cx < r.w && cy < r.h && r.px[cy * r.w + cx]) hit++;
      }
      row.push(hit >= 8);
    }
    cells.push(row);
  }
  return { cells, ox, oy, cell };
}

/** Trace the boundary of filled cells into closed rectilinear polygons (outers and holes). */
export function traceGrid(cells: boolean[][], ox: number, oy: number, cell: number): Contour[] {
  const rows = cells.length, cols = cells[0]?.length ?? 0;
  const filled = (x: number, y: number) => y >= 0 && x >= 0 && y < rows && x < cols && cells[y][x];
  // directed edges with filled cell on the right-hand side (y down => clockwise outers)
  const next = new Map<string, [number, number][]>();
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const k = `${x1},${y1}`;
    if (!next.has(k)) next.set(k, []);
    next.get(k)!.push([x2, y2]);
  };
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!filled(x, y)) continue;
    if (!filled(x, y - 1)) add(x, y, x + 1, y);
    if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!filled(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops: Contour[] = [];
  for (const [start, outs] of next) {
    while (outs.length) {
      const loop: Pt[] = [];
      let [cx, cy] = start.split(',').map(Number);
      let [nx, ny] = outs.pop()!;
      loop.push([cx, cy]);
      let guard = 0;
      while (!(nx === Number(start.split(',')[0]) && ny === Number(start.split(',')[1])) && guard++ < 100000) {
        loop.push([nx, ny]);
        const cand = next.get(`${nx},${ny}`)!;
        // prefer turning right at pinch points so loops stay simple
        const dx = nx - cx, dy = ny - cy;
        cand.sort((p, q) => turn(dx, dy, p[0] - nx, p[1] - ny) - turn(dx, dy, q[0] - nx, q[1] - ny));
        const nn = cand.shift()!;
        cx = nx; cy = ny; [nx, ny] = nn;
      }
      // remove collinear points
      const simple = loop.filter((p, i) => {
        const a = loop[(i - 1 + loop.length) % loop.length], b = loop[(i + 1) % loop.length];
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
      });
      loops.push(simple.map(([x, y]) => [ox + x * cell, oy + y * cell] as Pt));
    }
  }
  return loops;
}

function turn(dx: number, dy: number, ex: number, ey: number): number {
  // smaller = more to the right (clockwise in y-down screen space)
  const cross = dx * ey - dy * ex;
  const dot = dx * ex + dy * ey;
  return -Math.atan2(cross, dot);
}
