// Shared fetch for UT's public ArcGIS campus layers.
//
// The guards matter more than the fetch. These scripts overwrite committed data
// files, so a bad run does not crash the app — it silently replaces good data
// with worse, and the symptom is a feature quietly not working for some
// buildings, which looks exactly like the buildings that were never covered.

/**
 * Query a feature layer and return its features, or throw with a reason.
 *
 * @param {string} service  .../FeatureServer/0/query
 * @param {Record<string,string>} params  query parameters
 */
export async function fetchLayer(service, params) {
  const res = await fetch(`${service}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`ArcGIS returned HTTP ${res.status} for ${service}`);

  const data = await res.json();
  // ArcGIS reports query errors with HTTP 200 and an `error` body, so checking
  // res.ok alone would sail straight past them.
  if (data.error) throw new Error(`ArcGIS error: ${JSON.stringify(data.error)}`);
  // A layer that outgrew one page returns the first maxRecordCount features and
  // sets this flag — valid JSON, real records, just not all of them.
  if (data.exceededTransferLimit) {
    throw new Error(`Response truncated: ${service} outgrew a single page. Add resultOffset paging.`);
  }

  const features = data.features ?? [];
  // A renamed or retired layer answers successfully with nothing, which would
  // otherwise wipe the file.
  if (features.length === 0) throw new Error(`No features returned from ${service}; it may have moved.`);
  return features;
}

/** Group records by building abbreviation, dropping any that cannot be placed. */
export function byBuilding(features, toRecord, abbrField) {
  const out = {};
  let skipped = 0;
  for (const f of features) {
    const abbr = (f.attributes?.[abbrField] ?? '').trim().toUpperCase();
    const g = f.geometry ?? {};
    // No abbreviation means nothing to attach it to; no geometry means nothing
    // to put on a map.
    if (!abbr || typeof g.x !== 'number' || typeof g.y !== 'number') {
      skipped += 1;
      continue;
    }
    (out[abbr] ??= []).push(toRecord(f.attributes ?? {}, [
      Number(g.x.toFixed(7)),
      Number(g.y.toFixed(7)),
    ]));
  }
  const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
  return { grouped: sorted, skipped };
}
