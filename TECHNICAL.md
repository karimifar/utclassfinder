# UT Class Finder — Technical Reference

Expo + React Native app for finding rooms on the UT Austin campus. Students type a building or room code, the map zooms to that building, shows its floor plan, and lets them navigate to a specific room.

---

## Stack

| Concern | Library |
|---|---|
| Framework | Expo (dev client) + React Native, TypeScript |
| Navigation | expo-router (file-based, `app/`) |
| Map | `@rnmapbox/maps` v10 (native Mapbox GL) |
| Auth | `expo-auth-session` (OAuth 2.0 / OIDC + PKCE) |
| Secure storage | `expo-secure-store` (Keychain / Keystore) |
| SVG assets | `react-native-svg` + `react-native-svg-transformer` |

`.svg` files import as React components (`import Logo from '.../logo.svg'`).
The transformer is registered in `metro.config.js`; `svg.d.ts` provides the
TypeScript module declaration. Adding `react-native-svg` was a native change —
rebuild the dev client after a fresh checkout (`npx expo run:ios`).

---

## Project structure

```
app/
  _layout.tsx           Root layout — wraps AuthProvider + AuthGate
  login.tsx             UT EID sign-in screen
  search.tsx            Main screen: search bar + map toolbar + bottom panels
  building/[id].tsx     Building detail: footprint map + Get Directions
  index.tsx             Redirects to /search

src/
  auth/AuthContext.tsx  Session state, real OAuth (via token broker) + mock fallback
  data/
    types.ts            Shared TypeScript types (Building, RoomMatch, SearchMatch)
    buildings.ts        buildings.json loader + getBuildingById / getBuildingByAbbr
                        + formatFloor / sortedFloors utilities
    search.ts           All search functions (see Search section)
  map/
    CampusMap.tsx       Main map component (search screen)
    BuildingMap.tsx     Small footprint map (building detail screen)
  directions.ts         Apple/Google Maps handoff

server/                 UT SSO token broker (holds the client secret; see Authentication)
  broker-core.mjs       Exchange logic, host-agnostic
  worker.mjs            Cloudflare Worker adapter (production)
  token-broker.mjs      Node http adapter (local dev)
  theme.ts              Colors, spacing, border-radius

assets/data/
  buildings.json          Slim building metadata, generated (do not edit by hand)
  buildings_rooms.geojson 54 k room polygons, sourced from UT Facilities
  room-index.json         ~36.7 k searchable rooms, generated (do not edit by hand)
  campus_buildings.geojson 231 official building footprints, sourced from ArcGIS

assets/Visuals/
  logo.svg                Classroom Finder lockup (login hero)
  header.svg              Classroom Finder wordmark (app header)
  cola.png                Texas Liberal Arts lockup (login footer)
  cola-footer.png         Texas Liberal Arts horizontal lockup (screen footer)
  icon.png                1024×1024 app icon (referenced by app.config.js `icon`;
                          also baked into ios/.../AppIcon.appiconset)

scripts/
  build-buildings.mjs     Generates buildings.json from buildings_rooms.geojson
  build-room-index.mjs    Generates room-index.json from buildings_rooms.geojson
```

---

## Data architecture

### Source files

#### `buildings_rooms.geojson`
Raw room polygon data from UT Facilities (54,344 features). Each feature is a polygon for one space with properties:
```
room_id         "0152-02-2.216"   bldg_no + floor + roomNumber
bldg_no         "0152"
building_abbr   "GDC"
description     "GATES DELL COMPLEX"
floor           "02"
room_number     null              always null in this dataset
room_type       "general academic instruction (degree related)"
area            "623.0"           sq ft
```
Floor values are inconsistent across buildings (e.g. `"01"`, `"001"`, `"GROUND"`, `"W01"` all mean first floor).

**Important:** the dataset includes ALL space types — classrooms, corridors, bathrooms, mechanical rooms, janitor closets, stairwells, and more. These are filtered out at the search and map display layers (see below).

#### `campus_buildings.geojson`
Official building footprint polygons (231 features) sourced from UT's ArcGIS map:
- Standard buildings: `Campus_Buildings_view/FeatureServer/0`
- Utility/infrastructure buildings: `Campus_Buildings_High_Security_view/FeatureServer/0`

The "high security" label is UT's data classification for utility buildings (power plants, chilling stations, etc.) — not access-restricted. Both endpoints are publicly queryable. The file was fetched with a bounding-box query covering main campus (`-97.749,30.270,-97.720,30.295`).

Properties: `Building` (= bldg_no, e.g. `"0152"`), `Building_Abbr` (`"GDC"`), `Description`, `Address_Full`.

**7 buildings present in room data but absent from ArcGIS** (not published as shapes): `CCC`, `DI1`, `E13`, `E15`, `E27`, `JCB`, `UTS`.

#### ArcGIS source
```
Portal:    https://trecs.maps.arcgis.com
Web map:   471f5223e6a0445cb7965ac86616e800  ("New Campus Map 2025")
Standard:  https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/Campus_Buildings_view/FeatureServer/0
High sec:  https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/Campus_Buildings_High_Security_view/FeatureServer/0
```

### Non-navigable room type filtering

UT assigns space IDs to every labeled area in a building, including corridors, stairwells, bathrooms, mechanical rooms, and janitor closets. To prevent these from appearing in search results or on the floor plan, both the index generator and the map filter exclude the following `room_type` values:

