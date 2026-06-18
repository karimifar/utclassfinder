# UT Class Finder

A cross-platform mobile app that lets UT Austin students find any classroom by
typing the room code from their course schedule. The app authenticates students
with their UT EID, then shows the building, its floors, a campus map with the
building highlighted, and a **Get Directions** button that hands off to the
phone's maps app.

Built with **Expo + React Native (TypeScript)** so a single codebase ships to
both **iOS** and **Android**.

## Status

MVP scaffold. What works today:

- UT EID login screen with a local mock session (real UT SSO is wired but gated
  off until ITS provisions the app — see [Authentication](#authentication)).
- Room-code search with normalization and autocomplete over all 538 buildings.
- Result screen with a Mapbox map highlighting the building footprint, plus
  Get Directions handoff to Apple/Google Maps.

Known limitation: the bundled dataset has **building footprints only — no
room numbers**. Every search currently resolves to the building, and directions
go to the building. Adding room-level lookup needs a separate data source (see
[Data](#data)).

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | Expo (dev client) + React Native, TypeScript |
| Navigation | expo-router (file-based, in `app/`) |
| Map | `@rnmapbox/maps` (native Mapbox GL) |
| Auth | `expo-auth-session` (OAuth 2.0 / OIDC + PKCE, system browser) |
| Secure storage | `expo-secure-store` (Keychain / Keystore) |
| Location | `expo-location` |

## Getting started

Requires Node 18+, the Expo CLI, and a Mapbox account.

```bash
npm install
npx expo install        # reconcile native dep versions to the Expo SDK
cp .env.example .env     # then fill in your tokens (see below)
```

Because the app uses native modules (Mapbox), it needs a **dev client**, not
Expo Go:

```bash
npx expo run:ios         # or: npx expo run:android
```

### Environment variables

Set these in `.env` (gitignored):

| Variable | What |
| --- | --- |
| `MAPBOX_ACCESS_TOKEN` | Public token (`pk....`), used at runtime to render the map. |
| `MAPBOX_DOWNLOAD_TOKEN` | Secret token (`sk....`) with `DOWNLOADS:READ`, used only at build time to fetch the native SDK. |
| `UT_OAUTH_ENABLED` | `true` to use real UT SSO; `false` for the mock login. |
| `UT_OAUTH_CLIENT_ID` | OAuth client id from UT ITS. |
| `UT_OAUTH_AUTHORIZATION_ENDPOINT` | OIDC authorization endpoint. |
| `UT_OAUTH_TOKEN_ENDPOINT` | OIDC token endpoint. |

## Project structure

```
app/                     expo-router screens
  _layout.tsx            root layout + auth gate
  login.tsx              UT EID sign-in
  search.tsx             room-code search + autocomplete
  building/[id].tsx      result: map + Get Directions
src/
  auth/AuthContext.tsx   session state, real OAuth flow + mock fallback
  data/                  types, dataset loader, search/normalization
  map/BuildingMap.tsx    Mapbox footprint highlight
  directions.ts          Apple/Google Maps handoff
  theme.ts               colors + spacing
scripts/
  build-buildings.mjs    GeoJSON -> slim buildings.json
assets/data/buildings.json  bundled dataset (generated)
```

## Authentication

UT EID logins go through UT's SSO. For a native app the right path is OAuth 2.0
/ OIDC opened in the system browser with PKCE, which `expo-auth-session`
implements on both platforms. The flow lives in `src/auth/AuthContext.tsx`:

- While `UT_OAUTH_ENABLED=false`, `signIn()` mints a local mock session so the
  rest of the app is fully testable.
- When ITS provides the client id and endpoints, set the env vars and flip
  `UT_OAUTH_ENABLED=true`; the same `signIn()` runs the real flow.

Tokens are stored in the device keychain via `expo-secure-store` — no
credentials are persisted in plain text. The redirect URI is
`utclassfinder://redirect`; register it with ITS.

> **Open item:** confirm the OAuth endpoints and register the redirect URI with
> UT ITS (Entity ID, metadata XML, requested attributes).

## Data

`assets/data/buildings.json` is generated from UT's room-footprint GeoJSON:

```bash
npm run build:data       # node scripts/build-buildings.mjs <input> <output>
```

Each record has the building abbreviation, name, centroid (for the map pin and
directions), a convex-hull footprint (for the highlight), and its floor list.

> **Open items:**
> - The source GeoJSON has **no room numbers**, so the schedule-style "CFA 204"
>   lookup falls back to building level. Room-level data needs UT's room
>   inventory as a separate source.
> - Some abbreviations don't match the schedule codes (e.g. `CFA`). A building
>   abbreviation crosswalk will be needed.
> - Dataset ownership and update cadence are TBD (per the PRD).

## Roadmap

- Real UT SSO once ITS provisions the app
- Room-level data + floor plans
- Course-schedule integration (auto-pull registered classrooms)
- Indoor turn-by-turn, bathroom finder, accessibility directions
