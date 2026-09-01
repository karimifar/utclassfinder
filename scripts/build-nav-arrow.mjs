// Generates the navigate-mode direction puck (assets/Visuals/nav-arrow{,@2x,@3x}.png).
//
// A burnt-orange chevron with a white casing, drawn pointing north (0deg) so
// Mapbox's `iconRotate` can spin it to the device heading. Rasterised here
// rather than shipped as an SVG because Mapbox SymbolLayer needs a bitmap.
//
// Run with `npm run build:nav-arrow`. Only needs re-running if the shape or
// palette changes.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const ORANGE = [0xbf, 0x57, 0x00];
const WHITE = [0xff, 0xff, 0xff];

// Arrow outline in a unit square, y pointing down. Tip at top-centre, a notch
// at the base so it reads as a chevron rather than a triangle.
const ARROW = [
  [0.5, 0.06],
  [0.94, 0.94],
  [0.5, 0.71],
  [0.06, 0.94],
];

/** Scale a polygon about the unit square's centre — used to build the casing. */
function inflate(poly, factor) {
  return poly.map(([x, y]) => [0.5 + (x - 0.5) * factor, 0.55 + (y - 0.55) * factor]);
}

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const casing = inflate(ARROW, 1.22);
  const SS = 4; // supersample factor, for antialiased edges
  const raw = Buffer.alloc(size * (size * 4 + 1));

  for (let py = 0; py < size; py++) {
    const rowStart = py * (size * 4 + 1);
    raw[rowStart] = 0; // PNG filter type: none
    for (let px = 0; px < size; px++) {
      let orangeHits = 0, casingHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (inside(ARROW, x, y)) orangeHits++;
          else if (inside(casing, x, y)) casingHits++;
        }
      }
      const total = SS * SS;
      const orange = orangeHits / total;
      const casingOnly = casingHits / total;
      const alpha = orange + casingOnly;
      // Composite orange over white by coverage, then premultiply nothing —
      // PNG wants straight alpha.
      const mix = alpha === 0 ? 0 : orange / alpha;
      const o = rowStart + 1 + px * 4;
      for (let c = 0; c < 3; c++) {
        raw[o + c] = Math.round(ORANGE[c] * mix + WHITE[c] * (1 - mix));
      }
      raw[o + 3] = Math.round(alpha * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 44pt at 1x/2x/3x — React Native picks the density-appropriate file and
// reports the scale to Mapbox, so the puck lands at ~44pt on every device.
for (const [suffix, scale] of [['', 1], ['@2x', 2], ['@3x', 3]]) {
  const path = `assets/Visuals/nav-arrow${suffix}.png`;
  writeFileSync(path, png(44 * scale));
  console.log(`wrote ${path} (${44 * scale}px)`);
}
