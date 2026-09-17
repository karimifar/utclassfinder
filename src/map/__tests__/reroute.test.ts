import type { LngLat } from '../../data/types';
import {
  initialRerouteState,
  nextRerouteState,
  OFF_ROUTE_FIXES,
  REROUTE_COOLDOWN_MS,
  type RerouteState,
} from '../reroute';

const HERE: LngLat = [-97.7335, 30.2849];
/** ~55m north of HERE — past REROUTE_MIN_MOVE_METRES. */
const MOVED: LngLat = [-97.7335, 30.28539];

/** Feed a run of identical fixes, as the location stream would. */
function walk(
  state: RerouteState,
  ticks: { offBy: number; coords?: LngLat; arrived?: boolean; now: number }[],
) {
  let current = state;
  const reroutes: number[] = [];
  ticks.forEach(({ offBy, coords = HERE, arrived = false, now }) => {
    const result = nextRerouteState(current, { offBy, coords, arrived, now });
    current = result.state;
    if (result.reroute) reroutes.push(now);
  });
  return { state: current, reroutes };
}

describe('nextRerouteState', () => {
  it('stays put while the user is on the line', () => {
    const { reroutes } = walk(initialRerouteState, [
      { offBy: 2, now: 0 },
      { offBy: 12, now: 1000 },
      { offBy: 29, now: 2000 },
    ]);
    expect(reroutes).toEqual([]);
  });

  it('ignores a single wild fix, so one bad reading keeps the route', () => {
    const { reroutes } = walk(initialRerouteState, [
      { offBy: 80, now: 0 },
      { offBy: 5, now: 1000 },
      { offBy: 90, now: 2000 },
    ]);
    expect(reroutes).toEqual([]);
  });

  it('reroutes once the user is consistently off the line', () => {
    const ticks = Array.from({ length: OFF_ROUTE_FIXES }, (_, i) => ({ offBy: 60, now: i * 1000 }));
    const { reroutes } = walk(initialRerouteState, ticks);
    expect(reroutes).toHaveLength(1);
  });

  it('holds off during the cooldown even while still off route', () => {
    const first = walk(initialRerouteState, [
      { offBy: 60, now: 0 },
      { offBy: 60, now: 1000 },
    ]);
    expect(first.reroutes).toEqual([1000]);

    // Still off route, still walking, but inside the cooldown window.
    const during = walk(first.state, [
      { offBy: 60, coords: MOVED, now: 2000 },
      { offBy: 60, coords: MOVED, now: 3000 },
    ]);
    expect(during.reroutes).toEqual([]);

    const after = walk(during.state, [
      { offBy: 60, coords: MOVED, now: 1000 + REROUTE_COOLDOWN_MS + 1 },
    ]);
    expect(after.reroutes).toHaveLength(1);
  });

  // Standing somewhere Directions can't snap to — inside a building — reads as
  // permanently off route. Without the movement guard that re-requests forever.
  it('will not reroute again from a spot the user never left', () => {
    const first = walk(initialRerouteState, [
      { offBy: 60, now: 0 },
      { offBy: 60, now: 1000 },
    ]);
    expect(first.reroutes).toHaveLength(1);

    const stuck = walk(
      first.state,
      Array.from({ length: 20 }, (_, i) => ({ offBy: 60, now: 10000 + i * 6000 })),
    );
    expect(stuck.reroutes).toEqual([]);
  });

  it('reroutes again once the user has actually walked somewhere new', () => {
    const first = walk(initialRerouteState, [
      { offBy: 60, now: 0 },
      { offBy: 60, now: 1000 },
    ]);
    const moved = walk(first.state, [
      { offBy: 60, coords: MOVED, now: 20000 },
      { offBy: 60, coords: MOVED, now: 21000 },
    ]);
    expect(moved.reroutes).toHaveLength(1);
  });

  it('leaves the last stretch alone, where the route stops outside the building', () => {
    const { reroutes } = walk(initialRerouteState, [
      { offBy: 60, arrived: true, now: 0 },
      { offBy: 60, arrived: true, now: 1000 },
      { offBy: 60, arrived: true, now: 2000 },
    ]);
    expect(reroutes).toEqual([]);
  });
});
