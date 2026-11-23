// The world map for the new-trip screens, drawn once at build time and bundled into the planner: every country
// (Natural Earth 1:110m, public domain, via world-atlas) projected to a fixed frame, keyed by its ISO numeric code,
// plus where each of Pinroute's countries sits, so small islands too small for this scale still get a dot.
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import { geoNaturalEarth1, geoPath } from 'd3-geo';

export function worldMap(dests = [], { w = 960, h = 470 } = {}) {
  const topo = createRequire(import.meta.url)('world-atlas/countries-110m.json');
  const fc = feature(topo, topo.objects.countries);
  fc.features = fc.features.filter((f) => f.id !== '010');           // Antarctica: nobody flies there for a holiday
  const proj = geoNaturalEarth1().fitExtent([[4, 4], [w - 4, h - 4]], fc);
  const path = geoPath(proj).digits(0);
  const countries = {};
  for (const f of fc.features) {
    const d = path(f);
    if (d && f.id) countries[f.id] = (countries[f.id] || '') + d;
  }
  const at = Object.fromEntries(dests.map((x) => [x.id, proj([x.lon, x.lat]).map(Math.round)]));
  return { w, h, countries, at };
}
