import raw from '../../assets/data/buildings.json';
import type { Building } from './types';

/**
 * The bundled building dataset. Generated from UT's room-footprint GeoJSON by
 * scripts/build-buildings.mjs. Regenerate with `npm run build:data`.
 */
export const BUILDINGS: Building[] = raw as Building[];

const byId = new Map(BUILDINGS.map((b) => [b.id, b]));
const byAbbr = new Map(
  BUILDINGS.filter((b) => b.abbr).map((b) => [b.abbr!.toUpperCase(), b]),
);

export function getBuildingById(id: string): Building | undefined {
  return byId.get(id);
}

export function getBuildingByAbbr(abbr: string): Building | undefined {
  return byAbbr.get(abbr.toUpperCase());
}
