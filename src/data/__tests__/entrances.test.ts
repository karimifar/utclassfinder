import type { LngLat } from '../types';
import { getEntrances, nearestEntrance } from '../entrances';
import { BUILDINGS } from '../buildings';

describe('entrance data', () => {
  // UT's survey covers 67 buildings and 66 match an abbreviation in
  // buildings.json, but BUILDINGS is filtered to those with a footprint — so
  // the coverage the app can actually use is smaller than the raw join
  // suggests. This pins the number that matters: buildings a user can select.
  it('covers the buildings a user can actually reach', () => {
    const covered = BUILDINGS.filter((b) => getEntrances(b.abbr).length > 0);
    expect(covered.length).toBeGreaterThanOrEqual(50);
    expect(covered.length).toBeLessThan(BUILDINGS.length);
  });

  it('is keyed by abbreviation, case-insensitively', () => {
    expect(getEntrances('ase').length).toBeGreaterThan(0);
    expect(getEntrances('ASE')).toEqual(getEntrances('ase'));
  });

  // Nothing may assume an entrance exists: most buildings have none mapped.
  it('returns nothing rather than throwing for an unmapped building', () => {
    expect(getEntrances('ZZZ')).toEqual([]);
    expect(getEntrances(null)).toEqual([]);
    expect(getEntrances(undefined)).toEqual([]);
  });

  it('gives every entrance a usable coordinate', () => {
    for (const b of BUILDINGS) {
      for (const e of getEntrances(b.abbr)) {
        expect(e.center).toHaveLength(2);
        expect(Number.isFinite(e.center[0])).toBe(true);
        expect(Number.isFinite(e.center[1])).toBe(true);
        // Inside the Austin area — a swapped lat/lng would land in Asia.
        expect(e.center[0]).toBeLessThan(-90);
        expect(e.center[1]).toBeGreaterThan(25);
      }
    }
  });
});

describe('nearestEntrance', () => {
  it('picks the door closest to where the walker is coming from', () => {
    const all = getEntrances('BAT');
    expect(all.length).toBeGreaterThan(1);
    for (const target of all) {
      // Standing on a door, that door is the nearest one.
      expect(nearestEntrance('BAT', target.center)?.center).toEqual(target.center);
    }
  });

  it('is null for a building with no mapped entrance', () => {
    expect(nearestEntrance('ZZZ', [-97.73, 30.28])).toBeNull();
  });

  it('can restrict the choice to step-free doors', () => {
    const from: LngLat = [-97.7335, 30.2849];
    for (const b of BUILDINGS) {
      const picked = nearestEntrance(b.abbr, from, { barrierFree: true });
      if (picked) expect(picked.barrierFree).toBe(true);
    }
  });

  it('returns null when a building has entrances but none are step-free', () => {
    const noneAccessible = BUILDINGS.find(
      (b) => getEntrances(b.abbr).length > 0 && getEntrances(b.abbr).every((e) => !e.barrierFree),
    );
    if (noneAccessible) {
      expect(nearestEntrance(noneAccessible.abbr, [-97.73, 30.28], { barrierFree: true })).toBeNull();
    }
  });
});
