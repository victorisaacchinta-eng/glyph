import { film, springStep, springTrack, spring, progress, ease, clamp, lerp, rng, type FrameInfo } from 'reel-film';
import { ERAS, SECTION, FINALE, DURATION, BPM, PALETTE as C } from './eras.js';
import { buildScene, XH, type Scene, type Shape } from './scene.js';
import { traceContours } from './morph.js';
import { WEIGHT_START, weightAt, sectionStart, STRIP_LAND, TITLE_LAND } from './timing.js';
import { blendContours, type Field } from './sdf.js';
import { type Contour, bbox } from './outline.js';

const FONT = '"Schibsted Grotesk", system-ui, sans-serif';
const HERO = { duration: 0.8, bounce: 0.12 };
const SOFT = { duration: 0.7, bounce: 0 };

let scene: Scene;
let grain: CanvasPattern | null = null;

// ---------------------------------------------------------------- layout

interface Layout {
  wide: boolean;
  heroX: number; base: number; heroXH: number;
  colX: number; yearBase: number; yearXH: number;
  styleY: number; noteY: number; dataY: number; creditY: number;
  oX: number; oXH: number;
  line0: number; line1: number;
  tlY: number; tlX0: number; tlX1: number;
  s: number; // type unit
}

function layout(f: FrameInfo): Layout {
  const { width: W, height: H, short: S } = f;
  const wide = f.aspect >= 1.3;
  if (wide) {
    return {
      wide, s: S, heroX: W * 0.31, base: H * 0.66, heroXH: H * 0.3,
      colX: W * 0.585, yearBase: H * 0.4, yearXH: H * 0.105,
      styleY: H * 0.5, noteY: H * 0.552, dataY: H * 0.66, creditY: H * 0.7,
      oX: W * 0.585 + H * 0.045, oXH: H * 0.075,
      line0: W * 0.06, line1: W * 0.94,
      tlY: H * 0.895, tlX0: W * 0.06, tlX1: W * 0.94,
    };
  }
  return {
    wide, s: S, heroX: W * 0.5, base: H * 0.47, heroXH: H * 0.22,
    colX: W * 0.08, yearBase: H * 0.615, yearXH: H * 0.064,
    styleY: H * 0.685, noteY: H * 0.722, dataY: H * 0.822, creditY: H * 0.852,
    oX: W * 0.87, oXH: H * 0.048,
    line0: W * 0.06, line1: W * 0.94,
    tlY: H * 0.935, tlX0: W * 0.08, tlX1: W * 0.92,
  };
}

// ---------------------------------------------------------------- time helpers

const eraAt = (t: number) => clamp(Math.floor(t / SECTION), 0, ERAS.length - 1);

type Part = 'a' | 'o' | number; // number = year digit index

function fieldFor(i: number, part: Part): Field {
  const f = scene.fields[i];
  return part === 'a' ? f.a : part === 'o' ? f.o : f.year[part];
}
function shapePart(s: Shape, part: Part): Contour[] {
  return part === 'a' ? s.a : part === 'o' ? s.o : s.year[part];
}

/**
 * Trace a part (hero a, mini o or a year digit) as it should look at time t.
 * At rest it is the exact outline; in motion it is the zero contour of two blended distance fields.
 */
