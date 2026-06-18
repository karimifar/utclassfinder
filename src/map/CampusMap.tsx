import Mapbox from '@rnmapbox/maps';
import Constants from 'expo-constants';
import { Asset } from 'expo-asset';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BUILDINGS } from '../data/buildings';
import type { Building, RoomMatch } from '../data/types';
import { colors, radius, spacing } from '../theme';

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

// Labels only — point per building center, from buildings.json
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

interface Props {
  selectedRoom?: RoomMatch | null;
  selectedBuilding?: Building | null;
  cameraRef: React.RefObject<Mapbox.Camera | null>;
}

export function CampusMap({ selectedRoom, selectedBuilding, cameraRef }: Props) {
  const mapRef = useRef<Mapbox.MapView>(null);
  const [geojsonUri, setGeojsonUri] = useState<string | null>(null);
  const [buildingsUri, setBuildingsUri] = useState<string | null>(null);
  const hasHadSelection = useRef(false);

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
      });
    } else if (selectedBuilding) {
      hasHadSelection.current = true;
      cameraRef.current?.setCamera({
        centerCoordinate: selectedBuilding.center,
        zoomLevel: 17,
        animationDuration: 400,
        animationMode: 'flyTo',
      });
    } else if (hasHadSelection.current) {
      cameraRef.current?.fitBounds(
        CAMPUS_BOUNDS.ne,
        CAMPUS_BOUNDS.sw,
        [CAMPUS_BOUNDS.paddingTop, CAMPUS_BOUNDS.paddingRight, CAMPUS_BOUNDS.paddingBottom, CAMPUS_BOUNDS.paddingLeft],
        400,
      );
    }
  }, [selectedRoom, selectedBuilding, cameraRef]);

  const labels = useMemo(() => buildingLabels(), []);

  const zoomIn = useCallback(async () => {
    const zoom = await mapRef.current?.getZoom();
    if (zoom != null) cameraRef.current?.zoomTo(zoom + 1, 200);
  }, [cameraRef]);

  const zoomOut = useCallback(async () => {
    const zoom = await mapRef.current?.getZoom();
    if (zoom != null) cameraRef.current?.zoomTo(zoom - 1, 200);
  }, [cameraRef]);

  if (!token) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
        <Text style={styles.placeholderText}>
          Map unavailable — set MAPBOX_ACCESS_TOKEN in .env
        </Text>
      </View>
    );
  }

  const highlightRoomId = selectedRoom?.roomId ?? null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Mapbox.MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        styleURL={Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
      >
        <Mapbox.Camera ref={cameraRef} bounds={CAMPUS_BOUNDS} animationDuration={0} />

        {/* Building footprints — anchored above the base "building" layer so they sit
            below all road and label layers in the Light style */}
        {buildingsUri && (
          <Mapbox.ShapeSource id="campus-buildings" url={buildingsUri}>
            {/* Only the first layer uses aboveLayerID to anchor against the base map.
                Siblings stack naturally bottom-to-top in child order. */}
            <Mapbox.FillLayer
              id="building-fill"
              aboveLayerID="building"
              style={{ fillColor: colors.bgSubtle, fillOpacity: 0.7 }}
            />
            <Mapbox.LineLayer
              id="building-outline"
              style={{ lineColor: colors.mist, lineWidth: 1, lineOpacity: 0.6 }}
            />
            <Mapbox.FillLayer
              id="building-selected-fill"
              filter={selectedBuilding
                ? ['==', ['get', 'Building'], selectedBuilding.id]
                : ['==', ['get', 'Building'], '__none__']}
              style={{ fillColor: colors.burntOrange, fillOpacity: 0.1 }}
            />
            <Mapbox.LineLayer
              id="building-selected-outline"
              filter={selectedBuilding
                ? ['==', ['get', 'Building'], selectedBuilding.id]
                : ['==', ['get', 'Building'], '__none__']}
              style={{ lineColor: colors.burntOrange, lineWidth: 2.5, lineOpacity: 0.9 }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* ShapeSource always mounted so GeoJSON is pre-loaded; fill filter matches nothing until a room is selected */}
        {geojsonUri && (
          <Mapbox.ShapeSource id="all-rooms" url={geojsonUri}>
            <Mapbox.FillLayer
              id="selected-room-fill"
              filter={highlightRoomId
                ? ['==', ['get', 'room_id'], highlightRoomId]
                : ['==', ['get', 'room_id'], '__none__']}
              style={{ fillColor: colors.burntOrange, fillOpacity: 0.85, fillOutlineColor: colors.burntOrangeDark }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Building abbreviation labels */}
        <Mapbox.ShapeSource id="building-labels" shape={labels}>
          <Mapbox.SymbolLayer
            id="building-abbr"
            minZoomLevel={14}
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

        {/* Room label — MarkerView has no 1-subview restriction unlike PointAnnotation */}
        {selectedRoom && (
          <Mapbox.MarkerView
            key={selectedRoom.roomId}
            id="room-pin"
            coordinate={selectedRoom.center}
          >
            <View style={styles.roomPin}>
              <Text style={styles.roomPinText}>
                {`${selectedRoom.building.abbr} ${selectedRoom.roomNumber}`}
              </Text>
            </View>
          </Mapbox.MarkerView>
        )}

        <Mapbox.UserLocation visible androidRenderMode="normal" />
      </Mapbox.MapView>

      {/* Zoom controls */}
      <View style={styles.zoomControls}>
        <Pressable style={styles.zoomBtn} onPress={zoomIn}>
          <Text style={styles.zoomBtnText}>+</Text>
        </Pressable>
        <View style={styles.zoomDivider} />
        <Pressable style={styles.zoomBtn} onPress={zoomOut}>
          <Text style={styles.zoomBtnText}>−</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSubtle },
  placeholderText: { color: colors.slate, paddingHorizontal: 24, textAlign: 'center' },
  roomPin: {
    backgroundColor: colors.burntOrange,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 2,
    borderColor: colors.white,
    // PointAnnotation requires explicit dimensions
    minWidth: 40,
    alignItems: 'center',
  },
  roomPinText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  zoomControls: {
    position: 'absolute',
    bottom: 100,
    right: spacing.md,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  zoomBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomBtnText: { fontSize: 22, color: colors.ink, lineHeight: 26 },
  zoomDivider: { height: 1, backgroundColor: colors.line },
});
