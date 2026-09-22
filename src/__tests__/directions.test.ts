import { Linking } from 'react-native';
import { openInAppleMaps, openInGoogleMaps } from '../directions';
import type { LngLat } from '../data/types';

const GDC: LngLat = [-97.7359, 30.2861];

describe('maps hand-off', () => {
  let openURL: jest.SpiedFunction<typeof Linking.openURL>;
  let canOpenURL: jest.SpiedFunction<typeof Linking.canOpenURL>;

  beforeEach(() => {
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    canOpenURL = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    // Linking is already a module mock under jest-expo, so spyOn hands back the
    // same underlying mock each time and restoreAllMocks does not clear its
    // call log. Without this every test reads the first test's URL.
    openURL.mockClear();
    canOpenURL.mockClear();
  });
  afterEach(() => jest.restoreAllMocks());

  // These apps are the hand-off for trips too far to walk, so they open in
  // transit. Each spells the mode differently and none of them error on an
  // unrecognised value — they quietly give driving directions instead.
  it('asks Apple Maps for transit directions', async () => {
    await openInAppleMaps(GDC, 'GDC 2.216');
    expect(openURL.mock.calls[0][0]).toContain('dirflg=r');
  });

  it('asks Google Maps for transit directions', async () => {
    await openInGoogleMaps(GDC, 'GDC 2.216');
    expect(openURL.mock.calls[0][0]).toContain('directionsmode=transit');
  });

  it('falls back to the web URL when Google Maps is not installed', async () => {
    canOpenURL.mockResolvedValue(false);
    await openInGoogleMaps(GDC, 'GDC 2.216');
    const url = openURL.mock.calls[0][0];
    expect(url).toContain('https://www.google.com/maps/dir/');
    // The web URL uses a different parameter name from the app scheme.
    expect(url).toContain('travelmode=transit');
  });

  it('passes the destination as lat,lng — reversing it routes to Antarctica', async () => {
    await openInAppleMaps(GDC, 'GDC 2.216');
    expect(openURL.mock.calls[0][0]).toContain('daddr=30.2861,-97.7359');
  });

  it('escapes the label', async () => {
    await openInAppleMaps(GDC, 'GDC 2.216');
    expect(openURL.mock.calls[0][0]).toContain('q=GDC%202.216');
  });
});
