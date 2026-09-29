import type { LngLat } from '../../data/types';
import { advanceStep, maneuverRotation, parseSteps, stepInstruction, STEP_REACHED_METRES, type RouteStep } from '../steps';

const A: LngLat = [-97.7400, 30.2820];
/** ~110m north of A. */
const B: LngLat = [-97.7400, 30.2830];
/** ~110m north of B. */
const C: LngLat = [-97.7400, 30.2840];

const STEPS: RouteStep[] = [
  { location: A, instruction: 'Walk north', type: 'depart', modifier: null, distance: 110 },
  { location: B, instruction: 'Turn left onto Speedway', type: 'turn', modifier: 'left', distance: 110 },
  { location: C, instruction: 'You have arrived', type: 'arrive', modifier: null, distance: 0 },
];

describe('parseSteps', () => {
  it('reads maneuvers out of a Directions response', () => {
    const steps = parseSteps({
      legs: [{ steps: [{ maneuver: { location: [-97.74, 30.28], instruction: 'Turn left', type: 'turn', modifier: 'left' }, distance: 42 }] }],
    });
    expect(steps).toEqual([
      { location: [-97.74, 30.28], instruction: 'Turn left', type: 'turn', modifier: 'left', distance: 42 },
    ]);
  });

  it('flattens every leg', () => {
    const leg = { steps: [{ maneuver: { location: [-97.74, 30.28] } }] };
    expect(parseSteps({ legs: [leg, leg] })).toHaveLength(2);
  });

  // Steps only come back when steps=true was sent; everything else in the app
  // must keep working when they are absent.
  it('returns nothing rather than throwing on a response without steps', () => {
    expect(parseSteps(undefined)).toEqual([]);
    expect(parseSteps({})).toEqual([]);
    expect(parseSteps({ legs: [{}] })).toEqual([]);
  });

  it('drops a malformed maneuver instead of the whole route', () => {
    const steps = parseSteps({
      legs: [{ steps: [
        { maneuver: { location: 'nonsense' } },
        { maneuver: { location: [-97.74, 30.28], instruction: 'Turn right' } },
      ] }],
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].instruction).toBe('Turn right');
  });
});

describe('advanceStep', () => {
  it('holds at the maneuver being walked towards', () => {
    // Halfway between A and B: the turn at B is still ahead.
    const between: LngLat = [-97.7400, 30.2825];
    expect(advanceStep(STEPS, between, 1)).toBe(1);
  });

  it('advances once the maneuver is reached', () => {
    // Standing on B, the turn is done; the next thing is the arrival.
    expect(advanceStep(STEPS, B, 1)).toBe(2);
  });

  // A GPS gap can leave the index pointing at a maneuver already walked past.
  // Checking only the current step would strand it there for the whole trip.
  it('catches up when the walker is already standing on a later maneuver', () => {
    expect(advanceStep(STEPS, B, 0)).toBe(2);
  });

  // A walking fix wanders several metres. Choosing by nearest maneuver would
  // flip between two close turns and make the instruction flicker.
  it('never goes backwards', () => {
    expect(advanceStep(STEPS, A, 2)).toBe(2);
  });

  it('stops at the last step', () => {
    expect(advanceStep(STEPS, C, 2)).toBe(2);
  });

  it('survives an empty step list', () => {
    expect(advanceStep([], A, 0)).toBe(0);
  });

  it('does not advance from just outside the arrival radius', () => {
    // ~20m south of B, beyond STEP_REACHED_METRES.
    const approaching: LngLat = [-97.7400, 30.2830 - 20 / 110574];
    expect(STEP_REACHED_METRES).toBeLessThan(20);
    expect(advanceStep(STEPS, approaching, 1)).toBe(1);
  });
});

describe('stepInstruction', () => {
  it('gives Mapbox its own phrasing', () => {
    expect(stepInstruction(STEPS[1])).toBe('Turn left onto Speedway');
  });

  // "Walk north" the instant you tap Walk here says nothing the arrow doesn't.
  it('says nothing for the departure step', () => {
    expect(stepInstruction(STEPS[0])).toBeNull();
  });

  it('says nothing when there is no step or no text', () => {
    expect(stepInstruction(undefined)).toBeNull();
    expect(stepInstruction({ ...STEPS[1], instruction: '' })).toBeNull();
  });
});

describe('maneuverRotation', () => {
  const step = (modifier: string | null): RouteStep =>
    ({ location: A, instruction: 'x', type: 'turn', modifier, distance: 1 });

  it('points the way the maneuver turns', () => {
    expect(maneuverRotation(step('left'))).toBe(-90);
    expect(maneuverRotation(step('right'))).toBe(90);
    expect(maneuverRotation(step('uturn'))).toBe(180);
  });

  it('softens the angle for slight turns and sharpens it for hard ones', () => {
    expect(maneuverRotation(step('slight left'))).toBe(-45);
    expect(maneuverRotation(step('sharp left'))).toBe(-135);
    expect(maneuverRotation(step('slight right'))).toBe(45);
    expect(maneuverRotation(step('sharp right'))).toBe(135);
  });

  it('mirrors left and right', () => {
    for (const [l, r] of [['left', 'right'], ['slight left', 'slight right'], ['sharp left', 'sharp right']]) {
      expect(maneuverRotation(step(l))).toBe(-maneuverRotation(step(r)));
    }
  });

  // An unrecognised modifier should read as "keep going", not a guessed angle.
  it('points straight ahead when there is no turn to make', () => {
    expect(maneuverRotation(step('straight'))).toBe(0);
    expect(maneuverRotation(step(null))).toBe(0);
    expect(maneuverRotation(step('something new'))).toBe(0);
    expect(maneuverRotation(undefined)).toBe(0);
  });
});
