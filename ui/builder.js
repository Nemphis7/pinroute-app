// Building a trip's route on the map: tap a place to add it as a stop where it fits best, tap a stop to pick it, then
// set its nights, move it or take it out. The legs between the stops draw themselves as the route changes, each as
// what Pinroute would make it (a flight when the hop is long and has airports at both ends, a ferry to or from an
// island, else the road). The pins are Pinroute's own places where it has them, the cities with flights elsewhere,
// and the places Claude suggested for the trip (save_route_ideas). Every change is saved with update_trip after a
// short pause, so the open planner, the chat and the calendar follow.
import { Plane, Ship, Car, Plus, Minus, X, ArrowUp, ArrowDown, Search, ZoomIn, ZoomOut, Expand, Undo2, Check, Sparkles, Shuffle, MapPinPlus, LoaderCircle } from 'lucide';
import { call, render, tell, ask, waiting, showError } from './core.js';
import { h, s, icon, nightsTxt, plural } from './dom.js';

const B = { on: false, trip: null, M: null, places: [], countries: [], stops: [], sel: null, total: null, fixedEnds: false, timer: 0,
  saving: false, saved: false, err: '', q: '', found: [], undo: [], vb: null, svg: null, el: null, drawn: new Set(), dropped: new Set(), hooks: {}, loading: false };
const MODE_IC = { flight: Plane, ferry: Ship, road: Car };
const MODE_WORD = { flight: 'flight', ferry: 'ferry', road: 'road' };
const rad = (d) => (d * Math.PI) / 180;
const project = (m, lat, lon) => [m.k * rad(lon) + m.tx, m.ty - m.k * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))];
const has = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon);
export function km(a, b) {
  if (!has(a) || !has(b)) return null;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(x)));
}
// What the server makes of a hop (legs() in src/trips.mjs), so a leg shows as soon as a stop is added
export function modeOf(a, b) {
  const d = km(a, b);
  if (a.iata && b.iata && a.iata !== b.iata && (d == null || d >= 250)) return 'flight';
  return a.island || b.island ? 'ferry' : 'road';
}
const same = (a, b) => a.place.toLowerCase() === b.name?.toLowerCase() || (has(a) && has(b) && km(a, b) < 12);
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const nightsIn = (list) => list.reduce((n, x) => n + (x.nights || 0), 0);

export const builderOn = () => B.on;
const spin = () => { const i = icon(LoaderCircle); i.classList.add('spin'); return i; };

// V: the trip as the planner has it. hooks.onSaved(result) takes the saved trip; hooks.onClose() goes back to the route.
export async function openBuilder(V, hooks = {}) {
  Object.assign(B, { on: true, trip: V.trip, hooks, sel: null, err: '', q: '', found: [], undo: [], saved: false, vb: null, drawn: new Set(), dropped: new Set() });
  B.stops = V.stops.map(stopOf);
  B.fixedEnds = !!V.trip.ticket && B.stops.length > 1;
  B.total = V.trip.ticket ? nightsIn(B.stops) : null;
  B.drawn = new Set(legsOf(B.stops).map((l) => l.id));
  B.dropped = new Set(B.stops.map((x) => x.place));
  if (B.M?.trip !== V.trip.id) { B.M = null; B.svg = null; B.mapKey = ''; }
  render();
  await loadPlaces();
}
const stopOf = (x) => ({ place: x.place, nights: x.nights, iata: x.iata || null, lat: x.lat ?? null, lon: x.lon ?? null, island: !!x.island, region: x.region || null });

async function loadPlaces(quiet) {
  B.loading = !quiet; render();
  try {
    const r = await call('route_map', { trip_id: B.trip.id });
    B.places = r.structuredContent?.places || [];
    B.countries = r.structuredContent?.countries || [];
    const m = r._meta?.map;
    // The map stays put once it's up; it changes only when Claude's places reach beyond it
    if (m && (!B.M || !B.places.every((p) => inside(B.M, p)))) { B.M = { ...m, trip: B.trip.id }; B.mapKey = ''; B.vb = null; }
    B.err = '';
  } catch (e) { B.err = e.message || String(e); }
  B.loading = false; render();
  return B.places.length;
}
function inside(m, p) { const [x, y] = project(m, p.lat, p.lon); return x >= 0 && y >= 0 && x <= m.w && y <= m.h; }