```
circulation areas (non e&g)      — hallways, corridors, lobbies, stairwells
mechanical areas (non-e&g)       — HVAC, utility rooms
public rest rooms (non e&g)      — bathrooms
custodial areas (non e&g)        — janitor closets
shell space (non e&g)            — unfinished/unassigned space
building maintenance
utilities
construction project management
landscape and grounds maintenance
operation and maintenance
floor
to be determined
```

This blocklist lives in two places:
1. **`scripts/build-room-index.mjs`** — skips excluded types when generating `room-index.json`
2. **`src/map/CampusMap.tsx`** (`navigableFilter`) — a Mapbox GL `['in', ...]` expression applied to all floor plan layers

### `hasFootprint` flag and consistent data

`buildings.json` includes only the 198 buildings that have a matching polygon in `campus_buildings.geojson`. This is computed at build time by `build-buildings.mjs` cross-referencing both datasets, and enforced at runtime by filtering `BUILDINGS` to `hasFootprint: true`. This ensures search results, map labels, and polygons are always consistent — no building appears in one place but not another.

### Generated files

#### `buildings.json`
One record per building (198 with footprints), generated by `scripts/build-buildings.mjs`:
```ts
{
  id: string          // bldg_no, e.g. "0152"
  abbr: string|null   // "GDC"
  name: string|null   // "GATES DELL COMPLEX"
  center: [lng, lat]
  footprint: [lng, lat][]  // convex hull of all room vertices
  floors: string[]          // e.g. ["01","02","03","04","05","06","07"]
  roomCount: number
  hasFootprint: boolean     // always true for entries in this filtered array
}
```
Run: `node scripts/build-buildings.mjs assets/data/buildings_rooms.geojson`

#### `room-index.json`
Flat array of ~36,700 entries for fast room search (non-navigable types excluded), generated by `scripts/build-room-index.mjs`:
```ts
{
  room_id:       "0152-02-2.216"
  bldg_no:       "0152"
  building_abbr: "GDC"
  floor:         "02"
  roomNumber:    "2.216"
  center:        [lng, lat]   // polygon centroid, used for camera flyTo + navigation
}
```
Run: `node scripts/build-room-index.mjs`

#### `entrances.json`
Building entrances keyed by abbreviation (98 entrances across 67 buildings), generated by
`scripts/build-entrances.mjs`:
```ts
{
  "ASE": [{
    center:       [lng, lat]
    side:         "West"        // which face of the building, or null
    barrierFree:  true          // step-free, per UT's own survey
    autoOpener:   true          // power-assisted door
    description:  "The barrier-free celebrated entrance for Aerospace Engineering
                   Building (ASE) is located on the west side of the building off
                   Wichita Street. BACS reader and auto-opener are found on a metal
                   bollard, forward and to the right of the door."
  }]
}
```
Run: `npm run build:entrances`

**Source.** UT's `Celebrated_Entrances_view` layer — "celebrated entrance" is UT's own term
for a building's primary entrance — on the same public ArcGIS portal as the building
footprints above:
```
https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/Celebrated_Entrances_view/FeatureServer/0
```
There is a sibling `ADA_Celebrated_Entrances_view` layer, but it is exactly this layer
filtered to `BarrierFree = Y` (86 of the 98), so pulling this one alone serves both routing
and any accessible-entrance feature.

**Coverage is partial and nothing may assume an entrance exists.** 67 buildings are
surveyed; 66 join to `buildings.json` by abbreviation (`SSW` does not), and only **56** of
those survive the `hasFootprint` filter into `BUILDINGS` — so 56 is the coverage a user can
actually reach. The other ~480 buildings fall back to the pre-existing behaviour.

**This is a snapshot, not a live feed.** The app imports the JSON statically; nothing in
`src/` or `app/` ever contacts ArcGIS. UT edits these records (they carry `last_edited_date`),
so the file goes stale silently — re-run the script alongside `build:data` and `build:rooms`
when refreshing campus data.

The fetch and its guards live in `scripts/lib/arcgis.mjs`, shared with the elevator script —
see **ArcGIS fetch guards** below.

#### `elevators.json`
Elevator locations keyed by building abbreviation (227 locations across 141 buildings),
generated by `scripts/build-elevators.mjs`:
```ts
{
  "ADH": [{
    center:  [lng, lat]
    cabs:    3        // cars at this location; null where UT left it blank
    private: false    // service or keyed rather than public
    notes:   null
  }]
}
```
Run: `npm run build:elevators`

Source: the `Elevators` layer on the same portal:
```
https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/Elevators/FeatureServer/0
```

**Each record is an elevator bank, not a car** — `cabs` gives the count. 338 public cars across
208 public locations; ATT has the most banks (7), then SJH (6).

**Coverage is much broader than the entrance survey: 120 of the 198 selectable buildings,
against 56.** Anything built on elevators reaches roughly twice as many buildings.

**19 elevators are marked private** (service or keyed). `getElevators()` in
`src/data/elevators.ts` excludes them by default and requires `{ includePrivate: true }` to
see them. A private elevator is worse than none — it sends someone to a car they cannot call,
which is a bad outcome precisely when mobility is the reason they needed it. The data keeps
them so the app can choose; the default is simply not the harmful one.

