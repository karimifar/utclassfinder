// Generates the selected-room marker (assets/Visuals/room-pin{,@2x,@3x}.png).
//
// A burnt-orange teardrop with a white casing and a white hole, drawn with its
// tip at the bottom of the canvas so Mapbox's `iconAnchor: 'bottom'` lands the
// point on the room itself.
//
// The room polygon is already painted burnt orange, but a room is a few metres
// across — below about zoom 17 it is a speck, and zoomed out to campus it
// disappears entirely. A symbol is drawn in screen space, so it stays legible
// at any zoom.
//
// Rasterised here rather than shipped as an SVG because Mapbox SymbolLayer
// needs a bitmap. Same approach as build-nav-arrow.mjs.
//
// Run with `npm run build:room-pin`. Only needs re-running if the shape or
// palette changes.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const ORANGE = [0xbf, 0x57, 0x00];
const WHITE = [0xff, 0xff, 0xff];

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * A teardrop: a circle, plus the triangle running from its two tangent points
 * down to `tipY`. Taking the tangents rather than the circle's widest points is
 * what makes the flanks meet the head smoothly instead of with a visible notch.
 */
function teardrop(cx, cy, r, tipY) {
  const d = tipY - cy;
  const cosA = r / d;
  const sinA = Math.sqrt(1 - cosA * cosA);
  const tri = [
    [cx - r * sinA, cy + r * cosA],
    [cx + r * sinA, cy + r * cosA],
    [cx, tipY],
  ];
  return (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r || inside(tri, x, y);
}

const CY = 0.355;
const body = teardrop(0.5, CY, 0.275, 0.945);
const casing = teardrop(0.5, CY, 0.325, 0.99);
const holeR = 0.112;
const hole = (x, y) => (x - 0.5) ** 2 + (y - CY) ** 2 <= holeR * holeR;

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
  const bodyBuf = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(bodyBuf));
  return Buffer.concat([len, bodyBuf, crc]);
}

function png(size) {
  const SS = 4; // supersample factor, for antialiased edges
  const raw = Buffer.alloc(size * (size * 4 + 1));

  for (let py = 0; py < size; py++) {
    const rowStart = py * (size * 4 + 1);
    raw[rowStart] = 0; // PNG filter type: none
    for (let px = 0; px < size; px++) {
      let orangeHits = 0, whiteHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (hole(x, y)) whiteHits++;
          else if (body(x, y)) orangeHits++;
          else if (casing(x, y)) whiteHits++;
        }
      }
      const total = SS * SS;
      const orange = orangeHits / total;
      const white = whiteHits / total;
      const alpha = orange + white;
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 40pt at 1x/2x/3x, matching how the nav arrow ships.
for (const [suffix, scale] of [['', 1], ['@2x', 2], ['@3x', 3]]) {
  const path = `assets/Visuals/room-pin${suffix}.png`;
  writeFileSync(path, png(40 * scale));
  console.log(`wrote ${path} (${40 * scale}px)`);
}
