import Mapbox from '@rnmapbox/maps';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { initialsFromSession, useAuth } from '../src/auth/AuthContext';
import { floorLabel, floorLabels, floorPhrase, getBuildingById, sortedFloors } from '../src/data/buildings';
import { getRoomById, getRoomsInBuilding, parseRoomCode, searchBuildings, searchRooms } from '../src/data/search';
import type { Building, LngLat, RoomMatch, SearchMatch } from '../src/data/types';
import { CAMPUS_DEBUG_ORIGIN, CONFIGURED_DEBUG_ORIGIN, DEBUG_TOOLS_ENABLED } from '../src/debug';
import { appleMapsAvailable, googleMapsAvailable, openInAppleMaps, openInGoogleMaps } from '../src/directions';
import { CampusMap, CampusMapHandle, NavProgress } from '../src/map/CampusMap';
import { fixSupports, type FixQuality } from '../src/map/fixQuality';
import { ARRIVAL_METRES, type RouteState } from '../src/map/routeState';
import { formatDistance } from '../src/units';
import { colors, radius, spacing } from '../src/theme';

type AutocompleteItem =
  | { kind: 'building'; match: SearchMatch }
  | { kind: 'room'; room: RoomMatch };

export default function Search() {
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();
  const initials = initialsFromSession(session);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const mapHandle = useRef<CampusMapHandle>(null);

  const [query, setQuery] = useState('');
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<RoomMatch | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [mapHeading, setMapHeading] = useState(0);
  const [routeState, setRouteState] = useState<RouteState>({ status: 'idle' });
  const [navProgress, setNavProgress] = useState<NavProgress>({
    maneuverRotation: 0,
    distanceToDestination: null,
    accuracy: null,
    instruction: null,
    distanceToManeuver: null,
  });
  const [navigateMode, setNavigateMode] = useState(false);
  const [followLost, setFollowLost] = useState(false);
  // Only changes when the fix crosses a quality band, so this costs one render
  // a session rather than one per GPS tick.
  const [fixBand, setFixBand] = useState<FixQuality>('unknown');
  // Measured rather than assumed: the arrival card's height depends on the
  // building name wrapping, and the toolbar has to clear whatever it turns out
  // to be.
  const [arrivalHeight, setArrivalHeight] = useState(0);
  // Whether to offer Google Maps at all. Asked once: the answer only changes if
  // the user installs or removes it, which they cannot do without leaving.
  const [hasGoogleMaps, setHasGoogleMaps] = useState(false);
  useEffect(() => {
    let cancelled = false;
    googleMapsAvailable().then((ok) => { if (!cancelled) setHasGoogleMaps(ok); });
    return () => { cancelled = true; };
  }, []);
  // Simulated route origin, so navigation is testable from off campus. Seeded
  // from the build config; the long-press toggle below can also set it at
  // runtime, but only in builds that opted in. See src/debug.ts.
  const [debugOrigin, setDebugOrigin] = useState<LngLat | null>(CONFIGURED_DEBUG_ORIGIN);

  const items: AutocompleteItem[] = useMemo(() => {
    const q = query.trim();
    if (selectedBuilding) {
      // Empty query included: tapping the search bar inside a building offers
      // that building's rooms to browse. This used to return nothing, on the
      // grounds that an empty query produced an unranked dump — true when the
      // rooms came back in source order, but getRoomsInBuilding now orders them
      // by floor and number, which is a list worth showing.
      // No cap: the dropdown virtualises, so the whole building costs the same
      // to render as twenty of it, and a cap just hides rooms someone is
      // scrolling to find.
      return getRoomsInBuilding(selectedBuilding.id, q).map(
        (room) => ({ kind: 'room' as const, room }),
      );
    }
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

  /**
   * Put the search box away.
   *
   * Every transition that changes what the map is showing calls this. Only
   * handleSelect used to, so opening the keyboard and then navigating any other
   * way — a map tap, the back arrow, a floor — left it covering half the screen
   * with nothing to dismiss it.
   */
  const leaveSearch = () => {
    Keyboard.dismiss();
    setShowResults(false);
  };

  const handleSelect = (item: AutocompleteItem) => {
    leaveSearch();
    setNavigateMode(false);
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
      setShowResults(false);
    }
  };

  const handleRoomPress = (roomId: string) => {
    // Navigation owns the screen. A tap on a room the user happens to be
    // walking past shouldn't throw away the trip they're in the middle of.
    if (navigateMode) return;
    const room = getRoomById(roomId);
    if (!room) return;
    leaveSearch();
    setSelectedRoom(room);
    setSelectedFloor(room.floor);
    setQuery(room.roomNumber);
    setShowResults(false);
  };

  const handleBuildingPress = (buildingId: string) => {
    if (navigateMode) return;
    const building = getBuildingById(buildingId);
    if (!building) return;
    leaveSearch();
    setSelectedRoom(null);
    setSelectedBuilding(building);
    setSelectedFloor(sortedFloors(building.floors)[0] ?? null);
    setQuery('');
    setShowResults(false);
  };

  const handleBack = () => {
    leaveSearch();
    if (navigateMode) {
      setNavigateMode(false);
      return;
    }
    if (selectedRoom) {
      setSelectedRoom(null);
      setSelectedBuilding(selectedBuilding ?? selectedRoom.building);
      setSelectedFloor(selectedRoom.floor);
      setQuery('');
      setShowResults(false);
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
      leaveSearch();
      setSelectedRoom(null);
      setNavigateMode(false);
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

  // After selecting a room the query holds that room's number, which would
  // re-populate `items` and immediately re-open the list on the result the user
  // just picked. Typing anything different re-opens it.
  const queryEchoesSelectedRoom =
    selectedRoom !== null &&
    query.trim().toUpperCase() === selectedRoom.roomNumber.toUpperCase();
  const showDropdown = showResults && items.length > 0 && !queryEchoesSelectedRoom;

  const routeReady = routeState.status === 'ok' ? routeState : null;
  const routeFailure = routeState.status === 'error' ? routeState.reason : null;
  // 'no-location' isn't a failure the user can act on — a fix is still coming,
  // and the route effect refires when it lands.
  const routeSettling = routeState.status === 'pending' || routeFailure === 'no-location';
  const unwalkable = routeFailure === 'too-far' || routeFailure === 'no-route';
  // Arrival ends navigation and replaces the nav bar, so a fix too coarse to
  // place the user inside the arrival radius must not trigger it — otherwise a
  // bad fix ends the trip from across the street.
  const arrived =
    navProgress.distanceToDestination !== null &&
    navProgress.distanceToDestination <= ARRIVAL_METRES &&
    fixSupports(navProgress.accuracy, ARRIVAL_METRES);

  const roomLabel = selectedRoom
    ? `${selectedRoom.building.abbr} ${selectedRoom.roomNumber}`
    : 'Destination';

  const toggleDebugOrigin = () => {
    if (!DEBUG_TOOLS_ENABLED) return;
    setDebugOrigin((current) => (current ? null : CAMPUS_DEBUG_ORIGIN));
  };
  // Header stacks the logo row (44) and search bar (48) on one white surface,
  // with spacing.sm between them and below the search bar.
  const headerHeight = insets.top + 44 + spacing.sm + 48 + spacing.sm;
  // Thin branded footer; panels and the nav bar float just above it.
  // Extra spacing.sm of breathing room above the logo.
  const footerHeight = insets.bottom + 32 + spacing.sm;
  const panelBottom = footerHeight + spacing.sm;
  const dropdownTop = headerHeight + spacing.xs;
  const arrivalTop = headerHeight + spacing.sm;
  // The arrival card sits where the toolbar normally does, so the toolbar drops
  // below it for the one screen where both are up.
  const toolbarTop =
    arrived && arrivalHeight > 0
      ? arrivalTop + arrivalHeight + spacing.sm
      : headerHeight + spacing.sm;
  const floors = selectedBuilding ? sortedFloors(selectedBuilding.floors) : [];
  // Built once per building: the labels depend on the whole floor list, since
  // that's what decides whether two codes collide.
  const floorNames = useMemo(
    () => floorLabels(selectedBuilding?.floors ?? []),
    [selectedBuilding],
  );

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
        onRoomPress={handleRoomPress}
        onRouteState={setRouteState}
        onNavProgress={setNavProgress}
        onFollowStateChange={setFollowLost}
        onFixQualityChange={setFixBand}
        navigateMode={navigateMode}
        headerHeight={headerHeight}
        debugOrigin={debugOrigin}
      />

      {/* App header — replaces the native stack header so the logo renders
          flat: no glass capsule, shadow, tint, or press effect. Contains the
          logo row (initials + sign-out on the right) and the search bar. */}
      <View style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.logoRow}>
          {/* Long-press is the hidden simulated-origin toggle. Unreachable
              unless the build opted in — see DEBUG_TOOLS_ENABLED. */}
          <Pressable
            onLongPress={toggleDebugOrigin}
            delayLongPress={900}
            disabled={!DEBUG_TOOLS_ENABLED}
          >
            <Image
              source={require('../assets/Visuals/header.png')}
              style={styles.headerLogo}
              resizeMode="contain"
              accessibilityLabel="Classroom Finder"
            />
          </Pressable>
          <View style={styles.headerActions}>
            {initials ? (
              <Text
                style={styles.initials}
                accessibilityLabel={`Signed in as ${session?.name ?? session?.eid}`}
              >
                {initials}
              </Text>
            ) : null}
            <Pressable onPress={signOut} hitSlop={8} accessibilityLabel="Sign out">
              {({ pressed }) => (
                <Svg width={22} height={22} viewBox="0 0 24 24">
                  <Path
                    d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                    stroke={pressed ? colors.ink : colors.slate}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </Svg>
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.searchBar}>
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
      </View>

      {/* Persistent warning that routes are not starting from real GPS, so a
          tester can never mistake a simulated run for real behaviour. */}
      {debugOrigin && (
        <View style={[styles.debugBadge, { top: toolbarTop }]}>
          <Text style={styles.debugBadgeText}>SIMULATED ORIGIN</Text>
        </View>
      )}

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

      {/* Results dropdown — also shown in building state, where it searches
          rooms within that building. Absolutely positioned below the header;
          the floor-switcher panel is anchored to the bottom, so they don't
          collide. */}
      {showDropdown && (
        <View style={[styles.dropdown, { top: dropdownTop }]}>
          <FlatList
            data={items}
            keyExtractor={(item) =>
              item.kind === 'room' ? item.room.roomId : item.match.building.id
            }
            keyboardShouldPersistTaps="handled"
            scrollEnabled={items.length > 5}
            // Shorter in building state: the floor switcher is on screen too,
            // and a full-height list leaves nothing of the map on an iPhone SE.
            style={{ maxHeight: selectedBuilding ? 240 : 300 }}
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
                        {titleCase(room.building.name)} · {floorLabel(room.floor, room.building.floors)}
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
        <View style={[styles.bottomPanel, { bottom: panelBottom }]}>
          {/* Same as the room card: the panel outlives whatever the map is
              showing, so its header is the way back to the building. */}
          <Pressable
            onPress={() => mapHandle.current?.focusSelectedBuilding()}
            style={({ pressed }) => [styles.panelHeader, pressed && styles.panelHeaderPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Show ${selectedBuilding.abbr} on the map`}
          >
            <View style={styles.panelBadge}>
              <Text style={styles.panelBadgeText}>{selectedBuilding.abbr}</Text>
            </View>
            <Text style={styles.panelTitle} numberOfLines={1}>
              {titleCase(selectedBuilding.name)}
            </Text>
          </Pressable>
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.floorList}
            contentContainerStyle={styles.floorListContent}
          >
            {floors.map((floor) => (
              <Pressable
                key={floor}
                style={styles.floorRow}
                onPress={() => {
                  leaveSearch();
                  setSelectedFloor(floor);
                }}
              >
                <View style={[styles.radio, selectedFloor === floor && styles.radioSelected]}>
                  {selectedFloor === floor && <View style={styles.radioDot} />}
                </View>
                <Text style={[styles.floorLabel, selectedFloor === floor && styles.floorLabelSelected]}>
                  {floorNames.get(floor) ?? floor}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Room state — info panel with two CTAs */}
      {selectedRoom && !navigateMode && (
        <View style={[styles.bottomPanel, { bottom: panelBottom }]}>
          {/* The card stays up wherever the map is panned, so the room code
              doubles as the way back to it. Without this, panning away from a
              selection left no route back to it at all. */}
          <Pressable
            onPress={() => mapHandle.current?.focusSelectedRoom()}
            style={({ pressed }) => [styles.panelHeader, pressed && styles.panelHeaderPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Show ${selectedRoom.building.abbr} ${selectedRoom.roomNumber} on the map`}
          >
            <View style={styles.panelBadge}>
              <Text style={styles.panelBadgeText}>{selectedRoom.building.abbr}</Text>
            </View>
            <Text style={styles.roomNumber}>{selectedRoom.roomNumber}</Text>
          </Pressable>
          <Text style={styles.roomBuilding} numberOfLines={1}>
            {titleCase(selectedRoom.building.name)}
          </Text>
          <Text style={styles.roomFloor}>{floorLabel(selectedRoom.floor, selectedRoom.building.floors)}</Text>

          {/* Route status. Every outcome says something — a failed Directions
              call used to leave this blank indefinitely. */}
          {routeReady && (
            <Text style={styles.routeInfo}>
              ~{Math.max(1, Math.round(routeReady.duration / 60))} min walk · {formatDistance(routeReady.distance)}
            </Text>
          )}
          {routeSettling && (
            <View style={styles.routePending}>
              <ActivityIndicator size="small" color={colors.blueBonnet} />
              <Text style={styles.routePendingText}>
                {routeFailure === 'no-location' ? 'Finding your location…' : 'Finding route…'}
              </Text>
            </View>
          )}
          {unwalkable && (
            <Text style={styles.routeNotice}>Too far to walk from here</Text>
          )}
          {routeFailure === 'no-permission' && (
            <Text style={styles.routeNotice}>Enable location to get walking directions</Text>
          )}
          {/* No API reports whether the user granted Precise Location — the
              permission response carries only its scope — so this is inferred
              from a fix radius far too wide to be GPS. */}
          {fixBand === 'reduced' && routeFailure !== 'no-permission' && (
            <Pressable onPress={() => Linking.openSettings()}>
              <Text style={styles.routeNotice}>
                Turn on Precise Location for accurate directions
              </Text>
            </Pressable>
          )}
          {routeFailure === 'failed' && (
            <Text style={styles.routeNotice}>Couldn't load walking directions</Text>
          )}

          {routeFailure === 'no-permission' ? (
            <Pressable style={styles.walkBtn} onPress={() => Linking.openSettings()}>
              <Text style={styles.walkBtnText}>Enable Location</Text>
            </Pressable>
          ) : !unwalkable && routeFailure !== 'failed' ? (
            <Pressable
              style={[styles.walkBtn, routeSettling && styles.walkBtnDisabled]}
              disabled={routeSettling}
              onPress={() => {
                leaveSearch();
                setNavigateMode(true);
              }}
            >
              <Text style={styles.walkBtnText}>Walk here</Text>
            </Pressable>
          ) : null}

          {/* Hand-off to a maps app. Named rather than a generic "Open in
              Maps", because on iOS that silently meant Apple Maps and there was
              no way to choose. Google only appears when it is installed —
              offering an app the user does not have is worse than not offering
              the choice. Both stay secondary: they are a way out, not the
              thing this card is for. */}
          <View style={styles.mapsRow}>
            {appleMapsAvailable() && (
              <Pressable
                style={[styles.mapsBtn, styles.mapsRowBtn]}
                onPress={() => openInAppleMaps(selectedRoom.center, roomLabel)}
              >
                <Text style={styles.mapsBtnText}>Apple Maps</Text>
              </Pressable>
            )}
            {hasGoogleMaps && (
              <Pressable
                style={[styles.mapsBtn, styles.mapsRowBtn]}
                onPress={() => openInGoogleMaps(selectedRoom.center, roomLabel)}
              >
                <Text style={styles.mapsBtnText}>Google Maps</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {/* Arrival — the route can't go indoors, so this is where walking ends.
          Sits at the top: once you have arrived, the room on the map matters
          more than the card, and a bottom panel covers exactly the ground the
          nav camera puts the destination on.

          The building tag and name repeat the building-state header, so the
          hand-off from "walking there" to "find it inside" looks like the same
          place rather than a new screen. */}
      {selectedRoom && navigateMode && arrived && (
        <View
          style={[styles.bottomPanel, styles.arrivalPanel, { top: arrivalTop }]}
          onLayout={(e) => setArrivalHeight(e.nativeEvent.layout.height)}
        >
          <Text style={styles.arrivalTitle}>{"🤘🏼 You've Arrived!"}</Text>

          <View style={styles.panelHeader}>
            <View style={styles.panelBadge}>
              <Text style={styles.panelBadgeText}>{selectedRoom.building.abbr}</Text>
            </View>
            <Text style={styles.panelTitle} numberOfLines={1}>
              {titleCase(selectedRoom.building.name)}
            </Text>
          </View>

          <Text style={styles.arrivalDetail}>
            Room {selectedRoom.roomNumber} is on {floorPhrase(selectedRoom.floor, selectedRoom.building.floors)}
          </Text>

          <Pressable
            style={styles.walkBtn}
            onPress={() => {
              leaveSearch();
              setNavigateMode(false);
            }}
          >
            <Text style={styles.walkBtnText}>Done</Text>
          </Pressable>
        </View>
      )}

      {/* Navigate mode — compact bar with bearing arrow and ETA */}
      {selectedRoom && navigateMode && !arrived && (
        <View style={[styles.navBar, { bottom: panelBottom }]}>
          <View style={styles.navArrowWrap}>
            {/* Shows the maneuver, not a compass bearing: a left turn points
                left however the phone is held. It used to swing with the map
                heading, which contradicted the instruction beside it. */}
            <Text style={[
              styles.navArrow,
              { transform: [{ rotate: `${navProgress.maneuverRotation}deg` }] },
            ]}>↑</Text>
          </View>
          <View style={styles.navInfo}>
            {/* The maneuver, in Mapbox's own words. Falls back to the
                destination before the first instruction lands, and on the last
                stretch where there is nothing left to announce. */}
            <Text style={styles.navDest} numberOfLines={1}>
              {navProgress.instruction ?? `${selectedRoom.building.abbr} ${selectedRoom.roomNumber}`}
            </Text>
            <Text style={styles.navEta} numberOfLines={1}>
              {navProgress.instruction !== null && navProgress.distanceToManeuver !== null
                ? `${formatDistance(navProgress.distanceToManeuver)} · `
                : ''}
              {routeReady
                ? `~${Math.max(1, Math.round(routeReady.duration / 60))} min to ${selectedRoom.building.abbr} ${selectedRoom.roomNumber}`
                : `${selectedRoom.building.abbr} ${selectedRoom.roomNumber}`}
            </Text>
          </View>
          <Pressable
            style={styles.navEnd}
            onPress={() => {
              leaveSearch();
              setNavigateMode(false);
            }}
          >
            <Text style={styles.navEndText}>End</Text>
          </Pressable>
        </View>
      )}

      {/* Re-center chip — panning during navigation disengages the follow camera */}
      {selectedRoom && navigateMode && !arrived && followLost && (
        <Pressable
          style={({ pressed }) => [
            styles.recenterChip,
            { bottom: panelBottom + 76 + spacing.sm },
            pressed && styles.recenterChipPressed,
          ]}
          onPress={() => mapHandle.current?.centerOnUser()}
        >
          <Text style={styles.recenterChipText}>Re-center</Text>
        </Pressable>
      )}

      {/* Branded footer */}
      <View style={[styles.footer, { height: footerHeight, paddingTop: spacing.sm, paddingBottom: insets.bottom }]}>
        <Image
          source={require('../assets/Visuals/cola-footer.png')}
          style={styles.footerLogo}
          resizeMode="contain"
          accessibilityLabel="Texas Liberal Arts"
        />
      </View>
    </View>
  );
}

function titleCase(s: string | null): string {
  if (!s) return 'Unknown building';
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  logoRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLogo: { width: 158, height: 25 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Flat like the rest of the header — no avatar chip, so it reads as a label
  // paired with the sign-out icon rather than a second control.
  initials: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: colors.slate,
  },

  searchBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bgSubtle,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    gap: spacing.sm,
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
  panelHeaderPressed: { opacity: 0.55 },
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
  roomFloor: { fontSize: 13, color: colors.mist, marginBottom: spacing.xs },
  routeInfo: { fontSize: 13, color: colors.blueBonnet, fontWeight: '600', marginBottom: spacing.sm },
  routePending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  routePendingText: { fontSize: 13, color: colors.slate },
  routeNotice: { fontSize: 13, color: colors.slate, fontWeight: '600', marginBottom: spacing.sm },
  walkBtn: {
    backgroundColor: colors.burntOrange,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  walkBtnDisabled: { opacity: 0.45 },
  walkBtnText: { color: colors.white, fontWeight: '700', fontSize: 15 },

  // Arrival card — replaces the nav bar in the last ~25m. Same box as every
  // other panel; only the type is bigger, because this is the payoff.
  // Shadow falls downward here, unlike the bottom panels it borrows from.
  arrivalPanel: { shadowOffset: { width: 0, height: 1 } },
  arrivalTitle: { fontSize: 26, fontWeight: '800', color: colors.ink, marginBottom: spacing.md },
  arrivalDetail: { fontSize: 16, color: colors.slate, marginBottom: spacing.md },

  debugBadge: {
    position: 'absolute',
    left: spacing.md,
    backgroundColor: colors.ink,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  debugBadgeText: { color: colors.sunshine, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  // Side by side when both apps are offered; a lone button still fills the row.
  mapsRow: { flexDirection: 'row', gap: spacing.sm },
  mapsRowBtn: { flex: 1 },
  mapsBtn: {
    borderWidth: 1.5,
    borderColor: colors.burntOrange,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  mapsBtnText: { color: colors.burntOrange, fontWeight: '600', fontSize: 15 },

  // Navigate mode bar
  navBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  navArrowWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.burntOrange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrow: { fontSize: 22, color: colors.white },
  navInfo: { flex: 1 },
  navDest: { fontSize: 15, fontWeight: '700', color: colors.ink },
  navEta: { fontSize: 13, color: colors.slate, marginTop: 2 },
  navEnd: {
    borderWidth: 1.5,
    borderColor: colors.mist,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  navEndText: { fontSize: 14, fontWeight: '600', color: colors.slate },

  recenterChip: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.white,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  recenterChipPressed: { backgroundColor: colors.bgSubtle },
  recenterChipText: { color: colors.burntOrange, fontSize: 14, fontWeight: '700' },

  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerLogo: { width: 167, height: 16 },

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
