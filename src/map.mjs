// The trip's map, drawn on the server so the planner stays small: the coastline around the stops (Natural Earth
// 1:50m land, public domain, via world-atlas) projected and clipped to the frame, plus each stop's position.
// The planner only lays the route on top. Home airports are left out, so the map shows the trip, not the flight there.
import { createRequire } from 'node:module';
import { feature, mesh } from 'topojson-client';
import { geoMercator, geoPath } from 'd3-geo';

let LAND = null;
const land = () => (LAND ||= (() => {
  const topo = createRequire(import.meta.url)('world-atlas/land-50m.json');
  return feature(topo, topo.objects.land);
})());

const cache = new Map();                       // stops' coordinates → map, the last 64 kept

// Without w and h the frame takes the trip's shape: tall for a trip down a coast, wide for one across a continent.
export function tripMap(stops, { w, h, pad = 32, long = 600, short = 360 } = {}) {
  const known = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  if (!known.length) return null;
  const sig = `${w || 'fit'}x${h || 'fit'}|${known.map((s) => `${s.lon},${s.lat}`).join(';')}`;
  if (cache.has(sig)) return cache.get(sig);

  let coords = known.map((s) => [s.lon, s.lat]);
  const lons = coords.map((c) => c[0]), lats = coords.map((c) => c[1]);
  const span = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats));
  // A trip around one town still shows its coast: at least about 1.2° across
  if (span < 1.2) {
    const cx = (Math.max(...lons) + Math.min(...lons)) / 2, cy = (Math.max(...lats) + Math.min(...lats)) / 2;
    coords = [...coords, [cx - 0.6, cy - 0.6], [cx + 0.6, cy + 0.6]];
  }
  if (!w || !h) {
    const unit = geoMercator().scale(1).translate([0, 0]);
    const xy = coords.map((c) => unit(c));
    const bw = Math.max(...xy.map((p) => p[0])) - Math.min(...xy.map((p) => p[0]));
    const bh = Math.max(...xy.map((p) => p[1])) - Math.min(...xy.map((p) => p[1]));
    const r = bw / Math.max(bh, 1e-9);
    if (r < 1) { h = long; w = Math.round(Math.min(long, Math.max(short, long * r + 2 * pad))); }
    else { w = long; h = Math.round(Math.min(long, Math.max(short, long / r + 2 * pad))); }
  }
  const proj = geoMercator().fitExtent([[pad, pad], [w - pad, h - pad]], { type: 'MultiPoint', coordinates: coords });
  proj.clipExtent([[0, 0], [w, h]]);
  const round = (v) => Math.round(v * 10) / 10;
  const map = {
    w, h,
    land: geoPath(proj).digits(1)(land()) || '',
    points: stops.map((s) => (Number.isFinite(s.lat) && Number.isFinite(s.lon) ? proj([s.lon, s.lat]).map(round) : null)),
  };
  cache.set(sig, map);
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  return map;
}

// A map around one point for picking airports: land and borders (Natural Earth 1:50m) in a fixed frame that shows
// the range circle with room to spare. k, tx and ty are the Mercator projection (x = k·λ + tx, y = ty − k·ln tan(π/4 + φ/2),
// in radians), so the planner can turn a tap back into a place and draw the circle and the airports itself.
let COUNTRIES = null;
const countries = () => (COUNTRIES ||= (() => {
  const topo = createRequire(import.meta.url)('world-atlas/countries-50m.json');
  return { land: feature(topo, topo.objects.land), borders: mesh(topo, topo.objects.countries, (a, b) => a !== b) };
})());
const regionCache = new Map();

export function regionMap({ lat, lon }, within, { w = 640, h = 420 } = {}) {
  const sig = `${lat.toFixed(2)},${lon.toFixed(2)},${within},${w}x${h}`;
  if (regionCache.has(sig)) return regionCache.get(sig);
  const dLat = (within * 1.35) / 111.32, dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const corners = [[lon - dLon, Math.max(-80, lat - dLat)], [lon + dLon, Math.min(84, lat + dLat)]];
  const proj = geoMercator().fitExtent([[0, 0], [w, h]], { type: 'MultiPoint', coordinates: corners });
  proj.clipExtent([[0, 0], [w, h]]);
  const path = geoPath(proj).digits(1), c = countries();
  const [tx, ty] = proj.translate();
  const map = { w, h, land: path(c.land) || '', borders: path(c.borders) || '', k: proj.scale(), tx, ty, center: { lat, lon } };
  regionCache.set(sig, map);
  if (regionCache.size > 64) regionCache.delete(regionCache.keys().next().value);
  return map;
}
