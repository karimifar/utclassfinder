import Mapbox, { UserTrackingMode } from '@rnmapbox/maps';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { Asset } from 'expo-asset';
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { BUILDINGS } from '../data/buildings';
import { getElevators } from '../data/elevators';
import { nearestEntrance } from '../data/entrances';
import type { Building, LngLat, RoomMatch } from '../data/types';
import { colors } from '../theme';
import { frameFootprint } from './framing';
import { fixQuality, type FixQuality } from './fixQuality';
import { shouldTurnCamera, smoothHeading } from './heading';
import { initialRerouteState, nextRerouteState, type RerouteState } from './reroute';
import { advanceStep, maneuverRotation, stepInstruction } from './steps';
import { ARRIVAL_METRES, haversine, MAX_WALK_METRES, type RouteState } from './routeState';
import { useWalkingRoute } from './useWalkingRoute';

function splitRouteAtUser(
  coords: [number, number][],
  user: [number, number],
): { walked: [number, number][]; remaining: [number, number][] } {
  let bestDist = Infinity;
  let bestIdx = 0;
  let bestPoint: [number, number] = coords[0];

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((user[0] - a[0]) * dx + (user[1] - a[1]) * dy) / lenSq));
    const px = a[0] + t * dx, py = a[1] + t * dy;
    const dist = (user[0] - px) ** 2 + (user[1] - py) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
      bestPoint = [px, py];
    }
  }

  return {
    walked: [...coords.slice(0, bestIdx + 1), bestPoint],
    remaining: [bestPoint, ...coords.slice(bestIdx + 1)],
  };
}

export interface CampusMapHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  centerOnUser: () => void;
  /**
   * Re-frame the selected room — the same view selecting it produced.
   *
   * The room card stays up while the map is panned anywhere, so without this
   * there is no way back to a selection once it is off screen.
   */
  focusSelectedRoom: () => void;
  /** The same, for the building panel. */
  focusSelectedBuilding: () => void;
}

/** Where the user is walking next, for the nav bar's arrow and arrival card. */
export interface NavProgress {
  /**
   * Which way the next maneuver turns, in degrees clockwise from straight
   * ahead. Screen-relative and fixed — a left turn is a left turn however the
   * phone is held.
   */
  maneuverRotation: number;
  /** Straight-line metres to the destination, or null when unknown. */
  distanceToDestination: number | null;
  /**
   * Radius of uncertainty of the fix these were measured from, in metres, or
   * null when the platform reported none. Arrival is judged against it: a fix
   * looser than the arrival radius cannot say whether we are inside it.
   */
  accuracy: number | null;
  /** What to do next, in Mapbox's phrasing, or null when there's nothing to say. */
  instruction: string | null;
  /** Metres to the maneuver `instruction` describes. */
  distanceToManeuver: number | null;
}

const token = Constants.expoConfig?.extra?.mapboxAccessToken as string | undefined;
if (token) Mapbox.setAccessToken(token);

const CAMPUS_BOUNDS = {
  ne: [-97.722582, 30.294828] as [number, number],
  sw: [-97.746697, 30.270204] as [number, number],
  paddingTop: 32,
  paddingBottom: 32,
  paddingLeft: 32,
  paddingRight: 32,
};

const CAMPUS_BUILDINGS = BUILDINGS.filter(
  (b) => b.center[0] > -97.76 && b.center[0] < -97.70 &&
         b.center[1] > 30.27 && b.center[1] < 30.30
);

function buildingLabels(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: CAMPUS_BUILDINGS.filter((b) => b.abbr).map((b) => ({
      type: 'Feature',
      id: b.id,
      properties: { abbr: b.abbr! },
      geometry: { type: 'Point', coordinates: b.center },
    })),
  };
}

const BUILDING_TAP_MIN_ZOOM = 15;
// Shifts the focal point to 35% from top (paddingBottom = 30% of screen height).
const FOCUS_PADDING = { paddingTop: 0, paddingLeft: 0, paddingRight: 0, paddingBottom: Dimensions.get('window').height * 0.3 };
const NO_PADDING   = { paddingTop: 0, paddingLeft: 0, paddingRight: 0, paddingBottom: 0 };
// Navigate mode, modelled on Google Maps walking: the puck sits low and the
// camera sits close to the ground, so most of the screen is the route ahead
// rather than the ground already behind you.
//
// Padding insets the region the centre is placed in, so it is `paddingTop` that
// pushes the puck DOWN the screen. The previous `paddingBottom: 35%` did the
// exact opposite of what its comment claimed and parked the puck near the top,
// which is what left so little of the route in view.
const NAV_FOCUS_FROM_TOP = 0.72;
const NAV_PADDING = {
  paddingTop: Dimensions.get('window').height * (NAV_FOCUS_FROM_TOP * 2 - 1),
  paddingLeft: 0,
  paddingRight: 0,
  paddingBottom: 0,
};
// Steeper than the old 60 puts more of the horizon in shot; 18.5 sits closer to
// the ground than 18 without losing the next turn off the top of the screen.
const NAV_PITCH = 65;
const NAV_ZOOM = 18.5;
/** How long a recentre takes. Long enough to read as a move, short enough not to wait. */
const RECENTER_MS = 450;
const ROOM_ZOOM = 19;
// Building state is framed to the footprint, but never outside this range:
// 17.5 is where the floor-plan room labels switch on (see `floor-plan-labels`),
// and past 19 a small building's floor plan is unreadably large.
const BUILDING_MIN_ZOOM = 17.5;
const BUILDING_MAX_ZOOM = 19.0;
// Breathing room between the footprint and the edge of the framed area.
const FRAME_INSET = 28;
/**
 * The same, for the walk overview — the dial for "fit it, but pull back a bit
 * more".
 *
 * Its own constant rather than sharing FRAME_INSET, because the overview has to
 * hold a whole walk between the header and the room panel while a building only
 * has to hold one footprint, and because widening one should not silently
 * reframe the other.
 *
 * Raise this to zoom out. It is the right dial for a frame that feels tight on
 * any edge: it shrinks both axes, so it pulls back whichever one is binding.
 * Adding top padding instead only zooms out when height is the binding axis —
 * on a wide walk it leaves the zoom alone and just slides the map down, which
 * buys room at the top by pushing the bottom under the panel.
 */
