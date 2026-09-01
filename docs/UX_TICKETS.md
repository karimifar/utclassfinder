# UX Tickets — TestFlight round 1

Source: hands-on TestFlight testing, Sept 2026. Five defects, written as
self-contained tickets for Claude Code. Each ticket names the files it touches,
the decisions already made (don't re-litigate them), and acceptance criteria.

**Stack context:** Expo SDK 53 / React Native 0.79 / expo-router.
`@rnmapbox/maps` ^10.1.33. All map camera and layer logic lives in
`src/map/CampusMap.tsx`; the state machine (zero → building → room → navigate)
lives in `app/search.tsx`. Building/room data is bundled in
`assets/data/buildings.json` and `assets/data/room-index.json`.

**Suggested order:** T-3 → T-5 → T-4 → T-1 → T-2.
T-3 removes the declarative `bounds` prop that T-5 depends on, and restores a
usable route origin that T-4 needs in order to be testable at all. T-1 and T-2
are independent and can be done in any order.

---

## T-1 — Adaptive camera zoom when entering building state

**Severity:** Medium · **Area:** Map camera · **Files:** `src/map/CampusMap.tsx`

### Problem
Entering building state always flies to a hardcoded `zoomLevel: 17`
(`CampusMap.tsx:256`). One uniform zoom cannot serve both the Gates Dell Complex
and a small annex: large buildings are cropped or sit too small to read, small
buildings are surrounded by dead space. The floor-plan room labels only turn on
at `minZoomLevel={17.5}`, so at zoom 17 the user enters building state and sees
an unlabeled floor plan — the state looks broken.

### Decision
Frame the camera to the building's own footprint, clamped to a sane range.
Do **not** ship a flat higher zoom. The data needed already exists: every
`Building` in `assets/data/buildings.json` carries a `footprint: LngLat[]`
convex hull (see `src/data/types.ts`), and `BUILDINGS` is already filtered to
`hasFootprint === true` in `src/data/buildings.ts`.

### Requirements
1. Add a helper (new file `src/map/framing.ts` is fine) that computes the
   axis-aligned bounding box `{ ne, sw }` of a `Building.footprint`.
2. In the `selectedBuilding` branch of the camera effect
   (`CampusMap.tsx:253-261`), replace the fixed `zoomLevel: 17` with a
   `cameraRef.current?.fitBounds(ne, sw, padding, duration)` call, or an
   equivalent `setCamera({ bounds })`, preserving the existing 400ms `flyTo`
   feel.
3. Preserve the existing focal offset. `FOCUS_PADDING` shifts the focal point up
   so the bottom panel doesn't cover the building — the fitBounds padding array
   must reproduce that (bottom padding = 30% of window height, per
   `CampusMap.tsx:80`).
4. **Clamp the resulting zoom to `[17.5, 19.0]`.** 17.5 is the floor-plan label
   threshold — never land below it in building state. 19.0 prevents tiny
   buildings from jumping to a zoom where the floor plan is unreadably large.
   Implement the clamp by reading back the resulting zoom, or by computing the
   fit zoom analytically and calling `setCamera({ centerCoordinate, zoomLevel })`
   with the clamped value. Prefer the analytical version — it's one animation
   instead of two and won't visibly re-adjust.
5. Room state (`zoomLevel: 19`, `CampusMap.tsx:247`) is unchanged by this ticket.

### Acceptance criteria
- Entering building state on GDC frames the whole complex with the floor plan
  visible and room labels rendered.
- Entering building state on a small building (pick one with a footprint under
  ~40m across) does not zoom past 19 and does not leave the building as a speck.
- In every building tested, room number labels are visible immediately on
  arrival — no case where the user must pinch in to see labels.
- The building is vertically centered in the area *above* the floor-switcher
  panel, not behind it.
- No regression to the room-state camera or to the zoom-out behavior when
  clearing a selection (`CampusMap.tsx:263-271`).

### Out of scope
Rotating the camera to the building's principal axis. Per-building tuning
overrides in the dataset.

---

## T-2 — Room autocomplete is suppressed in building state

**Severity:** High · **Area:** Search · **Files:** `app/search.tsx`

### Problem
Once a building is selected, typing a room number into the search bar produces
no pick list. The user must tap the room polygon on the map, which is
impractical for rooms on a dense floor or a floor they haven't switched to.

### Root cause
The data layer already works — `items` is correctly populated by
`getRoomsInBuilding(selectedBuilding.id, query.trim())` (`app/search.tsx:47-51`).
The dropdown is simply gated off:

```tsx
// app/search.tsx:262
{showResults && items.length > 0 && !inBuildingOrRoomState && (
```

The trailing `!inBuildingOrRoomState` was added so the floor-switcher panel
would "handle navigation" in building state. That was wrong.

### Requirements
1. Show the dropdown in building state. The gate becomes roughly
   `showResults && items.length > 0` — but see (2), room state differs.
2. **Room state must not show a stale list.** After selecting a room,
   `handleSelect` sets `query` to the room number (`app/search.tsx:73`), which
   would immediately re-populate and re-open the dropdown. `handleSelect`
   already calls `setShowResults(false)`; verify that holds, and additionally
   suppress the dropdown when `selectedRoom !== null` and `query` is unchanged
   from that room's number. Focusing the field and typing something different
   *should* re-open the list.
3. Layout: the dropdown is absolutely positioned at `dropdownTop`
   (`app/search.tsx:147`) and the floor-switcher panel is anchored to the bottom
   — they do not collide. Confirm on a small device (iPhone SE) that an 8-item
   list plus the panel still leaves the map legible. If it doesn't, cap
   `maxHeight` for the building-state list at 240.
4. Selecting a room from this list must follow the existing room-selection path:
   set room, set floor to the room's floor (so the floor switcher and the map's
   `floorFilter` follow the room across floors), dismiss the keyboard, close the
   list.
