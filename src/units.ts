/**
 * Distances for display, in the units a US campus audience actually walks in.
 *
 * Everything internal stays metric: Directions answers in metres, and the
 * thresholds in routeState (arrival, max walk) are metres. This is the single
 * conversion, applied at the point of display.
 */

const METRES_PER_FOOT = 0.3048;
const FEET_PER_MILE = 5280;

/**
 * Where feet give way to miles. 0.1 mi is the switch Google Maps uses, and
 * below it a mileage reads as a rounding error ("0.0 mi") rather than a
 * distance.
 */
const MILE_THRESHOLD_FEET = FEET_PER_MILE / 10;

/**
 * A walking distance as text — "450 ft", "0.4 mi".
 *
 * Feet are rounded to the nearest 10: consumer GPS isn't accurate to the foot,
 * and a figure like "437 ft" claims a precision the fix doesn't have.
 */
export function formatDistance(metres: number): string {
  const feet = metres / METRES_PER_FOOT;
  if (feet < MILE_THRESHOLD_FEET) {
    // Never round down to a bare "0 ft" — at that point the arrival card has
    // taken over anyway, and "0 ft" reads like a bug.
    return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  }
  return `${(feet / FEET_PER_MILE).toFixed(1)} mi`;
}
