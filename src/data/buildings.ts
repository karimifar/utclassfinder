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

/**
 * Display labels for one building's floors, keyed by raw floor code.
 *
 * 65 of 538 buildings carry two floor series: the usual `01`, `02` and also
 * `001`, `002`. Both strip to the same label, which showed FAC two rows both
 * reading "Floor 1". They are genuinely different levels — no room number
 * appears on both, and each is a full floor plate — but the dataset holds no
 * descriptor saying what the `001` series *is*, so the raw code is appended
 * rather than guessed at.
 *
 * The shorter code keeps the plain label, because `01` is the campus-wide norm
 * (527 buildings) and `001` the exception (67).
 */
export function floorLabels(floors: string[]): Map<string, string> {
  const grouped = new Map<string, string[]>();
  for (const code of floors) {
    const label = formatFloor(code);
    const codes = grouped.get(label);
    if (codes) codes.push(code);
    else grouped.set(label, [code]);
  }

  const labels = new Map<string, string>();
  for (const [label, codes] of grouped) {
    if (codes.length === 1) {
      labels.set(codes[0], label);
      continue;
    }
    const [plain, ...rest] = [...codes].sort((a, b) => a.length - b.length || a.localeCompare(b));
    labels.set(plain, label);
    for (const code of rest) labels.set(code, `${label} (${code})`);
  }
  return labels;
}

/** One floor's label, disambiguated against the rest of its building. */
export function floorLabel(code: string, floors: string[]): string {
  return floorLabels(floors).get(code) ?? formatFloor(code);
}

/**
 * `floorLabel` in sentence position — "Room 2.106 is on ...".
 *
 * The bare labels read fine standing alone in the floor switcher, but not mid
 * sentence: "is on Ground", "is on Lower Level".
 */
export function floorPhrase(code: string, floors: string[]): string {
  const base = formatFloor(code);
  // '' normally, or ' (001)' where the label had to be disambiguated.
  const suffix = floorLabel(code, floors).slice(base.length);
  if (base === 'Ground') return `the Ground floor${suffix}`;
  if (base === 'Lower Level') return `the Lower Level${suffix}`;
  return `${base}${suffix}`;
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
