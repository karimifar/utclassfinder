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
  auth/AuthContext.tsx  Session state, real OAuth + mock fallback
  data/
    types.ts            Shared TypeScript types (Building, RoomMatch, SearchMatch)
    buildings.ts        buildings.json loader + getBuildingById / getBuildingByAbbr
                        + formatFloor / sortedFloors utilities
    search.ts           All search functions (see Search section)
  map/
    CampusMap.tsx       Main map component (search screen)
    BuildingMap.tsx     Small footprint map (building detail screen)
  directions.ts         Apple/Google Maps handoff
  theme.ts              Colors, spacing, border-radius

assets/data/
  buildings.json          Slim building metadata, generated (do not edit by hand)
  buildings_rooms.geojson 54 k room polygons, sourced from UT Facilities
  room-index.json         ~36.7 k searchable rooms, generated (do not edit by hand)
  campus_buildings.geojson 231 official building footprints, sourced from ArcGIS

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
  centerOnUser: () => void; // flies to last known GPS location at zoom 17
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
}
```

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

`hasHadSelection` ref prevents the zoom-out from firing on initial mount.

**Focal point offset:** `FOCUS_PADDING = { paddingBottom: windowHeight × 0.3 }` shifts the camera's effective center to 35% from the top of the screen (instead of 50%), keeping selected items in the upper portion of the viewport with the info panel below.

**Map bounds:** `maxBounds` on the Camera restricts panning to a 200-mile radius around Austin (SW: `[-101.10, 27.37]`, NE: `[-94.39, 33.17]`). `minZoomLevel={7}` prevents zooming out beyond the bounded region.

### Building tap interaction

Tapping a `campus-buildings` polygon at zoom ≥ 15 calls `onBuildingPress(buildingId)`. Below zoom 15, taps are ignored. The threshold constant is `BUILDING_TAP_MIN_ZOOM = 15` in `CampusMap.tsx`. Works from any state (zero, building, or room).

### Compass and heading

`onCameraChanged` fires on every camera move and reports `state.properties.heading`. This is passed to `search.tsx` via `onHeadingChange`, which drives the rotation of the `N` compass button: `transform: [{ rotate: '${-heading}deg' }]`. Tapping the button calls `cameraRef.current?.setCamera({ heading: 0 })` to reset north.

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
- **Room info panel** at bottom: building badge + room number + building name + floor + Navigate here CTA
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
openDirections(building)
// Opens walking directions to building.center

openDirectionsToCoordinate(center: [lng, lat], label?)
// Opens walking directions to an arbitrary coordinate — used for room-level navigation
// iOS  → http://maps.apple.com/?daddr={lat},{lng}&q={label}&dirflg=w
// Android → https://www.google.com/maps/dir/?api=1&destination={lat},{lng}&travelmode=walking
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

## Authentication (`src/auth/AuthContext.tsx`)

UT EID login via OAuth 2.0 / OIDC with PKCE in the system browser.

- `UT_OAUTH_ENABLED=false` → mock session, 8-hour expiry, app fully usable
- `UT_OAUTH_ENABLED=true` → real UT SSO flow via `expo-auth-session`

Session is stored in device keychain (`expo-secure-store`). Redirect URI: `utclassfinder://redirect` — must be registered with UT ITS.

**Open item:** UT ITS has not yet provisioned the OAuth client. Endpoints and client ID are placeholders in `.env`.

---

## Environment variables

| Variable | Purpose |
|---|---|
| `MAPBOX_ACCESS_TOKEN` | Public token (`pk...`), runtime map rendering |
| `MAPBOX_DOWNLOAD_TOKEN` | Secret token (`sk...`), build-time SDK download only |
| `UT_OAUTH_ENABLED` | `"true"` / `"false"` |
| `UT_OAUTH_CLIENT_ID` | From UT ITS |
| `UT_OAUTH_AUTHORIZATION_ENDPOINT` | OIDC authorization endpoint |
| `UT_OAUTH_TOKEN_ENDPOINT` | OIDC token endpoint |

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

- **UT SSO:** waiting on UT ITS to provision the OAuth client and endpoints
- **Room search scope:** `getRoomsInBuilding` uses a fixed limit of 8 for autocomplete; a larger limit or pagination could be useful if the room list grows in building state
