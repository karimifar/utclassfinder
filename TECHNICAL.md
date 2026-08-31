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
  onRouteInfo?: (info: { distance; duration } | null) => void;  // walking route fetched/cleared
  onFollowStateChange?: (disengaged: boolean) => void;  // nav follow camera lost/regained (drives Re-center chip)
  navigateMode?: boolean;              // true while "Walk here" navigation is active
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

Tapping **Walk here** on the room panel sets `navigateMode` and switches the map into a Google-Maps-style first-person view. Constants in `CampusMap.tsx`: `NAV_PITCH = 60`, `NAV_ZOOM = 18`, `NAV_PADDING` (bottom padding = 35% of screen height, so the puck sits low with the route ahead).

### Route

When a room is selected (any state, not just navigation), `CampusMap` fetches a walking route from the Mapbox Directions API (`mapbox/walking` profile) from the user's location to `room.center`, reporting `{distance, duration}` up via `onRouteInfo`. In navigate mode the route splits into two lines as the user moves (`splitRouteAtUser`):

```
route-remaining-line   solid blueBonnet, width interpolated zoom 15→19 : 4→9px
route-walked-line      dashed blueBonnet at 40% opacity, width 3→7px
nav-destination-dot    burnt orange circle, white stroke (room center)
```

### Camera

- **Real device:** declarative follow props on the Camera — `followUserLocation` + `UserTrackingMode.FollowWithCourse` (heading-up) + `followPitch`/`followZoomLevel`/`followPadding`. Mapbox drives the camera from GPS.
- **Simulator:** GPS is unusable (reports San Francisco; a campus coordinate is seeded), so navigate mode positions the camera manually: seeded origin, `NAV_PITCH`, heading = bearing of the first route segment (`segmentBearing`).
- **Exit:** pitch and heading animate back to 0. The `wasNavigating` ref prevents this from firing on mount.

### 3D buildings

A `FillExtrusionLayer` (`buildings-3d`) renders only during navigate mode, sourced from the Light style's own `composite` / `building` source-layer (OSM-derived `height` / `min_height` attributes, citywide). Extrusions draw at 75% opacity so route segments behind buildings stay faintly visible. The flat `building-fill` / `building-outline` layers set opacity 0 while navigating to avoid z-fighting.

### Follow disengagement + Re-center chip

Panning the map during navigation disengages the follow camera. Two detection paths in `CampusMap.tsx`, both feeding `setDisengaged`:

1. `onUserTrackingModeChange` on the Camera — native follow mode ended (real device)
2. `gestures.isGestureActive` in `onCameraChanged` — any user gesture during navigation (works on simulator)

The state gates the `followUserLocation` prop (so clearing it re-engages follow) and is reported to `search.tsx` via `onFollowStateChange`, which shows the **Re-center** chip above the nav bar. The chip calls `centerOnUser()`, which clears the disengaged state and restores the nav camera. State resets automatically on nav enter/exit.

### Nav UI (`search.tsx`)

The room panel is replaced by a compact nav bar: bearing arrow (rotates toward the destination from `bearing(userCoords, room.center)`), destination, live ETA/distance, and an **End** button that exits navigate mode.

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

UT EID login via OIDC authorization code + PKCE in the system browser.

- `UT_OAUTH_ENABLED=false` → mock session, 8-hour expiry, app fully usable
- `UT_OAUTH_ENABLED=true` → real UT SSO flow via `expo-auth-session`

Session is stored in device keychain (`expo-secure-store`).

### Registered client (UT IAM)

| Field | Value |
|---|---|
| `client_id` | `cola-class-finder-oidc` |
| `client_secret` | *(none — public native client)* |
| `token_endpoint_auth_method` | `none` |
| `grant_types` | `authorization_code` |
| `response_types` | `code` |
| `scope` | `openid profile utexas_profile` |
| `redirect_uris` | `utclassfinder://redirect` |
| `post_logout_redirect_uris` | *(none)* |

Because there is no client secret, **PKCE is the only thing binding the token exchange to this app** — `usePKCE: true` in `AuthRequest` is not optional.

### Endpoints

UT Enterprise Authentication runs Shibboleth IdP with the OIDC OP plugin. Defaults live in `app.config.js` and can be overridden per-environment in `.env`:

| Endpoint | URL |
|---|---|
| Issuer | `https://enterprise.login.utexas.edu` |
| Authorization | `https://enterprise.login.utexas.edu/idp/profile/oidc/authorize` |
| Token | `https://enterprise.login.utexas.edu/idp/profile/oidc/token` |
| UserInfo | `https://enterprise.login.utexas.edu/idp/profile/oidc/userinfo` |

### Identity

The EID comes from decoding the `id_token` returned by the token endpoint (`decodeJwtPayload` / `eidFromClaims` in `AuthContext.tsx`). Claim names vary by IdP release policy, so we try `eid` → `utexasEduPersonEid` → `uid` → `preferred_username` → `sub` and fall back to the literal `"UT EID"`. The signature is **not** verified on-device — the token arrives over TLS straight from the token endpoint, and anything security-sensitive must be re-verified server-side.

### Notes

- No `post_logout_redirect_uris` are registered, so `signOut()` clears the local keychain session only. The IdP browser session persists; the next sign-in may complete without a password prompt. Ask IAM to register a logout redirect if true single-logout is needed.
- Expo Go cannot receive `utclassfinder://redirect` — testing SSO requires a dev client build.

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

All `UT_OAUTH_*` values except `ENABLED` have working defaults in `app.config.js`; set them only to override.

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

- **UT SSO:** client is provisioned and wired up, but untested against the live IdP. Two things to confirm with IAM before flipping `UT_OAUTH_ENABLED=true`: (1) the exact endpoint paths — the discovery document at `/.well-known/openid-configuration` was not publicly readable, so the Shibboleth defaults are inferred; (2) which claim `utexas_profile` releases the EID under.
- **Room search scope:** `getRoomsInBuilding` uses a fixed limit of 8 for autocomplete; a larger limit or pagination could be useful if the room list grows in building state
