import { Linking, Platform } from 'react-native';
import type { Building, LngLat } from './data/types';

/**
 * Handing a destination off to a maps app.
 *
 * These are the hand-off for journeys the app itself cannot route — the ones
 * too far to walk — so they open in transit mode rather than walking or
 * driving. Whatever gets someone to campus is a bus or rail trip; in-app
 * walking directions cover the rest.
 *
 * Each app spells the mode differently, and none of them error on an
 * unrecognised value — they quietly fall back to driving. Hence the constants.
 */

/** Google Maps' custom scheme. Declared in Info.plist's LSApplicationQueriesSchemes. */
const GOOGLE_MAPS_SCHEME = 'comgooglemaps://';

/** Apple's `dirflg`: d driving, w walking, r transit. */
const APPLE_TRANSIT = 'r';
/** The Google Maps app scheme's parameter. */
const GOOGLE_APP_TRANSIT = 'transit';
/** Google's web URL uses a different parameter name for the same idea. */
const GOOGLE_WEB_TRANSIT = 'transit';

export function appleMapsAvailable(): boolean {
  // Android would open this in a browser, which helps nobody.
  return Platform.OS === 'ios';
}

/**
 * Whether Google Maps can handle the hand-off.
 *
 * On iOS this is a real "is it installed" check. On Android the web URL opens
 * the app when present and the browser otherwise, so it is always offerable.
 */
export async function googleMapsAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return true;
  try {
    return await Linking.canOpenURL(GOOGLE_MAPS_SCHEME);
  } catch {
    return false;
  }
}

export async function openInAppleMaps(center: LngLat, label = 'Destination'): Promise<void> {
  const [lng, lat] = center;
  await Linking.openURL(
    `http://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}&dirflg=${APPLE_TRANSIT}`,
  );
}

export async function openInGoogleMaps(center: LngLat, label = 'Destination'): Promise<void> {
  const [lng, lat] = center;
  const app = `${GOOGLE_MAPS_SCHEME}?daddr=${lat},${lng}&q=${encodeURIComponent(label)}&directionsmode=${GOOGLE_APP_TRANSIT}`;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${GOOGLE_WEB_TRANSIT}`;
  // Prefer the installed app; the web URL is the fallback, and on Android it
  // hands off to the app anyway.
  try {
    if (await Linking.canOpenURL(app)) {
      await Linking.openURL(app);
      return;
    }
  } catch {
    // Fall through to the web URL.
  }
  await Linking.openURL(web);
}

/** Directions to a building, for the building detail screen. */
export async function openDirections(building: Building): Promise<void> {
  const label = building.name ?? building.abbr ?? 'Destination';
  if (appleMapsAvailable()) return openInAppleMaps(building.center, label);
  return openInGoogleMaps(building.center, label);
}
