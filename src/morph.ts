/**
 * Path tracing helpers. Morphing itself is done with signed distance fields (sdf.ts): point-to-point
 * interpolation was tried first and tore whenever two letters had different topology.
 */
import type { Contour } from './outline.js';

export function traceContours(ctx: CanvasRenderingContext2D | Path2D, cs: Contour[], ox = 0, oy = 0, s = 1): void {
  for (const c of cs) {
    c.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(ox + x * s, oy + y * s) : ctx.lineTo(ox + x * s, oy + y * s)));
    ctx.closePath();
  }
}
