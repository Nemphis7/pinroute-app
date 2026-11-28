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

// A map for building a route by tapping places: land and borders around every place to pick and every stop, in a
// frame shaped like them. Like regionMap it gives the projection (k, tx, ty), so the planner places pins and stops
// itself and the map stays put while the route changes.
const pickCache = new Map();
export function pickMap(points, { long = 760, short = 460, pad = 0.12 } = {}) {
  const known = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!known.length) return null;
  let lons = known.map((p) => p.lon), lats = known.map((p) => p.lat);
  let x0 = Math.min(...lons), x1 = Math.max(...lons), y0 = Math.min(...lats), y1 = Math.max(...lats);
  // At least about 3° across, so one city still shows its coast; then some sea around the edges
  const grow = (a, b, min) => { const c = (a + b) / 2, half = Math.max(b - a, min) / 2 * (1 + pad * 2); return [c - half, c + half]; };
  [x0, x1] = grow(x0, x1, 3); [y0, y1] = grow(y0, y1, 3);
  y0 = Math.max(-78, y0); y1 = Math.min(82, y1);
  const sig = [x0, x1, y0, y1].map((v) => v.toFixed(2)).join(',');
  if (pickCache.has(sig)) return pickCache.get(sig);
  const corners = { type: 'MultiPoint', coordinates: [[x0, y0], [x1, y1]] };
  const unit = geoMercator().scale(1).translate([0, 0]);
  const [a, b] = [unit([x0, y0]), unit([x1, y1])];
  const r = Math.abs(b[0] - a[0]) / Math.max(Math.abs(b[1] - a[1]), 1e-9);
  const w = r >= 1 ? long : Math.round(Math.max(short, long * r)), h = r >= 1 ? Math.round(Math.max(short, long / r)) : long;
  const proj = geoMercator().fitExtent([[0, 0], [w, h]], corners);
  proj.clipExtent([[-w * 0.5, -h * 0.5], [w * 1.5, h * 1.5]]);
  const path = geoPath(proj).digits(1), c = countries();
  const [tx, ty] = proj.translate();
  const map = { w, h, land: path(c.land) || '', borders: path(c.borders) || '', k: proj.scale(), tx, ty };
  pickCache.set(sig, map);
  if (pickCache.size > 32) pickCache.delete(pickCache.keys().next().value);
  return map;
}