5. Raise the result cap for in-building search. `getRoomsInBuilding` defaults to
   `limit = 8` (`src/data/search.ts`); with a building already scoped, 8 is
   tight for a query like "2". Pass an explicit limit of 20 from `app/search.tsx`
   and let the existing `scrollEnabled={items.length > 5}` handle overflow.
6. Empty-query behavior: on entering building state, `query` is `''` and
   `getRoomsInBuilding` returns the first N rooms unranked. Do **not** show that
   unfiltered dump on entry — `showResults` should only produce a list in
   building state once the user has typed at least one character. (`handleSelect`
   currently calls `setShowResults(true)` after selecting a building at
   `app/search.tsx:78` — that needs to change or be compensated for.)

### Acceptance criteria
- In building state for GDC, typing `2` lists GDC rooms starting with 2,
  ranked exact-first by the existing `rankRooms`.
- Typing `2.216` narrows to that room; tapping it selects the room, switches the
  floor plan to Floor 2, and highlights the polygon in burnt orange.
- Pressing return with a query selects the top result (existing
  `onSubmitEditing` behavior) and does not leave the list open.
- Entering building state with an empty query shows the floor switcher and **no**
  dropdown.
- The back arrow from room state returns to building state with the list closed
  and the query cleared.

---

## T-3 — Navigation must originate from live GPS, and the map must not cage the user

**Severity:** High · **Area:** Location / map bounds · **Files:** `src/map/CampusMap.tsx`, `app.config.js`

### Problem
Two coupled issues surfaced while testing from Boston:

1. **Origin.** `CampusMap.tsx:124-127` seeds a hardcoded campus origin
   (`[-97.7335, 30.2849]`) behind an `isSimulator = __DEV__ && !Constants.isDevice`
   flag. On a TestFlight build `__DEV__` is false, so the seed is skipped and
   real GPS is used — which is correct in principle, but it means there is now
   **no** way to exercise navigation from off campus, and the dev-vs-prod split
   is scattered through the file in five places (`:124`, `:127`, `:188`, `:349`,
   `:583`, `:588`), including the `followUserLocation` prop.
2. **Cage.** `maxBounds={MAX_BOUNDS}` (`CampusMap.tsx:57, 347`) hard-limits
   panning to a ~200-mile box around Austin, and `minZoomLevel={7}` prevents
   zooming out far enough to see where you actually are. A tester in Boston
   cannot see their own blue dot.

### Decisions
- Production always uses live GPS. No silent fallback origin for real users.
- Remove `maxBounds` and `minZoomLevel` entirely.
- Move `CAMPUS_BOUNDS` off the live `bounds` prop and into the Camera's
  `defaultSettings`, so it frames the app on first load only and never
  re-asserts itself mid-session. **This is also the fix for T-5** — see that
  ticket.
- Add an explicit, dev-only simulated origin so navigation is testable from
  anywhere, replacing the implicit simulator seed.

### Requirements
1. **Location permissions.** Verify `NSLocationWhenInUseUsageDescription` is set
   in `app.config.js` with copy that explains campus walking directions, and
   that the app requests permission on first entry to the search screen rather
   than relying on Mapbox's implicit request. Handle denial: if permission is
   denied, `userCoordsRef` stays null — the room card must not show a dead
   "Walk here" button (see requirement 5).
