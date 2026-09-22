/**
 * How far the current GPS fix can be trusted.
 *
 * Every fix carries a `accuracy` — the radius of uncertainty in metres — and
 * until now the app ignored it, treating a 5m fix and a 500m fix identically
 * when routing, rerouting and declaring arrival.
 */

/**
 * Above this, the fix is almost certainly not GPS at all.
 *
 * iOS lets the user grant "Approximate Location" instead of Precise, which
 * reports roughly 1–3km. Nothing in expo-location exposes that authorization —
 * its permission response carries only `scope` — so the uncertainty radius is
 * the only way to detect it. 500m is well clear of even a bad urban fix
 * (tens of metres) and well below the approximate band.
 */
export const REDUCED_ACCURACY_METRES = 500;

export type FixQuality =
  /** A normal GPS fix. */
  | 'normal'
  /** So coarse it almost certainly means Precise Location is switched off. */
  | 'reduced'
  /** The platform reported no accuracy at all. */
  | 'unknown';

export function fixQuality(accuracy: number | null | undefined): FixQuality {
  if (accuracy == null || !Number.isFinite(accuracy) || accuracy < 0) return 'unknown';
  return accuracy >= REDUCED_ACCURACY_METRES ? 'reduced' : 'normal';
}

/**
 * Whether a fix is precise enough to decide something at `withinMetres`.
 *
 * A fix uncertain by more than the distance being tested cannot answer the
 * question — "am I inside a 25m arrival radius" is unanswerable from a fix
 * that could be 100m out. Callers pass their own threshold so each decision is
 * judged against the constant that defines it.
 *
 * An unreported accuracy counts as usable: it is a platform quirk rather than
 * evidence of a bad fix, and refusing to ever arrive would be the worse
 * failure.
 */
export function fixSupports(accuracy: number | null | undefined, withinMetres: number): boolean {
  if (accuracy == null || !Number.isFinite(accuracy) || accuracy < 0) return true;
  return accuracy <= withinMetres;
}
