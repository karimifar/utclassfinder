// Generates the floor-plan elevator marker (assets/Visuals/elevator{,@2x,@3x}.png).
//
// The glyph is Google's Material Symbols "elevator" (Rounded, filled; Apache
// License 2.0): a tile with a person beside up and down arrows. It sits on a
// white badge so it stays legible over the floor plan, in a soft charcoal
// rather than black, so it doesn't fight the orange room highlight or the
// blue bathrooms.
//
// Rasterised here rather than shipped as an SVG because Mapbox SymbolLayer
// needs a bitmap. Same approach as build-nav-arrow.mjs and build-room-pin.mjs,
// plus a small path flattener so the icon can stay in its original SVG form.
//
// Run with `npm run build:elevator-icon`. Only needs re-running if the shape or
// palette changes.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CHARCOAL = [0x40, 0x40, 0x40];
const WHITE = [0xff, 0xff, 0xff];

// Material Symbols Rounded "elevator", filled, 400 weight. viewBox 0 -960 960 960.
const GLYPH =
  'M280-400v140q0 13 8.5 21.5T310-230h60q13 0 21.5-8.5T400-260v-140h10q13 0 21.5-8.5T440-430v-80' +
  'q0-33-23.5-56.5T360-590h-40q-33 0-56.5 23.5T240-510v80q0 13 8.5 21.5T270-400h10Zm60-224' +
  'q23 0 39.5-16.5T396-680q0-23-16.5-39.5T340-736q-23 0-39.5 16.5T284-680q0 23 16.5 39.5T340-624Z' +
  'm202 94h146q9 0 13.5-7.5T701-553l-73-117q-5-7-13-7t-13 7l-73 117q-5 8-.5 15.5T542-530Zm86 240 ' +
  '73-117q5-8 .5-15.5T688-430H542q-9 0-13.5 7.5t.5 15.5l73 117q5 7 13 7t13-7ZM180-120q-24 0-42-18' +
  't-18-42v-600q0-23 18-41.5t42-18.5h600q23 0 41.5 18.5T840-780v600q0 24-18.5 42T780-120H180Z';

/**
 * Turns an SVG path into polygons in the unit square. Handles the commands the
 * glyph uses — M L H V Q T Z, absolute and relative — and nothing else, so a
 * swapped-in icon with curves of another kind fails loudly instead of drawing
 * wrong.
 */
function flatten(d, viewBox) {
  const [vx, vy, vw] = viewBox;
  const toks = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g);
  const polys = [];
  let i = 0, cmd = '', prev = '', x = 0, y = 0, sx = 0, sy = 0, qx = 0, qy = 0, cur = null;
  const num = () => parseFloat(toks[i++]);
  const quad = (x1, y1, ex, ey) => {
    const N = 12;
    for (let k = 1; k <= N; k++) {
      const t = k / N, u = 1 - t;
      cur.push([u * u * x + 2 * u * t * x1 + t * t * ex, u * u * y + 2 * u * t * y1 + t * t * ey]);
    }
    qx = x1; qy = y1; x = ex; y = ey;
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const ox = cmd === cmd.toLowerCase() ? x : 0;
    const oy = cmd === cmd.toLowerCase() ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        x = sx = num() + ox; y = sy = num() + oy;
        cur = [[x, y]]; polys.push(cur);
        cmd = cmd === 'm' ? 'l' : 'L'; // further pairs are implicit line-tos
        break;
      case 'L': x = num() + ox; y = num() + oy; cur.push([x, y]); break;
      case 'H': x = num() + ox; cur.push([x, y]); break;
      case 'V': y = num() + oy; cur.push([x, y]); break;
      case 'Q': quad(num() + ox, num() + oy, num() + ox, num() + oy); break;
      case 'T': {
        const smooth = /[QT]/i.test(prev);
        quad(smooth ? 2 * x - qx : x, smooth ? 2 * y - qy : y, num() + ox, num() + oy);
        break;
      }
      case 'Z': x = sx; y = sy; break;
      default: throw new Error(`build-elevator-icon: unsupported path command ${cmd}`);
    }
    prev = cmd;
  }
  return polys.map((p) => p.map(([px, py]) => [(px - vx) / vw, (py - vy) / vw]));
}

/** Non-zero winding fill, which is what SVG paths default to. */
function filled(polys, px, py) {
  let w = 0;
  for (const p of polys) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [x0, y0] = p[j];
      const [x1, y1] = p[i];
      const side = (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0);
      if (y0 <= py) {
        if (y1 > py && side > 0) w++;
      } else if (y1 <= py && side < 0) w--;
    }
  }
  return w !== 0;
}

/** A square centred in the unit canvas, `half` from centre to edge, corners rounded by `r`. */
function roundedSquare(half, r) {
  return (x, y) => {
    const dx = Math.max(Math.abs(x - 0.5) - (half - r), 0);
    const dy = Math.max(Math.abs(y - 0.5) - (half - r), 0);
    return dx * dx + dy * dy <= r * r;
  };
}

const glyph = flatten(GLYPH, [0, -960, 960, 960]);
// The glyph's tile runs 0.125–0.875; the badge sits just outside it, with
// corners that follow the glyph's own rounding.
const badge = roundedSquare(0.44, 0.12);

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
      let inkHits = 0, whiteHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (filled(glyph, x, y)) inkHits++;
          else if (badge(x, y)) whiteHits++;
        }
      }
      const total = SS * SS;
      const ink = inkHits / total;
      const white = whiteHits / total;
      const alpha = ink + white;
      const mix = alpha === 0 ? 0 : ink / alpha;
      const o = rowStart + 1 + px * 4;
      for (let c = 0; c < 3; c++) {
        raw[o + c] = Math.round(CHARCOAL[c] * mix + WHITE[c] * (1 - mix));
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

// 32pt at 1x/2x/3x — smaller than the room pin, since it marks a fixture
// rather than the destination.
for (const [suffix, scale] of [['', 1], ['@2x', 2], ['@3x', 3]]) {
  const path = `assets/Visuals/elevator${suffix}.png`;
  writeFileSync(path, png(32 * scale));
  console.log(`wrote ${path} (${32 * scale}px)`);
}
