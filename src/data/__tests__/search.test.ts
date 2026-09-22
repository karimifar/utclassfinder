import { floorSortKey, getBuildingByAbbr } from '../buildings';
import { getRoomsInBuilding } from '../search';

describe('getRoomsInBuilding with no token', () => {
  // Tapping the search bar inside a building used to show nothing at all,
  // because an empty query returned an empty list by design.
  it('offers the building to browse rather than nothing', () => {
    const gdc = getBuildingByAbbr('GDC')!;
    expect(getRoomsInBuilding(gdc.id, '', 20).length).toBeGreaterThan(0);
  });

  it('works through the building from the bottom floor up', () => {
    const gdc = getBuildingByAbbr('GDC')!;
    const keys = getRoomsInBuilding(gdc.id, '', 60).map((r) => floorSortKey(r.floor));
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
  });

  // The reason ordering matters at all: in source order this list is arbitrary,
  // and a plain string sort is barely better — it puts room 10 before room 2.
  it('orders room numbers naturally, not as strings', () => {
    const cal = getBuildingByAbbr('CAL')!;
    const numbered = getRoomsInBuilding(cal.id, '', 400)
      .filter((r) => r.floor === '001' && /^\d+$/.test(r.roomNumber))
      .map((r) => Number(r.roomNumber));
    expect(numbered.length).toBeGreaterThan(3);
    expect(numbered).toEqual([...numbered].sort((a, b) => a - b));
  });

  it('still ranks against the token when there is one', () => {
    const gdc = getBuildingByAbbr('GDC')!;
    const hits = getRoomsInBuilding(gdc.id, '2.2', 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((r) => r.roomNumber.toUpperCase().startsWith('2.2'))).toBe(true);
  });

  it('respects an explicit limit', () => {
    const gdc = getBuildingByAbbr('GDC')!;
    expect(getRoomsInBuilding(gdc.id, '', 5)).toHaveLength(5);
  });

  // The dropdown virtualises, so capping the list only hid rooms someone was
  // scrolling to find. JCD is the extreme: over two thousand rooms.
  it('returns every room when no limit is given', () => {
    const jcd = getBuildingByAbbr('JCD')!;
    const all = getRoomsInBuilding(jcd.id, '');
    expect(all.length).toBeGreaterThan(2000);
    expect(new Set(all.map((r) => r.roomId)).size).toBe(all.length);
  });
});
