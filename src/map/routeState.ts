import type { LngLat } from '../data/types';

/**
 * Why a walking route isn't available. Previously every failure was swallowed
 * by `.catch(() => {})`, which left the room card showing a blank ETA forever.
 */
export type RouteFailure =
  /** Location permission was denied, so there is no origin to route from. */
  | 'no-permission'
  /** Permission is granted but no fix has arrived yet. */
  | 'no-location'
  /** The Directions API has no walking route between origin and destination. */
  | 'no-route'
  /** Origin is far enough away that walking isn't a real option. */
  | 'too-far'
  /** Network or API error. */
  | 'failed';

export type RouteState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'ok'; distance: number; duration: number }
  | { status: 'error'; reason: RouteFailure };

/** Straight-line distance in metres. */
export function haversine(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Beyond this, "walk here" stops being a sensible offer. */
export const MAX_WALK_METRES = 5000;

/** Within this, the user has effectively arrived at the destination. */
export const ARRIVAL_METRES = 25;
