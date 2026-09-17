import { BUILDINGS, floorLabels, floorPhrase, formatFloor } from '../buildings';

describe('formatFloor', () => {
  it('drops the leading zeros the dataset pads codes with', () => {
    expect(formatFloor('01')).toBe('Floor 1');
    expect(formatFloor('02')).toBe('Floor 2');
  });

  it('spells out the named levels', () => {
    expect(formatFloor('GROUND')).toBe('Ground');
    expect(formatFloor('GRO')).toBe('Ground');
    expect(formatFloor('LL')).toBe('Lower Level');
  });
});

describe('floorLabels', () => {
  it('leaves an ordinary floor list alone', () => {
    const labels = floorLabels(['01', '02', '03']);
    expect([...labels.values()]).toEqual(['Floor 1', 'Floor 2', 'Floor 3']);
  });

  // FAC ships ['001','01','02','03','04','05'] and showed two rows both
  // reading "Floor 1". 65 of 538 buildings carry both series.
  it('separates the two floor series the dataset mixes', () => {
    const labels = floorLabels(['001', '01', '02', '03', '04', '05']);
    expect(labels.get('01')).toBe('Floor 1');
    expect(labels.get('001')).toBe('Floor 1 (001)');
    expect(labels.get('02')).toBe('Floor 2');
  });

  it('disambiguates every colliding pair, not just the first', () => {
    const labels = floorLabels(['001', '01', '002', '02']);
    expect(labels.get('001')).toBe('Floor 1 (001)');
    expect(labels.get('002')).toBe('Floor 2 (002)');
    expect(labels.get('01')).toBe('Floor 1');
    expect(labels.get('02')).toBe('Floor 2');
  });

  // BTL, which has both 001M and 01M alongside the plain floors.
  it('handles suffixed codes like the mezzanines', () => {
    const labels = floorLabels(['001M', '01M']);
    expect(labels.get('01M')).toBe('Floor 1M');
    expect(labels.get('001M')).toBe('Floor 1M (001M)');
  });
});

describe('floorPhrase', () => {
  it('leaves numbered floors alone — they already read as a phrase', () => {
    expect(floorPhrase('01', ['01', '02'])).toBe('Floor 1');
  });

  // "Room 21 is on Ground" / "is on Lower Level" were the grammatical misses.
  it('makes the named levels read in a sentence', () => {
    expect(floorPhrase('GROUND', ['GROUND', '01'])).toBe('the Ground floor');
    expect(floorPhrase('GRO', ['GRO', '01'])).toBe('the Ground floor');
    expect(floorPhrase('LL', ['LL', '01'])).toBe('the Lower Level');
  });

  it('carries the disambiguating code into the sentence', () => {
    expect(floorPhrase('001', ['001', '01'])).toBe('Floor 1 (001)');
  });
});

describe('floorLabels over the real dataset', () => {
  // The bug this fixes was two indistinguishable rows in one building's floor
  // switcher. That is the invariant, so assert it against the shipped data.
  it('gives every building a set of distinct floor labels', () => {
    const offenders: string[] = [];
    for (const building of BUILDINGS) {
      const labels = [...floorLabels(building.floors).values()];
      if (new Set(labels).size !== labels.length) {
        offenders.push(`${building.abbr ?? building.id}: ${labels.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('labels every floor code a building declares', () => {
    for (const building of BUILDINGS) {
      const labels = floorLabels(building.floors);
      for (const code of building.floors) {
        expect(labels.get(code)).toBeTruthy();
      }
    }
  });
});
