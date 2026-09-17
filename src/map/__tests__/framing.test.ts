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

describe('frameFootprint for a walking overview', () => {
  // Matches overviewCamera in CampusMap: the same viewport, the panel below and
  // the header above, clamped for a whole walk rather than a single building.
  // The header is insets.top (59 on a Dynamic Island phone) + 108 of chrome.
  const HEADER = 167;
  // OVERVIEW_INSET — the pull-back dial.
  const INSET = 48;
  const OVERVIEW = {
    ...VIEWPORT,
    paddingTop: HEADER,
    paddingBottom: VIEWPORT.height * 0.3,
    inset: INSET,
    minZoom: 11.5,
    maxZoom: 18.0,
  };
  const AVAIL_W = VIEWPORT.width - INSET * 2;
  const AVAIL_H = VIEWPORT.height - HEADER - VIEWPORT.height * 0.3 - INSET * 2;

  /**
   * Everything is in frame exactly when the clamp didn't zoom in past the fit.
   * The centre needs no check here — frameFootprint always centres on the bbox,
   * which the case above pins down.
   */
  const framesAllOf = (points: LngLat[]) =>
    frameFootprint(points, OVERVIEW)!.zoom <= fitZoom(footprintBbox(points)!, AVAIL_W, AVAIL_H);

  // The far corners of CAMPUS_BOUNDS — about as long as a campus walk gets.
  const NE: LngLat = [-97.722582, 30.294828];
  const SW: LngLat = [-97.746697, 30.270204];

  it('keeps both ends of a cross-campus walk in frame', () => {
    const framed = frameFootprint([SW, NE], OVERVIEW)!;
    // Centred on the pair, and never tighter than the zoom that just fits them:
    // together those two are what containment means.
    expect(framed.center).toEqual(bboxCenter(footprintBbox([SW, NE])!));
    expect(framed.zoom).toBeLessThanOrEqual(fitZoom(footprintBbox([SW, NE])!, AVAIL_W, AVAIL_H));
  });

  // T-2: a floor of 14 framed anything past roughly 1.5km by cropping it. The
  // floor has to clear the longest walk "Walk here" is willing to offer, on
  // either axis — north-south is the tight one, because the header and the
  // panel between them take well over half the height.
  it.each([
    ['east-west', [-97.7400 + 5000 / (111320 * Math.cos((30.282 * Math.PI) / 180)), 30.2820]],
    ['north-south', [-97.7400, 30.2820 + 5000 / 110574]],
  ] as [string, LngLat][])('still frames the longest walk the app will offer (%s)', (_, to) => {
    expect(framesAllOf([[-97.7400, 30.2820], to])).toBe(true);
  });

  it('stops at the ceiling when the user is already at the door', () => {
    const room: LngLat = [-97.7335, 30.2849];
    const atTheDoor: LngLat = [room[0] + 0.00002, room[1] + 0.00002];
    expect(frameFootprint([atTheDoor, room], OVERVIEW)!.zoom).toBe(18.0);
  });

  // Why the camera frames the route's own points rather than user-and-room: a
  // path that rounds a building can reach past both of its endpoints, and
  // framing only the ends leaves that stretch off screen.
  it('pulls back for a route that doubles back past its own endpoints', () => {
    const from: LngLat = [-97.7360, 30.2820];
    const to: LngLat = [-97.7340, 30.2820];
    // Heads west around a building before turning back east to the room.
    const path: LngLat[] = [from, [-97.7380, 30.2822], to];
    expect(frameFootprint(path, OVERVIEW)!.zoom).toBeLessThan(
      frameFootprint([from, to], OVERVIEW)!.zoom,
    );
    expect(framesAllOf(path)).toBe(true);
  });

  it('has nothing to frame before the first fix', () => {
    expect(frameFootprint([], OVERVIEW)).toBeNull();
  });

  // T-3: the reframe left the user's puck off the top of the screen. Directions
  // snaps to the walking network, so the route's first coordinate is not where
  // the user is standing — framing the line alone silently drops them.
  it('frames the user and the room, not just the snapped route', () => {
    const room: LngLat = [-97.7340, 30.2820];
    const user: LngLat = [-97.7398, 30.2861];
    // Where Directions picked the walk up: on the path, ~45m south of the user.
    const snapped: LngLat = [-97.7396, 30.2857];
    const route: LngLat[] = [snapped, [-97.7380, 30.2840], [-97.7345, 30.2822]];

    // The old behaviour: the route's own bounds do not reach the user.
    const routeOnly = footprintBbox(route)!;
    expect(user[1]).toBeGreaterThan(routeOnly.ne[1]);

    // The fix — user and room go in alongside the line.
    const points = [...route, user, room];
    expect(framesAllOf(points)).toBe(true);
    const framed = frameFootprint(points, OVERVIEW)!;
    const bbox = footprintBbox(points)!;
    expect(bbox.ne[1]).toBeGreaterThanOrEqual(user[1]);
    expect(bbox.sw[0]).toBeLessThanOrEqual(user[0]);
    expect(framed.zoom).toBeLessThan(frameFootprint(route, OVERVIEW)!.zoom);
  });

  // The reframe put the far end of a long walk behind the search bar. The
  // header costs about a third of the usable height, so this is not a rounding
  // difference — the camera has to be told about it.
  it('frames below the header, not behind it', () => {
    const withHeader = frameFootprint([SW, NE], OVERVIEW)!;
    const ignoringHeader = frameFootprint([SW, NE], { ...OVERVIEW, paddingTop: 0 })!;
    expect(withHeader.zoom).toBeLessThan(ignoringHeader.zoom);
    expect(framesAllOf([SW, NE])).toBe(true);
  });

  // Why the inset is the dial for a tight frame and top padding is not: on a
  // wide walk, width is the binding axis, so extra top padding leaves the zoom
  // untouched and only slides the map down.
  it('pulls back on both axes, where top padding only moves a wide walk', () => {
    // Wide and short: width binds.
    const wide: LngLat[] = [[-97.7450, 30.2820], [-97.7250, 30.2826]];
    const base = frameFootprint(wide, OVERVIEW)!;
    const morePaddingTop = frameFootprint(wide, { ...OVERVIEW, paddingTop: HEADER + 100 })!;
    const moreInset = frameFootprint(wide, { ...OVERVIEW, inset: INSET + 24 })!;

    expect(morePaddingTop.zoom).toBe(base.zoom);
    expect(moreInset.zoom).toBeLessThan(base.zoom);
  });
});
