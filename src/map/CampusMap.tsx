import Mapbox from '@rnmapbox/maps';
import Constants from 'expo-constants';
import { Asset } from 'expo-asset';
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { BUILDINGS } from '../data/buildings';
import type { Building, RoomMatch } from '../data/types';
import { colors } from '../theme';

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
}

export const CampusMap = forwardRef<CampusMapHandle, Props>(
  function CampusMap({ selectedRoom, selectedBuilding, selectedFloor, cameraRef, onUserLocation, onHeadingChange, onBuildingPress }, ref) {
    const mapRef = useRef<Mapbox.MapView>(null);
    const [geojsonUri, setGeojsonUri] = useState<string | null>(null);
    const [buildingsUri, setBuildingsUri] = useState<string | null>(null);
    const hasHadSelection = useRef(false);
    const userCoordsRef = useRef<[number, number] | null>(null);

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
            <Mapbox.ShapeSource id="all-rooms" url={geojsonUri}>
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

          <Mapbox.UserLocation
            visible
            androidRenderMode="normal"
            onUpdate={(loc) => {
              const coords: [number, number] = [loc.coords.longitude, loc.coords.latitude];
              userCoordsRef.current = coords;
              onUserLocation?.(coords);
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
