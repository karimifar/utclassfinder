import { useEffect, useRef, useState } from 'react';
import type { LngLat } from '../data/types';
import { haversine, MAX_WALK_METRES, type RouteState } from './routeState';

export interface WalkingRouteOptions {
  /** Where the user is walking to, or null when nothing is selected. */
  destination: LngLat | null;
  /**
   * Reads the origin at request time. A getter rather than a plain value so the
   * live GPS coordinate can stay in a ref — re-rendering the map on every
   * location tick would be wasteful.
   */
  getOrigin: () => LngLat | null;
  /**
   * Changes whenever the origin should be re-read: the first GPS fix landing,
   * or a simulated origin being set. This is what makes a route requested
   * before the first fix retry once there's somewhere to route from — selecting
   * a room in the first second after launch used to leave the ETA blank forever.
   */
  originKey: string;
  /** True once location has been refused — separates "not yet" from "never". */
  permissionDenied: boolean;
  accessToken?: string;
  /** Injection point for tests. */
  fetchImpl?: typeof fetch;
}

export interface WalkingRoute {
  route: GeoJSON.Feature<GeoJSON.LineString> | null;
  state: RouteState;
}

/**
 * Walking route from the current origin to `destination`, as a GeoJSON line
 * plus a state describing what happened.
 *
 * Every failure path reports something. The previous inline version ended in
 * `.catch(() => {})` and an `if (!leg) return;`, which left the room card
 * showing a stale ETA — or none at all — with no indication anything was wrong.
 */
export function useWalkingRoute({
  destination,
  getOrigin,
  originKey,
  permissionDenied,
  accessToken,
  fetchImpl,
}: WalkingRouteOptions): WalkingRoute {
  const [route, setRoute] = useState<GeoJSON.Feature<GeoJSON.LineString> | null>(null);
  const [state, setState] = useState<RouteState>({ status: 'idle' });

  const getOriginRef = useRef(getOrigin);
  useEffect(() => { getOriginRef.current = getOrigin; });
  const fetchRef = useRef(fetchImpl);
  useEffect(() => { fetchRef.current = fetchImpl; });

  // Depend on the coordinates rather than the destination array, so a new array
  // holding the same point doesn't refire the request.
  const destLng = destination?.[0] ?? null;
  const destLat = destination?.[1] ?? null;

  useEffect(() => {
    if (destLng == null || destLat == null || !accessToken) {
      setRoute(null);
      setState({ status: 'idle' });
      return;
    }

    const origin = getOriginRef.current();
    if (!origin) {
      setRoute(null);
      setState({
        status: 'error',
        reason: permissionDenied ? 'no-permission' : 'no-location',
      });
      return;
    }

    // Directions answers NoRoute for anything transcontinental anyway, and a
    // 5km straight line already isn't a walk. Skip the round trip.
    if (haversine(origin, [destLng, destLat]) > MAX_WALK_METRES) {
      setRoute(null);
      setState({ status: 'error', reason: 'too-far' });
      return;
    }

    setState({ status: 'pending' });
    const controller = new AbortController();
    const doFetch = fetchRef.current ?? fetch;
    const [oLng, oLat] = origin;
    doFetch(
      `https://api.mapbox.com/directions/v5/mapbox/walking/${oLng},${oLat};${destLng},${destLat}?geometries=geojson&access_token=${accessToken}`,
      { signal: controller.signal },
    )
      .then((r) => r.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        const leg = data?.routes?.[0];
        if (!leg) {
          setRoute(null);
          const noRoute = data?.code === 'NoRoute' || data?.code === 'NoSegment';
          setState({ status: 'error', reason: noRoute ? 'no-route' : 'failed' });
          return;
        }
        setRoute({ type: 'Feature', properties: {}, geometry: leg.geometry });
        setState({ status: 'ok', distance: leg.distance, duration: leg.duration });
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        setRoute(null);
        setState({ status: 'error', reason: 'failed' });
      });

    return () => controller.abort();
  }, [destLng, destLat, originKey, permissionDenied, accessToken]);

  return { route, state };
}