2. **Remove the scattered `isSimulator` branching.** Replace with a single
   module-level `DEBUG_ORIGIN` concept:
   - Default `null`. When null, origin is always `userCoordsRef.current` from
     the live `<Mapbox.UserLocation onUpdate>` stream.
   - Settable in dev/TestFlight only. Implementation preference, in order:
     (a) an `extra.debugOrigin` value in `app.config.js` read via
     `Constants.expoConfig?.extra`, so it can be flipped per build without code
     changes; plus (b) a hidden runtime toggle — long-press the header logo in
     `app/search.tsx` — that sets a campus origin for the session and shows a
     small persistent "SIMULATED ORIGIN" badge so a tester can never mistake it
     for real behavior.
   - Gate the runtime toggle behind `__DEV__ || <TestFlight detection>`. It must
     be impossible to reach in an App Store build.
3. **`followUserLocation` must no longer be disabled by the simulator flag**
   (`CampusMap.tsx:349`). When a debug origin is active, the follow camera
   should still be driven manually as it is today (`CampusMap.tsx:188-201`);
   when it isn't, the declarative follow props take over.
4. **Remove `maxBounds` and `minZoomLevel`** from `<Mapbox.Camera>`
   (`CampusMap.tsx:347-348`) and delete the now-unused `MAX_BOUNDS` constant
   (`CampusMap.tsx:56-60`).
5. **Change `bounds={CAMPUS_BOUNDS}` to `defaultSettings={{ bounds: CAMPUS_BOUNDS }}`**
   (`CampusMap.tsx:345`). This is load-bearing for T-5 — do not skip it.
6. **Handle the impossible route.** The Mapbox Directions call
   (`CampusMap.tsx:216-240`) currently swallows every failure:
   `if (!leg) return;` leaves `route` and `routeInfo` at their previous values
   and reports nothing. From Boston the API returns `NoRoute` and the room card
   silently shows no ETA and no path — which is what made T-4 look like a
   rendering bug.
   - Surface a `routeError` state up through `onRouteInfo` (or a sibling
     callback) distinguishing: no location permission, route pending, and
     no walking route available.
   - In the room card (`app/search.tsx:322-372`): while pending, show a
     spinner or "Finding route…" in place of the ETA. On `NoRoute` or a
     straight-line distance over ~5 km, replace the "Walk here" button with the
     text "Too far to walk from here" and keep "Open in Maps" as the primary
     action. On permission denied, show "Enable location to get walking
     directions" with a button that opens iOS Settings.
   - `.catch(() => {})` at `CampusMap.tsx:239` must not stay silent — route the
     error into the same state.
7. **Retry when location arrives late.** The effect returns early if
   `origin` is null (`CampusMap.tsx:222`). It depends on `hasLocation`, but
   `hasLocation` is only ever set to `true` once — if the first GPS fix lands
   after a room is selected, verify the route actually refetches. Add a test for
   the cold-start ordering: select a room within the first second of app launch.

### Acceptance criteria
- On a TestFlight build in Boston: the blue puck appears at the tester's real
  location, the map can be zoomed out to see both Boston and Austin, and panning
  is not clamped.
- Selecting a UT room from Boston shows "Too far to walk from here" in the room
  card within a few seconds — never an indefinite blank ETA.
- With the debug origin enabled, selecting a room produces a real route with a
  real ETA, and a "SIMULATED ORIGIN" badge is visible on screen.
- With location permission denied, the app does not crash, does not offer
  "Walk here", and explains why.
- No `isSimulator` references remain in `src/map/CampusMap.tsx`.
- In an App Store (non-TestFlight, non-dev) build, no gesture reaches the debug
  origin toggle.

---

## T-4 — Navigation mode shows no path and no directional indicator

**Severity:** High · **Area:** Navigation · **Files:** `src/map/CampusMap.tsx`, `app/search.tsx`

**Depends on T-3.** With a Boston origin there is no route to render, so this is
untestable until T-3's debug origin exists. Do T-3 first.

### Problem
Entering navigate mode shows the tilted 3D view but no line to follow, and the
user's own position is a plain dot with no clear sense of which way to walk. The
only directional cue is a `↑` glyph in the bottom bar (`app/search.tsx:377-383`)
that points as-the-crow-flies at the destination, not along the route.