#### ArcGIS fetch guards

Both generators use `fetchLayer()` from `scripts/lib/arcgis.mjs`. They **overwrite committed
data files**, so a bad run does not crash anything — it replaces good data with worse, and the
symptom is a feature quietly not working for some buildings, indistinguishable from the
buildings that were never covered:

| Guard | Catches |
|---|---|
| `!res.ok` | server down, 404, 500 |
| `data.error` | ArcGIS reports query errors with **HTTP 200** and an `error` body, so `res.ok` sails past them |
| `data.exceededTransferLimit` | the layer outgrew one page — valid JSON, real records, just not all of them. `maxRecordCount` is 2000 against 98 entrances / 227 elevators. Fix is `resultOffset` paging |
| `features.length === 0` | layer renamed or retired: answers successfully with nothing, wiping the file |

---

## Search architecture (`src/data/search.ts`)

All search functions are pure/synchronous. The room index is lazy-loaded once (`require()`) and cached.

### `parseRoomCode`

All 198 searchable buildings have exactly 3-character abbreviations, so the first 3 characters of a normalized query are always the building token:
```
"GDC 2.216" → { buildingToken: "GDC", roomToken: "2.216" }
"MAI 220"   → { buildingToken: "MAI", roomToken: "220" }
"E26"       → { buildingToken: "E26", roomToken: null }   ← numeric abbreviations work correctly
```

### Functions

**`searchBuildings(query, limit=8): SearchMatch[]`**
Parses query into `buildingToken + roomToken`. Returns buildings ranked by: exact abbr → abbr prefix → abbr contains → name contains.

**`searchRooms(query, limit=8): RoomMatch[]`**
Returns rooms where `roomNumber.startsWith(roomToken)` within the matched building. Uses `rankRooms()` to sort: exact match first, then shorter room numbers ascending (prevents "MAI 2209A" from ranking above "MAI 220").

**`getRoomsInBuilding(bldgNo, token='', limit=8): RoomMatch[]`**
Like `searchRooms` but takes a building ID directly. Used in building state autocomplete.

**`resolveRoom(buildingAbbr, roomToken): RoomMatch|null`**
Exact lookup by abbr + room number.

### Search autocomplete logic (`app/search.tsx`)

```
Zero state:
  query has room token    →  searchRooms(query)      returns RoomMatch[]
  query has no room token →  searchBuildings(query)  returns SearchMatch[]

Building/Room state:
  Autocomplete dropdown is HIDDEN
  TextInput remains active for room search within the building
```

---

## Map architecture (`src/map/CampusMap.tsx`)

### Imperative handle (`CampusMapHandle`)

`CampusMap` is a `forwardRef` component exposing three imperative methods:

```ts
export interface CampusMapHandle {
  zoomIn: () => void;      // increments zoom by 1
  zoomOut: () => void;     // decrements zoom by 1
  centerOnUser: () => void; // flies to last known GPS location at zoom 17;
                            // during navigate mode: nav zoom/pitch + re-engages follow
}
```

These are called from `search.tsx` via `mapHandle.current?.zoomIn()` etc., allowing the map toolbar to live outside the map component.

### Props

```ts
interface Props {
  selectedRoom?: RoomMatch | null;
  selectedBuilding?: Building | null;
  selectedFloor?: string | null;       // floor to display the plan for
  cameraRef: React.RefObject<Mapbox.Camera | null>;
  onUserLocation?: (coords: [number, number]) => void;  // fires on GPS update
  onHeadingChange?: (heading: number) => void;          // fires on every camera move
  onBuildingPress?: (buildingId: string) => void;       // fires when footprint tapped at zoom ≥ 15
  onRoomPress?: (roomId: string) => void;               // fires when a floor-plan room is tapped
  onRouteState?: (state: RouteState) => void;           // route lifecycle: pending / ok / why it failed
  onNavProgress?: (progress: NavProgress) => void;      // maneuver, instruction, distances, fix accuracy
  onFollowStateChange?: (disengaged: boolean) => void;  // nav follow camera lost/regained (drives Re-center chip)
  navigateMode?: boolean;              // true while "Walk here" navigation is active
  headerHeight?: number;               // chrome height, so the overview camera frames below it
  onFixQualityChange?: (quality: FixQuality) => void;   // fires on quality band change, not per fix
  debugOrigin?: LngLat | null;         // simulated origin; see src/debug.ts
}
```

`CampusMapHandle` also exposes `focusSelectedRoom()` and `focusSelectedBuilding()`, which the
panel headers call to re-frame the map — the cards outlive whatever the map is showing, so
without them a panned-away selection had no way back.

**Everything the imperative handle reaches must go through a ref.** It is built once
(`[cameraRef]` deps, deliberately — rebuilding it would hand the screen a new object on every
GPS tick), so a prop read directly inside it freezes at its first-render value. `headerHeight`
did exactly that and framed the room under the search bar, because insets have not resolved
on the first render.

### Data sources

| ShapeSource id | Data file | What it renders |
|---|---|---|
| `campus-buildings` | `campus_buildings.geojson` | Building footprint fills + outlines |
| `all-rooms` | `buildings_rooms.geojson` | Floor plan + selected room highlight |
| `building-labels` | In-memory GeoJSON (from buildings.json) | Building abbreviation labels |