// The trip changed somewhere else (Claude saved a route) while nothing here is waiting to be saved
export function builderSync(V) {
  if (!B.on || B.timer || B.saving || V.trip.id !== B.trip.id) return;
  const next = V.stops.map(stopOf);
  if (JSON.stringify(next) !== JSON.stringify(B.stops)) { B.stops = next; B.sel = null; }
}

export function closeBuilder() {
  if (B.timer) { clearTimeout(B.timer); B.timer = 0; save(); }
  B.on = false;
  B.hooks.onClose?.();
  render();
}

// ---------------------------------------------------------------- changing the route
// Where the route can change: a trip started from a flight keeps where it lands first and where it flies home last;
// any trip keeps a last stop with no nights (where it ends) last.
const lo = () => (B.fixedEnds ? 1 : 0);
const hi = () => (B.stops.length > 1 && (B.fixedEnds || B.stops.at(-1).nights === 0) ? B.stops.length - 1 : B.stops.length);
const movable = (i) => i >= lo() && i < hi();

function change(fn, sel) {
  B.undo = [...B.undo, { stops: B.stops.map((x) => ({ ...x })), sel: B.sel }].slice(-20);
  fn();
  B.sel = sel === undefined ? B.sel : sel;
  B.saved = false;
  queueSave();
  render();
}

export function addPlace(p) {
  const stop = { place: p.name, nights: 2, iata: p.iata || null, lat: p.lat, lon: p.lon, island: !!p.island, region: p.region || null };
  const at = bestSpot(stop);
  change(() => {
    B.stops.splice(at, 0, stop);
    if (B.total != null) balance(at);
  }, at);
  tellLater();
}
// Where a new stop adds the least travel, between the stops the route lets change.
// A new stop never goes before the first: that's where the trip starts.
function bestSpot(p) {
  const a = Math.max(1, lo()), b = Math.max(a, hi());
  if (!B.stops.length) return 0;
  let best = b, cost = Infinity;
  for (let i = a; i <= b; i++) {
    const prev = B.stops[i - 1], next = B.stops[i];
    const c = (prev ? km(prev, p) ?? 0 : 0) + (next ? km(p, next) ?? 0 : 0) - (prev && next ? km(prev, next) ?? 0 : 0);
    if (c < cost - 1e-6) { cost = c; best = i; }
  }
  return best;
}
// A trip with set flights keeps its nights: the new stop's nights come from the longest stays
function balance(at) {
  let over = nightsIn(B.stops) - B.total;
  while (over > 0) {
    const from = B.stops.map((x, i) => [x.nights, i]).filter(([n, i]) => i !== at && n > 1).sort((x, y) => y[0] - x[0])[0];
    if (!from) { const take = Math.min(over, B.stops[at].nights - 1); B.stops[at].nights -= take; over -= take; break; }
    B.stops[from[1]].nights -= 1; over -= 1;
  }
}
function removeStop(i) {
  const x = B.stops[i];
  change(() => {
    B.stops.splice(i, 1);
    // With set flights the nights go to the stop before
    if (B.total != null && x.nights) { const to = B.stops[Math.max(0, i - 1)]; if (to) to.nights += x.nights; }
  }, null);
  tellLater();
}
function move(i, by) {
  const j = i + by;
  if (!movable(i) || !movable(j)) return;
  change(() => { [B.stops[i], B.stops[j]] = [B.stops[j], B.stops[i]]; }, j);
}
function nights(i, by) {
  change(() => { B.stops[i].nights = Math.max(0, Math.min(60, B.stops[i].nights + by)); });
}
// The stops in between in the order that travels least: from the first stop, always on to the nearest one left
function tidy() {
  const a = lo() || (B.stops.length ? 1 : 0), b = hi();
  if (b - a < 2) return;
  change(() => {
    const left = B.stops.slice(a, b), out = [];
    let at = B.stops[a - 1] || left[0];
    while (left.length) {
      left.sort((x, y) => (km(at, x) ?? 0) - (km(at, y) ?? 0));
      at = left.shift(); out.push(at);
    }
    B.stops.splice(a, b - a, ...out);
  }, null);
}
function undo() {
  const u = B.undo.at(-1);
  if (!u) return;
  B.undo = B.undo.slice(0, -1);
  B.stops = u.stops; B.sel = u.sel; B.saved = false;
  queueSave(); render();
}

