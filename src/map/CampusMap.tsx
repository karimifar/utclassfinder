import Mapbox from '@rnmapbox/maps';
import Constants from 'expo-constants';
import { Asset } from 'expo-asset';
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { BUILDINGS } from '../data/buildings';
import type { Building, RoomMatch } from '../data/types';
import { colors } from '../theme';

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

// 200-mile radius around Austin — hard limit on how far the user can pan.
const MAX_BOUNDS = {
  ne: [-94.3871, 33.1658] as [number, number],
  sw: [-101.0991, 27.3686] as [number, number],
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

interface Props {
  selectedRoom?: RoomMatch | null;
  selectedBuilding?: Building | null;
  selectedFloor?: string | null;
  cameraRef: React.RefObject<Mapbox.Camera | null>;
  onUserLocation?: (coords: [number, number]) => void;
  onHeadingChange?: (heading: number) => void;
  onBuildingPress?: (buildingId: string) => void;
  onRoomPress?: (roomId: string) => void;
  onRouteInfo?: (info: { distance: number; duration: number } | null) => void;
  navigateMode?: boolean;
}

export const CampusMap = forwardRef<CampusMapHandle, Props>(
  function CampusMap({ selectedRoom, selectedBuilding, selectedFloor, cameraRef, onUserLocation, onHeadingChange, onBuildingPress, onRoomPress, onRouteInfo, navigateMode }, ref) {
    const mapRef = useRef<Mapbox.MapView>(null);
    const [geojsonUri, setGeojsonUri] = useState<string | null>(null);
    const [buildingsUri, setBuildingsUri] = useState<string | null>(null);
    const [route, setRoute] = useState<GeoJSON.Feature<GeoJSON.LineString> | null>(null);
    const [walkedRoute, setWalkedRoute] = useState<GeoJSON.Feature<GeoJSON.LineString> | null>(null);
    const [remainingRoute, setRemainingRoute] = useState<GeoJSON.Feature<GeoJSON.LineString> | null>(null);
    // On the iOS simulator, GPS always reports San Francisco. Seed a campus coordinate so routes work during dev.
    // On a real device we always use actual GPS, so the seed is skipped.
    const isSimulator = __DEV__ && !Constants.isDevice;
    const [hasLocation, setHasLocation] = useState(isSimulator);
    const hasHadSelection = useRef(false);
    const userCoordsRef = useRef<[number, number] | null>(isSimulator ? [-97.7335, 30.2849] : null);
    const onRouteInfoRef = useRef(onRouteInfo);
    useEffect(() => { onRouteInfoRef.current = onRouteInfo; });
    const navigateModeRef = useRef(navigateMode);
    useEffect(() => { navigateModeRef.current = navigateMode; }, [navigateMode]);
    const routeRef = useRef(route);
    useEffect(() => { routeRef.current = route; }, [route]);

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
        if (userCoordsRef.current) {
          cameraRef.current?.setCamera({
            centerCoordinate: userCoordsRef.current,
            zoomLevel: 17,
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

    useEffect(() => {
      if (navigateMode && route) {
        const coords = route.geometry.coordinates as [number, number][];
        const lngs = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        const ne: [number, number] = [Math.max(...lngs), Math.max(...lats)];
        const sw: [number, number] = [Math.min(...lngs), Math.min(...lats)];
        cameraRef.current?.fitBounds(ne, sw, [100, 80, 240, 80], 600);
        setRemainingRoute({ type: 'Feature', properties: {}, geometry: route.geometry });
        setWalkedRoute(null);
      } else if (!navigateMode) {
        setWalkedRoute(null);
        setRemainingRoute(null);
      }
    }, [navigateMode, route, cameraRef]);

    useEffect(() => {
      if (!selectedRoom || !token) {
        setRoute(null);
        onRouteInfoRef.current?.(null);
        return;
      }
      const origin = userCoordsRef.current;
      if (!origin) return;

      const controller = new AbortController();
      const [dLng, dLat] = selectedRoom.center;
      const [oLng, oLat] = origin;
      fetch(
        `https://api.mapbox.com/directions/v5/mapbox/walking/${oLng},${oLat};${dLng},${dLat}?geometries=geojson&access_token=${token}`,
        { signal: controller.signal },
      )
        .then((r) => r.json())
        .then((data) => {
          const leg = data.routes?.[0];
          if (!leg) return;
          setRoute({ type: 'Feature', properties: {}, geometry: leg.geometry });
          onRouteInfoRef.current?.({ distance: leg.distance, duration: leg.duration });
        })
        .catch(() => {});
      return () => controller.abort();
    }, [selectedRoom, hasLocation]);

    useEffect(() => {
      if (selectedRoom) {
        hasHadSelection.current = true;
        cameraRef.current?.setCamera({
          centerCoordinate: selectedRoom.center,
          zoomLevel: 19,
          animationDuration: 400,
          animationMode: 'flyTo',
          padding: FOCUS_PADDING,
        });
      } else if (selectedBuilding) {
        hasHadSelection.current = true;
        cameraRef.current?.setCamera({
          centerCoordinate: selectedBuilding.center,
          zoomLevel: 17,
          animationDuration: 400,
          animationMode: 'flyTo',
          padding: FOCUS_PADDING,
        });
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
          onCameraChanged={(state) => onHeadingChange?.(state.properties.heading ?? 0)}
        >
          <Mapbox.Camera ref={cameraRef} bounds={CAMPUS_BOUNDS} animationDuration={0} maxBounds={MAX_BOUNDS} minZoomLevel={7} />

          {buildingsUri && (
            <Mapbox.ShapeSource
              id="campus-buildings"
              url={buildingsUri}
              onPress={async (e) => {
                const zoom = await mapRef.current?.getZoom();
                console.log('[CampusMap] building tap zoom:', zoom?.toFixed(2));
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
          {navigateMode && remainingRoute && (
            <Mapbox.ShapeSource id="route-remaining" shape={remainingRoute}>
              <Mapbox.LineLayer
                id="route-remaining-line"
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
          {navigateMode && walkedRoute && (
            <Mapbox.ShapeSource id="route-walked" shape={walkedRoute}>
              <Mapbox.LineLayer
                id="route-walked-line"
                style={{
                  lineColor: colors.blueBonnet,
                  lineWidth: 4,
                  lineOpacity: 0.4,
                  lineCap: 'butt',
                  lineJoin: 'round',
                  lineDasharray: [2, 2],
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
              if (!isSimulator) {
                userCoordsRef.current = coords;
                setHasLocation(true);
              }
              onUserLocation?.(coords);
              if (navigateModeRef.current && routeRef.current && !isSimulator) {
                const routeCoords = routeRef.current.geometry.coordinates as [number, number][];
                const { walked, remaining } = splitRouteAtUser(routeCoords, coords);
                setWalkedRoute({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: walked } });
                setRemainingRoute({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: remaining } });
              }
            }}
          />
        </Mapbox.MapView>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSubtle },
  placeholderText: { color: colors.slate, paddingHorizontal: 24, textAlign: 'center' },
});