const OVERVIEW_INSET = 48;
// Overview state frames the whole walk. The floor has to clear the longest walk
// the app will even offer (MAX_WALK_METRES, 5km) — anything higher silently
// crops the route instead of framing it, and raising OVERVIEW_INSET eats into
// the margin, so the two move together. The ceiling keeps a user already at the
// door from slamming to room zoom and losing all context.
const OVERVIEW_MIN_ZOOM = 11.5;
const OVERVIEW_MAX_ZOOM = 18.0;


/** Bearing (degrees) of the first route segment, for the initial nav camera heading. */
function segmentBearing(from: [number, number], to: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lng1, lat1] = from.map(toRad);
  const [lng2, lat2] = to.map(toRad);
  const dLng = lng2 - lng1;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * The room-state camera. Shared by the selection effect and the navigate-mode
 * teardown so ending navigation lands on exactly the view the user left.
 */
function roomCamera(room: RoomMatch, animationDuration: number) {
  return {
    centerCoordinate: room.center,
    zoomLevel: ROOM_ZOOM,
    pitch: 0,
    heading: 0,
    padding: FOCUS_PADDING,
    animationMode: 'flyTo' as const,
    animationDuration,
  };
}

/**
 * The building-state camera: framed to the building's own footprint rather than
 * a flat zoom, so a complex like GDC and a small annex both fill the view.
 *
 * The zoom is computed analytically instead of via `fitBounds` so it can be
 * clamped and applied in a single animation — fitting and then correcting
 * visibly re-adjusts.
 */
function buildingCamera(building: Building, animationDuration: number) {
  const win = Dimensions.get('window');
  const framed = frameFootprint(building.footprint, {
    width: win.width,
    height: win.height,
    // Matches FOCUS_PADDING, so the building is centred in the area *above*
    // the floor-switcher panel rather than behind it.
    paddingBottom: FOCUS_PADDING.paddingBottom,
    inset: FRAME_INSET,
    minZoom: BUILDING_MIN_ZOOM,
    maxZoom: BUILDING_MAX_ZOOM,
  });
  return {
    centerCoordinate: framed?.center ?? building.center,
    zoomLevel: framed?.zoom ?? BUILDING_MIN_ZOOM,
    padding: FOCUS_PADDING,
    animationMode: 'flyTo' as const,
    animationDuration,
  };
}

/**
 * The overview camera: every point of the walk on screen at once, framed in the
 * area above the room panel.
 *
 * Selecting a room used to draw the route and leave the camera where it was, so
 * a destination off-screen gave no clue which way it lay. Framing the walk end
 * to end answers "where am I going" before the user has to pan for it.
 */
function overviewCamera(points: LngLat[], animationDuration: number, paddingTop: number) {
  const win = Dimensions.get('window');
  // Unlike the other cameras this one has to clear the header too. A walk can
  // run the length of campus, so the framed box reaches the top of the screen
  // and the far end of the route was disappearing behind the search bar.
  const padding = { ...FOCUS_PADDING, paddingTop };
  const framed = frameFootprint(points, {
    width: win.width,
    height: win.height,
    paddingTop,
    paddingBottom: FOCUS_PADDING.paddingBottom,
    inset: OVERVIEW_INSET,
    minZoom: OVERVIEW_MIN_ZOOM,
    maxZoom: OVERVIEW_MAX_ZOOM,
  });
  if (!framed) return null;
  return {
    centerCoordinate: framed.center,
    zoomLevel: framed.zoom,
    // Levelled, so returning here from navigate mode undoes the nav pitch.
    pitch: 0,
    heading: 0,
    padding,
    animationMode: 'flyTo' as const,
    animationDuration,
  };
}

interface Props {
  selectedRoom?: RoomMatch | null;
  selectedBuilding?: Building | null;
  selectedFloor?: string | null;
  cameraRef: React.RefObject<Mapbox.Camera | null>;
  onUserLocation?: (coords: [number, number]) => void;
  onHeadingChange?: (heading: number) => void;
  onBuildingPress?: (buildingId: string) => void;
  onRoomPress?: (roomId: string) => void;
  /** Route lifecycle — pending, resolved, or why it failed. */
  onRouteState?: (state: RouteState) => void;
  /** Live navigate-mode progress: bearing along the route and distance to go. */
  onNavProgress?: (progress: NavProgress) => void;
  /** Fires when the nav camera stops/starts following the user (map pan disengages follow). */
  onFollowStateChange?: (disengaged: boolean) => void;
  navigateMode?: boolean;
  /**
   * Height of the header chrome in points, so the overview camera can frame the
   * walk below it. The screen computes this from its own safe-area insets.
   */
  headerHeight?: number;
  /**
   * Fires when the fix changes quality band — not on every tick, which would
   * re-render the screen on every GPS update for no benefit.
   */
  onFixQualityChange?: (quality: FixQuality) => void;
  /**
   * Simulated origin for walking directions. Null in production — see src/debug.ts.
   * When set, routes originate here instead of live GPS and the follow camera is
   * driven manually, because the real device is somewhere else entirely.
   */
  debugOrigin?: LngLat | null;
}