function queueSave() {
  clearTimeout(B.timer);
  B.timer = setTimeout(() => { B.timer = 0; save(); }, 700);
}
async function save() {
  if (!B.stops.length) return;
  B.saving = true; render();
  const stops = B.stops.map((x) => ({ place: x.place, nights: x.nights, ...(x.iata && /^[A-Z]{3}$/i.test(x.iata) ? { airport: x.iata } : {}), ...(has(x) ? { lat: x.lat, lon: x.lon } : {}), ...(x.island ? { island: true } : {}) }));
  try {
    const r = await call('update_trip', { trip_id: B.trip.id, stops });
    B.err = ''; B.saved = !B.timer;
    B.hooks.onSaved?.(r);
  } catch (e) { B.err = e.message || String(e); showError(B.err); }
  B.saving = false; render();
}
let told = 0;
function tellLater() {
  clearTimeout(told);
  told = setTimeout(() => tell(`the traveller changed the route of "${B.trip.name}" (${B.trip.id}) on the map: ${B.stops.map((x) => `${x.place} (${nightsTxt(x.nights)})`).join(' → ')}.`), 2500);
}

// ---------------------------------------------------------------- the list beside the map
const legsOf = (list) => list.slice(1).map((b, i) => { const a = list[i]; return { id: `${a.place}>${b.place}`, a, b, i, mode: modeOf(a, b), km: km(a, b) }; });

export function builderList() {
  const L = legsOf(B.stops), n = nightsIn(B.stops);
  const count = (m) => L.filter((l) => l.mode === m).length;
  const kinds = [[count('flight'), 'flight'], [count('ferry'), 'ferry', 'ferries'], [count('road'), 'drive']].filter(([c]) => c).map(([c, one, many]) => plural(c, one, many));
  const diff = B.total != null ? n - B.total : 0;
  const rows = [];
  B.stops.forEach((x, i) => {
    rows.push(stopRow(x, i));
    if (L[i]) rows.push(legRow(L[i]));
  });
  return [
    h('div', { class: 'bl-head' },
      h('h2', { text: 'Build your route' }),
      h('p', { class: 'meta', text: 'Tap a place on the map to add it where it fits best. Tap a stop to change its nights or its place in the route.' })),
    h('div', { class: 'bl-sum', role: 'status' },
      h('b', { text: `${plural(B.stops.length, 'stop')} · ${nightsTxt(n)}` }), kinds.length ? h('span', { class: 'small', text: kinds.join(', ') }) : null,
      diff ? h('span', { class: 'small warn', text: diff > 0 ? `${nightsTxt(diff)} more than your flights allow` : `${nightsTxt(-diff)} still to place` } ) : null,
      h('span', { class: 'small bl-save', 'aria-live': 'polite' }, B.saving || B.timer ? [spin(), 'Saving'] : B.saved ? [icon(Check), 'Saved'] : null)),
    searchBox(),
    B.stops.length ? h('ol', { class: 'bl-rail' }, rows) : h('p', { class: 'meta empty', text: 'No stops yet. Tap a place on the map to start.' }),
    B.err ? h('p', { class: 'note warn', text: B.err }) : null,
    waiting.ideas ? h('p', { class: 'small skel-line' }, h('span', { class: 'spark' }, icon(Sparkles)), 'Claude is finding places; they appear on the map as pins.') : null,
    h('div', { class: 'acts bl-acts' },
      h('button', { class: 'primary', id: 'bl-done', onclick: closeBuilder }, icon(Check), 'Done'),
      h('button', { onclick: askIdeas, disabled: !!waiting.ideas }, icon(Sparkles), 'Ask Claude for places'),
      hi() - (lo() || 1) >= 2 ? h('button', { class: 'ghost', onclick: tidy, title: 'Put the stops in between in the order that travels least' }, icon(Shuffle), 'Shortest order') : null,
      B.undo.length ? h('button', { class: 'ghost', onclick: undo }, icon(Undo2), 'Undo') : null),
  ];
}

