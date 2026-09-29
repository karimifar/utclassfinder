// Generates assets/data/elevators.json from UT's public campus map services.
//
// Source: the "Elevators" layer behind UT's New Campus Map (2025), published by
// TRECS_PUB on ArcGIS Online — the same portal as the building footprints and
// celebrated entrances.
//
// Each record is an elevator *bank*, not a single car: Cab_Count says how many
// cars are at that location. Coverage is far broader than the entrance survey
// (~120 of the app's selectable buildings, against 56 for entrances).
//
// Run: node scripts/build-elevators.mjs
// Snapshot, not a live feed — the app imports the JSON statically. Re-run when
// refreshing campus data.

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchLayer, byBuilding } from './lib/arcgis.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const SERVICE =
  'https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services' +
  '/Elevators/FeatureServer/0/query';

const features = await fetchLayer(SERVICE, {
  where: '1=1',
  outFields: 'Building,Cab_Count,Private,Notes',
  outSR: '4326',
  returnGeometry: 'true',
  resultRecordCount: '2000',
  f: 'json',
});

const { grouped: out, skipped } = byBuilding(
  features,
  (a, center) => ({
    center,
    // How many cars at this location. Null where UT left it blank.
    cabs: typeof a.Cab_Count === 'number' ? a.Cab_Count : null,
    // Restricted rather than public — service or keyed elevators. Kept rather
    // than dropped so the app can decide whether to show them; a user looking
    // for a way up should not be sent to one they cannot call.
    private: a.Private === 'Yes',
    notes: (a.Notes ?? '').trim() || null,
  }),
  'Building',
);

writeFileSync(join(root, 'assets/data/elevators.json'), JSON.stringify(out, null, 0) + '\n');

const all = Object.values(out).flat();
const publicOnes = all.filter((e) => !e.private);
console.log('wrote assets/data/elevators.json');
console.log(`  ${all.length} elevator locations across ${Object.keys(out).length} buildings`);
console.log(`  ${publicOnes.length} public, ${all.length - publicOnes.length} private`);
console.log(`  ${publicOnes.reduce((n, e) => n + (e.cabs ?? 0), 0)} public cars in total`);
if (skipped) console.log(`  skipped ${skipped} without a building or geometry`);
