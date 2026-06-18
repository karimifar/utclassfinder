// Generates assets/data/room-index.json from buildings_rooms.geojson.
// Each entry: { room_id, bldg_no, building_abbr, floor, roomNumber, center: [lng, lat] }
// Only includes rooms where room_id has a non-empty third segment (the room number).
// Run: node scripts/build-room-index.mjs

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const geojson = JSON.parse(
  readFileSync(join(root, 'assets/data/buildings_rooms.geojson'), 'utf8')
);

const index = [];

for (const feature of geojson.features) {
  const { room_id, bldg_no, building_abbr, floor } = feature.properties;
  if (!room_id) continue;

  // room_id format: "{bldg_no}-{floor}-{roomNumber}", e.g. "0152-07-2.216"
  const parts = room_id.split('-');
  // bldg_no itself may contain hyphens (e.g. "WC02") so the room number is
  // everything after the second hyphen-delimited segment counting from the end.
  // The last segment is always the room number; second-to-last is the floor.
  if (parts.length < 3) continue;
  const roomNumber = parts[parts.length - 1];
  if (!roomNumber) continue;

  // Compute centroid from polygon ring
  const ring = feature.geometry.coordinates[0];
  let lngSum = 0, latSum = 0;
  for (const [lng, lat] of ring) {
    lngSum += lng;
    latSum += lat;
  }
  const n = ring.length;
  const center = [
    Math.round((lngSum / n) * 1e6) / 1e6,
    Math.round((latSum / n) * 1e6) / 1e6,
  ];

  index.push({ room_id, bldg_no, building_abbr, floor, roomNumber, center });
}

writeFileSync(
  join(root, 'assets/data/room-index.json'),
  JSON.stringify(index)
);

console.log(`Done. ${index.length} rooms indexed from ${geojson.features.length} features.`);
