import Mapbox from '@rnmapbox/maps';
import React, { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthContext';
import { getRoomsInBuilding, parseRoomCode, searchBuildings, searchRooms } from '../src/data/search';
import type { Building, RoomMatch, SearchMatch } from '../src/data/types';
import { CampusMap } from '../src/map/CampusMap';
import { colors, radius, spacing } from '../src/theme';

type AutocompleteItem =
  | { kind: 'building'; match: SearchMatch }
  | { kind: 'room'; room: RoomMatch };

export default function Search() {
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const cameraRef = useRef<Mapbox.Camera>(null);

  const [query, setQuery] = useState('');
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<RoomMatch | null>(null);
  const [showResults, setShowResults] = useState(false);

  const items: AutocompleteItem[] = useMemo(() => {
    if (selectedBuilding) {
      return getRoomsInBuilding(selectedBuilding.id, query.trim()).map(
        (room) => ({ kind: 'room' as const, room }),
      );
    }
    const q = query.trim();
    if (!q) return [];
    const { roomToken } = parseRoomCode(q);
    if (roomToken) {
      return searchRooms(q).map((room) => ({ kind: 'room' as const, room }));
    }
    return searchBuildings(q).map((match) => ({ kind: 'building' as const, match }));
  }, [query, selectedBuilding]);

  const handleChange = (text: string) => {
    setQuery(text);
    setShowResults(true);
    if (!text.trim() && !selectedBuilding) setSelectedRoom(null);
  };

  const handleSelect = (item: AutocompleteItem) => {
    Keyboard.dismiss();
    setShowResults(false);
    if (item.kind === 'room') {
      setSelectedRoom(item.room);
      setQuery(selectedBuilding ? item.room.roomNumber : `${item.room.building.abbr} ${item.room.roomNumber}`);
    } else {
      setSelectedBuilding(item.match.building);
      setQuery('');
      setShowResults(true);
    }
  };

  // Back from room → return to building state. Back from building → return to default.
  const handleBack = () => {
    if (selectedRoom) {
      setSelectedRoom(null);
      setQuery('');
      setShowResults(true);
    } else {
      setSelectedBuilding(null);
      setQuery('');
      setShowResults(false);
    }
  };

  const handleClearQuery = () => {
    setQuery('');
    setSelectedRoom(null);
    if (selectedBuilding) setShowResults(true);
    else setShowResults(false);
  };

  const inBuildingState = selectedBuilding !== null;
  const searchBarTop = insets.top + 12;
  const dropdownTop = searchBarTop + 52;

  return (
    <View style={styles.container}>
      <CampusMap
        cameraRef={cameraRef}
        selectedRoom={selectedRoom}
        selectedBuilding={selectedBuilding}
      />

      {/* Floating search bar */}
      <View style={[styles.searchBar, { top: searchBarTop }]}>
        {inBuildingState ? (
          <Pressable onPress={handleBack} hitSlop={8} style={styles.backBtn}>
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
        ) : (
          <Text style={styles.searchIcon}>⌕</Text>
        )}

        {inBuildingState && (
          <View style={styles.buildingChip}>
            <Text style={styles.buildingChipText}>{selectedBuilding.abbr}</Text>
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder={inBuildingState
            ? `Rooms in ${selectedBuilding.abbr}…`
            : 'Building or room, e.g. GDC 2.216'}
          placeholderTextColor={colors.mist}
          autoCapitalize="characters"
          autoCorrect={false}
          value={query}
          onChangeText={handleChange}
          onFocus={() => setShowResults(true)}
          returnKeyType="search"
          onSubmitEditing={() => items[0] && handleSelect(items[0])}
        />

        {query.length > 0 && (
          <Pressable onPress={handleClearQuery} hitSlop={8}>
            <Text style={styles.clearBtn}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Results dropdown */}
      {showResults && items.length > 0 && (
        <View style={[styles.dropdown, { top: dropdownTop }]}>
          <FlatList
            data={items}
            keyExtractor={(item) =>
              item.kind === 'room' ? item.room.roomId : item.match.building.id
            }
            keyboardShouldPersistTaps="handled"
            scrollEnabled={items.length > 5}
            style={{ maxHeight: 300 }}
            renderItem={({ item }) => {
              if (item.kind === 'room') {
                const { room } = item;
                return (
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    onPress={() => handleSelect(item)}
                  >
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{room.building.abbr ?? '?'}</Text>
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {room.building.abbr} {room.roomNumber}
                      </Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {titleCase(room.building.name)} · Floor {room.floor}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                );
              }
              const { match } = item;
              return (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => handleSelect(item)}
                >
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{match.building.abbr ?? '?'}</Text>
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {titleCase(match.building.name)}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {match.building.roomCount} rooms
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              );
            }}
          />
        </View>
      )}

      {/* Sign out */}
      <Pressable
        onPress={signOut}
        style={[styles.signOut, { bottom: insets.bottom + spacing.md }]}
        hitSlop={8}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function titleCase(s: string | null): string {
  if (!s) return 'Unknown building';
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  searchBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  searchIcon: { fontSize: 18, color: colors.mist },
  backBtn: { justifyContent: 'center' },
  backBtnText: { fontSize: 20, color: colors.ink, lineHeight: 24 },
  buildingChip: {
    backgroundColor: colors.burntOrange,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    justifyContent: 'center',
  },
  buildingChipText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  input: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 0 },
  clearBtn: { fontSize: 14, color: colors.mist },

  dropdown: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 5,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowPressed: { backgroundColor: colors.bgSubtle },
  badge: {
    minWidth: 48,
    paddingHorizontal: spacing.sm,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.burntOrange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.white, fontWeight: '800', fontSize: 13 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  rowSub: { marginTop: 1, fontSize: 12, color: colors.slate },
  chevron: { fontSize: 22, color: colors.mist },

  signOut: {
    position: 'absolute',
    alignSelf: 'center',
  },
  signOutText: { color: colors.white, fontSize: 13, opacity: 0.7 },
});
