import { BUILDINGS } from '../buildings';
import { getElevators, hasElevator, nearestElevator } from '../elevators';

describe('elevator data', () => {
  it('covers far more buildings than the entrance survey', () => {
    const covered = BUILDINGS.filter((b) => hasElevator(b.abbr));
    expect(covered.length).toBeGreaterThanOrEqual(100);
  });

  it('is keyed by abbreviation, case-insensitively', () => {
    expect(getElevators('adh').length).toBeGreaterThan(0);
    expect(getElevators('ADH')).toEqual(getElevators('adh'));
  });

  it('returns nothing rather than throwing for a building with none', () => {
    expect(getElevators('ZZZ')).toEqual([]);
    expect(getElevators(null)).toEqual([]);
    expect(hasElevator(undefined)).toBe(false);
  });

  // A private elevator is worse than none: it sends someone to a car they
  // cannot call.
  it('hides private elevators unless asked for them', () => {
    for (const b of BUILDINGS) {
      expect(getElevators(b.abbr).every((e) => !e.private)).toBe(true);
    }
    const withPrivate = BUILDINGS.find(
      (b) => getElevators(b.abbr, { includePrivate: true }).length > getElevators(b.abbr).length,
    );
    expect(withPrivate).toBeDefined();
  });

  it('gives every elevator a usable coordinate', () => {
    for (const b of BUILDINGS) {
      for (const e of getElevators(b.abbr, { includePrivate: true })) {
        expect(Number.isFinite(e.center[0])).toBe(true);
        expect(Number.isFinite(e.center[1])).toBe(true);
        // Austin, not the other side of the planet from swapped coordinates.
        expect(e.center[0]).toBeLessThan(-90);
        expect(e.center[1]).toBeGreaterThan(25);
      }
    }
  });

  it('reports a sane car count where UT gave one', () => {
    for (const b of BUILDINGS) {
      for (const e of getElevators(b.abbr, { includePrivate: true })) {
        if (e.cabs !== null) {
          expect(e.cabs).toBeGreaterThan(0);
          expect(e.cabs).toBeLessThan(20);
        }
      }
    }
  });
});

describe('nearestElevator', () => {
  it('picks the closest bank', () => {
    const multi = BUILDINGS.find((b) => getElevators(b.abbr).length > 1);
    expect(multi).toBeDefined();
    for (const target of getElevators(multi!.abbr)) {
      expect(nearestElevator(multi!.abbr, target.center)?.center).toEqual(target.center);
    }
  });

  it('is null for a building with none', () => {
    expect(nearestElevator('ZZZ', [-97.73, 30.28])).toBeNull();
  });
});
