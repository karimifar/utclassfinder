import {
  CAMERA_HEADING_DEADBAND,
  headingDelta,
  normalizeHeading,
  shouldTurnCamera,
  smoothHeading,
} from '../heading';

describe('normalizeHeading', () => {
  it('wraps into 0..360', () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(360)).toBe(0);
    expect(normalizeHeading(-90)).toBe(270);
    expect(normalizeHeading(450)).toBe(90);
  });
});

describe('headingDelta', () => {
  it('takes the short way across north', () => {
    expect(headingDelta(359, 1)).toBe(2);
    expect(headingDelta(1, 359)).toBe(-2);
  });

  it('is signed by turn direction', () => {
    expect(headingDelta(90, 100)).toBe(10);
    expect(headingDelta(100, 90)).toBe(-10);
  });

  it('never returns more than half a turn', () => {
    for (let a = 0; a < 360; a += 7) {
      for (let b = 0; b < 360; b += 11) {
        expect(Math.abs(headingDelta(a, b))).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe('smoothHeading', () => {
  it('takes the first reading whole', () => {
    expect(smoothHeading(null, 137)).toBe(137);
  });

  it('moves part of the way towards a new reading', () => {
    expect(smoothHeading(0, 100, 0.2)).toBeCloseTo(20, 6);
  });

  // Smoothing 359 towards 1 must not travel backwards through 180.
  it('smooths across north without spinning the long way', () => {
    expect(smoothHeading(359, 9, 0.5)).toBeCloseTo(4, 6);
    expect(smoothHeading(5, 355, 0.5)).toBeCloseTo(0, 6);
  });

  it('converges on a steady reading', () => {
    let h: number | null = 0;
    for (let i = 0; i < 60; i++) h = smoothHeading(h, 90);
    expect(h).toBeCloseTo(90, 3);
  });

  it('always reports a normalised bearing', () => {
    let h: number | null = 10;
    for (const reading of [350, 340, 20, 200, 5]) {
      h = smoothHeading(h, reading);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});

describe('shouldTurnCamera', () => {
  it('always commits the first heading', () => {
    expect(shouldTurnCamera(null, 42)).toBe(true);
  });

  // The actual complaint: a phone held still wanders a few degrees and the map
  // moved with it.
  it('ignores drift inside the deadband', () => {
    expect(shouldTurnCamera(90, 93)).toBe(false);
    expect(shouldTurnCamera(90, 87)).toBe(false);
  });

  it('turns once the drift is deliberate', () => {
    expect(shouldTurnCamera(90, 90 + CAMERA_HEADING_DEADBAND)).toBe(true);
    expect(shouldTurnCamera(90, 120)).toBe(true);
  });

  it('measures the deadband across north too', () => {
    expect(shouldTurnCamera(358, 2)).toBe(false);
    expect(shouldTurnCamera(358, 10)).toBe(true);
  });
});
