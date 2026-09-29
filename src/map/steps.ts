import type { LngLat } from '../data/types';
import { haversine } from './routeState';

/**
 * Turn-by-turn maneuvers along a walking route.
 *
 * The nav bar used to show only a bearing arrow computed from raw geometry,
 * which tells you which way to point but never what you are about to do.
 * Directions will write the instructions for us — they just have to be asked
 * for, with `steps=true`.
 */

export interface RouteStep {
  /** Where the maneuver happens. */
  location: LngLat;
  /** Mapbox's own phrasing, e.g. "Turn left onto Speedway". */
  instruction: string;
  /** Maneuver kind: depart, turn, continue, arrive, and so on. */
  type: string;
  /** left / right / straight, where the maneuver has a direction. */
  modifier: string | null;
  /** Metres this step covers. */
  distance: number;
}

/**
 * Pull the steps out of a Directions response.
 *
 * Defensive throughout: steps only exist when `steps=true` was sent, the shape
 * is several levels deep, and a malformed entry should cost us that one
 * instruction rather than the whole route.
 */
export function parseSteps(route: unknown): RouteStep[] {
  const legs = (route as { legs?: unknown[] })?.legs;
  if (!Array.isArray(legs)) return [];
  const out: RouteStep[] = [];
  for (const leg of legs) {
    const steps = (leg as { steps?: unknown[] })?.steps;
    if (!Array.isArray(steps)) continue;
    for (const s of steps) {
      const step = s as {
        maneuver?: { location?: unknown; instruction?: unknown; type?: unknown; modifier?: unknown };
        distance?: unknown;
      };
      const loc = step.maneuver?.location;
      if (!Array.isArray(loc) || loc.length !== 2) continue;
      if (typeof loc[0] !== 'number' || typeof loc[1] !== 'number') continue;
      out.push({
        location: [loc[0], loc[1]],
        instruction: typeof step.maneuver?.instruction === 'string' ? step.maneuver.instruction : '',
        type: typeof step.maneuver?.type === 'string' ? step.maneuver.type : '',
        modifier: typeof step.maneuver?.modifier === 'string' ? step.maneuver.modifier : null,
        distance: typeof step.distance === 'number' ? step.distance : 0,
      });
    }
  }
  return out;
}

/** Close enough to a maneuver to count as having reached it. */
export const STEP_REACHED_METRES = 15;

/**
 * Which maneuver the user is walking towards.
 *
 * Only ever moves forward. A walker's fix wanders by several metres, and an
 * index chosen by nearest-maneuver flips back and forth between two turns that
 * are close together — the instruction would flicker. Advancing only on
 * arrival means a missed turn leaves the instruction stale until the off-route
 * check rebuilds the route, which is the right division of labour.
 */
export function advanceStep(steps: RouteStep[], coords: LngLat, current: number): number {
  if (steps.length === 0) return 0;
  const start = Math.max(0, Math.min(current, steps.length - 1));
  let next = start;
  // Scan the whole remainder rather than stopping at the first maneuver not yet
  // reached. Checking only the current one gets stuck for good if a GPS gap
  // lets the walker pass a maneuver without a fix landing near it — they end up
  // standing on a later turn while the index still points at an earlier one.
  for (let i = start; i < steps.length; i += 1) {
    if (haversine(coords, steps[i].location) <= STEP_REACHED_METRES) {
      next = Math.min(i + 1, steps.length - 1);
    }
  }
  return next;
}

/**
 * The instruction to show, or null when there is nothing useful to say.
 *
 * `depart` is dropped: "Walk north" at the moment the user taps Walk here adds
 * nothing the arrow does not already convey.
 */
export function stepInstruction(step: RouteStep | undefined): string | null {
  if (!step || !step.instruction) return null;
  if (step.type === 'depart') return null;
  return step.instruction;
}

/**
 * Which way the arrow should point for a maneuver, in degrees clockwise from
 * straight ahead.
 *
 * Screen-relative and fixed: a left turn is a left turn however the phone is
 * held. The arrow used to show the route bearing minus the map heading, which
 * swung around as the user turned — useful for orientation, but sitting beside
 * the words "Turn left" it read as a contradiction.
 */
export function maneuverRotation(step: RouteStep | undefined): number {
  switch (step?.modifier) {
    case 'sharp left': return -135;
    case 'left': return -90;
    case 'slight left': return -45;
    case 'slight right': return 45;
    case 'right': return 90;
    case 'sharp right': return 135;
    case 'uturn': return 180;
    // `straight`, no modifier at all, or something we do not recognise: the
    // honest answer is "keep going", not a guess at an angle.
    default: return 0;
  }
}
