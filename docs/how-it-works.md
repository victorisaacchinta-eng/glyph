# How Glyph works

This is the walkthrough to read before presenting Glyph. It explains each algorithm in plain words, why it was chosen, and what was tried first.

## 1. The idea in one sentence

One letter, the lowercase *a*, changes from typeface to typeface in historical order, and the film measures each typeface while you watch, so every historical claim arrives with a measurement.

## 2. From a font file to a polygon

A font stores each letter as a set of closed curves (quadratic or cubic Bezier segments). `src/outline.ts` asks opentype.js for the path of a glyph and **flattens** it: each curve becomes 14 straight segments. A glyph is then a list of closed polygons called contours. The *a* usually has two: the outer silhouette and the hole of the bowl (the counter).

Every letter is scaled so its **x-height is 1000 units**. The x-height is the height of a lowercase *x*, measured from the font's own *x* glyph. Normalising it means the morph shows only how the shapes changed; differences in the fonts' nominal sizes drop out.

To know which contour is a hole, `depths()` checks how many other contours each one sits inside (an even-odd point-in-polygon test). Depth 0 is an outer, depth 1 is a hole.

## 3. Why the morph uses distance fields

**First attempt (rejected): point-to-point interpolation.** Resample both letters to the same number of points, pair up contours, rotate the starting point to minimise the squared distance, then slide each point from A to B. It works between similar shapes. It tears when the topology differs: a double-story *a* has its counter in a different place from a single-story *a*, so mid-way the counter cuts through the stem. Into pixels it shattered completely.

**What Glyph does: signed distance fields (SDF).** `src/sdf.ts` lays a grid over the letter. At each grid point it stores the distance to the nearest edge of the outline, negative inside the letter and positive outside. That grid is the letter's field.

To morph from A to B at progress `p`, blend the two fields point by point: `d = dA + (dB - dA) * p`. The new letter is wherever `d` is below zero. Because this is just arithmetic on numbers, holes can open and close smoothly and nothing can self-intersect.

**Getting a crisp outline back: marching squares.** Each grid cell has four corners, each inside or outside, giving 16 cases. For each case the algorithm knows which cell edges the outline crosses, and where along that edge (by linear interpolation of the two corner distances). Linking those crossings cell to cell gives closed contours. The two ambiguous "saddle" cases are decided by the average of the four corners. The result is a vector path, so it stays sharp at any size.

When the letter is at rest the film draws the exact font outline. Only during a transition does it draw the blended contour, so static frames are exactly the typeface.

**Questions you may be asked**
- *Why not just crossfade two images?* A crossfade shows two letters at once; this shows one letter that is in between.
- *How fine is the grid?* 7 units per cell for the hero letter (x-height 1000), about 2 pixels on a 1080p frame.
- *Cost?* Distance fields are computed once at load (exact point-to-segment distance with a bounding-box shortcut). Each frame is one blend and one marching-squares pass.

## 4. The year digits

Digits change in two ways. If only the typeface changes (a 1 becoming another era's 1), the digit melts through its distance field, centred on itself, while its position slides separately. If the value changes (4 to 5) there is no meaningful in-between shape, so the digit rolls through a mask like an odometer.

## 5. The measurements

All numbers on screen are computed in `src/measure.ts` from the same outlines.

**Stroke contrast** is measured on each typeface's *o*, where type designers measure it. Walk around the inner contour (the counter). At each point, the stroke thickness is the distance to the nearest point of the outer contour. After light smoothing, contrast = thickest / thinnest. Bodoni Moda reaches 5.2 : 1; Jost is 1.1 : 1.

**Axis of stress** is the line through the two thinnest places of that ring (the second one has to be roughly opposite the first). Old-style faces lean left because they imitate a pen held at an angle; Didones are vertical. Below 1.45 : 1 the film says "near monoline" instead, because a nearly even stroke has no meaningful axis.

**The geometric circle** is a least-squares fit (the Kasa method) to the counter of Jost's single-story *a*. It solves one small linear system for the centre and radius, and the reported percentage is the root-mean-square distance of the counter from that circle, relative to the radius.

**Also in the code**: an exact Euclidean distance transform (Felzenszwalb and Huttenlocher) that turns a rasterised glyph into local stroke widths along its medial ridge. It is tested on a bar of known width. It was the first contrast method; on whole letters the tapered joins confuse it, which is why the ring method on the *o* is what appears on screen.

## 6. The bitmap era is drawn by hand

Sampling a vector *a* onto a 6-pixel grid produces a blob. That is historically accurate: screen fonts of 1984 were drawn pixel by pixel because automatic conversion at that size fails. So the 1984 *a*, *o* and digits are drawn on a grid in `src/scene.ts`, then traced back into polygons (`traceGrid`) so the same morph pipeline can carry them. The on-screen credit says so.

## 7. The variable era

Jost's Hairline (100) and Black (900) masters are loaded alongside Book (400). The weight on screen follows a spring track (400, 900, 120, 400). Between 400 and 900 the letter blends the Book and Black fields; below 400, Book and Hairline. At exactly 400 it is the exact Book outline, so there is no jump when the morph hands over to the weight sweep. Real variable fonts interpolate between masters in a similar way, point by point rather than by distance field.

## 8. Picture and sound share one clock

`src/timing.ts` holds the section times, the weight curve, the digit-roll times and the finale landing times. Both the film (`src/main.ts`) and the score (`score/score.ts`) import it. So the supersaw's filter cutoff is mapped from the same weight value the slider shows (100 maps to 250 Hz, 900 to 8 kHz), every odometer click lands on a rolling digit, and the finale plucks land with the specimen letters.

The instruments are made from scratch with Reel's synthesizer: additive organ partials, FM bells, Karplus-Strong plucked strings (a burst of noise circulating in a short delay line with a damping filter) for lute, harpsichord and bass, detuned saw unison for strings and the supersaw, square waves for the chiptune. The mix is normalised to -14 LUFS with a limiter keeping peaks under -1.5 dBTP.

## 9. Rendering

Reel calls `seek(t)` on the page for every frame and screenshots it in headless Chrome. With 4 subframes per frame spread across half the frame interval, ffmpeg averages them into real motion blur. Two workers render halves of the film in parallel and the segments are joined without re-encoding. Because every frame depends only on `t`, any frame can be rendered alone and in any order, which is also what makes the contact-sheet review step cheap.

## 10. Honest limits

- The typefaces are open-source revivals and new designs in each tradition. The measurements describe these fonts; the historical punches would differ in detail.
- Letters are normalised to one x-height, so real differences in x-height between eras are not shown.
- Distance-field blending can thin a stroke briefly mid-morph when two shapes barely overlap; at 0.8 seconds per transition, with motion blur, it reads as a melt.
- Every number and algorithm above is in the code and tested in `test/`.