### Root cause (partly)
The primary cause is the missing route from T-3. But there are latent rendering
issues to fix regardless:
- The plain `route` line is explicitly hidden in navigate mode
  (`CampusMap.tsx:483: {route && !navigateMode && ...}`), so nav mode depends
  entirely on `remainingRoute` / `walkedRoute`, which are only populated inside
  the `navigateMode && route` effect (`CampusMap.tsx:181-206`) and inside
  `UserLocation.onUpdate` (`CampusMap.tsx:588`, currently `&& !isSimulator`).
  If either path doesn't fire, nav mode renders no line at all.
- `<Mapbox.FillExtrusionLayer id="buildings-3d">` (`CampusMap.tsx:513-529`) is
  declared **after** the route sources in JSX but its draw order relative to the
  route lines is not pinned. At 60° pitch, an extruded building will occlude a
  route line drawn beneath it.

### Decisions
- Directional puck on the path (Google-Maps-style chevron that rotates with
  heading), not repeating chevrons along the line.
- The last leg to the room is a dashed straight hop — see requirement 5.

### Requirements
1. **Guarantee a line exists whenever nav mode has a route.** `remainingRoute`
   should derive from `route` unconditionally rather than being seeded once by
   an effect. Simplest robust form: render `remainingRoute ?? route` in nav
   mode, so a missing split never means a missing line.
2. **Pin layer order.** Use `belowLayerID` / `aboveLayerID` so both route line
   layers draw *above* `buildings-3d`. Verify at 60° pitch that the line is not
   swallowed by an extrusion when the route passes alongside a tall building.
3. **Directional puck.** Replace the default `<Mapbox.UserLocation>` puck in nav
   mode with a chevron/arrow that rotates to the user's course.
   `showsUserHeadingIndicator` is already on (`CampusMap.tsx:577`); use
   `<Mapbox.UserLocation><Mapbox.SymbolLayer .../></Mapbox.UserLocation>` or a
   custom puck with a burnt-orange arrow asset. Requirements:
   - Rotates with device heading, not with bearing-to-destination.
   - `iconRotationAlignment: 'map'` so it stays glued to the route line at pitch.
   - Sized to stay legible at `NAV_ZOOM` (18) — roughly 32–40pt.
   - Falls back to the current dot outside nav mode.
4. **Route styling.** Keep the existing walked/remaining split
   (`splitRouteAtUser`, `CampusMap.tsx:9-34`): solid `blueBonnet` ahead, dimmed
   dashed behind. Add a rounded white casing beneath the remaining line
   (a second, wider `LineLayer` in white at ~70% opacity) so it reads against
   both the limestone extrusions and the light basemap.
5. **Dashed final hop.** The Directions API snaps to sidewalks and cannot route
   to a room on an upper floor, so the route ends at the nearest walkway. Draw a
   separate dashed `LineLayer` from the route's last coordinate to
   `selectedRoom.center`, visually distinct from the walking route (thinner,
   dashed, `burntOrange`), to read as "enter here, then go inside."

   **Scope decision:** the product promise is *get the user to the building*,
   not to the door. Door-level accuracy is explicitly not a goal — the dashed
   hop is a visual signal that the guided portion has ended, not a claim about
   which entrance to use. Do not build entrance detection, and do not treat a
   dashed hop that crosses the footprint at an odd angle as a bug.
6. **Arrival state.** When the user is within ~25m of `selectedRoom.center`,
   swap the nav bar (`app/search.tsx:375-397`) for an arrival card:
   "You've arrived at {abbr} — Room {roomNumber} is on {formatFloor(floor)}",
   with a single button that ends navigation. This is also the natural exit into
   T-5's camera restore.
7. **Bottom-bar arrow.** The `↑` in the nav bar uses `bearing(userCoords,
   selectedRoom.center)` — straight-line, so it can point through a building
   while the route goes around. Change it to the bearing of the next route
   segment ahead of the user, which `splitRouteAtUser` already computes the
   split point for.

### Acceptance criteria
- With a debug origin on campus, entering nav mode always shows a continuous
  blue line from the puck to the building, with a dashed hop to the room marker.
- The line is visible at 60° pitch with 3D extrusions on, including where the
  route runs beside a tall building.
- The user indicator is an arrow that rotates as the phone rotates and visibly
  points along the route when facing the right way.
- Walking (or simulating movement) dims the traversed portion behind the puck.
- The nav bar arrow points along the route, not through buildings.
- Within 25m of the room, the arrival card replaces the nav bar.

### Out of scope
Turn-by-turn instruction text and voice guidance. Off-route detection and
rerouting. Indoor routing.