Both GeoJSON files are loaded via `Asset.fromModule(...).downloadAsync()` on mount and cached as local URIs.

### Layer stack (bottom → top)

#### `campus-buildings` ShapeSource

Uses **data-driven expressions** instead of separate selected/unselected layers to avoid GL layer ordering bugs. `activeBldgNo` is embedded directly in the expression and re-evaluated whenever it changes.

```
building-fill     aboveLayerID="building"
                  fillColor:   case(Building == activeBldgNo → limestone, else → shade)
                  fillOpacity: case(Building == activeBldgNo → 1.0,       else → 0.7)

building-outline  aboveLayerID="building"
                  lineColor:   case(Building == activeBldgNo → burntOrange, else → blueBonnet)
                  lineWidth:   case(Building == activeBldgNo → 2.5,         else → 1)
                  lineOpacity: 0.9
```

**Layer ordering rule:** all `campus-buildings` layers use `aboveLayerID="building"` (a known Mapbox style layer). Do NOT chain `aboveLayerID` between user-defined layers — rnmapbox resolves these at registration time and the ordering becomes unpredictable. Child order within the ShapeSource determines stacking among same-anchor siblings.

#### `all-rooms` ShapeSource
All layers share `floorFilter`: active building + floor + non-navigable exclusion.
```
floor-plan-fill      All navigable rooms on active floor (highlightFill = rgba(191,87,0,0.25))
floor-plan-outline   Room borders (ink at 30% opacity, 0.8px)
floor-plan-labels    Room numbers (minZoom 17.5, 9px DIN Regular)
                     text derived from room_id by slicing off "bldg_no-floor-" prefix
selected-room-fill   Selected room only, solid orange (burntOrange, 0.9 opacity)
selected-room-outline Selected room border (burntOrangeDark, 2px)
selected-room-label  Selected room number (13px DIN Bold, white, always visible)
```

#### `building-labels` ShapeSource
```
building-abbr   minZoom 15, 11px DIN Bold burntOrangeDark with white halo
```
Labels and building tap activation both begin at zoom 15.

### Camera behavior

