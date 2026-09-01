import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useWalkingRoute } from '../useWalkingRoute';

const GDC_2_216: [number, number] = [-97.7365, 30.2861];
const ON_CAMPUS: [number, number] = [-97.7335, 30.2849];
const BOSTON: [number, number] = [-71.0589, 42.3601];
const TOKEN = 'pk.test';

/** A Directions response with one walking leg. */
function okResponse() {
  return {
    json: async () => ({
      routes: [{
        distance: 412,
        duration: 300,
        geometry: { type: 'LineString', coordinates: [ON_CAMPUS, GDC_2_216] },
      }],
    }),
  } as unknown as Response;
}

function render(overrides: Partial<Parameters<typeof useWalkingRoute>[0]> = {}) {
  const fetchImpl = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okResponse());
  const props = {
    destination: GDC_2_216,
    getOrigin: () => ON_CAMPUS as [number, number] | null,
    originKey: 'gps',
    permissionDenied: false,
    accessToken: TOKEN,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  };
  const view = renderHook((p: typeof props) => useWalkingRoute(p), { initialProps: props });
  return { ...view, fetchImpl, props };
}

describe('useWalkingRoute', () => {
  it('resolves a walking route and reports distance and duration', async () => {
    const { result, fetchImpl } = render();

    await waitFor(() => expect(result.current.state.status).toBe('ok'));
    expect(result.current.state).toEqual({ status: 'ok', distance: 412, duration: 300 });
    expect(result.current.route?.geometry.coordinates).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Origin first, then destination — reversing them silently routes backwards.
    expect(String(fetchImpl.mock.calls[0][0])).toContain(
      `${ON_CAMPUS[0]},${ON_CAMPUS[1]};${GDC_2_216[0]},${GDC_2_216[1]}`,
    );
  });

  // T-3 requirement 7: a room can be selected in the first second after launch,
  // long before Core Location has a fix. The route has to be requested once the
  // fix lands rather than left silently blank.
  it('retries once the first GPS fix lands after the room was selected', async () => {
    let origin: [number, number] | null = null;
    const { result, rerender, fetchImpl, props } = render({
      getOrigin: () => origin,
      originKey: 'none',
    });

    // Cold start: a room is selected, but there is nowhere to route from yet.
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'error', reason: 'no-location' }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();

    // First fix arrives. CampusMap flips `hasFix`, which changes `originKey`.
    act(() => { origin = ON_CAMPUS; });
    rerender({ ...props, getOrigin: () => origin, originKey: 'gps' });

    await waitFor(() => expect(result.current.state.status).toBe('ok'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.current.route).not.toBeNull();
  });

  it('distinguishes a denied permission from a fix that has not arrived', async () => {
    const { result } = render({ getOrigin: () => null, permissionDenied: true });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'error', reason: 'no-permission' }),
    );
  });

  it('reports too-far without calling Directions when the origin is out of range', async () => {
    const { result, fetchImpl } = render({ getOrigin: () => BOSTON });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'error', reason: 'too-far' }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces NoRoute instead of leaving the previous route in place', async () => {
    const fetchImpl = jest.fn(async () => ({
      json: async () => ({ code: 'NoRoute', routes: [] }),
    }) as unknown as Response);

    const { result } = render({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'error', reason: 'no-route' }),
    );
    expect(result.current.route).toBeNull();
  });

  it('surfaces a network failure rather than swallowing it', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('offline'); });

    const { result } = render({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'error', reason: 'failed' }),
    );
  });

  it('goes idle when the room selection is cleared', async () => {
    const { result, rerender, props } = render();
    await waitFor(() => expect(result.current.state.status).toBe('ok'));

    rerender({ ...props, destination: null });

    await waitFor(() => expect(result.current.state).toEqual({ status: 'idle' }));
    expect(result.current.route).toBeNull();
  });
});
