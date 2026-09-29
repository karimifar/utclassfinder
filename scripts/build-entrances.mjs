// Generates assets/data/entrances.json from UT's public campus map services.
//
// Source: the "Celebrated Entrances" layer behind UT's New Campus Map (2025),
// published by TRECS_PUB on ArcGIS Online. "Celebrated entrance" is UT's term
// for a building's primary entrance. The layer is authoritative, maintained,
// and — crucially — carries Bldg_Abbr, which joins straight to buildings.json.
//
// The ADA_Celebrated_Entrances layer is exactly this layer filtered to
// BarrierFree = Y, so pulling this one gives both the routing destinations and
// the accessible-entrance set from a single fetch.
//
// Run: node scripts/build-entrances.mjs
// Only needs re-running when UT edits the source, which they do periodically —
// the records carry last_edited_date.

import { writeFileSync } from 'fs';
import { fetchLayer, byBuilding } from './lib/arcgis.mjs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const SERVICE =
  'https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services' +
  '/Celebrated_Entrances_view/FeatureServer/0/query';

const params = new URLSearchParams({
  where: "Status = 'Active'",
  outFields: 'Bldg_Abbr,Bldg_Number,Directional,BarrierFree,AutoOpener,Description',
  outSR: '4326',
  returnGeometry: 'true',
  resultRecordCount: '2000',
  f: 'json',
});

const features = await fetchLayer(SERVICE, Object.fromEntries(params));

const { grouped: out, skipped } = byBuilding(
  features,
  (a, center) => ({
    center,
    side: a.Directional || null,
    barrierFree: a.BarrierFree === 'Y',
    autoOpener: a.AutoOpener === 'Y',
    description: (a.Description ?? '').trim() || null,
  }),
  'Bldg_Abbr',
);

writeFileSync(join(root, 'assets/data/entrances.json'), JSON.stringify(out, null, 0) + '\n');

const total = Object.values(out).reduce((n, v) => n + v.length, 0);
const barrierFree = Object.values(out).flat().filter((e) => e.barrierFree).length;
console.log(`wrote assets/data/entrances.json`);
console.log(`  ${total} entrances across ${Object.keys(out).length} buildings`);
console.log(`  ${barrierFree} barrier-free, ${total - barrierFree} not`);
if (skipped) console.log(`  skipped ${skipped} without an abbreviation or geometry`);