export const CampusMap = forwardRef<CampusMapHandle, Props>(
  function CampusMap({ selectedRoom, selectedBuilding, selectedFloor, cameraRef, onUserLocation, onHeadingChange, onBuildingPress, onRoomPress, onRouteState, onNavProgress, onFollowStateChange, navigateMode, headerHeight = 0, onFixQualityChange, debugOrigin = null }, ref) {
    const mapRef = useRef<Mapbox.MapView>(null);
    const [geojsonUri, setGeojsonUri] = useState<string | null>(null);
    const [buildingsUri, setBuildingsUri] = useState<string | null>(null);
    const [walkedRoute, setWalkedRoute] = useState<GeoJSON.Feature<GeoJSON.LineString> | null>(null);
    const [remainingRoute, setRemainingRoute] = useState<GeoJSON.Feature<GeoJSON.LineString> | null>(null);
    const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
    // Flips once, on the first GPS fix. Routes requested before then are retried
    // when it flips — a room can be selected in the first second after launch,
    // long before Core Location has anything to report.
    const [hasFix, setHasFix] = useState(false);
    // Device compass heading, tracked only in navigate mode (it drives the
    // direction puck, and re-rendering the map on every heading tick is wasteful).
    const [userHeading, setUserHeading] = useState(0);
    /**
     * The bearing the camera is actually held at.
     *
     * Separate from `userHeading`, and deliberately staler: the puck follows the
     * smoothed compass closely so fine movement still reads, while the map only
     * turns once that has drifted past the deadband. Small movements wiggle the
     * arrow and leave the map alone.
     */
    const [cameraHeading, setCameraHeading] = useState<number | null>(null);
    const smoothedHeadingRef = useRef<number | null>(null);
    const cameraHeadingRef = useRef<number | null>(null);
    useEffect(() => { cameraHeadingRef.current = cameraHeading; }, [cameraHeading]);
    /** Sequences the recentre: move by hand first, hand back to follow after. */
    const recenterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (recenterTimer.current) clearTimeout(recenterTimer.current); }, []);
    // Bumped when the user strays off the line, which re-requests directions
    // from wherever they actually are now.
    const [rerouteSeq, setRerouteSeq] = useState(0);
    const rerouteState = useRef<RerouteState>(initialRerouteState);
    const hasHadSelection = useRef(false);
    /** Live GPS only. The effective route origin is `debugOrigin ?? this`. */
    const userCoordsRef = useRef<[number, number] | null>(null);
    /**
     * The imperative handle is built once, so anything it reaches for has to be
     * a ref or it freezes at the first render's value — and on that render the
     * safe-area insets have not resolved, so headerHeight is still 0.
     */
    const headerHeightRef = useRef(headerHeight);
    useEffect(() => { headerHeightRef.current = headerHeight; });
    /** Radius of uncertainty of the newest fix, in metres. */
    const accuracyRef = useRef<number | null>(null);
    const fixQualityRef = useRef<FixQuality>('unknown');
    const navigateModeRef = useRef(navigateMode);
    useEffect(() => { navigateModeRef.current = navigateMode; }, [navigateMode]);
    const selectedRoomRef = useRef(selectedRoom);
    useEffect(() => { selectedRoomRef.current = selectedRoom; }, [selectedRoom]);
    const selectedBuildingRef = useRef(selectedBuilding);
    useEffect(() => { selectedBuildingRef.current = selectedBuilding; }, [selectedBuilding]);
    const debugOriginRef = useRef(debugOrigin);
    useEffect(() => { debugOriginRef.current = debugOrigin; }, [debugOrigin]);

    const onRouteStateRef = useRef(onRouteState);
    useEffect(() => { onRouteStateRef.current = onRouteState; });
    const onNavProgressRef = useRef(onNavProgress);
    useEffect(() => { onNavProgressRef.current = onNavProgress; });
    const onUserLocationRef = useRef(onUserLocation);
    useEffect(() => { onUserLocationRef.current = onUserLocation; });
    const onFixQualityChangeRef = useRef(onFixQualityChange);
    useEffect(() => { onFixQualityChangeRef.current = onFixQualityChange; });

    /** Origin for routing and for the nav bar: simulated if set, else live GPS. */
    const currentOrigin = (): [number, number] | null =>
      debugOriginRef.current ?? userCoordsRef.current;

    // Changes exactly when the origin should be re-read, so a route requested
    // before the first GPS fix is retried the moment one lands.
    /**
     * The door to walk to, when UT has surveyed one for this building.
     *
     * Recomputed only when the room changes or the origin is re-read — never
     * per fix. The destination feeds useWalkingRoute, and a destination that
     * moved with the walker would re-request directions forever.
     */
    const entrance = useMemo(
      () => (selectedRoom ? nearestEntrance(selectedRoom.building.abbr, currentOrigin() ?? selectedRoom.center) : null),
      // The three beyond selectedRoom look unnecessary to the linter because
      // the body reads the origin through a ref rather than naming them. They
      // are exactly the signal that the origin has changed — first fix, a
      // simulated origin, a reroute — and dropping them would leave the door
      // chosen from a position the walker has since left.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [selectedRoom, hasFix, debugOrigin, rerouteSeq],
    );
    /**
     * Where the walk actually ends. The door when we know it, the room's own
     * centroid when we don't — which is what Directions then snaps to the
     * nearest path, door or not.
     */
    const walkTarget: LngLat | null = entrance?.center ?? selectedRoom?.center ?? null;
    const walkTargetRef = useRef(walkTarget);
    useEffect(() => { walkTargetRef.current = walkTarget; });

    const originKey = debugOrigin
      ? `debug:${debugOrigin[0]},${debugOrigin[1]}`
      : hasFix ? `gps:${rerouteSeq}` : 'none';

    const { route, steps, state: routeState } = useWalkingRoute({
      destination: walkTarget,
      getOrigin: currentOrigin,
      originKey,
      permissionDenied: permission === 'denied',
      accessToken: token,
    });
    useEffect(() => { onRouteStateRef.current?.(routeState); }, [routeState]);
    const routeRef = useRef(route);
    useEffect(() => { routeRef.current = route; }, [route]);
    const stepsRef = useRef(steps);
    useEffect(() => { stepsRef.current = steps; }, [steps]);
    /** Index of the maneuver being walked towards. Only ever moves forward. */
    const stepIndexRef = useRef(0);
    // A new route renumbers the maneuvers, so the index cannot carry over.
    useEffect(() => { stepIndexRef.current = 0; }, [steps]);

    // Whether the user panned away from the follow camera during navigation.
    const [followDisengaged, setFollowDisengaged] = useState(false);
    const followDisengagedRef = useRef(false);
    const onFollowStateChangeRef = useRef(onFollowStateChange);
    useEffect(() => { onFollowStateChangeRef.current = onFollowStateChange; });
    const setDisengaged = (v: boolean) => {
      if (followDisengagedRef.current === v) return;
      followDisengagedRef.current = v;
      setFollowDisengaged(v);
      onFollowStateChangeRef.current?.(v);
    };

    useImperativeHandle(ref, () => ({
      zoomIn: async () => {
        const zoom = await mapRef.current?.getZoom();
        if (zoom != null) cameraRef.current?.zoomTo(zoom + 1, 200);
      },
      zoomOut: async () => {
        const zoom = await mapRef.current?.getZoom();
        if (zoom != null) cameraRef.current?.zoomTo(zoom - 1, 200);
      },
      focusSelectedRoom: () => {
        const room = selectedRoomRef.current;
        if (!room) return;
        // Clear the frame key so the automatic pass does not decide this view is
        // already current and skip it — an explicit tap always re-frames.
        framedRef.current = null;
        cameraRef.current?.setCamera(roomViewCamera(room, 500));
      },
      focusSelectedBuilding: () => {
        const building = selectedBuildingRef.current;
        if (!building) return;
        framedRef.current = null;
        cameraRef.current?.setCamera(buildingCamera(building, 500));
      },
      centerOnUser: () => {
        const origin = currentOrigin();
        const followed = navigateModeRef.current && !debugOriginRef.current;

        if (!followed) {
          // Nothing to hand back to — just move.
          setDisengaged(false);
          if (origin) {
            cameraRef.current?.setCamera({
              centerCoordinate: origin,
              zoomLevel: navigateModeRef.current ? NAV_ZOOM : 17,
              ...(navigateModeRef.current ? { pitch: NAV_PITCH, padding: NAV_PADDING } : {}),
              animationDuration: RECENTER_MS,
              animationMode: 'easeTo',
            });
          }
          return;
        }

        // Re-arming the follow camera on its own looked wrong: rnmapbox hands
        // the viewport its *default* transition, which arcs out and back, and
        // then snaps the bearing immediately afterwards. Neither is controllable
        // from here.
        //
        // So make the move ourselves — a straight easeTo from wherever the user
        // has panned to, onto them — and only hand back to the follow camera
        // once it is already sitting where it wants to be, leaving its own
        // transition with nothing to animate.
        if (origin) {
          cameraRef.current?.setCamera({
            centerCoordinate: origin,
            zoomLevel: NAV_ZOOM,
            pitch: NAV_PITCH,
            padding: NAV_PADDING,
            // Hold the damped bearing, so recentring does not also spin the map.
            ...(cameraHeadingRef.current != null ? { heading: cameraHeadingRef.current } : {}),
            animationDuration: RECENTER_MS,
            animationMode: 'easeTo',
          });
        }
        if (recenterTimer.current) clearTimeout(recenterTimer.current);
        recenterTimer.current = setTimeout(() => {
          recenterTimer.current = null;
          setDisengaged(false);
        }, RECENTER_MS + 60);
      },
      // Built once, deliberately: a handle rebuilt every render would hand the
      // screen a new object on each GPS tick. Everything reached from in here —
      // the selection, the route, the origin, headerHeight — goes through a ref
      // for exactly that reason, so the first render's closure still reads
      // current values. Adding roomViewCamera to the deps is not the fix; if
      // something in here ever reads a prop directly, give it a ref instead.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [cameraRef]);

    useEffect(() => {
      Mapbox.setTelemetryEnabled(false);
      Asset.fromModule(require('../../assets/data/buildings_rooms.geojson'))
        .downloadAsync()
        .then((asset) => { if (asset.localUri) setGeojsonUri(asset.localUri); });
      Asset.fromModule(require('../../assets/data/campus_buildings.geojson'))
        .downloadAsync()
        .then((asset) => { if (asset.localUri) setBuildingsUri(asset.localUri); });
    }, []);

    // Ask for location up front rather than letting Mapbox request it
    // implicitly, so a denial is a state we know about and can explain.
    useEffect(() => {
      let cancelled = false;
      Location.requestForegroundPermissionsAsync()
        .then(({ status }) => {
          if (!cancelled) setPermission(status === 'granted' ? 'granted' : 'denied');
        })
        .catch(() => { if (!cancelled) setPermission('denied'); });
      return () => { cancelled = true; };
    }, []);

    /** Push the next maneuver and the distance remaining up to the nav bar. */
    const reportNavProgress = (coords: [number, number]) => {
      const room = selectedRoomRef.current;
      if (!room) {
        onNavProgressRef.current?.({
          maneuverRotation: 0,
          distanceToDestination: null,
          accuracy: null,
          instruction: null,
          distanceToManeuver: null,
        });
        return;
      }
      // Which maneuver is next, from wherever the walker actually is.
      const currentSteps = stepsRef.current;
      stepIndexRef.current = advanceStep(currentSteps, coords, stepIndexRef.current);
      const step = currentSteps[stepIndexRef.current];

      onNavProgressRef.current?.({
        maneuverRotation: maneuverRotation(step),
        // To the door when we know it: that is where the walk ends.
        distanceToDestination: haversine(coords, walkTargetRef.current ?? room.center),
        // A simulated origin is exactly where it says it is. Reporting the real
        // device's uncertainty here would judge a synthetic distance against an
        // unrelated fix, and a poor one indoors would block arrival outright.
        accuracy: debugOriginRef.current ? 0 : accuracyRef.current,
        instruction: stepInstruction(step),
        distanceToManeuver: step ? haversine(coords, step.location) : null,
      });
    };

    /** Re-request directions when the user has clearly left the route. */
    const maybeReroute = (coords: [number, number], offBy: number) => {
      const { state, reroute } = nextRerouteState(rerouteState.current, {
        offBy,
        accuracy: accuracyRef.current,
        coords,
        // Measured to the door we are actually walking to. Against the room's
        // centroid instead, a large building leaves you metres from the
        // entrance but still far from the room, and arrival never fires.
        arrived: walkTargetRef.current != null
          && haversine(coords, walkTargetRef.current) <= ARRIVAL_METRES,
        now: Date.now(),
      });
      rerouteState.current = state;
      if (reroute) setRerouteSeq((n) => n + 1);
    };

    // A new route or destination starts the off-route count over; leaving
    // navigation forgets the cooldown too, so the next trip starts clean.
    useEffect(() => {
      rerouteState.current = navigateMode
        ? { ...rerouteState.current, fixes: 0 }
        : initialRerouteState;
    }, [navigateMode, selectedRoom, route]);

    useEffect(() => {
      if (!navigateMode) {
        onNavProgressRef.current?.({
          maneuverRotation: 0,
          distanceToDestination: null,
          accuracy: null,
          instruction: null,
          distanceToManeuver: null,
        });
        return;
      }
      const origin = currentOrigin();
      if (origin) reportNavProgress(origin);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigateMode, route, steps, selectedRoom, debugOrigin, hasFix]);

    /**
     * The non-navigating camera for a selected room: the user, the room, and
     * the path between them, all on screen at once.
     *
     * All three are needed, not just the route. Directions snaps to the walking
     * network at both ends, so the route's first coordinate can sit tens of
     * metres from the actual GPS position and its last stops at the kerb rather
     * than inside the building. Framing the line alone left the puck off the
     * top of the screen. The route's own points still go in, because a path
     * that rounds a building reaches past both of its endpoints.
     *
     * An origin too far away to walk from is left out entirely. There is no
     * walk to frame, and including it makes a box spanning the whole distance —
     * which the OVERVIEW_MIN_ZOOM clamp then pulls *in* to a view holding
     * neither the user nor the room, somewhere in the empty middle. That clamp
     * is only ever safe within MAX_WALK_METRES; this is what keeps it there.
     *
     * Measured rather than read off routeState, which arrives a network round
     * trip later — by then the bad camera has already flown.
     */
    const roomViewCamera = (room: RoomMatch, animationDuration: number) => {
      const current = routeRef.current;
      const origin = currentOrigin();
      const walkable = origin != null && haversine(origin, room.center) <= MAX_WALK_METRES;
      // No walk to frame — sit on the room itself.
      if (!current && !walkable) return roomCamera(room, animationDuration);

      const points: LngLat[] = [
        ...(current ? (current.geometry.coordinates as LngLat[]) : []),
        ...(walkable && origin ? [origin] : []),
        room.center,
      ];
      return overviewCamera(points, animationDuration, headerHeightRef.current) ?? roomCamera(room, animationDuration);
    };

    /**
     * What the current room view was framed from. Keeps GPS ticks from
     * re-animating a camera the user may have panned, while still allowing the
     * one upgrade from endpoints to the real route when it lands.
     */
    const framedRef = useRef<string | null>(null);

    const wasNavigating = useRef(false);
    const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (restoreTimer.current) clearTimeout(restoreTimer.current); }, []);

    useEffect(() => {
      if (navigateMode && route) {
        wasNavigating.current = true;
        setDisengaged(false);
        // With a simulated origin the declarative follow camera is off, because
        // real GPS is somewhere else entirely. Place the nav camera by hand at
        // the simulated origin, headed along the first route segment.
        if (debugOrigin) {
          const coords = route.geometry.coordinates as [number, number][];
          const next = coords.find((c) => c[0] !== debugOrigin[0] || c[1] !== debugOrigin[1]) ?? coords[coords.length - 1];
          cameraRef.current?.setCamera({
            centerCoordinate: debugOrigin,
            zoomLevel: NAV_ZOOM,
            pitch: NAV_PITCH,
            heading: segmentBearing(debugOrigin, next),
            padding: NAV_PADDING,
            animationMode: 'flyTo',
            animationDuration: 800,
          });
        }
        setRemainingRoute({ type: 'Feature', properties: {}, geometry: route.geometry });
        setWalkedRoute(null);
      } else if (!navigateMode) {
        // Leaving navigation drops the damped bearing, so the next trip starts
        // from the compass rather than from wherever the last one ended.
        smoothedHeadingRef.current = null;
        setCameraHeading(null);
        setWalkedRoute(null);
        setRemainingRoute(null);
        if (wasNavigating.current) {
          wasNavigating.current = false;
          setDisengaged(false);
          const room = selectedRoomRef.current;
          // One animation back to the room-state camera, not a pitch reset
          // racing a re-frame — two overlapping animations are what left the
          // camera skewed. The short delay lets `followUserLocation`, which
          // released on this same render, actually let go of the native camera
          // before the restore starts.
          if (restoreTimer.current) clearTimeout(restoreTimer.current);
          restoreTimer.current = setTimeout(() => {
            restoreTimer.current = null;
            if (room) {
              cameraRef.current?.setCamera(roomViewCamera(room, 600));
            } else {
              // Navigation ended because the selection was cleared: level the
              // camera and leave position alone.
              cameraRef.current?.setCamera({ pitch: 0, heading: 0, animationDuration: 500 });
            }
          }, 80);
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigateMode, route, cameraRef, debugOrigin]);

    useEffect(() => {
      // Navigate mode owns the camera. Leaving `framedRef` set across the whole
      // of it also means the exit tick is a no-op here, so this never races the
      // teardown animation for the same room.
      if (navigateMode) return;

      if (selectedRoom) {
        hasHadSelection.current = true;
        // Re-frame only when the inputs genuinely changed: a new room, or the
        // route arriving to replace the straight-line estimate.
        const key = `${selectedRoom.roomId}|${route ? 'route' : currentOrigin() ? 'ends' : 'room'}`;
        if (framedRef.current === key) return;
        framedRef.current = key;
        cameraRef.current?.setCamera(roomViewCamera(selectedRoom, 600));
      } else if (selectedBuilding) {
        framedRef.current = null;
        hasHadSelection.current = true;
        cameraRef.current?.setCamera(buildingCamera(selectedBuilding, 400));
      } else if (hasHadSelection.current) {
        framedRef.current = null;
        mapRef.current?.getZoom().then((zoom) => {
          if (zoom != null) cameraRef.current?.setCamera({
            zoomLevel: zoom - 1.5,
            animationDuration: 400,
            padding: NO_PADDING,
          });
        });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRoom, selectedBuilding, route, navigateMode, hasFix, debugOrigin, cameraRef]);

    const labels = useMemo(() => buildingLabels(), []);

    // Never let navigate mode render without a line: `remainingRoute` is
    // maintained by the location stream, which may not have ticked yet.
    const navRoute = remainingRoute ?? route;

    /**
     * Directions snaps to sidewalks and can't route to a room on an upper
     * floor, so the walking route stops at the nearest walkway. This is the
     * "enter here, then go inside" hop from there to the room.
     */
    const finalHop = useMemo(() => {
      if (!navigateMode || !selectedRoom || !route) return null;
      const coords = route.geometry.coordinates as [number, number][];
      const last = coords[coords.length - 1];
      if (!last || haversine(last, selectedRoom.center) < 1) return null;
      return {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: [last, selectedRoom.center] },
      };
    }, [navigateMode, selectedRoom, route]);

    /**
     * Public elevators in the building whose floor plan is open. UT's data has
     * one point per elevator bank and no floor list, so the same points show
     * on every floor — a bank serves the whole building.
     */
    const elevatorShape = useMemo(() => {
      const floorOpen = (selectedRoom?.floor ?? selectedFloor) != null;
      const abbr = selectedRoom?.building.abbr ?? selectedBuilding?.abbr;
      if (!floorOpen || !abbr) return null;
      const elevators = getElevators(abbr);
      if (elevators.length === 0) return null;
      return {
        type: 'FeatureCollection' as const,
        features: elevators.map((e) => ({
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'Point' as const, coordinates: e.center },
        })),
      };
    }, [selectedRoom, selectedBuilding, selectedFloor]);

    // Tapping an elevator names it for a moment, standing in for the map
    // legend the app doesn't have. Cleared when the building or floor changes,
    // so the label never floats over a plan it doesn't belong to.
    const [elevatorTip, setElevatorTip] = useState<LngLat | null>(null);
    const elevatorTipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
      setElevatorTip(null);
      return () => {
        if (elevatorTipTimer.current) clearTimeout(elevatorTipTimer.current);
      };
    }, [elevatorShape]);
    const showElevatorTip = (at: LngLat) => {
      if (elevatorTipTimer.current) clearTimeout(elevatorTipTimer.current);
      setElevatorTip(at);
      elevatorTipTimer.current = setTimeout(() => setElevatorTip(null), 2500);
    };

    if (!token) {
      return (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <Text style={styles.placeholderText}>
            Map unavailable — set MAPBOX_ACCESS_TOKEN in .env
          </Text>
        </View>
      );
    }

    const activeBldgNo = selectedRoom?.bldgNo ?? selectedBuilding?.id ?? null;
    const activeFloor = selectedRoom?.floor ?? selectedFloor ?? null;
    const highlightRoomId = selectedRoom?.roomId ?? null;

    const navigableFilter = ['!', ['in', ['get', 'room_type'], ['literal', [
      'circulation areas (non e&g)',
      'mechanical areas (non-e&g)',
      'public rest rooms (non e&g)',
      'custodial areas (non e&g)',
      'shell space (non e&g)',
      'building maintenance',
      'utilities',
      'construction project management',
      'landscape and grounds maintenance',
      'operation and maintenance',
      'floor',
      'to be determined',
    ]]]];

    const floorFilter: any = (activeBldgNo && activeFloor)
      ? ['all',
          ['==', ['get', 'bldg_no'], activeBldgNo],
          ['==', ['get', 'floor'], activeFloor],
          navigableFilter,
        ]
      : ['==', ['get', 'room_id'], '__none__'];

    const bathroomFilter: any = (activeBldgNo && activeFloor)
      ? ['all',
          ['==', ['get', 'bldg_no'], activeBldgNo],
          ['==', ['get', 'floor'], activeFloor],
          ['==', ['get', 'room_type'], 'public rest rooms (non e&g)'],
        ]
      : ['==', ['get', 'room_id'], '__none__'];

    const roomFilter: any = highlightRoomId
      ? ['==', ['get', 'room_id'], highlightRoomId]
      : ['==', ['get', 'room_id'], '__none__'];

    const roomLabelExpr: any = [
      'slice',
      ['get', 'room_id'],
      ['length', ['concat', ['get', 'bldg_no'], '-', ['get', 'floor'], '-']],
    ];

    return (
      <View style={StyleSheet.absoluteFill}>
        <Mapbox.MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          styleURL={Mapbox.StyleURL.Light}
          scaleBarEnabled={false}
          attributionEnabled={false}
          logoEnabled={false}
          onCameraChanged={(state) => {
            onHeadingChange?.(state.properties.heading ?? 0);
            if (state.gestures.isGestureActive && navigateModeRef.current) setDisengaged(true);
          }}
        >
          {/* Frames campus on first load only. Deliberately `defaultSettings`
              rather than the declarative `bounds` prop: `bounds` re-asserts
              whenever the Camera's other props change — notably when
              `followUserLocation` flips off at the end of navigation — which
              snapped the map back to the landing view. */}
          <Mapbox.Camera
            ref={cameraRef}
            defaultSettings={{ bounds: CAMPUS_BOUNDS }}
            animationDuration={0}
            followUserLocation={Boolean(navigateMode) && !debugOrigin && !followDisengaged}
            onUserTrackingModeChange={(e) => {
              if (navigateModeRef.current && !e.nativeEvent.payload.followUserLocation) setDisengaged(true);
            }}
            // Plain Follow, not FollowWithHeading. FollowWithHeading wires the
            // camera straight to the compass with no filtering available, so
            // every few degrees of noise moved the map. Follow leaves the
            // bearing alone and `followHeading` below supplies a damped one.
            followUserMode={UserTrackingMode.Follow}
            followHeading={navigateMode && cameraHeading != null ? cameraHeading : undefined}
            followPitch={NAV_PITCH}
            followZoomLevel={NAV_ZOOM}
            followPadding={NAV_PADDING}
          />

          <Mapbox.Images
            images={{
              'nav-arrow': require('../../assets/Visuals/nav-arrow.png'),
              'room-pin': require('../../assets/Visuals/room-pin.png'),
              elevator: require('../../assets/Visuals/elevator.png'),
            }}
          />

          {buildingsUri && (
            <Mapbox.ShapeSource
              id="campus-buildings"
              url={buildingsUri}
              onPress={async (e) => {
                const zoom = await mapRef.current?.getZoom();
                if (zoom == null || zoom < BUILDING_TAP_MIN_ZOOM) return;
                const buildingId = e.features[0]?.properties?.Building as string | undefined;
                if (buildingId) onBuildingPress?.(buildingId);
              }}
            >
              <Mapbox.FillLayer
                id="building-fill"
                aboveLayerID="building"
                style={{
                  fillColor: ['case', ['==', ['get', 'Building'], activeBldgNo ?? '__none__'], colors.limestone, colors.shade] as any,
                  fillOpacity: ['case', ['==', ['get', 'Building'], activeBldgNo ?? '__none__'], 1, 0.7] as any,
                }}
              />
              <Mapbox.LineLayer
                id="building-outline"
                aboveLayerID="building"
                style={{
                  lineColor: ['case', ['==', ['get', 'Building'], activeBldgNo ?? '__none__'], colors.burntOrange, colors.blueBonnet] as any,
                  lineWidth: ['case', ['==', ['get', 'Building'], activeBldgNo ?? '__none__'], 2.5, 1] as any,
                  lineOpacity: 0.9,
                }}
              />
            </Mapbox.ShapeSource>
          )}

          {geojsonUri && (
            <Mapbox.ShapeSource
              id="all-rooms"
              url={geojsonUri}
              onPress={(e) => {
                if (!activeBldgNo || !activeFloor) return;
                const roomId = e.features[0]?.properties?.room_id as string | undefined;
                if (roomId) onRoomPress?.(roomId);
              }}
            >
              <Mapbox.FillLayer
                id="floor-plan-fill"
                filter={floorFilter}
                style={{ fillColor: colors.highlightFill, fillOpacity: 1 }}
              />
              <Mapbox.LineLayer
                id="floor-plan-outline"
                filter={floorFilter}
                style={{ lineColor: 'rgba(26, 26, 26, 0.3)', lineWidth: 0.8 }}
              />
              <Mapbox.FillLayer
                id="bathroom-fill"
                filter={bathroomFilter}
                style={{ fillColor: colors.bathroomFill, fillOpacity: 1 }}
              />
              <Mapbox.LineLayer
                id="bathroom-outline"
                filter={bathroomFilter}
                style={{ lineColor: colors.bathroomLine, lineWidth: 1 }}
              />
              <Mapbox.SymbolLayer
                id="bathroom-icon"
                filter={bathroomFilter}
                minZoomLevel={17.5}
                style={{
                  textField: 'WC',
                  textFont: ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
                  textSize: ['interpolate', ['linear'], ['zoom'], 17.5, 10, 21, 15] as any,
                  textColor: colors.white,
                  textHaloColor: colors.bathroomLine,
                  textHaloWidth: 2,
                  textAllowOverlap: false,
                  textIgnorePlacement: false,
                }}
              />
              <Mapbox.SymbolLayer
                id="floor-plan-labels"
                filter={floorFilter}
                minZoomLevel={17.5}
                style={{
                  textField: roomLabelExpr,
                  // Grows with zoom rather than sitting at a flat 9: the rooms
                  // get bigger as you zoom in and the labels used to stay put,
                  // ending up tiny inside a large floor plan. It starts near
                  // the old size so the 17.5 view gains no new label
                  // collisions — `textAllowOverlap` is false, so larger text
                  // means Mapbox drops more of them — and earns its size
                  // higher up, where there is room to spare.
                  textSize: ['interpolate', ['linear'], ['zoom'], 17.5, 10, 21, 19] as any,
                  textColor: colors.ink,
                  textHaloColor: colors.white,
                  textHaloWidth: 1,
                  textFont: ['DIN Offc Pro Regular', 'Arial Unicode MS Regular'],
                  textAllowOverlap: false,
                  textMaxWidth: 4,
                }}
              />
              <Mapbox.FillLayer
                id="selected-room-fill"
                filter={roomFilter}
                style={{ fillColor: colors.burntOrange, fillOpacity: 0.9, fillOutlineColor: colors.burntOrangeDark }}
              />
              <Mapbox.LineLayer
                id="selected-room-outline"
                filter={roomFilter}
                style={{ lineColor: colors.burntOrangeDark, lineWidth: 2 }}
              />
              <Mapbox.SymbolLayer
                id="selected-room-label"
                filter={roomFilter}
                style={{
                  textField: roomLabelExpr,
                  // Tracks the floor-plan labels but stays above them, so the
                  // room you actually picked never ends up smaller than the
                  // ones around it.
                  textSize: ['interpolate', ['linear'], ['zoom'], 17.5, 13, 21, 20] as any,
                  textColor: colors.white,
                  textFont: ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
                  textHaloColor: colors.burntOrangeDark,
                  textHaloWidth: 0.5,
                  textAllowOverlap: true,
                  textIgnorePlacement: true,
                }}
              />
            </Mapbox.ShapeSource>
          )}

          {/* Above the floor plan so a room label never hides the way up.
              Shown whenever the floor plan is. Out to zoom 18 it behaves like
              part of the plan — halving with every zoom level, base 2, so it
              keeps its footprint on the building the way a room does. Closer
              in it holds at full size instead of blowing up with the plan. */}
          {elevatorShape && (
            <Mapbox.ShapeSource
              id="elevators"
              shape={elevatorShape}
              onPress={(e) => {
                const hit = e.features[0]?.geometry;
                if (hit?.type === 'Point') showElevatorTip(hit.coordinates as LngLat);
              }}
            >
              <Mapbox.SymbolLayer
                id="elevator-icon"
                style={{
                  iconImage: 'elevator',
                  iconSize: ['interpolate', ['exponential', 2], ['zoom'], 10, 1 / 256, 18, 1] as any,
                  iconAllowOverlap: true,
                }}
              />
            </Mapbox.ShapeSource>
          )}

          {elevatorShape && elevatorTip && (
            <Mapbox.ShapeSource
              id="elevator-tip"
              shape={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: elevatorTip } }}
            >
              <Mapbox.SymbolLayer
                id="elevator-tip-label"
                style={{
                  textField: 'Elevators',
                  textFont: ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
                  textSize: 13,
                  textColor: colors.white,
                  textHaloColor: '#404040',
                  textHaloWidth: 2,
                  // Above the icon, clear of it at the largest icon size.
                  textAnchor: 'bottom',
                  textOffset: [0, -1.6],
                  textAllowOverlap: true,
                  textIgnorePlacement: true,
                }}
              />
            </Mapbox.ShapeSource>
          )}

          <Mapbox.ShapeSource id="building-labels" shape={labels}>
            <Mapbox.SymbolLayer
              id="building-abbr"
              minZoomLevel={15}
              style={{
                textField: ['get', 'abbr'],
                textSize: 11,
                textColor: colors.burntOrangeDark,
                textHaloColor: colors.white,
                textHaloWidth: 1.5,
                textFont: ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
                textAnchor: 'center',
                textAllowOverlap: false,
              }}
            />
          </Mapbox.ShapeSource>

          {route && !navigateMode && (
            <Mapbox.ShapeSource id="route" shape={route}>
              <Mapbox.LineLayer
                id="route-line"
                style={{
                  lineColor: colors.blueBonnet,
                  lineWidth: 4,
                  lineOpacity: 0.85,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </Mapbox.ShapeSource>
          )}
          {navigateMode && navRoute && (
            <Mapbox.ShapeSource id="route-remaining" shape={navRoute}>
              {/* White casing so the line reads against the basemap. No
                  `aboveLayerID`: with the extrusions gone there is nothing left
                  to climb over, and an unanchored layer goes on top of the
                  style, which is where a route belongs. The rest of the route
                  chains off this one. */}
              <Mapbox.LineLayer
                id="route-remaining-casing"
                style={{
                  lineColor: colors.white,
                  lineWidth: ['interpolate', ['linear'], ['zoom'], 15, 8, 19, 15] as any,
                  lineOpacity: 0.7,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              <Mapbox.LineLayer
                id="route-remaining-line"
                aboveLayerID="route-remaining-casing"
                style={{
                  lineColor: colors.blueBonnet,
                  // Wider at nav zoom — the tilted camera views it at a grazing angle.
                  lineWidth: ['interpolate', ['linear'], ['zoom'], 15, 4, 19, 9] as any,
                  lineOpacity: 0.95,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </Mapbox.ShapeSource>
          )}
          {/* The portion already behind the puck. Only ever set alongside
              `remainingRoute`, so its anchor layer is always mounted. */}
          {navigateMode && walkedRoute && (
            <Mapbox.ShapeSource id="route-walked" shape={walkedRoute}>
              <Mapbox.LineLayer
                id="route-walked-line"
                aboveLayerID="route-remaining-line"
                style={{
                  lineColor: colors.blueBonnet,
                  lineWidth: ['interpolate', ['linear'], ['zoom'], 15, 3, 19, 7] as any,
                  lineOpacity: 0.4,
                  lineCap: 'butt',
                  lineJoin: 'round',
                  lineDasharray: [2, 2],
                }}
              />
            </Mapbox.ShapeSource>
          )}
          {navigateMode && finalHop && (
            <Mapbox.ShapeSource id="route-final-hop" shape={finalHop}>
              <Mapbox.LineLayer
                id="route-final-hop-line"
                aboveLayerID="route-remaining-line"
                style={{
                  lineColor: colors.burntOrange,
                  lineWidth: ['interpolate', ['linear'], ['zoom'], 15, 2.5, 19, 5] as any,
                  lineOpacity: 0.95,
                  lineCap: 'round',
                  lineJoin: 'round',
                  lineDasharray: [1.5, 1.5],
                }}
              />
            </Mapbox.ShapeSource>
          )}
          {/* The selected room, marked in screen space. The polygon underneath
              is already burnt orange, but a room is a few metres across — by
              campus zoom it is gone entirely, which is what made a selection
              impossible to find after zooming out.

              Shown in navigate mode too, replacing the flat destination dot
              that used to live here, so the destination looks the same before
              and during the walk. */}
          {selectedRoom && (
            <Mapbox.ShapeSource
              id="room-marker"
              shape={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: selectedRoom.center } }}
            >
              <Mapbox.SymbolLayer
                id="room-marker-pin"
                style={{
                  iconImage: 'room-pin',
                  // The tip is the point being marked, not the middle.
                  iconAnchor: 'bottom',
                  // Eases off as the floor plan takes over: close in, the
                  // polygon says where the room is and a full-size pin just
                  // covers it.
                  iconSize: ['interpolate', ['linear'], ['zoom'], 15, 1, 19, 0.72] as any,
                  // Never let label collision drop the one thing the user asked
                  // to see.
                  iconAllowOverlap: true,
                  iconIgnorePlacement: true,
                }}
              />
            </Mapbox.ShapeSource>
          )}

          <Mapbox.UserLocation
            visible
            showsUserHeadingIndicator
            androidRenderMode="compass"
            onUpdate={(loc) => {
              const coords: [number, number] = [loc.coords.longitude, loc.coords.latitude];
              userCoordsRef.current = coords;
              // Radius of uncertainty, in metres. Routing, rerouting and
              // arrival are all judged against it; ignoring it meant a 500m
              // fix was trusted exactly as much as a 5m one.
              accuracyRef.current = loc.coords.accuracy ?? null;
              // Only on a band change — this reaches the screen, and firing it
              // on every tick would re-render the whole UI for nothing.
              const quality = fixQuality(accuracyRef.current);
              if (quality !== fixQualityRef.current) {
                fixQualityRef.current = quality;
                onFixQualityChangeRef.current?.(quality);
              }
              if (!hasFix) setHasFix(true);
              // Report the *effective* origin, so the nav bar and arrival check
              // agree with whatever the route was actually drawn from.
              onUserLocationRef.current?.(debugOriginRef.current ?? coords);

              if (navigateModeRef.current) {
                const raw = loc.coords.heading ?? loc.coords.course ?? 0;
                const smoothed = smoothHeading(smoothedHeadingRef.current, raw);
                smoothedHeadingRef.current = smoothed;
                const heading = Math.round(smoothed);
                setUserHeading((prev) => (prev === heading ? prev : heading));
                // The map turns only on a real turn — see src/map/heading.ts.
                setCameraHeading((prev) =>
                  shouldTurnCamera(prev, smoothed) ? smoothed : prev,
                );
                // With a simulated origin the device is nowhere near the route,
                // so splitting it at the real position would erase the line.
                if (!debugOriginRef.current) {
                  // splitRouteAtUser has no segment to project onto below two
                  // points, and would hand back an undefined coordinate.
                  const routeCoords = (routeRef.current?.geometry.coordinates ?? []) as [number, number][];
                  if (routeCoords.length >= 2) {
                    const { walked, remaining } = splitRouteAtUser(routeCoords, coords);
                    setWalkedRoute({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: walked } });
                    setRemainingRoute({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: remaining } });
                    // `remaining[0]` is the closest point on the line, so this is
                    // the perpendicular distance from the route.
                    maybeReroute(coords, haversine(coords, remaining[0]));
                  }
                  reportNavProgress(coords);
                }
              }
            }}
          >
            {navigateMode ? (
              // Google-Maps-style chevron, glued flat to the map so it stays on
              // the route line at 60° pitch. Outside nav mode `undefined` falls
              // back to Mapbox's default dot.
              <Mapbox.SymbolLayer
                id="nav-user-puck"
                style={{
                  iconImage: 'nav-arrow',
                  iconSize: 0.85,
                  iconRotate: userHeading,
                  iconRotationAlignment: 'map',
                  iconPitchAlignment: 'map',
                  iconAllowOverlap: true,
                  iconIgnorePlacement: true,
                }}
              />
            ) : undefined}
          </Mapbox.UserLocation>
        </Mapbox.MapView>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSubtle },
  placeholderText: { color: colors.slate, paddingHorizontal: 24, textAlign: 'center' },
});
