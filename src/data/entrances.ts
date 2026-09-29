import { haversine } from '../map/routeState';
import type { LngLat } from './types';
import raw from '../../assets/data/entrances.json';

/**
 * Building entrances, from UT's own campus map data.
 *
 * Routing used to aim at the room's centroid and let Directions snap it to
 * whatever path happened to be nearest — so a room on the north side of a
 * building sent you to the north, whether or not a door was there. These are
 * real doors, keyed by building abbreviation.
 *
 * Coverage is 67 of 538 buildings: the large, confusing ones, which is where
 * guessing the wrong side actually costs you. Everything else falls back to the
 * old behaviour, so nothing may assume an entrance exists.
 *
 * Regenerate with `npm run build:entrances`.
 */
export interface Entrance {
  center: LngLat;
  /** Which side of the building the door is on, e.g. "West". */
  side: string | null;
  /** Step-free, per UT's own accessibility survey. */
  barrierFree: boolean;
  /** Has a power-assisted door opener. */
  autoOpener: boolean;
  /** UT's written directions to the door, including what to look for. */
  description: string | null;
}

// Through `unknown`: the JSON import types coordinates as number[], which
// is not assignable to the LngLat tuple without an explicit step.
const BY_BUILDING = raw as unknown as Record<string, Entrance[]>;

/** Every known entrance for a building, or [] when none are mapped. */
export function getEntrances(abbr: string | null | undefined): Entrance[] {
  if (!abbr) return [];
  return BY_BUILDING[abbr.toUpperCase()] ?? [];
}

/**
 * The entrance to walk to, or null when the building has none mapped.
 *
 * Nearest to where the walker is coming from, which minimises the outdoor leg —
 * the part we can actually route. `barrierFree` narrows it to step-free doors.
 */
export function nearestEntrance(
  abbr: string | null | undefined,
  from: LngLat,
  opts: { barrierFree?: boolean } = {},
): Entrance | null {
  const all = getEntrances(abbr);
  const usable = opts.barrierFree ? all.filter((e) => e.barrierFree) : all;
  let best: Entrance | null = null;
  let bestDistance = Infinity;
  for (const e of usable) {
    const d = haversine(from, e.center);
    if (d < bestDistance) {
      bestDistance = d;
      best = e;
    }
  }
  return best;
}
