import Mapbox, { UserTrackingMode } from '@rnmapbox/maps';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { Asset } from 'expo-asset';
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { BUILDINGS } from '../data/buildings';
import type { Building, LngLat, RoomMatch } from '../data/types';
import { colors } from '../theme';
import { frameFootprint } from './framing';
import { haversine, type RouteState } from './routeState';
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
}

/** Where the user is walking next, for the nav bar's arrow and arrival card. */
export interface NavProgress {
  /** Bearing of the route segment ahead, or null when there's no route. */
  bearing: number | null;
  /** Straight-line metres to the destination, or null when unknown. */
  distanceToDestination: number | null;
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
// Navigate mode: puck sits low on screen so the route ahead fills the view.
const NAV_PADDING  = { paddingTop: 0, paddingLeft: 0, paddingRight: 0, paddingBottom: Dimensions.get('window').height * 0.35 };
const NAV_PITCH = 60;
const NAV_ZOOM = 18;
const ROOM_ZOOM = 19;
// Building state is framed to the footprint, but never outside this range:
// 17.5 is where the floor-plan room labels switch on (see `floor-plan-labels`),
// and past 19 a small building's floor plan is unreadably large.
const BUILDING_MIN_ZOOM = 17.5;
const BUILDING_MAX_ZOOM = 19.0;
// Breathing room between the footprint and the edge of the framed area.
const FRAME_INSET = 28;

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
   * Simulated origin for walking directions. Null in production — see src/debug.ts.
   * When set, routes originate here instead of live GPS and the follow camera is
   * driven manually, because the real device is somewhere else entirely.
   */
  debugOrigin?: LngLat | null;
}

