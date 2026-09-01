import type { LngLat } from '../data/types';

export interface Bbox {
  ne: LngLat;
  sw: LngLat;
}

/** Mapbox renders 512px tiles, so the world is 512 * 2^zoom pixels across. */
const TILE_SIZE = 512;

/** Axis-aligned bounding box of a building footprint. Null for empty input. */
export function footprintBbox(footprint: LngLat[]): Bbox | null {
  if (!footprint || footprint.length === 0) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of footprint) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return { ne: [maxLng, maxLat], sw: [minLng, minLat] };
}

export function bboxCenter(b: Bbox): LngLat {
  return [(b.ne[0] + b.sw[0]) / 2, (b.ne[1] + b.sw[1]) / 2];
}

/** Web Mercator y, normalised to 0..1 (0 = north pole side). */
function mercatorY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

/**
 * The zoom at which `bbox` exactly fills a `width` x `height` point viewport.
 *
 * Computed analytically rather than via Camera.fitBounds so the caller can
 * clamp the result and issue a single animation — fitBounds followed by a
 * corrective zoom visibly re-adjusts.
 */
export function fitZoom(bbox: Bbox, width: number, height: number): number {
  const dx = Math.abs(bbox.ne[0] - bbox.sw[0]) / 360;
  const dy = Math.abs(mercatorY(bbox.sw[1]) - mercatorY(bbox.ne[1]));
  // A degenerate footprint (single point, or a viewport with no room in it)
  // has no meaningful fit — let the caller's clamp decide.
  const zoomX = dx > 0 && width > 0 ? Math.log2(width / (TILE_SIZE * dx)) : Infinity;
  const zoomY = dy > 0 && height > 0 ? Math.log2(height / (TILE_SIZE * dy)) : Infinity;
  return Math.min(zoomX, zoomY);
}

export interface FrameOptions {
  /** Viewport size in points. */
  width: number;
  height: number;
  /** Chrome that covers the map; the footprint is framed in what's left. */
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  /** Extra breathing room between the footprint and the framed area's edges. */
  inset?: number;
  minZoom: number;
  maxZoom: number;
}

/**
 * Camera centre and zoom that frame `footprint` inside the un-padded part of
 * the viewport, clamped to [minZoom, maxZoom].
 *
 * The centre is the footprint's own centre: the caller passes the same padding
 * to `setCamera`, which shifts the focal point so the building lands in the
 * visible area above the bottom panel rather than behind it.
 */
export function frameFootprint(
  footprint: LngLat[],
  opts: FrameOptions,
): { center: LngLat; zoom: number } | null {
  const bbox = footprintBbox(footprint);
  if (!bbox) return null;
  const inset = opts.inset ?? 0;
  const width = opts.width - (opts.paddingLeft ?? 0) - (opts.paddingRight ?? 0) - inset * 2;
  const height = opts.height - (opts.paddingTop ?? 0) - (opts.paddingBottom ?? 0) - inset * 2;
  const raw = fitZoom(bbox, width, height);
  const zoom = Math.max(opts.minZoom, Math.min(opts.maxZoom, raw));
  return { center: bboxCenter(bbox), zoom };
}
