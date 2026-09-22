import { fixQuality, fixSupports, REDUCED_ACCURACY_METRES } from '../fixQuality';

describe('fixQuality', () => {
  it('treats an ordinary GPS fix as normal', () => {
    expect(fixQuality(5)).toBe('normal');
    expect(fixQuality(65)).toBe('normal');
  });

  // Approximate Location reports 1–3km; there is no API that reports the
  // authorization itself, so the radius is the only signal.
  it('flags the approximate-location band as reduced', () => {
    expect(fixQuality(REDUCED_ACCURACY_METRES)).toBe('reduced');
    expect(fixQuality(3000)).toBe('reduced');
  });

  it('does not mistake a bad urban fix for reduced permission', () => {
    expect(fixQuality(120)).toBe('normal');
  });

  it('reports unknown rather than guessing when nothing is given', () => {
    expect(fixQuality(null)).toBe('unknown');
    expect(fixQuality(undefined)).toBe('unknown');
    expect(fixQuality(NaN)).toBe('unknown');
    expect(fixQuality(-1)).toBe('unknown');
  });
});

describe('fixSupports', () => {
  it('trusts a fix tighter than the distance being judged', () => {
    expect(fixSupports(10, 25)).toBe(true);
    expect(fixSupports(25, 25)).toBe(true);
  });

  // The whole point: you cannot tell whether you are inside a 25m radius from
  // a fix that might be 100m out.
  it('refuses a fix looser than the distance being judged', () => {
    expect(fixSupports(26, 25)).toBe(false);
    expect(fixSupports(100, 25)).toBe(false);
  });

  it('lets an unreported accuracy through rather than blocking forever', () => {
    expect(fixSupports(null, 25)).toBe(true);
    expect(fixSupports(undefined, 25)).toBe(true);
  });
});
