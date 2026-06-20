#!/usr/bin/env node
/**
 * Converts the raw UT room-footprint GeoJSON into a slim buildings dataset the
 * app bundles and searches over.
 *
 * Input : a FeatureCollection of room Polygons with properties
 *         { bldg_no, building_abbr, description, floor, room_number, room_type, area }
 * Output: assets/data/buildings.json — one record per building:
 *         { id, abbr, name, center: [lng,lat], footprint: [[lng,lat], ...], floors, roomCount }
 *
 * Footprint is the convex hull of all of a building's room vertices — a cheap,
 * good-enough outline for highlighting on the map. Swap in true building
 * outlines later if UT Facilities provides them.
 *
 * Usage:
 *   node scripts/build-buildings.mjs <input.geojson> [output.json]
 */
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const input = process.argv[2];
const output = process.argv[3] ?? 'assets/data/buildings.json';
if (!input) {
  console.error('Usage: node scripts/build-buildings.mjs <input.geojson> [output.json]');
  process.exit(1);
}

// Andrew's monotone chain convex hull.
function convexHull(points) {
  const pts = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

const round = (n) => Math.round(n * 1e6) / 1e6;

// Load footprint building IDs from campus_buildings.geojson for the hasFootprint flag.
const footprintsPath = join(__dirname, '..', 'assets/data/campus_buildings.geojson');
const footprintIds = new Set();
if (fs.existsSync(footprintsPath)) {
  const fp = JSON.parse(fs.readFileSync(footprintsPath, 'utf8'));
  for (const f of fp.features ?? []) {
    if (f.properties?.Building) footprintIds.add(f.properties.Building);
  }
  console.log(`Loaded ${footprintIds.size} footprint building IDs from campus_buildings.geojson`);
}

console.log(`Reading ${input} ...`);
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const feats = data.features ?? [];
console.log(`  ${feats.length} room features`);

const buildings = new Map();
for (const f of feats) {
  const p = f.properties ?? {};
  const id = p.bldg_no;
  if (!id) continue;
  let b = buildings.get(id);
  if (!b) {
    b = { id, abbr: p.building_abbr ?? null, name: p.description ?? null, pts: [], floors: new Set(), roomCount: 0 };
    buildings.set(id, b);
  }
  b.abbr ??= p.building_abbr;
  b.name ??= p.description;
  b.roomCount += 1;
  if (p.floor) b.floors.add(p.floor);
  const g = f.geometry;
  if (g?.type === 'Polygon') for (const ring of g.coordinates) for (const c of ring) b.pts.push(c);
}

const out = [];
for (const b of buildings.values()) {
  if (b.pts.length === 0) continue;
  let sx = 0, sy = 0;
  for (const [x, y] of b.pts) { sx += x; sy += y; }
  const center = [round(sx / b.pts.length), round(sy / b.pts.length)];
  const hull = convexHull(b.pts).map(([x, y]) => [round(x), round(y)]);
  out.push({
    id: b.id,
    abbr: b.abbr,
    name: b.name,
    center,
    footprint: hull,
    floors: [...b.floors].sort(),
    roomCount: b.roomCount,
    hasFootprint: footprintIds.has(b.id),
  });
}

out.sort((a, b) => (a.abbr ?? '').localeCompare(b.abbr ?? ''));
fs.mkdirSync(output.substring(0, output.lastIndexOf('/')), { recursive: true });
fs.writeFileSync(output, JSON.stringify(out));
console.log(`Wrote ${out.length} buildings -> ${output} (${(fs.statSync(output).size / 1024).toFixed(0)} KB)`);