| State transition | Camera action |
|---|---|
| Room selected | `setCamera({ center: room.center, zoom: 19, flyTo, padding: FOCUS_PADDING })` |
| Building selected | `setCamera({ center: building.center, zoom: 17, flyTo, padding: FOCUS_PADDING })` |
| Back / X pressed → zero state | `setCamera({ zoom: currentZoom − 1.5, padding: NO_PADDING })` |
| Initial mount (both null) | No imperative call — declarative `bounds` prop handles it |
| Navigate mode entered | Follow camera (device) or manual nav camera (simulator) — see [3D walking navigation](#3d-walking-navigation-navigate-mode) |
| Navigate mode exited | `setCamera({ pitch: 0, heading: 0 })` — flattens back; guarded by `wasNavigating` ref |

`hasHadSelection` ref prevents the zoom-out from firing on initial mount.

**Focal point offset:** `FOCUS_PADDING = { paddingBottom: windowHeight × 0.3 }` shifts the camera's effective center to 35% from the top of the screen (instead of 50%), keeping selected items in the upper portion of the viewport with the info panel below.

**Map bounds:** `maxBounds` on the Camera restricts panning to a 200-mile radius around Austin (SW: `[-101.10, 27.37]`, NE: `[-94.39, 33.17]`). `minZoomLevel={7}` prevents zooming out beyond the bounded region.

### Building tap interaction

Tapping a `campus-buildings` polygon at zoom ≥ 15 calls `onBuildingPress(buildingId)`. Below zoom 15, taps are ignored. The threshold constant is `BUILDING_TAP_MIN_ZOOM = 15` in `CampusMap.tsx`. Works from any state (zero, building, or room).

### Compass and heading

`onCameraChanged` fires on every camera move and reports `state.properties.heading`. This is passed to `search.tsx` via `onHeadingChange`, which drives the rotation of the `N` compass button: `transform: [{ rotate: '${-heading}deg' }]`. Tapping the button calls `cameraRef.current?.setCamera({ heading: 0 })` to reset north.

---

## 3D walking navigation (navigate mode)

Tapping **Walk here** on the room panel sets `navigateMode` and switches the map into a Google-Maps-style first-person view. Constants in `CampusMap.tsx`: `NAV_PITCH = 65`, `NAV_ZOOM = 18.5`, `NAV_PADDING`, `RECENTER_MS = 450`.

`NAV_PADDING` uses **`paddingTop`**, not `paddingBottom`. Padding insets the region the camera centre is placed in, so `paddingTop` is what pushes the puck *down* the screen; the original `paddingBottom: 35%` did the opposite of its stated intent and parked the puck near the top. It is now derived from `NAV_FOCUS_FROM_TOP = 0.72`.

### Route

When a room is selected (any state, not just navigation), `CampusMap` fetches a walking route
from the Mapbox Directions API (`mapbox/walking` profile), reporting lifecycle up via
`onRouteState`. The request carries four parameters beyond the defaults, each fixing a real
problem and each silent if lost — hence the test asserting all of them are present:

| Parameter | Why |
|---|---|
| `walkway_bias=1` | default 0 is neutral, and campus has ~1,000 service roads competing with ~4,300 footways, so routes ignored the paths people walk |
| `overview=full` | default `simplified` decimates geometry; a staircase collapsed into a straight line looked like the router had skipped it |
| `steps=true` | turn-by-turn maneuvers for the nav bar |
| `geometries=geojson` | line geometry |

**Destination is the building entrance, not the room.** `walkTarget` is
`nearestEntrance(...)?.center ?? room.center`. Routing to the room's centroid let Directions
snap to whatever path was nearest, which for a large building is frequently the wrong side
with no door on it. The entrance is chosen once per route request — memoised on
`[selectedRoom, hasFix, debugOrigin, rerouteSeq]`, never per GPS fix, because a destination
that moved with the walker would re-request directions forever.

Arrival (`ARRIVAL_METRES`) is measured against `walkTarget` for the same reason: reaching
the door of a large building can still leave you 80 m from the room's centroid, and measured
the old way arrival would never fire.

In navigate mode the route splits into two lines as the user moves (`splitRouteAtUser`):

```
route-remaining-line   solid blueBonnet, width interpolated zoom 15→19 : 4→9px
route-walked-line      dashed blueBonnet at 40% opacity, width 3→7px
route-final-hop-line   dashed burnt orange, entrance → room (Directions stops outdoors)
room-marker-pin        screen-space pin at the room, iconAnchor bottom, size 1→0.72 by zoom
```

### Camera

- **Real device:** declarative follow props on the Camera — `followUserLocation` +
  `UserTrackingMode.Follow` + `followHeading` + `followPitch`/`followZoomLevel`/`followPadding`.

  **Plain `Follow`, not `FollowWithHeading`.** `FollowWithHeading` maps to
  `followOptions.bearing = .heading` natively, wiring the camera straight to the compass with
  no filter exposed by rnmapbox — a phone held still drifted the whole map. `Follow` maps to
  `bearing = nil`, leaving the bearing to us, and `followHeading` supplies a damped one from
  `src/map/heading.ts`: exponential smoothing (`HEADING_SMOOTHING = 0.2`) plus a deadband
  (`CAMERA_HEADING_DEADBAND = 8`), so the map does not turn until the walker actually turns.
  The puck follows the smoothed heading closely, so small movements move the arrow and leave
  the map still.

  (`FollowWithCourse` was the original setting and was worse still: *course* is GPS
  direction-of-travel, undefined standing still.)
- **Simulator:** GPS is unusable (reports San Francisco; a campus coordinate is seeded), so navigate mode positions the camera manually: seeded origin, `NAV_PITCH`, heading = bearing of the first route segment (`segmentBearing`).
- **Exit:** pitch and heading animate back to 0. The `wasNavigating` ref prevents this from firing on mount.

### 3D buildings — removed

The `buildings-3d` `FillExtrusionLayer` that used to render during navigate mode is gone;
the extrusions were distracting at pitch. Two things depended on it and were fixed alongside:
`building-fill` / `building-outline` no longer force opacity 0 while navigating (they were
hidden *because* the extrusions replaced them), and the route casing no longer anchors
`aboveLayerID="buildings-3d"` — it is unanchored, which places it on top of the style.

### Follow disengagement + Re-center chip

Panning the map during navigation disengages the follow camera. Two detection paths in `CampusMap.tsx`, both feeding `setDisengaged`:

1. `onUserTrackingModeChange` on the Camera — native follow mode ended (real device)
2. `gestures.isGestureActive` in `onCameraChanged` — any user gesture during navigation (works on simulator)

The state gates the `followUserLocation` prop (so clearing it re-engages follow) and is reported to `search.tsx` via `onFollowStateChange`, which shows the **Re-center** chip above the nav bar. The chip calls `centerOnUser()`, which clears the disengaged state and restores the nav camera. State resets automatically on nav enter/exit.

### Nav UI (`search.tsx`)

The room panel is replaced by a compact nav bar: maneuver arrow, the turn instruction, distance
to the maneuver, live ETA, and an **End** button.

The arrow shows the **maneuver**, not a compass bearing — `maneuverRotation()` in
`src/map/steps.ts` maps Mapbox's modifier (`left`, `slight right`, `uturn`, …) to a fixed
screen-relative angle. It previously rotated by `bearing - mapHeading`, which swung as the
walker turned and read as contradicting the written instruction beside it. An unrecognised
modifier points straight ahead rather than guessing.

Instructions come from `steps=true`; `advanceStep()` tracks which maneuver is next and only
ever moves forward, since picking the *nearest* maneuver makes the text flicker between two
turns that are close together.

---

## Screen chrome (`app/search.tsx`, `app/login.tsx`)

### Custom header

The search screen renders its own header instead of the native stack header (`headerShown: false` in `_layout.tsx`). Reason: iOS 26 wraps native `headerLeft`/`headerTitle` items in a tinted "liquid glass" capsule with a shadow and press animation, which distorts the logo. The custom header is a white absolute-positioned overlay containing:

```
logo row (44pt)    header.svg wordmark left · sign-out icon right
                   (sign-out is an inline react-native-svg log-out glyph)
search bar (48pt)  bgSubtle fill + hairline border (no floating shadow)
```

`headerHeight = insets.top + 44 + spacing.sm + 48 + spacing.sm` — the results dropdown (`dropdownTop`) and map toolbar (`toolbarTop`) anchor below it.

### Footer

Thin branded strip pinned to the bottom: `cola-footer.png` (Texas Liberal Arts lockup) centered at 16pt tall. `footerHeight = insets.bottom + 32 + spacing.sm`, with `paddingTop: spacing.sm` for breathing room above the logo and `paddingBottom: insets.bottom` to clear the home indicator. All bottom-anchored UI (floor switcher, room panel, nav bar, Re-center chip) anchors to `panelBottom = footerHeight + spacing.sm` so nothing overlaps the footer.

### Login screen (`app/login.tsx`)

`logo.svg` lockup + tagline in the upper hero area, sign-in button near the bottom, `cola.png` centered beneath it. Sign-out lives in the header (no bottom sign-out button).

### App icon

`assets/Visuals/icon.png` (1024×1024), declared as `icon` in `app.config.js` (source of truth for prebuild/EAS) and mirrored into `ios/UTClassFinder/Images.xcassets/AppIcon.appiconset/`.

---

## UI states (`app/search.tsx`)

### Active building derivation

The "active building" for UI purposes is derived from whichever is set:
```ts
const activeBuilding = selectedBuilding ?? selectedRoom?.building ?? null;
const inBuildingOrRoomState = activeBuilding !== null;
```
This means searching directly for a room (bypassing building state) still shows the building chip and back button, making the experience identical to building → room navigation.

### Zero state
- Search icon `⌕` in bar, no panels, no dropdown until typing begins
- Building labels and footprint polygons visible at zoom ≥ 15

### Building state (building selected, no room)
- `←` back + building chip in search bar; no autocomplete dropdown
- Map: selected building highlighted (limestone fill + burntOrange 2.5px outline); floor plan shown for active floor
- **Floor switcher panel** at bottom: building badge + name, radio button list of floors sorted by `sortedFloors()` and labelled by `formatFloor()`

### Room state (room selected)
- `←` back + building chip + `✕` dismiss in search bar; room number in text input
- Map: floor plan of room's floor; selected room in solid burnt orange with white bold label
- **Room info panel** at bottom: building badge + room number + building name + floor + walking ETA + **Walk here** (3D navigate mode) and **Open in Maps** CTAs
- Building footprint still highlighted in selected style

### Button behavior
```
Any state     tap building polygon (zoom ≥ 15) → enter that building's building state

Building state  ←  → zero state (zoom out 1.5)
Room state      ←  → building state for that room's building (even if building state was bypassed)
Room state      ✕  → zero state (zoom out 1.5)
```

### Map toolbar (`search.tsx`)
Four-button vertical pill on the right side of screen, positioned just below the search bar:
```
+   zoomIn()          mapHandle.current?.zoomIn()
−   zoomOut()         mapHandle.current?.zoomOut()
⊙   centerOnUser()    mapHandle.current?.centerOnUser()
N   resetNorth        cameraRef.current?.setCamera({ heading: 0 })
    (rotates with map heading via -mapHeading transform)
```

---

## Navigation handoff (`src/directions.ts`)

```ts
appleMapsAvailable(): boolean          // iOS only — Android would open a browser
googleMapsAvailable(): Promise<boolean>  // iOS: is it installed; Android: always
openInAppleMaps(center, label?)
openInGoogleMaps(center, label?)
openDirections(building)               // building detail screen
```

The room panel shows **named** buttons — Apple Maps and Google Maps — rather than one "Open
in Maps", which silently meant Apple Maps on iOS with no way to choose. Google appears only
when installed; offering an app the user does not have is worse than not offering the choice.

**`LSApplicationQueriesSchemes` in `Info.plist` is required** for the Google button to ever
appear: iOS reports an undeclared scheme as unavailable from `canOpenURL` *even when the app
is installed*. It declares `comgooglemaps`.

**All three open in transit mode** — these are the way out for journeys too far to walk.
None of these apps error on an unrecognised mode; they quietly fall back to driving, so each
spelling is pinned by a test:

```
Apple Maps        dirflg=r
Google Maps app   directionsmode=transit     (comgooglemaps:// scheme)
Google Maps web   travelmode=transit         (fallback when not installed)
```

---

## Floor utilities (`src/data/buildings.ts`)

```ts
formatFloor(code: string): string
// "01" → "Floor 1",  "001" → "Floor 1",  "01M" → "Floor 1M"
// "GROUND" | "GRO" → "Ground"
// "LL" → "Lower Level"

sortedFloors(floors: string[]): string[]
// Sorts floor codes: LL → B* → GROUND/GRO → numbered floors ascending
```

---

## Theme (`src/theme.ts`)

```ts
colors = {
  burntOrange:     '#BF5700'   // UT primary
  burntOrangeDark: '#9E4700'
  ink:             '#1A1A1A'
  slate:           '#595959'
  mist:            '#8E8E93'
  line:            '#E2E2E2'
  bg:              '#FFFFFF'
  bgSubtle:        '#F7F7F8'
  white:           '#FFFFFF'
  highlightFill:   'rgba(191, 87, 0, 0.25)'  // floor plan room fill
  highlightLine:   '#BF5700'
  shade:           '#9cadb7'   // default building footprint fill
  blueBonnet:      '#005f86'   // default building footprint outline
  limestone:       '#d6d2c4'   // selected building fill
}
```

---

## Authentication (`src/auth/AuthContext.tsx` + `server/`)

UT EID login via OIDC authorization code + PKCE in the system browser, with the
code exchange completed by a token broker we host.

- `UT_OAUTH_ENABLED=false` → mock session, app fully usable
- `UT_OAUTH_ENABLED=true` → real UT SSO flow via `expo-auth-session` + broker

Session is stored in device keychain (`expo-secure-store`).

### Why there is a broker

UT's OP **does not support public clients**. Its discovery document advertises:

```
token_endpoint_auth_methods_supported:
  client_secret_basic, client_secret_post, client_secret_jwt, private_key_jwt
```

`none` is absent, and an unauthenticated exchange is refused:

```
POST /idp/profile/oidc/token   (no client auth)
→ 401 {"error":"invalid_client","error_description":"Client authentication failed"}
```

So the exchange must carry a client secret — which a native app cannot hold,
since anything in `app.config.js`/`.env` is serialised into the shipped bundle.
`server/` resolves this: the app runs authorization + PKCE in the browser as
normal, then POSTs `{code, code_verifier}` to the broker, which attaches
`client_secret_basic` and forwards to UT. PKCE still binds each exchange to the
app instance that started it; the broker adds client authentication and nothing
else. It is stateless and logs outcomes only — never codes, tokens, or the secret.

```
app ──authorize+PKCE──▶ UT IdP (system browser)
app ◀────── code ────── UT IdP
app ──{code, verifier}─▶ broker ──+client_secret──▶ UT /token
app ◀────── tokens ──── broker ◀───── tokens ──────
```

| File | Role |
|---|---|
| `server/broker-core.mjs` | All logic; no HTTP wiring, so both hosts share it |
| `server/worker.mjs` | Cloudflare Worker adapter (production) |
| `server/token-broker.mjs` | Node `http` adapter (local dev only) |
| `wrangler.toml` | Worker config; non-sensitive `[vars]` only |

`client_secret_post` returns `InvalidEvent` on this IdP — **basic auth is the
only method that works**. Both halves of the credential are percent-encoded
before base64: RFC 6749 §2.3.1 requires it and Nimbus (which Shibboleth's OP
parses with) percent-decodes them. Today's secret is alphanumeric so the
encoding is a no-op; it matters at rotation.

There is deliberately **no refresh path**. The app never calls a UT API with the
access token — signing in only proves EID identity — so nothing needs
refreshing, and `offline_access` would mean storing a long-lived refresh token
on-device for no gain. Session length is a local constant, `SESSION_TTL_MS` in
`AuthContext.tsx` (currently 30 days), rather than the IdP's ~1h access token
lifetime; inheriting that would force a browser re-login every hour.

### Deploying the broker

```bash
npx wrangler secret put UT_OAUTH_CLIENT_SECRET   # paste the UT IAM secret
npx wrangler deploy
curl https://<worker-url>/healthz                # → {"ok":true}
```

Then set `UT_OAUTH_BROKER_URL=https://<worker-url>` in `.env` and rebuild the app.

The secret lives **only** in Cloudflare's secret store. It must never be in
`.env`, `wrangler.toml`, or git. `wrangler deploy` uploads only the `[vars]`
declared in `wrangler.toml` (verify with `wrangler deploy --dry-run`); wrangler
reads the repo's `.env` for *local* `dev` runs only. For local dev put the
secret in `.dev.vars` (gitignored) and run `npm run broker:dev`.

Because `/exchange` is a public endpoint proxying to UT, put a Cloudflare rate
limiting rule in front of it. Abuse potential is low — codes are single-use,
short-lived, and PKCE-bound — but the broker is stateless by design and cannot
rate limit itself.

### Registered client (UT IAM)

| Field | Value |
|---|---|
| `client_id` | `cola-class-finder-oidc` |
| `client_secret` | *(confidential — held only by the broker)* |
| `token_endpoint_auth_method` | `client_secret_basic` |
| `grant_types` | `authorization_code` |
| `response_types` | `code` |
| `scope` | `openid profile utexas_profile` |
| `redirect_uris` | `utclassfinder://redirect` |
| `post_logout_redirect_uris` | *(none)* |

`usePKCE: true` in `AuthRequest` is not optional — it is what ties the exchange
to this app instance, and `realSignIn` fails hard if the verifier is missing.
The broker pins `redirect_uri` server-side so a stolen code cannot be redeemed
against a different callback through us.

### Endpoints

UT Enterprise Authentication runs Shibboleth IdP with the OIDC OP plugin. These
match its published discovery document at
`https://enterprise.login.utexas.edu/.well-known/openid-configuration`
(verified 2026-09-03). Defaults live in `app.config.js`, overridable via `.env`:

| Endpoint | URL |
|---|---|
| Issuer | `https://enterprise.login.utexas.edu` |
| Authorization | `https://enterprise.login.utexas.edu/idp/profile/oidc/authorize` |
| Token | `https://enterprise.login.utexas.edu/idp/profile/oidc/token` |
| UserInfo | `https://enterprise.login.utexas.edu/idp/profile/oidc/userinfo` |

### Identity

The EID comes from decoding the `id_token` relayed by the broker
(`decodeJwtPayload` / `eidFromClaims` in `AuthContext.tsx`). The signature is
**not** verified on-device — the token arrives over TLS from the broker, which
received it over TLS from the token endpoint — and anything security-sensitive
must be re-verified server-side.

Confirmed against a real sign-in (2026-09-03), `utexas_profile` releases:

| Claim | Example | Note |
|---|---|---|
| `utexasEduPersonEid` | `abc12345` | The EID. What we read. |
| `uid`, `username` | `abc12345` | Same value, duplicated |
| `sub` | `abc12345@utexas.edu` | Scoped principal, **not** a bare EID |
| `name`, `given_name`, `family_name` | | Display name |
| `eid`, `preferred_username` | — | Do not exist |

`eidFromClaims` reads `utexasEduPersonEid` → `uid` → `username`, then falls back
to `sub` with the scope stripped, then to the literal `"UT EID"`.

The token also carries `utexasEduPersonUin`, `utexasEduPersonAffCode`,
`utexasEduPersonPrimaryTitle`, `eduPersonAffiliation` and similar directory
attributes. None are used, and none are stored — see below.

### What the session stores

Only `{eid, name, expiresAt, mock}`. The access and ID tokens are used once, at
sign-in, and then discarded: nothing in the app calls a UT API, so there is
nothing to present them to.

This is not only tidiness. Persisting the `id_token` tripped SecureStore's
2048-byte advisory limit —

```
WARN  Value being stored in SecureStore is larger than 2048 bytes and it may
not be stored successfully. In a future SDK version, this call may throw.
```

— so sessions could silently fail to persist today and would throw on a future
Expo SDK, and it wrote a JWT full of directory PII into the keychain for no
purpose. If a backend ever needs an identity assertion, re-run the flow rather
than storing one.

### Notes

- No `post_logout_redirect_uris` are registered, so `signOut()` clears the local keychain session only. The IdP browser session persists; the next sign-in may complete without a password prompt. Ask IAM to register a logout redirect if true single-logout is needed.
- Expo Go cannot receive `utclassfinder://redirect` — testing SSO requires a dev client build.
- The discovery document does not advertise `code_challenge_methods_supported`. An authorization request with `S256` is accepted, but that alone does not prove the token endpoint *enforces* the verifier; worth confirming with IAM.

---

## Environment variables

| Variable | Purpose |
|---|---|
| `MAPBOX_ACCESS_TOKEN` | Public token (`pk...`), runtime map rendering |
| `MAPBOX_DOWNLOAD_TOKEN` | Secret token (`sk...`), build-time SDK download only |
| `UT_OAUTH_ENABLED` | `"true"` / `"false"` |
| `UT_OAUTH_CLIENT_ID` | UT IAM client ID (default `cola-class-finder-oidc`) |
| `UT_OAUTH_ISSUER` | OIDC issuer base URL |
| `UT_OAUTH_AUTHORIZATION_ENDPOINT` | Override for the authorization endpoint |
| `UT_OAUTH_TOKEN_ENDPOINT` | Override for the token endpoint |
| `UT_OAUTH_USERINFO_ENDPOINT` | Override for the userinfo endpoint |
| `UT_OAUTH_SCOPES` | Space-separated scopes (default `openid profile utexas_profile`) |
| `UT_OAUTH_BROKER_URL` | Base URL of the deployed token broker; required when enabled |

All `UT_OAUTH_*` values except `ENABLED` and `BROKER_URL` have working defaults in `app.config.js`; set them only to override.

`UT_OAUTH_CLIENT_SECRET` is deliberately **not** in this table. It is never read by the app — only by the broker, from its own host environment. Putting it in `.env` would bake it into the shipped bundle.

---

## Running the app

```bash
npm install
cp .env.example .env   # fill in tokens
npx expo run:ios       # or: npx expo run:android
```

Requires a dev client (native Mapbox module — Expo Go won't work).

To regenerate data files after a GeoJSON update:
```bash
node scripts/build-room-index.mjs
node scripts/build-buildings.mjs assets/data/buildings_rooms.geojson
```

---

## Known data gaps

- **Room 2.455 in ART building**: Does not exist in UT Facilities' source data. Room numbers jump `2.454 → 2.456`. This is a gap in UT's system — nothing to fix in the app.
- **7 buildings without footprints**: `CCC`, `DI1`, `E13`, `E15`, `E27`, `JCB`, `UTS` have room data but no polygon in `campus_buildings.geojson`. They were not published to the ArcGIS endpoints at the time of data collection.
- **Room geometry precision**: Source floor plans were digitized in Texas State Plane (feet). Converted to WGS84, wall corners carry ~30cm positional error. At zoom 19 (~26cm/px) this produces slightly non-straight walls. This is inherent GIS imprecision in UT Facilities' data and cannot be corrected without re-digitizing the source.

---

## Open items

- **UT SSO:** working end to end. Endpoints match the published discovery document, the broker is deployed at `https://utclassfinder-token-broker.emk.workers.dev`, and a real EID sign-in has completed on a dev client with the EID resolved from `utexasEduPersonEid`. Remaining: add a Cloudflare rate limiting rule in front of `/exchange`, rotate the client secret, and register a `post_logout_redirect_uri` with IAM if true single-logout is wanted.
- **Room search scope:** `getRoomsInBuilding` uses a fixed limit of 8 for autocomplete; a larger limit or pagination could be useful if the room list grows in building state
