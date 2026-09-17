import type { LngLat } from '../data/types';
import { haversine } from './routeState';

/**
 * Deciding when a walking route has gone stale.
 *
 * Directions are fetched once, from wherever the user stood when they tapped
 * Walk here. Without this, a wrong turn leaves that original line on screen for
 * the rest of the trip, confidently pointing back at a corner they already
 * passed.
 */

/** Clears ordinary GPS scatter between buildings; catches a missed turn in a few paces. */
export const OFF_ROUTE_METRES = 30;
/** One wild fix shouldn't be enough to discard a good route. */
export const OFF_ROUTE_FIXES = 2;
export const REROUTE_COOLDOWN_MS = 5000;
/**
 * A reroute has to be earned by actual movement. Without this, a user standing
 * somewhere Directions can't snap tightly to — inside a building, say — sits
 * permanently "off route" and re-requests forever.
 */
export const REROUTE_MIN_MOVE_METRES = 20;

export interface RerouteState {
  /** Consecutive fixes seen off the route. */
  fixes: number;
  /** When the last reroute was issued (ms since epoch); null means never. */
  lastAt: number | null;
  /** Where the user was when the last reroute was issued. */
  lastPos: LngLat | null;
}

export const initialRerouteState: RerouteState = { fixes: 0, lastAt: null, lastPos: null };

export interface RerouteInput {
  /** Perpendicular distance from the route line, in metres. */
  offBy: number;
  coords: LngLat;
  /**
   * Arrival is excluded: the route stops at the building door while the room is
   * inside it, so the last few metres always read as off-route.
   */
  arrived: boolean;
  now: number;
}

/**
 * Whether to re-request directions, and the tracker state to carry forward.
 *
 * Pure so the thresholds can be exercised directly — the alternative is walking
 * around campus taking wrong turns to test a cooldown.
 */
export function nextRerouteState(
  state: RerouteState,
  { offBy, coords, arrived, now }: RerouteInput,
): { state: RerouteState; reroute: boolean } {
  if (arrived || offBy <= OFF_ROUTE_METRES) {
    return { state: { ...state, fixes: 0 }, reroute: false };
  }

  const fixes = state.fixes + 1;
  if (fixes < OFF_ROUTE_FIXES) return { state: { ...state, fixes }, reroute: false };
  if (state.lastAt !== null && now - state.lastAt < REROUTE_COOLDOWN_MS) {
    return { state: { ...state, fixes }, reroute: false };
  }
  if (state.lastPos && haversine(coords, state.lastPos) < REROUTE_MIN_MOVE_METRES) {
    return { state: { ...state, fixes }, reroute: false };
  }

  return { state: { fixes: 0, lastAt: now, lastPos: coords }, reroute: true };
}