function stopRow(x, i) {
  const on = B.sel === i, fixed = !movable(i);
  const why = B.fixedEnds && (i === 0 || i === B.stops.length - 1) ? (i === 0 ? 'Your flight lands here' : 'Your flight home leaves here') : null;
  return h('li', { class: `bl-stop${on ? ' sel' : ''}`, 'data-bstop': i },
    h('button', { class: 'bl-name', 'aria-pressed': String(on), onclick: () => { B.sel = on ? null : i; render(); focusStop(i); } },
      h('span', { class: 'badge-n', text: String(i + 1) }),
      h('span', { class: 'main' }, h('span', { class: 'place', text: x.place }), h('span', { class: 'sub', text: why || (x.nights ? nightsTxt(x.nights) : 'Where the trip ends') }))),
    h('div', { class: 'stepper sm', role: 'group', 'aria-label': `Nights in ${x.place}` },
      h('button', { class: 'icon', 'aria-label': `One night fewer in ${x.place}`, disabled: x.nights === 0, onclick: () => nights(i, -1) }, icon(Minus)),
      h('span', { class: 'val', text: String(x.nights) }),
      h('button', { class: 'icon', 'aria-label': `One night more in ${x.place}`, disabled: x.nights >= 60, onclick: () => nights(i, 1) }, icon(Plus))),
    on ? h('div', { class: 'bl-tools' },
      h('button', { class: 'ghost', disabled: fixed || !movable(i - 1), onclick: () => move(i, -1) }, icon(ArrowUp), 'Earlier'),
      h('button', { class: 'ghost', disabled: fixed || !movable(i + 1), onclick: () => move(i, 1) }, icon(ArrowDown), 'Later'),
      h('button', { class: 'ghost danger', disabled: fixed || B.stops.length < 2, onclick: () => removeStop(i) }, icon(X), 'Remove')) : null);
}
function legRow(l) {
  return h('li', { class: `bl-leg m-${l.mode}`, 'aria-label': `${MODE_WORD[l.mode]} from ${l.a.place} to ${l.b.place}` },
    icon(MODE_IC[l.mode]), h('span', { text: `${l.mode === 'flight' ? 'Flight' : l.mode === 'ferry' ? 'Ferry' : 'Road'}${l.km != null ? ` · ${l.km.toLocaleString('en-GB')} km` : ''}` }));
}

// A place that isn't a pin: typed, found among the pins or the cities with airports
let findT = 0;
function searchBox() {
  const q = B.q.trim().toLowerCase();
  const pins = q ? B.places.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 4) : [];
  const more = B.found.filter((a) => !pins.some((p) => p.iata === a.code && p.name === a.city)).slice(0, 5 - pins.length);
  const list = [...pins.map((p) => ({ label: p.name, sub: p.region || '', go: () => addPlace(p) })),
    ...more.map((a) => ({ label: a.city, sub: `${a.country} · ${a.code}`, go: () => addPlace({ name: a.city, lat: a.lat, lon: a.lon, iata: a.code, region: a.country }) }))];
  return h('div', { class: 'bl-search' },
    h('label', { class: 'field-ic' }, icon(Search),
      h('input', { id: 'bl-q', type: 'search', placeholder: 'Add a place by name', autocomplete: 'off', value: B.q, 'aria-label': 'Add a place by name',
        oninput: (e) => { B.q = e.target.value; clearTimeout(findT); findT = setTimeout(find, 300); render(); },
        onkeydown: (e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); pickFound(list[0]); } } })),
    q && list.length ? h('ul', { class: 'bl-found', role: 'listbox' }, list.map((x) => h('li', {}, h('button', { class: 'row', role: 'option', onclick: () => pickFound(x) },
      icon(MapPinPlus), h('span', { class: 'main' }, h('span', { class: 'place', text: x.label }), h('span', { class: 'sub', text: x.sub })))))) : null);
}
function pickFound(x) { B.q = ''; B.found = []; x.go(); }
async function find() {
  const q = B.q.trim();
  if (q.length < 2) { B.found = []; render(); return; }
  try { const r = await call('find_airports', { query: q, limit: 5 }); if (B.q.trim() === q) { B.found = r.structuredContent?.airports || []; render(); } }
  catch { /* the pins still match */ }
}