function tracePart(path: Path2D, t: number, part: Part, ox: number, oy: number, scale: number, delay = 0): void {
  const k = eraAt(t);
  const HAIR = ERAS.length, BLACK = ERAS.length + 1;
  const shapeAt = (i: number) => (i === HAIR ? scene.hair : i === BLACK ? scene.black : scene.eras[i]);
  const exact = (i: number) => traceContours(path, shapePart(shapeAt(i), part), ox, oy, scale);
  const blend = (i: number, j: number, p: number) => {
    // digits are blended centred on themselves; their positions interpolate separately
    const dx = typeof part === 'number' ? lerp(scene.fields[i].yearOff[part], scene.fields[j].yearOff[part], p) : 0;
    traceContours(path, blendContours(fieldFor(i, part), fieldFor(j, part), p), ox + dx * scale, oy, scale);
  };
  if (k === 0) return exact(0);
  const tt = t - delay;
  const last = ERAS.length - 1;
  if (k === last && tt >= WEIGHT_START) {
    // piecewise through the Book master, so 400 is always the exact outline
    const w = weightAt(tt);
    if (Math.abs(w - 400) < 0.5) return exact(last);
    return w > 400 ? blend(last, BLACK, (w - 400) / 500) : blend(last, HAIR, (400 - w) / 300);
  }
  const since = tt - sectionStart(k);
  const p = springStep(since, HERO);
  if (p <= 1e-4) return exact(k - 1);
  if (since > 0.4 && Math.abs(1 - p) < 0.002) return exact(k);
  blend(k - 1, k, p);
}

const ROLL = { duration: 0.6, bounce: 0.1 };

/**
 * Year digits: when only the typeface changes (a 1 becoming another era's 1) the digit melts through
 * the distance fields; when the value changes (4 to 5) there is no meaningful in-between shape, so it
 * rolls through a mask like an odometer.
 */
function traceDigit(path: Path2D, t: number, d: number, ox: number, oy: number, scale: number, delay: number, travel: number): void {
  const k = eraAt(t);
  if (k === 0) return tracePart(path, t, d, ox, oy, scale, delay);
  const from = ERAS[k - 1].year[d], to = ERAS[k].year[d];
  const since = t - delay - sectionStart(k);
  if (from === to || since > 1.2) return tracePart(path, t, d, ox, oy, scale, delay);
  if (since <= 0) return traceContours(path, scene.eras[k - 1].year[d], ox, oy, scale);
  const p = springStep(since, ROLL);
  traceContours(path, scene.eras[k - 1].year[d], ox, oy - p * travel, scale);
  traceContours(path, scene.eras[k].year[d], ox, oy + (1 - p) * travel, scale);
}

