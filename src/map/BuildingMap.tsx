import Mapbox from '@rnmapbox/maps';
import Constants from 'expo-constants';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Building } from '../data/types';
import { colors, radius } from '../theme';

const token = Constants.expoConfig?.extra?.mapboxAccessToken as string | undefined;
if (token) Mapbox.setAccessToken(token);

/** GeoJSON Polygon for the building footprint highlight. */
function footprintShape(building: Building): GeoJSON.Feature<GeoJSON.Polygon> {
  const ring = building.footprint.slice();
  if (ring.length && ring[0].join() !== ring[ring.length - 1].join()) {
    ring.push(ring[0]); // close the ring
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

export function BuildingMap({ building }: { building: Building }) {
  useEffect(() => {
    Mapbox.setTelemetryEnabled(false);
  }, []);

  if (!token) {
    return (
      <View style={[styles.map, styles.placeholder]}>
        <Text style={styles.placeholderText}>
          Map unavailable — set MAPBOX_ACCESS_TOKEN in .env
        </Text>
      </View>
    );
  }

  return (
    <Mapbox.MapView style={styles.map} styleURL={Mapbox.StyleURL.Street} scaleBarEnabled={false}>
      <Mapbox.Camera
        defaultSettings={{ centerCoordinate: building.center, zoomLevel: 17 }}
        animationDuration={0}
      />

      <Mapbox.ShapeSource id="footprint" shape={footprintShape(building)}>
        <Mapbox.FillLayer
          id="footprint-fill"
          style={{ fillColor: colors.highlightFill, fillOutlineColor: colors.highlightLine }}
        />
        <Mapbox.LineLayer
          id="footprint-line"
          style={{ lineColor: colors.highlightLine, lineWidth: 2.5 }}
        />
      </Mapbox.ShapeSource>

      <Mapbox.PointAnnotation id="center" coordinate={building.center}>
        <View style={styles.pin} />
      </Mapbox.PointAnnotation>

      <Mapbox.UserLocation visible androidRenderMode="normal" />
    </Mapbox.MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1, borderRadius: radius.md, overflow: 'hidden' },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSubtle },
  placeholderText: { color: colors.slate, paddingHorizontal: 24, textAlign: 'center' },
  pin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.burntOrange,
    borderWidth: 3,
    borderColor: colors.white,
  },
});