function askIdeas() {
  const before = B.places.length;
  const where = B.countries.length ? ` in ${B.countries.join(' and ')}` : '';
  const route = B.stops.map((x) => x.place).join(' → ');
  const wish = B.trip.wishes ? ` What I have in mind: "${B.trip.wishes}".` : '';
  return ask('ideas', `Suggest 8 to 12 places worth a stop on my Pinroute trip "${B.trip.name}" (trip_id "${B.trip.id}")${where}, beyond the big cities: the route so far is ${route}.${wish} Save them with save_route_ideas, each with its lat and lon, nearest airport, island true for islands and a short why, so they show as pins on the map I'm building the route on. Don't change the route itself; I'll tap the ones I want.`,
    { answer: false, poll: () => loadPlaces(true), done: () => B.places.length > before, tries: 40 });
}

// ---------------------------------------------------------------- the map
export function builderMapEl() {
  if (B.el) return B.el;
  B.wrap = h('div', { class: 'stage-map bm-wrap' });
  const btn = (ic, label, fn) => h('button', { class: 'stage-btn icon', title: label, 'aria-label': label, onclick: fn }, icon(ic));
  B.tip = h('div', { class: 'bm-tip', 'aria-live': 'polite' });
  B.el = h('aside', { class: 'aside-map stage bm', 'aria-label': 'Map to build the route on' }, B.wrap,
    h('div', { class: 'stage-ctl' }, btn(ZoomIn, 'Zoom in', () => zoom(0.7)), btn(ZoomOut, 'Zoom out', () => zoom(1.4)), btn(Expand, 'Whole map', () => fit(true))),
    B.tip);
  wireGestures();
  window.addEventListener('resize', () => { if (B.on && B.vb) apply(fitAspect(B.vb)); });
  return B.el;
}

export function updateBuilderMap() {
  builderMapEl();
  if (!B.M) { B.wrap.replaceChildren(h('div', { class: 'bm-load' }, spin(), B.loading ? 'Loading the map' : '')); B.svg = null; return; }
  if (!B.svg || B.mapKey !== `${B.M.trip}|${B.M.w}|${B.M.k}`) build();
  layers();
  if (!B.vb || !B.vb.w) fit(false);
  else apply(B.vb);
  tip();
}

function build() {
  const M = B.M;
  B.mapKey = `${M.trip}|${M.w}|${M.k}`;
  const svg = s('svg', { class: 'map stage-svg', viewBox: `0 0 ${M.w} ${M.h}`, preserveAspectRatio: 'xMidYMid slice', role: 'application', 'aria-label': 'Map: tap a place to add it to the route' });
  const defs = s('defs');
  const sea = s('radialGradient', { id: 'bm-sea', cx: '50%', cy: '45%', r: '70%' });
  sea.append(s('stop', { offset: 0, class: 'sea-0' }), s('stop', { offset: 1, class: 'sea-1' }));
  const sh = s('filter', { id: 'bm-sh', x: '-5%', y: '-5%', width: '110%', height: '110%' });
  sh.append(s('feDropShadow', { dx: 0, dy: 2, stdDeviation: 3, 'flood-opacity': 0.2 }));
  defs.append(sea, sh);
  const W = M.w, H = M.h;
  svg.append(defs, s('rect', { class: 'sea', x: -W, y: -H, width: W * 3, height: H * 3, fill: 'url(#bm-sea)' }),
    s('path', { class: 'land', d: M.land, filter: 'url(#bm-sh)' }), s('path', { class: 'borders', d: M.borders || '' }));
  B.gLegs = s('g', { class: 'routes' }); B.gCands = s('g', { class: 'cands' }); B.gStops = s('g', { class: 'pins' });
  svg.append(B.gLegs, B.gCands, B.gStops);
  B.svg = svg;
  B.wrap.replaceChildren(svg);
}