// ---------------------------------------------------------------- text

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, weight = 400, color = C.ink, align: CanvasTextAlign = 'left') {
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

/** Masked line swap: the old line rises out of a clip as the new one rises in. */
function swap(ctx: CanvasRenderingContext2D, prev: string, next: string, t: number, t0: number, x: number, y: number, size: number, weight = 400, color = C.ink) {
  const p = progress(t, t0, t0 + 0.45, ease.out);
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
  const w = Math.max(ctx.measureText(prev).width, ctx.measureText(next).width) + size;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - size * 0.2, y - size * 1.0, w, size * 1.28);
  ctx.clip();
  const travel = size * 1.28;
  if (p < 1 && prev) { ctx.globalAlpha = 1 - p * 0.6; text(ctx, prev, x, y - p * travel, size, weight, color); }
  if (p > 0 && next) { ctx.globalAlpha = 1; text(ctx, next, x, y + (1 - p) * travel, size, weight, color); }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function dataLine(k: number, t: number): [string, string] {
  const e = scene.eras[k];
  if (ERAS[k].kind === 'outline') {
    const a = e.axis?.angle ?? 0;
    let second = Math.abs(a) < 2 ? 'Stress vertical' : `Stress ${a < 0 ? '\u2212' : '+'}${Math.abs(a).toFixed(0)}\u00b0`;
    if (e.circle) second = `Bowl within ${((e.circle.rms / e.circle.r) * 100).toFixed(1)}% of a circle`;
    else if (!hasStress(k)) second = 'Near monoline';
    return [`Contrast ${e.contrast!.toFixed(1)} : 1`, second];
  }
  if (ERAS[k].kind === 'pixel') return [`${e.grid!.cols} by ${e.grid!.rows} pixels`, `${e.grid!.rows} px to the x-height`];
  return [`Weight ${Math.round(weightAt(t))}`, 'wght axis 100 to 900'];
}

/** Below this contrast there is no meaningful axis of stress to draw. */
const hasStress = (k: number) => ERAS[k].kind === 'outline' && (scene.eras[k].contrast ?? 1) >= 1.45;

// ---------------------------------------------------------------- film

film({
  title: 'Glyph',
  duration: DURATION,
  bpm: BPM,
  audio: 'score/score.wav',
  background: C.paper,
  async setup(canvas, ctx) {
    void canvas;
    await Promise.all([document.fonts.load(`400 20px ${FONT}`), document.fonts.load(`500 20px ${FONT}`)]);
    scene = await buildScene('assets/fonts');
    // paper grain: one fixed noise tile, seeded
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    const g = tile.getContext('2d')!;
    const img = g.createImageData(256, 256);
    const r = rng(1455);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (r() - 0.5) * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grain = ctx.createPattern(tile, 'repeat');
  },
  draw(ctx, t, f) {
    const L = layout(f);
    const k = eraAt(t);
    const fin = progress(t, FINALE, FINALE + 0.6, ease.inOut); // 0 -> 1 as the finale takes over
    const intro = progress(t, 0.05, 0.9, ease.out);

    drawGuides(ctx, t, f, L, fin);
    drawEra(ctx, t, f, L, k, fin);
    if (t >= FINALE - 0.01) drawFinale(ctx, t, f, L);
    drawHeader(ctx, t, f, L, intro);
    drawTimeline(ctx, t, f, L, k, 1 - fin);

    // grain over everything, multiplied, very light
    if (grain) {
      ctx.save();
      ctx.globalAlpha = 0.045;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = grain;
      ctx.fillRect(0, 0, f.width, f.height);
      ctx.restore();
    }
  },
  guides(o, t, f) {
    // x-ray: section boundaries and the hero spring
    const L = layout(f);
    o.fillStyle = 'rgba(255,80,40,0.9)';
    o.font = `12px ${FONT}`;
    const k = eraAt(t);
    o.fillText(`era ${k}  spring p = ${springStep(t - sectionStart(k), HERO).toFixed(3)}`, 12, 20);
    o.strokeStyle = 'rgba(255,80,40,0.6)';
    const sc = L.heroXH / XH;
    const b = bbox(scene.eras[k].a);
    o.strokeRect(L.heroX + b.x0 * sc, L.base + b.y0 * sc, (b.x1 - b.x0) * sc, (b.y1 - b.y0) * sc);
  },
});

// ---------------------------------------------------------------- layers

function drawGuides(ctx: CanvasRenderingContext2D, t: number, f: FrameInfo, L: Layout, fin: number) {
  const grow = progress(t, 0.25, 1.1, ease.out) * (1 - fin);
  if (grow <= 0) return;
  const lw = Math.max(1, f.short / 900);
  ctx.save();
  ctx.strokeStyle = C.rubric;
  ctx.lineWidth = lw;
  const x0 = L.line0, x1 = lerp(L.line0, L.line1, grow);
  // baseline (full width) and x-height (hero zone only)
  ctx.beginPath();
  ctx.moveTo(x0, L.base); ctx.lineTo(x1, L.base);
  const xhY = L.base - L.heroXH;
  const xhEnd = lerp(L.line0, L.wide ? f.width * 0.53 : L.line1, grow);
  ctx.moveTo(x0, xhY); ctx.lineTo(xhEnd, xhY);
  ctx.stroke();
  ctx.globalAlpha = grow;
  text(ctx, 'baseline', L.line0, L.base - L.s * 0.009, L.s * 0.0145, 400, C.rubric);
  text(ctx, 'x-height', L.line0, xhY - L.s * 0.009, L.s * 0.0145, 400, C.rubric);
  ctx.restore();
}

function drawEra(ctx: CanvasRenderingContext2D, t: number, f: FrameInfo, L: Layout, k: number, fin: number) {
  const t0 = sectionStart(k);
  const sc = L.heroXH / XH;

  // onion skin: the previous era's outline lingers in rubric as the new one arrives
  if (k > 0) {
    const ghost = 1 - progress(t, t0, t0 + 1.4, ease.out);
    if (ghost > 0.01) {
      const p = new Path2D();
      traceContours(p, scene.eras[k - 1].a, L.heroX, L.base, sc);
      ctx.save();
      ctx.globalAlpha = ghost * 0.75 * (1 - fin);
      ctx.strokeStyle = C.rubric;
      ctx.lineWidth = Math.max(1, f.short / 700);
      ctx.stroke(p);
      ctx.restore();
    }
  }

  // hero letter: era 0 is stamped in, later eras morph
  let stamp = 1, ink = 0;
  if (k === 0) {
    stamp = spring(t, 1.1, 1, 0.1, { duration: 0.45, bounce: 0.22 });
    ink = Math.exp(-Math.max(0, t - 0.1) / 0.25) * (t >= 0.1 ? 1 : 0);
  }
  const hero = new Path2D();
  const cx = L.heroX, cy = L.base - L.heroXH / 2;
  const s2 = sc * stamp;
  // scale about the letter's centre: baseline sits half an x-height below it
  tracePart(hero, t, 'a', cx, cy + (L.heroXH / 2) * stamp, s2);
  ctx.save();
  if (fin > 0) {
    // the finale pulls the hero into the last specimen slot
    const slot = specimenSlot(f, L, ERAS.length - 1);
    const m = fin;
    ctx.translate(lerp(0, slot.x - L.heroX, m), lerp(0, slot.base - L.base, m));
    const z = lerp(1, slot.xh / L.heroXH, m);
    ctx.translate(L.heroX, L.base);
    ctx.scale(z, z);
    ctx.translate(-L.heroX, -L.base);
  }
  if (ink > 0.01) {
    ctx.shadowColor = `rgba(21,21,21,${0.35 * ink})`;
    ctx.shadowBlur = L.s * 0.02 * ink;
  }
  ctx.fillStyle = C.ink;
  ctx.fill(hero, 'nonzero');
  ctx.restore();

  const fade = 1 - fin;
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;

  // construction overlays, one per era where they mean something
  overlay(ctx, t, f, L, k, t0);

  // year: the digits morph with the letter, a beat behind
  const ysc = L.yearXH / XH;
  const yp = new Path2D();
  const half = springTrack(t, scene.eras.map((g, i) => [i === 0 ? 0 : sectionStart(i) + 0.1, yearWidth(g) / 2] as const), HERO) * ysc;
  const travel = L.yearXH * 1.95;
  for (let d = 0; d < 4; d++) traceDigit(yp, t, d, L.colX + half, L.yearBase, ysc, 0.08 + d * 0.045, travel);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, L.yearBase - L.yearXH * 1.62, f.width, L.yearXH * 2.04);
  ctx.clip();
  ctx.fillStyle = C.ink;
  ctx.fill(yp, 'nonzero');
  ctx.restore();

  // labels swap through a mask line
  const prev = k > 0 ? ERAS[k - 1] : null;
  const e = ERAS[k];
  const intro = k === 0;
  swap(ctx, prev?.style ?? '', e.style, t, intro ? 0.45 : t0 + 0.2, L.colX, L.styleY, L.s * 0.038, 500);
  swap(ctx, prev?.note ?? '', e.note, t, intro ? 0.6 : t0 + 0.32, L.colX, L.noteY, L.s * 0.0215, 400, C.muted);

  // mini o and the measured stress axis
  const op = new Path2D();
  tracePart(op, t, 'o', L.oX, L.dataY, L.oXH / XH, 0.12);
  ctx.fillStyle = C.ink;
  ctx.fill(op, 'nonzero');
  const g = scene.eras[k];
  if (g.axis && hasStress(k)) {
    const show = progress(t, t0 + (intro ? 1.0 : 0.85), t0 + 1.5, ease.out) * (1 - progress(t, t0 + SECTION - 0.15, t0 + SECTION, ease.linear));
    if (show > 0) {
      const osc = L.oXH / XH;
      const { a, b } = g.axis;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const ext = 0.16;
      ctx.save();
      ctx.strokeStyle = C.rubric;
      ctx.lineWidth = Math.max(1, f.short / 800);
      ctx.globalAlpha = fade * show;
      ctx.beginPath();
      ctx.moveTo(L.oX + (a[0] - dx * ext) * osc, L.dataY + (a[1] - dy * ext) * osc);
      ctx.lineTo(L.oX + (a[0] + dx * (1 + ext) * show) * osc, L.dataY + (a[1] + dy * (1 + ext) * show) * osc);
      ctx.stroke();
      ctx.restore();
    }
  }

  // data readout, measured from the outlines; sits on the baseline
  const [d1, d2] = dataLine(k, t);
  const [p1, p2] = prev ? dataLine(k - 1, t) : ['', ''];
  const dx0 = L.wide ? L.oX + L.oXH * 1.1 : L.colX;
  const dataBase = L.dataY - L.s * 0.014;
  if (ERAS[k].kind === 'variable' && t > t0 + 1) {
    text(ctx, d1, dx0, dataBase - L.s * 0.026, L.s * 0.019, 500);
    text(ctx, d2, dx0, dataBase, L.s * 0.019, 400, C.muted);
  } else {
    swap(ctx, p1, d1, t, intro ? 0.75 : t0 + 0.45, dx0, dataBase - L.s * 0.026, L.s * 0.019, 500);
    swap(ctx, p2, d2, t, intro ? 0.85 : t0 + 0.52, dx0, dataBase, L.s * 0.019, 400, C.muted);
  }
  swap(ctx, prev ? `Set in ${prev.credit}` : '', `Set in ${e.credit}`, t, intro ? 0.95 : t0 + 0.6, L.colX, L.creditY, L.s * 0.0155, 400, C.muted);
  ctx.restore();
}

