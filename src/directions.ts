import { Linking, Platform } from 'react-native';
import type { Building } from './data/types';

/**
 * Hand off to the platform maps app for walking directions to a building.
 * iOS -> Apple Maps, everything else -> Google Maps. Per the PRD, we route to
 * the building (entrance refinement is a future enhancement).
 */
export async function openDirections(building: Building): Promise<void> {
  const [lng, lat] = building.center;
  const label = encodeURIComponent(building.name ?? building.abbr ?? 'Destination');

  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${lat},${lng}&q=${label}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

  const ok = await Linking.canOpenURL(url);
  if (ok) await Linking.openURL(url);
}
