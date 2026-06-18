import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getBuildingById } from '../../src/data/buildings';
import { openDirections } from '../../src/directions';
import { BuildingMap } from '../../src/map/BuildingMap';
import { colors, radius, spacing } from '../../src/theme';

export default function BuildingResult() {
  const { id, room } = useLocalSearchParams<{ id: string; room?: string }>();
  const building = getBuildingById(id);

  if (!building) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.missing}>Building not found.</Text>
      </SafeAreaView>
    );
  }

  const name = titleCase(building.name);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: building.abbr ?? 'Result' }} />

      <View style={styles.header}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{building.abbr ?? '?'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.meta}>
            {building.floors.length} floor{building.floors.length === 1 ? '' : 's'}
            {room ? ` · you searched room ${room}` : ''}
          </Text>
        </View>
      </View>

      {room ? (
        <Text style={styles.notice}>
          Room-level location isn’t in the dataset yet — directions go to the
          building. Once inside, head to floor {leadingFloor(room)}.
        </Text>
      ) : null}

      <View style={styles.mapWrap}>
        <BuildingMap building={building} />
      </View>

      <SafeAreaView edges={['bottom']} style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          onPress={() => openDirections(building)}
        >
          <Text style={styles.ctaText}>Get Directions</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

/** "2.216" -> "2"; best-effort floor hint from a typed room token. */
function leadingFloor(room: string): string {
  const m = room.match(/^(\d+)/);
  return m ? m[1] : '—';
}

function titleCase(s: string | null): string {
  if (!s) return 'Unknown building';
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  missing: { color: colors.slate, fontSize: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  badge: {
    minWidth: 60,
    paddingHorizontal: spacing.sm,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.burntOrange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.white, fontWeight: '800', fontSize: 16 },
  name: { fontSize: 18, fontWeight: '700', color: colors.ink },
  meta: { marginTop: 2, fontSize: 14, color: colors.slate },
  notice: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.bgSubtle,
    borderRadius: radius.sm,
    color: colors.slate,
    fontSize: 14,
    lineHeight: 20,
  },
  mapWrap: { flex: 1, margin: spacing.md, marginTop: 0 },
  actions: { paddingHorizontal: spacing.md },
  cta: {
    backgroundColor: colors.burntOrange,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  ctaPressed: { backgroundColor: colors.burntOrangeDark },
  ctaText: { color: colors.white, fontSize: 17, fontWeight: '700' },
});
