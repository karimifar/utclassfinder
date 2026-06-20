export type LngLat = [number, number];

/** One building, as produced by scripts/build-buildings.mjs. */
export interface Building {
  /** Facility building number, e.g. "0364". Stable internal id. */
  id: string;
  /** Campus abbreviation students recognize, e.g. "GDC". May be null. */
  abbr: string | null;
  /** Full building name, e.g. "GATES DELL COMPLEX". */
  name: string | null;
  /** Centroid [lng, lat] — used for the map pin and directions target. */
  center: LngLat;
  /** Convex-hull outline [[lng, lat], ...] for highlighting on the map. */
  footprint: LngLat[];
  /** Floors present in the dataset, e.g. ["01","02",...]. */
  floors: string[];
  /** Number of room polygons that make up this building. */
  roomCount: number;
  /** True when a footprint polygon exists in campus_buildings.geojson. */
  hasFootprint: boolean;
}

export interface SearchMatch {
  building: Building;
  /** Lower is better. */
  score: number;
  /** The room token the user typed, if any, e.g. "2.216". */
  roomToken: string | null;
}

export interface RoomMatch {
  building: Building;
  roomId: string;
  bldgNo: string;
  center: LngLat;
  floor: string;
  roomNumber: string;
}
