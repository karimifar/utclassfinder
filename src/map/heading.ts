/**
 * Damping for the navigate-mode camera bearing.
 *
 * Mapbox's FollowWithHeading mode wires the camera straight to the compass, and
 * the compass is noisy — a phone held still still wanders a few degrees, which
 * left the whole map drifting under the user. rnmapbox exposes no heading
 * filter, so the smoothing has to happen here: the camera runs in plain Follow
 * mode, which leaves its bearing alone, and this decides what that bearing is.
 *
 * Two stages, which is roughly what Google Maps appears to do:
 *
 *   1. Smooth the raw compass, so a jump is followed over a few readings
 *      rather than in one snap.
 *   2. Only move the camera once the smoothed value has drifted past a
 *      deadband, so small movements do not rotate the map at all.
 */

/** 0..360, for any input including negatives. */
export function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Shortest signed turn from `a` to `b`, in (-180, 180].
 *
 * The whole reason this file exists: 359° to 1° is a 2° turn to the right, not
 * a 358° turn to the left, and arithmetic that misses that makes the map spin
 * the long way round every time the user faces north.
 */
export function headingDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

/**
 * How much of each new reading to take. Lower is smoother and laggier; 0.2
 * follows a real turn in well under a second while flattening jitter.
 */
export const HEADING_SMOOTHING = 0.2;

/** Exponential smoothing that takes the short way round the circle. */
export function smoothHeading(
  previous: number | null,
  reading: number,
  alpha: number = HEADING_SMOOTHING,
): number {
  if (previous == null) return normalizeHeading(reading);
  return normalizeHeading(previous + headingDelta(previous, reading) * alpha);
}

/**
 * How far the smoothed heading must drift before the camera follows it.
 *
 * Below this the map simply does not turn. Large enough to sit outside normal
 * compass wander, small enough that a deliberate turn feels responsive.
 */
export const CAMERA_HEADING_DEADBAND = 8;

export function shouldTurnCamera(
  committed: number | null,
  smoothed: number,
  deadband: number = CAMERA_HEADING_DEADBAND,
): boolean {
  if (committed == null) return true;
  return Math.abs(headingDelta(committed, smoothed)) >= deadband;
}
