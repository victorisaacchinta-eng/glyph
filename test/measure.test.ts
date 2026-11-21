import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Contour, type Pt, resample, perimeter, signedArea, depths } from '../src/outline.js';
import { fitCircle, ringStress, traceGrid, strokeWidths } from '../src/measure.js';
import { signedField, blendContours, unionFrame } from '../src/sdf.js';

const close = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const ellipse = (rx: number, ry: number, n = 720, cx = 0, cy = 0, cw = true): Contour => {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as Pt;
  });
  return cw ? pts : pts.reverse();
};
const square = (s: number, x = 0, y = 0): Contour => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const area = (cs: Contour[]) => cs.reduce((sum, c) => sum + signedArea(c), 0);

test('resampling spaces points evenly and keeps the perimeter', () => {
  const sq = square(100);
  const r = resample(sq, 40);
  assert.equal(r.length, 40);
  close(perimeter(r), 400, 1e-6);
  for (let i = 0; i < 40; i++) {
    const a = r[i], b = r[(i + 1) % 40];
    // consecutive points are one step apart along the outline (corners cut slightly)
    assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) <= 10 + 1e-9);
  }
});

test('nesting depth tells outers from holes', () => {
  assert.deepEqual(depths([ellipse(100, 100), ellipse(50, 50)]), [0, 1]);
});

test('ring contrast and stress axis on a ring built to be 2 : 1 with a vertical axis', () => {
  // outer ellipse 100 x 80, inner circle 60: sides are 40 thick, top and bottom 20
  const st = ringStress([ellipse(100, 80), ellipse(60, 60)])!;
  close(st.contrast, 2, 0.06, 'contrast');
  close(st.axis!.angle, 0, 3, 'axis');
});

test('a tilted ring reports a tilted axis', () => {
  const rot = (c: Contour, deg: number): Contour => {
    const r = (deg * Math.PI) / 180;
    return c.map(([x, y]) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)] as Pt);
  };
  const st = ringStress([rot(ellipse(100, 80), 20), ellipse(60, 60)])!;
  close(Math.abs(st.axis!.angle), 20, 4, 'tilted axis');
});

test('least-squares circle fit recovers a circle exactly', () => {
  const pts = ellipse(73, 73, 200, 12, -40);
  const c = fitCircle(pts);
  close(c.cx, 12, 1e-6); close(c.cy, -40, 1e-6); close(c.r, 73, 1e-6); close(c.rms, 0, 1e-6);
});

test('stroke widths from the distance transform measure a bar', () => {
  // a 400 x 40 bar: the medial ridge sits at width 40
  const st = strokeWidths([square(400, 0, 0).map(([x, y]) => [x, y / 10] as Pt)], 2);
  close(st.thick, 40, 2, 'bar width');
});

test('grid tracing turns cells into outer and hole loops', () => {
  const ring = [[true, true, true], [true, false, true], [true, true, true]];
  const loops = traceGrid(ring, 0, 0, 10);
  assert.equal(loops.length, 2);
  close(Math.abs(area(loops)), 800, 1e-9, 'eight filled cells of 10 x 10: outer 900 minus hole 100');
});

test('signed field: negative inside, distance to the edge', () => {
  const sq = square(100);
  const fr = unionFrame([[sq]], 20);
  const f = signedField([sq], fr, 5);
  const at = (x: number, y: number) => f.d[Math.round((y - f.y0) / f.cell) * f.cols + Math.round((x - f.x0) / f.cell)];
  close(at(50, 50), -50, 1e-6, 'centre');
  close(at(-10, 50), 10, 1e-6, 'outside left');
});

test('blending fields reproduces the endpoints and interpolates area', () => {
  const sq = square(100, -50, -50);
  const circle = ellipse(40, 40);
  const fr = unionFrame([[sq], [circle]], 20);
  const A = signedField([sq], fr, 2), B = signedField([circle], fr, 2);
  const a0 = Math.abs(area(blendContours(A, B, 0)));
  const a1 = Math.abs(area(blendContours(A, B, 1)));
  const am = Math.abs(area(blendContours(A, B, 0.5)));
  close(a0, 10000, 150, 'square');
  close(a1, Math.PI * 1600, 150, 'circle');
  assert.ok(am < a0 && am > a1, 'midpoint area lies between');
});
