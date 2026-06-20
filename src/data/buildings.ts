import raw from '../../assets/data/buildings.json';
import type { Building } from './types';

/**
 * The bundled building dataset. Generated from UT's room-footprint GeoJSON by
 * scripts/build-buildings.mjs. Regenerate with `npm run build:data`.
 */
export const BUILDINGS: Building[] = (raw as Building[]).filter(b => b.hasFootprint);

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

export function formatFloor(code: string): string {
  const upper = code.toUpperCase().trim();
  if (upper === 'GROUND' || upper === 'GRO') return 'Ground';
  if (upper === 'LL') return 'Lower Level';
  const stripped = code.replace(/^0+/, '') || '0';
  return `Floor ${stripped}`;
}

export function sortedFloors(floors: string[]): string[] {
  return [...floors].sort((a, b) => floorSortKey(a) - floorSortKey(b));
}

function floorSortKey(code: string): number {
  const upper = code.toUpperCase();
  if (upper === 'LL') return -2;
  if (upper.startsWith('B')) return -1;
  if (upper === 'GROUND' || upper === 'GRO') return 0;
  return parseFloat(code.replace(/[^0-9.]/g, '')) || 99;
}
