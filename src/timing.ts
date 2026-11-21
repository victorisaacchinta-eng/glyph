/** Timing shared by the picture and the score, so sound and image are driven by the same functions. */
import { springTrack } from 'reel-film';
import { ERAS, SECTION, FINALE } from './eras.js';

export const VAR = FINALE - SECTION; // start of the variable era
export const WEIGHT_START = VAR + 1.2;
export const sectionStart = (k: number): number => k * SECTION;

/** Weight of the variable era over time (100..900). The score maps it to a filter sweep. */
export function weightAt(t: number): number {
  return springTrack(t, [[0, 400], [WEIGHT_START, 900], [WEIGHT_START + 1.0, 120], [WEIGHT_START + 2.0, 400]], { duration: 0.85, bounce: 0.06 });
}

/** Times at which a year digit rolls (its value changes), for odometer clicks in the score. */
export function digitRolls(): number[] {
  const out: number[] = [];
  for (let k = 1; k < ERAS.length; k++) {
    for (let d = 0; d < 4; d++) {
      if (ERAS[k - 1].year[d] !== ERAS[k].year[d]) out.push(sectionStart(k) + 0.08 + d * 0.045);
    }
  }
  return out;
}

/** Finale beats: specimen letters land a sixteenth apart, title letters one per beat. */
export const STRIP_LAND = (i: number): number => FINALE + 0.15 + i * 0.125;
export const TITLE_LAND = (i: number): number => FINALE + 1.6 + i * 0.5;