export const CampusMap = forwardRef<CampusMapHandle, Props>(
  function CampusMap({ selectedRoom, selectedBuilding, selectedFloor, cameraRef, onUserLocation, onHeadingChange, onBuildingPress, onRoomPress, onRouteState, onNavProgress, onFollowStateChange, navigateMode, debugOrigin = null }, ref) {
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
    const hasHadSelection = useRef(false);
    /** Live GPS only. The effective route origin is `debugOrigin ?? this`. */
    const userCoordsRef = useRef<[number, number] | null>(null);
    const navigateModeRef = useRef(navigateMode);
    useEffect(() => { navigateModeRef.current = navigateMode; }, [navigateMode]);
    const selectedRoomRef = useRef(selectedRoom);
    useEffect(() => { selectedRoomRef.current = selectedRoom; }, [selectedRoom]);
    const debugOriginRef = useRef(debugOrigin);
    useEffect(() => { debugOriginRef.current = debugOrigin; }, [debugOrigin]);

    const onRouteStateRef = useRef(onRouteState);
    useEffect(() => { onRouteStateRef.current = onRouteState; });
    const onNavProgressRef = useRef(onNavProgress);
    useEffect(() => { onNavProgressRef.current = onNavProgress; });
    const onUserLocationRef = useRef(onUserLocation);
    useEffect(() => { onUserLocationRef.current = onUserLocation; });

    /** Origin for routing and for the nav bar: simulated if set, else live GPS. */
    const currentOrigin = (): [number, number] | null =>
      debugOriginRef.current ?? userCoordsRef.current;

    // Changes exactly when the origin should be re-read, so a route requested
    // before the first GPS fix is retried the moment one lands.
    const originKey = debugOrigin
      ? `debug:${debugOrigin[0]},${debugOrigin[1]}`
      : hasFix ? 'gps' : 'none';

    const { route, state: routeState } = useWalkingRoute({
      destination: selectedRoom?.center ?? null,
      getOrigin: currentOrigin,
      originKey,
      permissionDenied: permission === 'denied',
      accessToken: token,
    });
    useEffect(() => { onRouteStateRef.current?.(routeState); }, [routeState]);
    const routeRef = useRef(route);
    useEffect(() => { routeRef.current = route; }, [route]);

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
      centerOnUser: () => {
        setDisengaged(false);
        const origin = currentOrigin();
        if (origin) {
          cameraRef.current?.setCamera({
            centerCoordinate: origin,
            zoomLevel: navigateModeRef.current ? NAV_ZOOM : 17,
            ...(navigateModeRef.current ? { pitch: NAV_PITCH, padding: NAV_PADDING } : {}),
            animationDuration: 400,
            animationMode: 'flyTo',
          });
        }
      },
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

    /** Push the bearing to walk and the distance remaining up to the nav bar. */
    const reportNavProgress = (coords: [number, number]) => {
      const room = selectedRoomRef.current;
      if (!room) {
        onNavProgressRef.current?.({ bearing: null, distanceToDestination: null });
        return;
      }
      const current = routeRef.current;
      let bearing: number | null = null;
      if (current) {
        const routeCoords = current.geometry.coordinates as [number, number][];
        const { remaining } = splitRouteAtUser(routeCoords, coords);
        // The segment ahead, not the crow-flies bearing — the route goes around
        // buildings, and an arrow pointing through one is worse than useless.
        if (remaining.length >= 2) bearing = segmentBearing(remaining[0], remaining[1]);
      }
      if (bearing === null) bearing = segmentBearing(coords, room.center);
      onNavProgressRef.current?.({
        bearing,
        distanceToDestination: haversine(coords, room.center),
      });
    };

    useEffect(() => {
      if (!navigateMode) {
        onNavProgressRef.current?.({ bearing: null, distanceToDestination: null });
        return;
      }
      const origin = currentOrigin();
      if (origin) reportNavProgress(origin);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigateMode, route, selectedRoom, debugOrigin, hasFix]);

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
              cameraRef.current?.setCamera(roomCamera(room, 600));
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
      if (selectedRoom) {
        hasHadSelection.current = true;
        cameraRef.current?.setCamera(roomCamera(selectedRoom, 400));
      } else if (selectedBuilding) {
        hasHadSelection.current = true;
        cameraRef.current?.setCamera(buildingCamera(selectedBuilding, 400));
      } else if (hasHadSelection.current) {
        mapRef.current?.getZoom().then((zoom) => {
          if (zoom != null) cameraRef.current?.setCamera({
            zoomLevel: zoom - 1.5,
            animationDuration: 400,
            padding: NO_PADDING,
          });
        });
      }
    }, [selectedRoom, selectedBuilding, cameraRef]);

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
            followUserMode={UserTrackingMode.FollowWithCourse}
            followPitch={NAV_PITCH}
            followZoomLevel={NAV_ZOOM}
            followPadding={NAV_PADDING}
          />

          <Mapbox.Images images={{ 'nav-arrow': require('../../assets/Visuals/nav-arrow.png') }} />

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
                  // Hidden during navigation — the 3D extrusions replace them.
                  fillOpacity: navigateMode ? 0 : ['case', ['==', ['get', 'Building'], activeBldgNo ?? '__none__'], 1, 0.7] as any,
                }}
              />
              <Mapbox.LineLayer
                id="building-outline"
                aboveLayerID="building"
                style={{
                  lineColor: ['case', ['==', ['get', 'Building'], activeBldgNo ?? '__none__'], colors.burntOrange, colors.blueBonnet] as any,
                  lineWidth: ['case', ['==', ['get', 'Building'], activeBldgNo ?? '__none__'], 2.5, 1] as any,
                  lineOpacity: navigateMode ? 0 : 0.9,
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
                  textSize: 10,
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
                  textSize: 9,
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
                  textSize: 13,
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
          {/* Navigate mode — 3D building extrusions from the style's own
              (OSM-derived) building footprints, citywide. Declared before the
              route layers so they can anchor above it with `aboveLayerID`:
              at 60° pitch an extrusion will otherwise swallow the route line. */}
          {navigateMode && (
            <Mapbox.FillExtrusionLayer
              id="buildings-3d"
              sourceID="composite"
              sourceLayerID="building"
              filter={['==', ['get', 'extrude'], 'true']}
              minZoomLevel={15}
              maxZoomLevel={22}
              style={{
                fillExtrusionHeight: ['get', 'height'] as any,
                fillExtrusionBase: ['get', 'min_height'] as any,
                fillExtrusionColor: colors.limestone,
                fillExtrusionOpacity: 0.75,
              }}
            />
          )}

          {navigateMode && navRoute && (
            <Mapbox.ShapeSource id="route-remaining" shape={navRoute}>
              {/* White casing so the line reads against both the limestone
                  extrusions and the light basemap. */}
              <Mapbox.LineLayer
                id="route-remaining-casing"
                aboveLayerID="buildings-3d"
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
          {navigateMode && selectedRoom && (
            <Mapbox.ShapeSource
              id="nav-destination"
              shape={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: selectedRoom.center } }}
            >
              <Mapbox.CircleLayer
                id="nav-destination-dot"
                style={{
                  circleRadius: 8,
                  circleColor: colors.burntOrange,
                  circleStrokeColor: colors.white,
                  circleStrokeWidth: 2.5,
                  circlePitchAlignment: 'map',
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
              if (!hasFix) setHasFix(true);
              // Report the *effective* origin, so the nav bar and arrival check
              // agree with whatever the route was actually drawn from.
              onUserLocationRef.current?.(debugOriginRef.current ?? coords);

              if (navigateModeRef.current) {
                const heading = Math.round(loc.coords.heading ?? loc.coords.course ?? 0);
                setUserHeading((prev) => (prev === heading ? prev : heading));
                // With a simulated origin the device is nowhere near the route,
                // so splitting it at the real position would erase the line.
                if (!debugOriginRef.current) {
                  if (routeRef.current) {
                    const routeCoords = routeRef.current.geometry.coordinates as [number, number][];
                    const { walked, remaining } = splitRouteAtUser(routeCoords, coords);
                    setWalkedRoute({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: walked } });
                    setRemainingRoute({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: remaining } });
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
