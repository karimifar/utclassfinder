import Mapbox from '@rnmapbox/maps';
import React, { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthContext';
import { formatFloor, getBuildingById, sortedFloors } from '../src/data/buildings';
import { getRoomsInBuilding, parseRoomCode, searchBuildings, searchRooms } from '../src/data/search';
import type { Building, RoomMatch, SearchMatch } from '../src/data/types';
import { openDirectionsToCoordinate } from '../src/directions';
import { CampusMap, CampusMapHandle } from '../src/map/CampusMap';
import { colors, radius, spacing } from '../src/theme';

type AutocompleteItem =
  | { kind: 'building'; match: SearchMatch }
  | { kind: 'room'; room: RoomMatch };

export default function Search() {
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const cameraRef = useRef<Mapbox.Camera>(null);
  const mapHandle = useRef<CampusMapHandle>(null);

  const [query, setQuery] = useState('');
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<RoomMatch | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [mapHeading, setMapHeading] = useState(0);

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
      setSelectedFloor(item.room.floor);
      setQuery(item.room.roomNumber);
    } else {
      const building = item.match.building;
      setSelectedBuilding(building);
      const floors = sortedFloors(building.floors);
      setSelectedFloor(floors[0] ?? null);
      setQuery('');
      setShowResults(true);
    }
  };

  const handleBuildingPress = (buildingId: string) => {
    const building = getBuildingById(buildingId);
    if (!building) return;
    setSelectedRoom(null);
    setSelectedBuilding(building);
    setSelectedFloor(sortedFloors(building.floors)[0] ?? null);
    setQuery('');
    setShowResults(false);
  };

  const handleBack = () => {
    if (selectedRoom) {
      setSelectedRoom(null);
      setSelectedBuilding(selectedBuilding ?? selectedRoom.building);
      setSelectedFloor(selectedRoom.floor);
      setQuery('');
      setShowResults(true);
    } else {
      setSelectedBuilding(null);
      setSelectedFloor(null);
      setQuery('');
      setShowResults(false);
    }
  };

  const handleClearQuery = () => {
    if (selectedRoom) {
      // In room state, X = go all the way back to zero state
      setSelectedRoom(null);
      setSelectedBuilding(null);
      setSelectedFloor(null);
      setQuery('');
      setShowResults(false);
    } else {
      setQuery('');
      setShowResults(false);
    }
  };

  const activeBuilding = selectedBuilding ?? selectedRoom?.building ?? null;
  const inBuildingOrRoomState = activeBuilding !== null;
  const searchBarTop = Math.round(insets.top / 2);
  const dropdownTop = searchBarTop + 52;
  const toolbarTop = searchBarTop + 48 + spacing.sm;
  const floors = selectedBuilding ? sortedFloors(selectedBuilding.floors) : [];

  return (
    <View style={styles.container}>
      <CampusMap
        ref={mapHandle}
        cameraRef={cameraRef}
        selectedRoom={selectedRoom}
        selectedBuilding={selectedBuilding}
        selectedFloor={selectedFloor}
        onHeadingChange={setMapHeading}
        onBuildingPress={handleBuildingPress}
      />

      {/* Map toolbar — zoom, location, compass */}
      <View style={[styles.toolbar, { top: toolbarTop }]}>
        <Pressable style={styles.toolBtn} onPress={() => mapHandle.current?.zoomIn()}>
          <Text style={styles.toolBtnText}>+</Text>
        </Pressable>
        <View style={styles.toolDivider} />
        <Pressable style={styles.toolBtn} onPress={() => mapHandle.current?.zoomOut()}>
          <Text style={styles.toolBtnText}>−</Text>
        </Pressable>
        <View style={styles.toolDivider} />
        <Pressable
          style={styles.toolBtn}
          onPress={() => mapHandle.current?.centerOnUser()}
        >
          <Text style={styles.toolBtnText}>⊙</Text>
        </Pressable>
        <View style={styles.toolDivider} />
        <Pressable
          style={styles.toolBtn}
          onPress={() => cameraRef.current?.setCamera({ heading: 0, animationDuration: 300 })}
        >
          <Text style={[styles.toolBtnText, { transform: [{ rotate: `${-mapHeading}deg` }] }]}>N</Text>
        </Pressable>
      </View>

      {/* Floating search bar */}
      <View style={[styles.searchBar, { top: searchBarTop }]}>
        {inBuildingOrRoomState ? (
          <Pressable onPress={handleBack} hitSlop={8} style={styles.backBtn}>
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
        ) : (
          <Text style={styles.searchIcon}>⌕</Text>
        )}

        {inBuildingOrRoomState && (
          <View style={styles.buildingChip}>
            <Text style={styles.buildingChipText}>{activeBuilding!.abbr}</Text>
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder={inBuildingOrRoomState
            ? `Rooms in ${activeBuilding!.abbr}…`
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

        {(query.length > 0 || selectedRoom !== null) && (
          <Pressable onPress={handleClearQuery} hitSlop={8}>
            <Text style={styles.clearBtn}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Results dropdown — hidden in building state; floor switcher panel handles navigation there */}
      {showResults && items.length > 0 && !inBuildingOrRoomState && (
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
                        {titleCase(room.building.name)} · {formatFloor(room.floor)}
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

      {/* Building state — floor switcher panel */}
      {selectedBuilding && !selectedRoom && floors.length > 0 && (
        <View style={[styles.bottomPanel, { bottom: insets.bottom + spacing.md }]}>
          <View style={styles.panelHeader}>
            <View style={styles.panelBadge}>
              <Text style={styles.panelBadgeText}>{selectedBuilding.abbr}</Text>
            </View>
            <Text style={styles.panelTitle} numberOfLines={1}>
              {titleCase(selectedBuilding.name)}
            </Text>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.floorList}
            contentContainerStyle={styles.floorListContent}
          >
            {floors.map((floor) => (
              <Pressable
                key={floor}
                style={styles.floorRow}
                onPress={() => setSelectedFloor(floor)}
              >
                <View style={[styles.radio, selectedFloor === floor && styles.radioSelected]}>
                  {selectedFloor === floor && <View style={styles.radioDot} />}
                </View>
                <Text style={[styles.floorLabel, selectedFloor === floor && styles.floorLabelSelected]}>
                  {formatFloor(floor)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Room state — room info panel with navigate CTA */}
      {selectedRoom && (
        <View style={[styles.bottomPanel, { bottom: insets.bottom + spacing.md }]}>
          <View style={styles.panelHeader}>
            <View style={styles.panelBadge}>
              <Text style={styles.panelBadgeText}>{selectedRoom.building.abbr}</Text>
            </View>
            <Text style={styles.roomNumber}>{selectedRoom.roomNumber}</Text>
          </View>
          <Text style={styles.roomBuilding} numberOfLines={1}>
            {titleCase(selectedRoom.building.name)}
          </Text>
          <Text style={styles.roomFloor}>{formatFloor(selectedRoom.floor)}</Text>
          <Pressable
            style={styles.navigateBtn}
            onPress={() =>
              openDirectionsToCoordinate(
                selectedRoom.center,
                `${selectedRoom.building.abbr} ${selectedRoom.roomNumber}`,
              )
            }
          >
            <Text style={styles.navigateBtnText}>Navigate here</Text>
          </Pressable>
        </View>
      )}

      {/* Sign out — only visible in default state so it doesn't clash with panels */}
      {!inBuildingOrRoomState && (
        <Pressable
          onPress={signOut}
          style={[styles.signOut, { bottom: insets.bottom + spacing.md }]}
          hitSlop={8}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      )}
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

  // Shared bottom panel — used for both building (floor switcher) and room (info card) states
  bottomPanel: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  panelBadge: {
    backgroundColor: colors.burntOrange,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  panelBadgeText: { color: colors.white, fontWeight: '800', fontSize: 12 },
  panelTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },

  // Floor switcher
  floorList: { flexShrink: 1 },
  floorListContent: { gap: 2 },
  floorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.burntOrange },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.burntOrange,
  },
  floorLabel: { fontSize: 14, color: colors.slate },
  floorLabelSelected: { color: colors.ink, fontWeight: '600' },

  // Room info panel
  roomNumber: { fontSize: 20, fontWeight: '700', color: colors.ink },
  roomBuilding: { fontSize: 14, color: colors.slate, marginBottom: 2 },
  roomFloor: { fontSize: 13, color: colors.mist, marginBottom: spacing.sm },
  navigateBtn: {
    backgroundColor: colors.burntOrange,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  navigateBtnText: { color: colors.white, fontWeight: '700', fontSize: 15 },

  signOut: {
    position: 'absolute',
    alignSelf: 'center',
  },
  signOutText: { color: colors.white, fontSize: 13, opacity: 0.7 },

  toolbar: {
    position: 'absolute',
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
  toolBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnText: { fontSize: 20, color: colors.ink, lineHeight: 24 },
  toolDivider: { height: 1, backgroundColor: colors.line },
});
