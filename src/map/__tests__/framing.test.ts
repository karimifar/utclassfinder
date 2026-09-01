import { BUILDINGS, getBuildingByAbbr } from '../../data/buildings';
import type { LngLat } from '../../data/types';
import { bboxCenter, fitZoom, footprintBbox, frameFootprint } from '../framing';

// Roughly an iPhone 15 viewport, with the bottom 30% covered by the panel.
const VIEWPORT = { width: 393, height: 852 };
const OPTIONS = {
  ...VIEWPORT,
  paddingBottom: VIEWPORT.height * 0.3,
  inset: 28,
  // The floor-plan room labels switch on at 17.5; past 19 a small building's
  // plan is unreadably large.
  minZoom: 17.5,
  maxZoom: 19.0,
};

describe('footprintBbox', () => {
  it('takes the extremes of the hull, not the first and last points', () => {
    const hull: LngLat[] = [[-97.74, 30.28], [-97.73, 30.29], [-97.735, 30.275], [-97.745, 30.285]];
    expect(footprintBbox(hull)).toEqual({ ne: [-97.73, 30.29], sw: [-97.745, 30.275] });
  });

  it('returns null for an empty footprint', () => {
    expect(footprintBbox([])).toBeNull();
  });
});

describe('bboxCenter', () => {
  it('is the midpoint of the box', () => {
    const [lng, lat] = bboxCenter({ ne: [-97.73, 30.29], sw: [-97.75, 30.27] });
    expect(lng).toBeCloseTo(-97.74, 9);
    expect(lat).toBeCloseTo(30.28, 9);
  });
});

describe('fitZoom', () => {
  it('is constrained by whichever axis runs out of room first', () => {
    const wide = { ne: [-97.720, 30.2810] as LngLat, sw: [-97.740, 30.2800] as LngLat };
    const tall = { ne: [-97.739, 30.3000] as LngLat, sw: [-97.740, 30.2800] as LngLat };
    // Widening the viewport buys the width-limited box a closer fit, and does
    // nothing at all for the one that was already limited by height.
    expect(fitZoom(wide, 786, 596)).toBeGreaterThan(fitZoom(wide, 393, 596));
    expect(fitZoom(tall, 786, 596)).toBe(fitZoom(tall, 393, 596));
  });

  it('gains a zoom level each time the box halves', () => {
    const big = { ne: [-97.730, 30.2900] as LngLat, sw: [-97.740, 30.2800] as LngLat };
    const half = { ne: [-97.735, 30.2850] as LngLat, sw: [-97.740, 30.2800] as LngLat };
    expect(fitZoom(half, 393, 596) - fitZoom(big, 393, 596)).toBeCloseTo(1, 3);
  });
});

describe('frameFootprint', () => {
  // T-1: entering building state at a flat zoom 17 left the floor plan unlabelled,
  // because the room labels only render from 17.5.
  it('never lands below the floor-plan label threshold, for any real building', () => {
    for (const building of BUILDINGS) {
      const framed = frameFootprint(building.footprint, OPTIONS);
      expect(framed).not.toBeNull();
      expect(framed!.zoom).toBeGreaterThanOrEqual(17.5);
      expect(framed!.zoom).toBeLessThanOrEqual(19.0);
    }
  });

  it('frames GDC inside the clamp rather than against either end of it', () => {
    const gdc = getBuildingByAbbr('GDC');
    expect(gdc).toBeDefined();
    const framed = frameFootprint(gdc!.footprint, OPTIONS)!;
    expect(framed.zoom).toBeGreaterThan(17.5);
    expect(framed.zoom).toBeLessThan(19.0);
  });

  it('clamps a tiny building to the ceiling instead of zooming into the weeds', () => {
    const centre: LngLat = [-97.7335, 30.2849];
    // ~3m across.
    const tiny: LngLat[] = [
      [centre[0] - 0.000015, centre[1] - 0.000013],
      [centre[0] + 0.000015, centre[1] - 0.000013],
      [centre[0] + 0.000015, centre[1] + 0.000013],
      [centre[0] - 0.000015, centre[1] + 0.000013],
    ];
    expect(frameFootprint(tiny, OPTIONS)!.zoom).toBe(19.0);
  });

  it('centres on the footprint, so the panel padding can shift it into view', () => {
    const gdc = getBuildingByAbbr('GDC')!;
    const framed = frameFootprint(gdc.footprint, OPTIONS)!;
    expect(framed.center).toEqual(bboxCenter(footprintBbox(gdc.footprint)!));
  });

  it('returns null when there is no footprint to frame', () => {
    expect(frameFootprint([], OPTIONS)).toBeNull();
  });
});