---

## T-5 — Ending navigation dumps the camera to the landing view, skewed

**Severity:** Medium · **Area:** Map camera · **Files:** `src/map/CampusMap.tsx`

**Overlaps T-3 requirement 5** — that change is half of this fix. If T-3 is done
first, verify before implementing; some of this may already be resolved.

### Problem
Tapping "End" should return to the room the user was navigating to. Instead the
map zooms all the way out to the campus landing view and the camera stays
tilted/rotated.

### Root cause
Two bugs.

1. **The `bounds` prop re-asserts.** `<Mapbox.Camera bounds={CAMPUS_BOUNDS} ...>`
   (`CampusMap.tsx:345`) is a *declarative* prop. When `followUserLocation` flips
   from `true` to `false` on exiting nav mode (`CampusMap.tsx:349`), the Camera
   re-applies its declarative props and snaps back to `CAMPUS_BOUNDS` — the
   landing view. Fix: `defaultSettings={{ bounds: CAMPUS_BOUNDS }}` (T-3 req 5).
2. **The exit only resets orientation, never position.** The teardown branch
   does `setCamera({ pitch: 0, heading: 0, animationDuration: 500 })`
   (`CampusMap.tsx:209`) — no `centerCoordinate`, no `zoomLevel`, no padding
   reset. The camera effect that would re-frame the room
   (`CampusMap.tsx:243-272`) does not re-run, because `selectedRoom` hasn't
   changed — `navigateMode` is not in its dependency array. So nothing restores
   the room framing. The residual skew is that reset racing the snap-back from (1).

### Decision
On End, return to exactly the room-state camera the user saw before tapping
"Walk here": centered on the room, `zoomLevel: 19`, `pitch: 0`, `heading: 0`
(north-up), `padding: FOCUS_PADDING`.

### Requirements
1. Apply the `defaultSettings` change from T-3 requirement 5 if not already done.
2. In the nav-mode teardown (`CampusMap.tsx:206-212`), when `wasNavigating` was
   true and `selectedRoom` is non-null, issue a single `setCamera` with all of:
   `centerCoordinate: selectedRoom.center`, `zoomLevel: 19`, `pitch: 0`,
   `heading: 0`, `padding: FOCUS_PADDING`, `animationMode: 'flyTo'`,
   `animationDuration: 600`. One animation, not a pitch reset followed by a
   re-frame — two overlapping animations are what produces the skew.
3. If `selectedRoom` is null on exit (nav ended because the selection was
   cleared), fall back to the current behavior: level the camera, leave position
   alone.
4. Extract the room-framing camera options into a single function (e.g.
   `roomCamera(room)`) used by both the `selectedRoom` effect
   (`CampusMap.tsx:245-252`) and this teardown, so the two can't drift.
5. Confirm `followUserLocation` has fully released before the restore fires;
   if the follow camera is still active it will fight the animation. Sequence
   the state change if needed.
6. `centerOnUser` (`CampusMap.tsx:161-176`) reads `navigateModeRef.current` to
   choose nav vs normal framing — verify it still behaves correctly immediately
   after ending navigation, when the ref may not have settled.

### Acceptance criteria
- From room state, tap "Walk here", let nav mode settle, tap "End": the map
  animates back to the same view as before, north-up and flat, with the room
  highlighted in burnt orange and the room card visible.
- No intermediate frame where the whole campus is visible.
- No residual pitch or rotation — the compass button in the toolbar reads N.
- Repeating enter/exit five times leaves the camera in the same place every time.
- Ending navigation after panning away (follow disengaged, "Re-center" chip
  showing) still restores the room view.

---

## Appendix — follow-ups noted but not ticketed

- **Building entrances — CLOSED, will not do.** Routing targets `room.center`,
  which for an upper-floor room is a point in mid-air over the building, so
  Directions snaps to the nearest sidewalk — possibly not the side with the
  door. Investigated Sept 2026: no authoritative entrance dataset exists (UT's
  public GIS publishes footprints and hardscape but no entrance layer; OSM
  coverage is sparse). Decision: navigation guides the user *to the building*
  and stops there. Do not reopen without a product reason.
- **Route staleness.** The Directions call refires on every `selectedRoom`
  change but never on user movement, so the ETA shown on the room card ages as
  the user walks. Consider refetching on significant displacement (>50m).
- **Silent failure pattern.** `.catch(() => {})` appears in the Directions
  fetch; the codebase would benefit from a single error surface so failures
  reach the UI instead of the void. T-3 requirement 6 starts this.