const pt = (p) => project(B.M, p.lat, p.lon);
// Flights as arcs, the way route maps draw them; ferries and roads straight
function ctrl(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, k = Math.min(60, len * 0.22);
  return [(a[0] + b[0]) / 2 - (dy / len) * k, (a[1] + b[1]) / 2 + (dx / len) * k];
}
function arc(a, b, mode) {
  if (mode !== 'flight') return `M${a[0]},${a[1]} L${b[0]},${b[1]}`;
  const c = ctrl(a, b);
  return `M${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]}`;
}
// The middle of a leg, where its plane, boat or car sits
function midOf(a, b, mode) {
  if (mode !== 'flight') return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const c = ctrl(a, b);
  return [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4];
}

function layers() {
  const anim = !reduced();
  // legs: new ones draw in, each with what it is in the middle
  const L = legsOf(B.stops).filter((l) => has(l.a) && has(l.b));
  const legEls = [];
  const fresh = new Set();
  for (const l of L) {
    const a = pt(l.a), b = pt(l.b);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5) continue;
    const d = arc(a, b, l.mode), isNew = anim && !B.drawn.has(l.id);
    fresh.add(l.id);
    const g = s('g', { class: `bleg m-${l.mode}${isNew ? ' new' : ''}${B.sel === l.i || B.sel === l.i + 1 ? ' near' : ''}` });
    g.append(s('path', { class: 'route-halo', d }), s('path', { class: `route ${l.mode === 'flight' ? 'flight' : 'ground'}`, d, pathLength: 100 }));
    const [mx, my] = midOf(a, b, l.mode);
    const badge = s('g', { class: 'leg-badge', transform: `translate(${mx.toFixed(1)},${my.toFixed(1)})` });
    const inner = s('g', { class: 'pz' });
    inner.append(s('circle', { r: 9 }));
    const ic = icon(MODE_IC[l.mode]);
    ic.setAttribute('x', -5.5); ic.setAttribute('y', -5.5); ic.setAttribute('width', 11); ic.setAttribute('height', 11);
    const turn = s('g', l.mode === 'flight' ? { transform: 'rotate(45)' } : {});
    turn.append(ic);
    inner.append(turn, s('title', {}, `${MODE_WORD[l.mode]} · ${l.a.place} → ${l.b.place}`));
    badge.append(inner);
    g.append(badge);
    legEls.push(g);
  }
  B.drawn = fresh;
  B.gLegs.replaceChildren(...legEls);

  // the places to tap: not the ones already on the route
  const cands = B.places.filter((p) => has(p) && !B.stops.some((x) => same(x, p)));
  B.gCands.replaceChildren(...cands.map((p) => {
    const [x, y] = pt(p);
    const g = s('g', { class: `cand from-${p.from || 'airport'}`, transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, tabindex: 0, role: 'button', 'aria-label': `Add ${p.name}` });
    const inner = s('g', { class: 'pz' });
    inner.append(s('circle', { class: 'hit', r: 12 }), s('circle', { class: 'dot', r: 6.5 }), s('path', { class: 'plus', d: 'M-3,0 H3 M0,-3 V3' }),
      s('text', { class: 'label', x: 10, y: 4 }, p.name), s('title', {}, p.why ? `${p.name}: ${p.why}` : `Add ${p.name}`));
    g.append(inner);
    g.addEventListener('click', (e) => { if (dragged) return; e.stopPropagation(); addPlace(p); });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addPlace(p); } });
    g.addEventListener('mouseenter', () => { B.hover = p; tip(); });
    g.addEventListener('mouseleave', () => { B.hover = null; tip(); });
    return g;
  }));

  // the stops, numbered; one pin for a place the route comes back to
  const seen = new Map(), pins = [];
  B.stops.forEach((x, i) => {
    if (!has(x)) return;
    const [px, py] = pt(x), k = `${px.toFixed(0)},${py.toFixed(0)}`;
    if (seen.has(k)) { seen.get(k).nums.push(i + 1); return; }
    const rec = { x, i, px, py, nums: [i + 1] };
    seen.set(k, rec); pins.push(rec);
  });
  const shown = new Set();
  B.gStops.replaceChildren(...pins.sort((a, b) => (a.i === B.sel) - (b.i === B.sel)).map(({ x, i, px, py, nums }) => {
    const on = nums.includes((B.sel ?? -9) + 1), isNew = anim && !B.dropped.has(x.place);
    shown.add(x.place);
    const g = s('g', { class: `pin bstop${on ? ' sel' : ''}${isNew ? ' new' : ''}`, transform: `translate(${px.toFixed(1)},${py.toFixed(1)})`, tabindex: 0, role: 'button', 'data-bstop': i, 'aria-label': `Stop ${nums.join(' and ')}: ${x.place}` });
    const inner = s('g', { class: 'pz' });
    inner.append(s('circle', { class: 'pulse', r: 12 }), s('circle', { class: 'dot', r: 12 }), s('text', { class: 'num', 'text-anchor': 'middle', dy: '0.35em' }, nums.join('·')),
      s('text', { class: 'label', x: 18, y: -1 }, x.place), s('text', { class: 'label sub', x: 18, y: 13 }, x.nights ? nightsTxt(x.nights) : 'end'));
    g.append(inner);
    const choose = () => { B.sel = B.sel === i ? null : i; render(); document.querySelector(`.bl-stop[data-bstop="${i}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); };
    g.addEventListener('click', (e) => { if (dragged) return; e.stopPropagation(); choose(); });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    return g;
  }));
  B.dropped = shown;
  labels();
}

// Names show where there's room for them: a pin's name hides when another pin is close by on screen
function labels() {
  if (!B.svg || !B.vb) return;
  const k = B.vb.w / (B.el.getBoundingClientRect().width || 1);
  const all = [...B.gStops.children, ...B.gCands.children].map((g) => {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform'));
    return { g, x: Number(m[1]) / k, y: Number(m[2]) / k, stop: g.classList.contains('bstop') };
  });
  const placed = [];
  for (const p of all) {
    const free = placed.every((q) => Math.abs(q.x - p.x) > 90 || Math.abs(q.y - p.y) > (p.stop || q.stop ? 30 : 18) || p.x < q.x - 12);
    p.g.classList.toggle('nolabel', !free && !p.g.classList.contains('sel'));
    if (free || p.stop) placed.push(p);
  }
}

function tip() {
  if (!B.tip) return;
  const p = B.hover;
  const text = p ? (p.why ? `${p.name} · ${p.why}` : `Tap to add ${p.name}`)
    : B.stops.length ? `${plural(B.places.filter((x) => !B.stops.some((y) => same(y, x))).length, 'place')} to add · tap a pin` : 'Tap a place to start your route';
  B.tip.textContent = text;
}

// ---- the camera: fit, zoom, drag
function fullBox(all) {
  const list = [...B.stops.filter(has), ...(all || B.stops.length < 2 ? B.places.filter(has) : [])].map(pt);
  if (!list.length) return { x: 0, y: 0, w: B.M.w, h: B.M.h };
  const xs = list.map((p) => p[0]), ys = list.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = Math.max(x1 - x0, B.M.w * 0.25) * 1.3, hh = Math.max(y1 - y0, B.M.h * 0.25) * 1.3;
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - hh / 2, w, h: hh };
}
function fitAspect(b) {
  const r = B.el.getBoundingClientRect(), A = r.width && r.height ? r.width / r.height : 1;
  let { x, y, w, h: hh } = b;
  if (w / hh < A) { const nw = hh * A; x -= (nw - w) / 2; w = nw; } else { const nh = w / A; y -= (nh - hh) / 2; hh = nh; }
  return { x, y, w, h: hh };
}
function fit(all) { apply(fitAspect(fullBox(all ?? true))); }
function apply(v) {
  B.vb = v;
  if (!B.svg) return;
  B.svg.setAttribute('viewBox', `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`);
  const cw = B.el.getBoundingClientRect().width || 1;
  B.svg.style.setProperty('--k', (v.w / cw).toFixed(4));
  labels();
}
function zoom(f, cx, cy) {
  if (!B.vb) return;
  const v = B.vb, maxW = B.M.w * 2.5, minW = B.M.w * 0.04;
  const w = Math.max(minW, Math.min(maxW, v.w * f)), r = w / v.w;
  const ox = cx ?? v.x + v.w / 2, oy = cy ?? v.y + v.h / 2;
  apply({ x: ox - (ox - v.x) * r, y: oy - (oy - v.y) * r, w, h: v.h * r });
}
let dragged = false;
function wireGestures() {
  const P = new Map();
  let start = null;
  const toMap = (e) => { const r = B.el.getBoundingClientRect(); return [B.vb.x + ((e.clientX - r.left) / r.width) * B.vb.w, B.vb.y + ((e.clientY - r.top) / r.height) * B.vb.h]; };
  B.wrap.addEventListener('pointerdown', (e) => {
    if (!B.vb) return;
    P.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start = { vb: { ...B.vb }, pts: new Map([...P].map(([k, v]) => [k, { ...v }])) };
    dragged = false;
  });
  B.wrap.addEventListener('pointermove', (e) => {
    if (!P.has(e.pointerId) || !start) return;
    P.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = B.el.getBoundingClientRect(), k = start.vb.w / (r.width || 1);
    const [a, b] = [...P.values()], [a0, b0] = [...start.pts.values()];
    if (P.size === 1 && a0) {
      const dx = a.x - a0.x, dy = a.y - a0.y;
      if (!dragged && Math.hypot(dx, dy) < 6) return;
      if (!dragged) B.wrap.setPointerCapture?.(e.pointerId);
      dragged = true;
      apply({ ...start.vb, x: start.vb.x - dx * k, y: start.vb.y - dy * k });
    } else if (P.size === 2 && a0 && b0) {
      dragged = true;
      const f = Math.hypot(a0.x - b0.x, a0.y - b0.y) / (Math.hypot(a.x - b.x, a.y - b.y) || 1);
      B.vb = start.vb; zoom(f, ...toMap({ clientX: (a0.x + b0.x) / 2, clientY: (a0.y + b0.y) / 2 }));
    }
  });
  const up = (e) => { P.delete(e.pointerId); if (!P.size) { start = null; setTimeout(() => { dragged = false; }, 0); } else start = { vb: { ...B.vb }, pts: new Map([...P].map(([k, v]) => [k, { ...v }])) }; };
  B.wrap.addEventListener('pointerup', up);
  B.wrap.addEventListener('pointercancel', up);
  B.wrap.addEventListener('wheel', (e) => { if (!B.vb) return; e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 0.87, ...toMap(e)); }, { passive: false });
  B.wrap.addEventListener('click', () => { if (!dragged && B.sel != null) { B.sel = null; render(); } });
}
function focusStop(i) {
  const x = B.stops[i];
  if (!x || !has(x) || !B.vb) return;
  const [px, py] = pt(x), v = B.vb;
  if (px < v.x + v.w * 0.1 || px > v.x + v.w * 0.9 || py < v.y + v.h * 0.1 || py > v.y + v.h * 0.9) apply({ ...v, x: px - v.w / 2, y: py - v.h / 2 });
}

// For tests and screenshots
export const builderState = () => B;
