import { formatDistance } from '../units';

describe('formatDistance', () => {
  it('gives feet for anything short of a tenth of a mile', () => {
    expect(formatDistance(30.48)).toBe('100 ft');
    expect(formatDistance(100)).toBe('330 ft');
  });

  it('rounds feet to ten, rather than claiming a precision GPS lacks', () => {
    expect(formatDistance(133.2)).toBe('440 ft');
    expect(formatDistance(134.1)).toBe('440 ft');
  });

  it('switches to miles at the tenth-mile mark, so nothing reads "0.0 mi"', () => {
    expect(formatDistance(160.9)).toBe('530 ft');
    expect(formatDistance(161.0)).toBe('0.1 mi');
  });

  it('keeps one decimal for miles', () => {
    expect(formatDistance(1609.34)).toBe('1.0 mi');
    expect(formatDistance(4000)).toBe('2.5 mi');
    // MAX_WALK_METRES, the longest walk the app will offer.
    expect(formatDistance(5000)).toBe('3.1 mi');
  });

  it('never bottoms out at "0 ft"', () => {
    expect(formatDistance(0)).toBe('10 ft');
    expect(formatDistance(1)).toBe('10 ft');
  });
});
