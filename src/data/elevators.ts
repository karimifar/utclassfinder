import { haversine } from '../map/routeState';
import type { LngLat } from './types';
import raw from '../../assets/data/elevators.json';

/**
 * Elevator locations, from UT's own campus map data.
 *
 * Each record is a *bank*, not a single car — `cabs` says how many are there.
 * Coverage is much broader than the entrance survey: ~120 of the buildings a
 * user can select, against 56 for entrances.
 *
 * Regenerate with `npm run build:elevators`.
 */
export interface Elevator {
  center: LngLat;
  /** How many cars at this location, or null where UT left it blank. */
  cabs: number | null;
  /**
   * Restricted rather than public — service or keyed. Kept in the data so the
   * app can choose, but never offer one of these as a way up: the user cannot
   * call it.
   */
  private: boolean;
  notes: string | null;
}

const BY_BUILDING = raw as unknown as Record<string, Elevator[]>;

/**
 * Elevators in a building.
 *
 * Public ones only by default — a private elevator is worse than no elevator,
 * because it sends someone to a door that will not open for them.
 */
export function getElevators(
  abbr: string | null | undefined,
  opts: { includePrivate?: boolean } = {},
): Elevator[] {
  if (!abbr) return [];
  const all = BY_BUILDING[abbr.toUpperCase()] ?? [];
  return opts.includePrivate ? all : all.filter((e) => !e.private);
}

/** Whether a building has any elevator a user could actually take. */
export function hasElevator(abbr: string | null | undefined): boolean {
  return getElevators(abbr).length > 0;
}

/** The nearest usable elevator to a point, or null when there is none. */
export function nearestElevator(
  abbr: string | null | undefined,
  from: LngLat,
  opts: { includePrivate?: boolean } = {},
): Elevator | null {
  let best: Elevator | null = null;
  let bestDistance = Infinity;
  for (const e of getElevators(abbr, opts)) {
    const d = haversine(from, e.center);
    if (d < bestDistance) {
      bestDistance = d;
      best = e;
    }
  }
  return best;
}