/** Year outlines are centred on their own width; this lets the left edge sit on the column. */
function yearWidth(g: Shape): number {
  const b = bbox(g.year.flat());
  return b.x1 - b.x0;
}

function overlay(ctx: CanvasRenderingContext2D, t: number, f: FrameInfo, L: Layout, k: number, t0: number) {
  const sc = L.heroXH / XH;
  const out = 1 - progress(t, t0 + SECTION - 0.2, t0 + SECTION, ease.linear);
  const lw = Math.max(1, f.short / 760);
  const g = scene.eras[k];
  ctx.save();
  ctx.strokeStyle = C.rubric;
  ctx.fillStyle = C.rubric;
  ctx.lineWidth = lw;
  if (g.circle) {
    // geometric construction: the least-squares circle fitted to the bowl, drawn on
    const p = progress(t, t0 + 0.95, t0 + 1.9, ease.inOut);
    ctx.globalAlpha *= out;
    const { cx, cy, r } = g.circle;
    ctx.beginPath();
    ctx.arc(L.heroX + cx * sc, L.base + cy * sc, r * sc, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
    if (p > 0.2) {
      const c = L.s * 0.012 * progress(t, t0 + 1.1, t0 + 1.4, ease.out);
      ctx.beginPath();
      ctx.moveTo(L.heroX + cx * sc - c, L.base + cy * sc); ctx.lineTo(L.heroX + cx * sc + c, L.base + cy * sc);
      ctx.moveTo(L.heroX + cx * sc, L.base + cy * sc - c); ctx.lineTo(L.heroX + cx * sc, L.base + cy * sc + c);
      ctx.stroke();
    }
  }
  if (g.grid) {
    // bitmap era: the pixel grid sweeps in row by row
    const { cell, ox, oy, cols, rows } = g.grid;
    ctx.lineWidth = Math.max(1, f.short / 1400);
    for (let r = 0; r <= rows; r++) {
      const p = progress(t, t0 + 0.6 + r * 0.04, t0 + 1.1 + r * 0.04, ease.out) * out;
      if (p <= 0) continue;
      ctx.globalAlpha = 0.55 * p;
      const y = L.base + (oy + r * cell) * sc;
      ctx.beginPath();
      ctx.moveTo(L.heroX + ox * sc, y);
      ctx.lineTo(L.heroX + (ox + cols * cell * p) * sc, y);
      ctx.stroke();
    }
    for (let c = 0; c <= cols; c++) {
      const p = progress(t, t0 + 0.75 + c * 0.04, t0 + 1.25 + c * 0.04, ease.out) * out;
      if (p <= 0) continue;
      ctx.globalAlpha = 0.55 * p;
      const x = L.heroX + (ox + c * cell) * sc;
      ctx.beginPath();
      ctx.moveTo(x, L.base + oy * sc);
      ctx.lineTo(x, L.base + (oy + rows * cell * p) * sc);
      ctx.stroke();
    }
  }
  if (ERAS[k].kind === 'variable') {
    // the weight axis as a slider under the readout
    const show = progress(t, t0 + 0.9, t0 + 1.4, ease.out);
    const x0 = L.wide ? L.oX + L.oXH * 1.1 : L.colX;
    const x1 = L.wide ? f.width * 0.92 : f.width * 0.62;
    const y = L.creditY + L.s * (L.wide ? 0.055 : 0.038);
    ctx.globalAlpha = show;
    ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(lerp(x0, x1, show), y);
    ctx.stroke();
    for (let w = 100; w <= 900; w += 100) {
      const x = lerp(x0, x1, (w - 100) / 800);
      ctx.beginPath();
      ctx.moveTo(x, y - L.s * 0.006); ctx.lineTo(x, y + L.s * 0.006);
      ctx.stroke();
    }
    const w = t >= WEIGHT_START ? weightAt(t) : 400;
    const hx = lerp(x0, x1, (w - 100) / 800);
    ctx.beginPath();
    ctx.arc(hx, y, L.s * 0.008 * show, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHeader(ctx: CanvasRenderingContext2D, t: number, f: FrameInfo, L: Layout, intro: number) {
  ctx.save();
  ctx.globalAlpha = intro;
  const y = f.height * 0.075;
  text(ctx, 'Glyph', L.line0, y, L.s * 0.021, 500);
  text(ctx, 'One letter, 570 years', L.line1, y, L.s * 0.021, 400, C.muted, 'right');
  ctx.restore();
}

const YEAR0 = 1455, YEAR1 = 2026;
function drawTimeline(ctx: CanvasRenderingContext2D, t: number, f: FrameInfo, L: Layout, k: number, show: number) {
  const grow = progress(t, 0.4, 1.3, ease.out) * show;
  if (grow <= 0) return;
  const X = (y: number) => lerp(L.tlX0, L.tlX1, (y - YEAR0) / (YEAR1 - YEAR0));
  const lw = Math.max(1, f.short / 1000);
  ctx.save();
  ctx.globalAlpha = grow;
  ctx.strokeStyle = C.faint;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(L.tlX0, L.tlY); ctx.lineTo(lerp(L.tlX0, L.tlX1, grow), L.tlY);
  ctx.stroke();
  // marker springs from year to year
  const keys = ERAS.map((e, i) => [i === 0 ? 0 : sectionStart(i), X(Number(e.year))] as const);
  const mx = springTrack(t, keys, SOFT);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = lw * 2;
  ctx.beginPath();
  ctx.moveTo(L.tlX0, L.tlY); ctx.lineTo(mx, L.tlY);
  ctx.stroke();
  ERAS.forEach((e, i) => {
    const x = X(Number(e.year));
    const on = i === k;
    ctx.fillStyle = i <= k ? C.ink : C.faint;
    ctx.fillRect(x - lw, L.tlY - L.s * 0.008, lw * 2, L.s * 0.016);
    if (L.wide || i % 2 === 0 || on) {
      text(ctx, e.year, x, L.tlY + L.s * 0.03, L.s * 0.0135, on ? 500 : 400, on ? C.ink : C.muted, 'center');
    }
  });
  ctx.fillStyle = C.rubric;
  ctx.beginPath();
  ctx.arc(mx, L.tlY, L.s * 0.0055, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- finale

function specimenSlot(f: FrameInfo, L: Layout, i: number): { x: number; base: number; xh: number } {
  const n = ERAS.length;
  const x0 = f.width * (L.wide ? 0.14 : 0.1), x1 = f.width * (L.wide ? 0.86 : 0.9);
  return { x: lerp(x0, x1, i / (n - 1)), base: f.height * (L.wide ? 0.69 : 0.66), xh: L.s * (L.wide ? 0.075 : 0.06) };
}

function drawFinale(ctx: CanvasRenderingContext2D, t: number, f: FrameInfo, L: Layout) {
  const T = t - FINALE;
  // specimen strip: every era's a, landing a sixteenth apart (the last one is the hero, already moving)
  for (let i = 0; i < ERAS.length - 1; i++) {
    const slot = specimenSlot(f, L, i);
    const p = springStep(t - STRIP_LAND(i), { duration: 0.6, bounce: 0.18 });
    if (p <= 0) continue;
    const path = new Path2D();
    traceContours(path, scene.eras[i].a, slot.x, slot.base + (1 - p) * L.s * 0.08, slot.xh / XH);
    ctx.globalAlpha = clamp(p * 1.4);
    ctx.fillStyle = C.ink;
    ctx.fill(path, 'nonzero');
    ctx.globalAlpha = 1;
  }
  ERAS.forEach((e, i) => {
    const slot = specimenSlot(f, L, i);
    const a = progress(T, 0.5 + i * 0.125, 1.0 + i * 0.125, ease.out);
    ctx.globalAlpha = a;
    text(ctx, e.year, slot.x, slot.base + L.s * 0.05, L.s * 0.016, 400, C.muted, 'center');
    ctx.globalAlpha = 1;
  });
  // title assembled from five eras, one letter per beat
  const tsc = (L.s * (L.wide ? 0.115 : 0.1)) / XH;
  const letters = scene.title;
  const widths = letters.map((c) => { const b = bbox(c); return (b.x1 - b.x0) * tsc; });
  const gap = L.s * 0.012;
  const total = widths.reduce((s, w) => s + w, 0) + gap * (letters.length - 1);
  let x = f.width / 2 - total / 2;
  const base = f.height * (L.wide ? 0.42 : 0.38);
  letters.forEach((c, i) => {
    const p = springStep(t - TITLE_LAND(i), { duration: 0.55, bounce: 0.2 });
    const cx = x + widths[i] / 2;
    x += widths[i] + gap;
    if (p <= 0) return;
    const path = new Path2D();
    traceContours(path, c, cx, base + (1 - p) * L.s * 0.05, tsc);
    ctx.globalAlpha = clamp(p * 1.5);
    ctx.fillStyle = C.ink;
    ctx.fill(path, 'nonzero');
  });
  ctx.globalAlpha = 1;
  const cr = progress(T, 4.1, 4.8, ease.out);
  ctx.globalAlpha = cr;
  text(ctx, 'Eight typefaces, one letter, 570 years. Every measurement is taken from the outlines on screen.', f.width / 2, f.height * (L.wide ? 0.84 : 0.85), L.s * (L.wide ? 0.0185 : 0.021), 400, C.muted, 'center');
  ctx.globalAlpha = 1;
}
