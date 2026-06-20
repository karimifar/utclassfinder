import { BUILDINGS, getBuildingByAbbr, getBuildingById } from './buildings';
import type { Building, RoomMatch, SearchMatch } from './types';

type RoomIndexEntry = {
  room_id: string;
  bldg_no: string;
  building_abbr: string;
  floor: string;
  roomNumber: string;
  center: [number, number];
};

let _roomIndex: RoomIndexEntry[] | null = null;
function getRoomIndex(): RoomIndexEntry[] {
  if (!_roomIndex) {
    _roomIndex = require('../../assets/data/room-index.json') as RoomIndexEntry[];
  }
  return _roomIndex;
}

let _roomsByBuilding: Map<string, RoomIndexEntry[]> | null = null;
function getRoomsByBuilding(): Map<string, RoomIndexEntry[]> {
  if (!_roomsByBuilding) {
    _roomsByBuilding = new Map();
    for (const r of getRoomIndex()) {
      const list = _roomsByBuilding.get(r.bldg_no);
      if (list) list.push(r);
      else _roomsByBuilding.set(r.bldg_no, [r]);
    }
  }
  return _roomsByBuilding;
}

// Sort rooms so exact matches come first, then by room number length ascending.
// This ensures "220" ranks above "2209A" when the user typed "220".
function rankRooms(rooms: RoomIndexEntry[], token: string): RoomIndexEntry[] {
  const upper = token.toUpperCase();
  return [...rooms].sort((a, b) => {
    const aUp = a.roomNumber.toUpperCase();
    const bUp = b.roomNumber.toUpperCase();
    const aExact = aUp === upper ? 0 : 1;
    const bExact = bUp === upper ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return aUp.length - bUp.length;
  });
}

/**
 * Return up to `limit` rooms whose number starts with the room token in `query`.
 * Returns [] when the query has no room token or the building isn't recognised.
 */
export function searchRooms(query: string, limit = 8): RoomMatch[] {
  const { buildingToken, roomToken } = parseRoomCode(normalize(query));
  if (!roomToken) return [];
  const building = getBuildingByAbbr(buildingToken);
  if (!building) return [];
  const token = roomToken.toUpperCase();
  const rooms = getRoomsByBuilding().get(building.id) ?? [];
  const matches = rooms.filter(r => r.roomNumber.toUpperCase().startsWith(token));
  return rankRooms(matches, token).slice(0, limit).map(r => ({
    building, roomId: r.room_id, bldgNo: r.bldg_no, center: r.center, floor: r.floor, roomNumber: r.roomNumber,
  }));
}

/**
 * Given a building abbreviation and a room token (e.g. "2.216"), find the
 * matching room in the index and return its location and id for the map.
 */
export function resolveRoom(buildingAbbr: string, roomToken: string): RoomMatch | null {
  const building = getBuildingByAbbr(buildingAbbr);
  if (!building) return null;
  const bldgNo = building.id;
  const token = roomToken.toUpperCase();
  const entry = getRoomIndex().find(
    (r) => r.bldg_no === bldgNo && r.roomNumber.toUpperCase() === token
  );
  if (!entry) return null;
  return {
    building,
    roomId: entry.room_id,
    bldgNo: entry.bldg_no,
    center: entry.center,
    floor: entry.floor,
    roomNumber: entry.roomNumber,
  };
}

/** Uppercase, collapse internal whitespace, trim. "  cfa  204 " -> "CFA 204". */
export function normalize(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Split a room code into its building token and room token.
 * All UT building abbreviations are exactly 3 characters, so the first 3
 * characters are always the building token and everything after is the room.
 * "GDC 2.216" -> { buildingToken: "GDC", roomToken: "2.216" }
 * "MAI 220"   -> { buildingToken: "MAI", roomToken: "220" }
 * "MAI220"    -> { buildingToken: "MAI", roomToken: "220" }
 * "E26"       -> { buildingToken: "E26", roomToken: null }
 * "GDC"       -> { buildingToken: "GDC", roomToken: null }
 * "GD"        -> { buildingToken: "GD",  roomToken: null }  (partial, still works for prefix search)
 */
export function parseRoomCode(raw: string): {
  buildingToken: string;
  roomToken: string | null;
} {
  const norm = normalize(raw);
  const buildingToken = norm.slice(0, 3);
  const rest = norm.slice(3).trim();
  return { buildingToken, roomToken: rest || null };
}

/**
 * Return rooms within a specific building, optionally filtered by a room token prefix.
 * Empty token returns the first `limit` rooms (sorted as stored).
 */
export function getRoomsInBuilding(bldgNo: string, token = '', limit = 8): RoomMatch[] {
  const building = getBuildingById(bldgNo);
  if (!building) return [];
  const rooms = getRoomsByBuilding().get(bldgNo) ?? [];
  const upper = token.trim().toUpperCase();
  const filtered = upper ? rankRooms(rooms.filter(r => r.roomNumber.toUpperCase().startsWith(upper)), upper) : rooms;
  return filtered.slice(0, limit).map(r => ({
    building,
    roomId: r.room_id,
    bldgNo: r.bldg_no,
    center: r.center,
    floor: r.floor,
    roomNumber: r.roomNumber,
  }));
}

/**
 * Rank buildings against a query. Exact abbr match wins, then abbr prefix,
 * then name contains. Returns up to `limit` matches for autocomplete.
 */
export function searchBuildings(query: string, limit = 8): SearchMatch[] {
  const q = normalize(query);
  if (!q) return [];
  const { buildingToken, roomToken } = parseRoomCode(q);

  // Fast path: exact abbreviation hit.
  const exact = getBuildingByAbbr(buildingToken);
  const results: SearchMatch[] = [];
  const seen = new Set<string>();
  const push = (building: Building, score: number) => {
    if (seen.has(building.id)) return;
    seen.add(building.id);
    results.push({ building, score, roomToken });
  };

  if (exact) push(exact, 0);

  for (const b of BUILDINGS) {
    const abbr = (b.abbr ?? '').toUpperCase();
    const name = (b.name ?? '').toUpperCase();
    if (abbr && abbr.startsWith(buildingToken)) push(b, 1);
    else if (abbr && abbr.includes(buildingToken)) push(b, 2);
    else if (name.includes(q)) push(b, 3);
    else if (name.includes(buildingToken)) push(b, 4);
  }

  return results.sort((a, b) => a.score - b.score).slice(0, limit);
}
