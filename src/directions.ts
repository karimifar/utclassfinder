import { Linking, Platform } from 'react-native';
import type { Building } from './data/types';

export async function openDirections(building: Building): Promise<void> {
  return openDirectionsToCoordinate(
    building.center,
    building.name ?? building.abbr ?? 'Destination',
  );
}

export async function openDirectionsToCoordinate(
  center: [number, number],
  label = 'Destination',
): Promise<void> {
  const [lng, lat] = center;
  const encoded = encodeURIComponent(label);
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${lat},${lng}&q=${encoded}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
  const ok = await Linking.canOpenURL(url);
  if (ok) await Linking.openURL(url);
}
