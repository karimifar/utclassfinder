import Constants from 'expo-constants';
import type { LngLat } from './data/types';

/**
 * Simulated navigation origin.
 *
 * Production always routes from live GPS — there is no silent fallback. A
 * simulated origin only exists when a build explicitly opts in, so that walking
 * directions can be exercised from off campus. Two ways in:
 *
 *   - `DEBUG_ORIGIN="lng,lat"` at build time seeds it for the whole session
 *     (see app.config.js).
 *   - `DEBUG_TOOLS=true` enables a hidden runtime toggle — long-press the header
 *     logo — which sets CAMPUS_DEBUG_ORIGIN for the session.
 *
 * Whenever an origin is simulated the UI shows a persistent "SIMULATED ORIGIN"
 * badge, so a tester can never mistake it for real behaviour.
 */

/** Speedway at 24th, roughly the middle of campus. */
export const CAMPUS_DEBUG_ORIGIN: LngLat = [-97.7335, 30.2849];

function readConfiguredOrigin(): LngLat | null {
  const raw = Constants.expoConfig?.extra?.debugOrigin;
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [lng, lat] = raw;
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  return [lng, lat];
}

/** Build-time origin from `DEBUG_ORIGIN`, or null. */
export const CONFIGURED_DEBUG_ORIGIN: LngLat | null = readConfiguredOrigin();

/**
 * Whether the hidden runtime toggle is reachable. Dev builds always qualify;
 * everything else has to opt in at build time via `DEBUG_TOOLS=true`, which is
 * never set for an App Store build.
 */
export const DEBUG_TOOLS_ENABLED: boolean =
  __DEV__ || Constants.expoConfig?.extra?.debugTools === true;
