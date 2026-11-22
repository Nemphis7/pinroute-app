// The Pinroute planner, shown inside Claude. In the chat it is a compact trip card: the nights strip, how much is
// settled, a small map and one action, Open planner. Full screen it is the planner itself: the route on the left, the
// selected stop or leg on the right (one pane at a time on phones), where nights, flights and bookings can be changed.
// It talks to the Pinroute server through the host (callServerTool) and asks Claude, on the traveller's own plan,
// for the work that needs a model (sendMessage), then tells Claude what changed (updateModelContext).
import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from '@modelcontextprotocol/ext-apps';
import { Plane, Ship, Car, MapPin, Check, Plus, Minus, ExternalLink, ChevronLeft, Maximize2, Minimize2, MessageSquare } from 'lucide';

// Size reports start once the host has answered (see connect below), so none is sent into a closed channel
const app = new App({ name: 'Pinroute planner', version: '0.3.0' }, {}, { autoResize: false });
const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';

let V = null;              // the trip as the server sent it
let MAP = null;            // its map (coastline and stop positions), from the result's _meta, shaped like the trip
let MINI = null;           // the same, small and wide, for the card in the chat
let ctx = {};              // what the host told us: theme, display mode, the modes it offers
let sel = null;            // { kind: 'stop', index } or { kind: 'leg', key }
let pane = 'list';         // one-pane layouts: 'list' or 'detail'
let busy = false;          // a change is being saved
const fares = {};          // leg key → { state, fares, note, live, error, direct, sort }
const waiting = {};        // what Claude was asked to do and the view is watching for

// ---------------------------------------------------------------- small helpers
// DOM helper: text always goes through textContent, never through HTML
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
function s(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}
// Lucide line icons, one size and one stroke
function icon(node) {
  const svg = s('svg', { class: 'i', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  for (const [tag, attrs] of node) svg.append(s(tag, attrs));
  return svg;
}

const UTC = { timeZone: 'UTC' };
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...UTC });
const DM = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...UTC });
const LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...UTC });
const date = (iso) => new Date(`${iso}T00:00:00Z`);
const day = (iso) => DAY.format(date(iso));
const longDay = (iso) => LONG.format(date(iso));
const span = (a, b) => {
  const A = date(a), B = date(b);
  if (a === b) return DM.format(A);
  return A.getUTCMonth() === B.getUTCMonth() ? `${A.getUTCDate()}–${DM.format(B)}` : `${DM.format(A)} – ${DM.format(B)}`;
};
const days = (a, b) => Math.round((date(b) - date(a)) / 864e5);
const nightsTxt = (n) => `${n} night${n === 1 ? '' : 's'}`;
const money = (n, c) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: c || 'EUR', maximumFractionDigits: 0 }).format(n);
const hm = (m) => (m == null ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`);
const clock = (iso) => String(iso || '').slice(11, 16);            // times are local at each airport, shown as given
const textOf = (r) => (r?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const KIND = { food: 'Food', drink: 'Drinks', beach: 'Beach', view: 'View', activity: 'Activity', stay: 'Stay', shop: 'Shopping', other: 'Other' };
const MODE = { flight: Plane, ferry: Ship, road: Car };

const canFull = () => (ctx.availableDisplayModes || []).includes('fullscreen');
const isFull = () => ctx.displayMode === 'fullscreen';
const layout = () => (isFull() ? 'app' : canFull() ? 'card' : 'stacked');
const narrow = () => layout() === 'stacked' || window.innerWidth < 720;
const legByKey = (k) => V.legs.find((l) => l.key === k);
const route = (k) => String(k).split('|').slice(0, 3).join('|');          // a leg without its date
const isSel = (kind, id) => sel && sel.kind === kind && (kind === 'stop' ? sel.index === id : sel.key === id);

// ---------------------------------------------------------------- the whole view
function render() {
  if (!V) return;
  // A leg whose date moved keeps its selection; anything else that's gone falls back to the starting point
  if (sel?.kind === 'leg' && !legByKey(sel.key)) { const same = V.legs.find((l) => route(l.key) === route(sel.key)); sel = same ? { kind: 'leg', key: same.key } : null; }
  if (!sel || (sel.kind === 'stop' && !V.stops[sel.index])) sel = startingPoint();
  const L = layout();
  const root = $('app');
  root.dataset.layout = L;
  root.dataset.narrow = String(L !== 'card' && narrow());
  root.dataset.pane = pane;

  $('name').textContent = V.trip.name;
  const total = days(V.trip.start, V.trip.end);
  $('sub').textContent = `${span(V.trip.start, V.trip.end)} · ${V.trip.adults} traveller${V.trip.adults === 1 ? '' : 's'} · ${nightsTxt(total)}`;
  const st = $('status');
  st.textContent = [L === 'card' ? nowAndNext() : null, tally()].filter(Boolean).join('\n');
  st.hidden = !st.textContent;

  const small = window.innerWidth < 720;
  $('side').replaceChildren(...(L === 'card'
    ? [mapSvg({ mini: true })]
    : L === 'app' ? [h('button', { class: small ? 'ghost icon' : 'ghost', 'aria-label': 'Back to chat', title: 'Back to chat', onclick: () => setMode('inline') }, icon(Minimize2), small ? null : 'Back to chat')] : []).filter(Boolean));
  $('strip').replaceChildren(strip());
  $('open-row').hidden = L !== 'card';
  $('open-row').replaceChildren(h('button', { class: 'primary', onclick: () => openAt(sel) }, icon(Maximize2), 'Open planner'));
  $('panes').hidden = L === 'card';
  if (L !== 'card') { $('list').replaceChildren(...listView()); $('detail').replaceChildren(...detailView()); }
}

// Where the planner opens: the stop the traveller is at today, else the first stop
function startingPoint() {
  const t = today();
  const here = V.stops.find((x) => x.arrive <= t && t < x.depart);
  return { kind: 'stop', index: here ? here.index : 0 };
}

// During the trip: where the traveller is today and the next hop
function nowAndNext() {
  const t = today();
  const here = V.stops.find((x) => x.arrive <= t && t < x.depart);
  if (!here) return null;
  const next = V.legs.find((l) => l.after === here.index);
  const what = next ? `${next.mode === 'flight' ? 'flight' : next.mode === 'ferry' ? 'ferry' : 'drive'} to ${next.toName}, ${day(next.date)}` : null;
  return `Today in ${here.place}${what ? ` · Next: ${what}` : ''}`;
}

function tally() {
  const fl = V.legs.filter((l) => l.mode === 'flight'), tr = V.legs.filter((l) => l.mode !== 'flight');
  const parts = [];
  if (fl.length) parts.push(`${fl.filter((l) => l.chosen).length} of ${fl.length} flight${fl.length === 1 ? '' : 's'} chosen`);
  if (tr.length) parts.push(`${tr.filter((l) => l.booked).length} of ${tr.length} ferr${tr.length === 1 ? 'y or drive' : 'ies and drives'} booked`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------- nights strip: one segment per stay
function strip() {
  const stays = V.stops.filter((x) => x.nights > 0);
  const total = stays.reduce((n, x) => n + x.nights, 0) || 1;
  const segs = stays.map((x) => h('button', {
    class: 'seg', style: `flex-grow:${x.nights}`, 'aria-pressed': String(isSel('stop', x.index)),
    title: `${x.place} · ${nightsTxt(x.nights)} · ${span(x.arrive, x.depart)}`, 'aria-label': `${x.place}, ${nightsTxt(x.nights)}, ${span(x.arrive, x.depart)}`,
    onclick: () => openAt({ kind: 'stop', index: x.index }),
  }, h('span', { class: 'no', text: String(x.index + 1) }), h('span', { class: 'nm', text: x.place })));
  const t = today();
  const at = t >= V.trip.start && t < V.trip.end ? ((days(V.trip.start, t) + 0.5) / total) * 100 : null;
  return h('div', { class: 'strip' },
    h('div', { class: 'segs' }, segs, at != null ? h('span', { class: 'today', style: `left:${at}%` }) : null),
    h('div', { class: 'ends' }, h('span', { text: day(V.trip.start) }), h('span', { text: day(V.trip.end) }),
      at != null && at > 12 && at < 88 ? h('span', { class: 'today-label', style: `left:${at}%`, text: 'Today' }) : null));
}

// ---------------------------------------------------------------- the map
function mapSvg({ mini = false } = {}) {
  const M = mini ? MINI : MAP;
  if (!M) return null;
  const svg = s('svg', { class: `map${mini ? ' mini' : ''}`, viewBox: `0 0 ${M.w} ${M.h}`, role: 'img', 'aria-label': `Map of the route: ${V.stops.map((x) => x.place).join(', ')}` });
  svg.append(s('rect', { class: 'sea', width: M.w, height: M.h }), s('path', { class: 'land', d: M.land }));
  for (const l of V.legs) {
    if (l.after < 0 || l.after >= V.stops.length - 1) continue;           // flights from and to home are off this map
    const a = M.points[l.after], b = M.points[l.after + 1];
    if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
    const cls = `route ${l.mode === 'flight' ? 'flight' : 'ground'}${isSel('leg', l.key) ? ' sel' : ''}`;
    if (l.mode === 'flight') {                                                // flights as arcs, the way they are drawn on route maps
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), k = Math.min(48, len * 0.2);
      svg.append(s('path', { class: cls, d: `M${a[0]},${a[1]} Q${(a[0] + b[0]) / 2 - (dy / len) * k},${(a[1] + b[1]) / 2 + (dx / len) * k} ${b[0]},${b[1]}` }));
    } else svg.append(s('line', { class: cls, x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
  }
  // Pins: a trip that ends where it began gets one; the selected pin and its name go on top of the others
  const seen = new Set(), pins = [];
  V.stops.forEach((x, i) => {
    const p = M.points[i];
    if (!p || seen.has(p.join())) return;
    seen.add(p.join());
    pins.push({ x, i, p, on: isSel('stop', i) });
  });
  pins.sort((a, b) => a.on - b.on);
  for (const { x, i, p, on } of pins) {
    const g = s('g', { class: `pin${on ? ' sel' : ''}${mini ? '' : ' go'}`, transform: `translate(${p[0]},${p[1]})` });
    g.append(s('circle', { r: mini ? 6 : 11 }));
    if (!mini) {
      g.append(s('text', { 'text-anchor': 'middle', dy: '0.35em' }, String(i + 1)));
      g.append(s('title', {}, x.place));
      g.addEventListener('click', () => pick({ kind: 'stop', index: i }));
    }
    svg.append(g);
    if (on && !mini) svg.append(s('text', { class: 'label', x: p[0] + 14, y: p[1] + 4 }, x.place));
  }
  return svg;
}

// ---------------------------------------------------------------- route list
function listView() {
  const rows = [];
  const out = V.legs.find((l) => l.after === -1);
  if (out) rows.push(legRow(out));
  for (const x of V.stops) {
    rows.push(stopRow(x));
    for (const l of V.legs.filter((m) => m.after === x.index)) rows.push(legRow(l));
  }
  return [h('ol', { onkeydown: moveWithKeys }, rows),
    narrow() ? null : h('p', { class: 'hint small' }, h('kbd', { text: '↑' }), ' ', h('kbd', { text: '↓' }), ' move along the route')].filter(Boolean);
}

function stopRow(x) {
  const picks = V.picks[x.place] || [];
  const on = isSel('stop', x.index);
  return h('li', {}, h('button', { class: `row stop${on ? ' sel' : ''}`, 'aria-current': on ? 'true' : null, 'data-stop': x.index, onclick: () => pick({ kind: 'stop', index: x.index }) },
    h('span', { class: 'badge-n', text: String(x.index + 1) }),
    h('span', { class: 'main' }, h('span', { class: 'place', text: x.place }), h('span', { class: 'sub', text: x.nights ? `${span(x.arrive, x.depart)} · ${nightsTxt(x.nights)}` : day(x.arrive) })),
    picks.length ? h('span', { class: 'aside', title: `${picks.length} local picks` }, icon(MapPin), String(picks.length)) : null));
}

function legState(l) {
  if (l.booked) return { text: 'Booked', tone: 'done' };
  if (l.mode !== 'flight') return { text: 'To book', tone: 'todo' };
  if (l.chosen) return { text: 'Chosen', tone: 'done' };
  if (l.stale) return { text: 'Date moved', tone: 'warn' };
  return { text: 'To choose', tone: 'todo' };
}
const legLine = (l) => (l.mode === 'flight' ? `${l.from} → ${l.to} · ${day(l.date)}` : `${l.mode === 'ferry' ? 'Ferry' : 'Road'} · ${day(l.date)}`);

function legRow(l) {
  const on = isSel('leg', l.key), st = legState(l);
  return h('li', {}, h('button', { class: `row leg${on ? ' sel' : ''}`, 'aria-current': on ? 'true' : null, 'data-leg': l.key, onclick: () => pick({ kind: 'leg', key: l.key }) },
    icon(MODE[l.mode] || Plane),
    h('span', { class: 'main' }, h('span', { text: legLine(l) })),
    h('span', { class: `state ${st.tone}` }, st.tone === 'done' ? icon(Check) : null, st.text)));
}

// Up and down arrows move along the route, as in a list of messages
function moveWithKeys(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...$('list').querySelectorAll('.row')];
  const at = items.findIndex((b) => b.getAttribute('aria-current') === 'true');
  const next = items[Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (!next) return;
  e.preventDefault();
  pick(next.dataset.leg ? { kind: 'leg', key: next.dataset.leg } : { kind: 'stop', index: Number(next.dataset.stop) });
  $('list').querySelector('[aria-current="true"]')?.focus();
}

// ---------------------------------------------------------------- detail
// Wide: the selected item's details, and the map in a column beside them. One pane: a back button, no map.
function detailView() {
  const body = sel.kind === 'stop' ? stopDetail(V.stops[sel.index]) : legDetail(legByKey(sel.key));
  if (narrow()) {
    const map = mapSvg();
    return [h('button', { class: 'ghost back', onclick: () => { pane = 'list'; render(); } }, icon(ChevronLeft), 'Route'), ...body, map ? h('div', { class: 'list-map' }, map) : null].filter(Boolean);
  }
  const map = mapSvg();
  return [h('div', { class: 'content' }, body), map ? h('div', { class: 'aside-map' }, map) : null].filter(Boolean);
}

function stopDetail(x) {
  const picks = V.picks[x.place] || [];
  const where = [x.region, x.iata && `nearest airport ${x.iata}`].filter(Boolean).join(' · ');
  return [
    h('div', { class: 'dhead' },
      h('h2', { text: x.place }),
      h('p', { class: 'meta', text: x.nights ? `${day(x.arrive)} to ${day(x.depart)}` : `Arrive ${day(x.arrive)}` }),
      h('div', { class: 'stepper', role: 'group', 'aria-label': `Nights in ${x.place}` },
        h('button', { class: 'icon', 'aria-label': 'One night fewer', disabled: busy || x.nights === 0, onclick: () => setNights(x, x.nights - 1) }, icon(Minus)),
        h('span', { class: 'val', text: nightsTxt(x.nights) }),
        h('button', { class: 'icon', 'aria-label': 'One night more', disabled: busy || x.nights >= 60, onclick: () => setNights(x, x.nights + 1) }, icon(Plus))),
      where ? h('p', { class: 'small', text: where }) : null),
    h('section', { class: 'block' },
      h('h3', { text: picks.length ? `Local picks (${picks.length})` : 'Local picks' }),
      picks.length ? h('ul', { class: 'picks' }, picks.map((p) => h('li', {},
        h('div', { class: 'pick-head' }, h('span', { class: 'pname', text: p.name }), h('span', { class: 'kind', text: KIND[p.kind] || p.kind }),
          p.source_url ? h('button', { class: 'icon ghost', title: 'Source', 'aria-label': `Source for ${p.name}`, onclick: () => app.openLink({ url: p.source_url }) }, icon(ExternalLink)) : null),
        h('p', { class: 'why', text: `${p.why}${p.area ? ` · ${p.area}` : ''}` })))) : h('p', { class: 'empty', text: 'No picks saved yet.' }),
      waiting[`picks|${x.place}`] ? h('p', { class: 'small' }, 'Claude is looking; picks appear here once saved. ', h('button', { class: 'link', text: 'Refresh', onclick: () => refresh() })) : null,
      h('div', { class: 'acts' }, h('button', { class: picks.length ? '' : 'primary', onclick: () => askPicks(x) }, icon(MessageSquare), picks.length ? 'Ask Claude for more' : 'Ask Claude for local picks'))),
  ];
}

function legDetail(l) {
  const what = l.mode === 'flight' ? `Flight · ${longDay(l.date)} · ${l.from} → ${l.to}` : `${l.mode === 'ferry' ? 'Ferry' : 'By road'} · ${longDay(l.date)}${l.km ? ` · about ${l.km} km` : ''}`;
  return [h('div', { class: 'dhead' }, h('h2', { text: `${l.fromName} → ${l.toName}` }), h('p', { class: 'meta', text: what })),
    ...(l.mode === 'flight' ? flightBlock(l) : transferBlock(l))];
}

const bookedButton = (l) => h('button', { 'aria-pressed': String(l.booked), disabled: busy, onclick: () => setBooked(l, !l.booked) }, icon(Check), l.booked ? 'Booked' : 'Mark booked');

function flightBlock(l) {
  if (l.chosen) {
    return [ticket(l.chosen),
      l.note ? h('p', { class: 'meta', text: l.note }) : null,
      h('div', { class: 'acts' },
        bookedButton(l),
        l.chosen.link ? h('button', { onclick: () => app.openLink({ url: l.chosen.link }) }, icon(ExternalLink), 'Booking page') : null,
        h('button', { class: 'ghost', onclick: () => askFlights(l) }, icon(MessageSquare), 'Ask Claude again'),
        h('button', { class: 'ghost', disabled: busy, onclick: () => clearFlight(l) }, 'Remove'))].filter(Boolean);
  }
  const st = fares[l.key] || {};
  const label = st.state === 'loading' ? 'Searching…' : st.state === 'done' ? 'Search again' : V.flights.live ? 'Airline fares' : 'Demo fares';
  return [
    l.stale ? h('div', { class: 'note warn' }, `A flight was chosen for ${day(l.stale.date)}, before the dates moved: ${l.stale.summary}, ${money(l.stale.price, l.stale.currency)}. Choose one for ${day(l.date)}. `,
      h('button', { class: 'link', disabled: busy, onclick: () => clearFlight(l) }, 'Remove it')) : null,
    h('div', { class: 'acts' },
      h('button', { class: 'primary', onclick: () => askFlights(l) }, icon(MessageSquare), 'Ask Claude to find flights'),
      h('button', { disabled: st.state === 'loading', onclick: () => findFlights(l) }, label)),
    waiting[`flights|${l.key}`] ? h('p', { class: 'small' }, 'Claude is searching with your flight tools; the flight you pick appears here. ', h('button', { class: 'link', text: 'Refresh', onclick: () => refresh() })) : null,
    st.state === 'error' ? h('p', { class: 'note warn', text: st.error }) : null,
    st.state === 'done' ? faresBlock(l, st) : null,
  ].filter(Boolean);
}

// A chosen flight as a stub: codes and times when the summary carries them ("11:40 KBV → 12:55 DMK")
function ticket(c) {
  const m = /(\d{1,2}:\d{2})\s*([A-Z]{3})\s*→\s*(\d{1,2}:\d{2})\s*([A-Z]{3})/.exec(c.summary || '');
  const airline = (c.summary || '').split(',')[0].trim();
  return h('div', { class: 'ticket' },
    h('div', { class: 'tmain' },
      m ? h('div', { class: 'troute' },
        h('span', { class: 'code' }, h('b', { text: m[2] }), h('span', { class: 'time', text: m[1] })),
        h('span', { class: 'line' }, icon(Plane)),
        h('span', { class: 'code' }, h('b', { text: m[4] }), h('span', { class: 'time', text: m[3] }))) : h('p', { class: 'tsum', text: c.summary }),
      h('p', { class: 'small', text: [m ? airline : null, c.source ? `via ${c.source}` : null].filter(Boolean).join(' · ') || ' ' })),
    h('div', { class: 'tside' }, h('span', { class: 'price', text: money(c.price, c.currency) }), h('span', { class: 'small', text: `for ${V.trip.adults}` })));
}

function transferBlock(l) {
  return [
    l.booked && l.note ? h('p', { class: 'meta', text: l.note }) : null,
    h('div', { class: 'acts' },
      h('button', { class: l.booked ? '' : 'primary', onclick: () => askRoute(l) }, icon(MessageSquare), 'Ask Claude how to get there'),
      bookedButton(l)),
    waiting[`route|${l.key}`] ? h('p', { class: 'small', text: 'Claude is answering in the conversation.' }) : null,
  ].filter(Boolean);
}

function faresBlock(l, st) {
  if (!st.fares.length) {
    return h('p', { class: 'note' }, `No offers from ${st.live ? 'the airlines Amadeus covers' : 'this source'} on this route. `,
      h('button', { class: 'link', onclick: () => askFlights(l) }, 'Ask Claude to search with your flight tools'));
  }
  let list = st.fares.slice();
  if (st.direct) list = list.filter((f) => f.bounds.every((b) => b.stops === 0));
  if (st.sort === 'time') list.sort((a, b) => a.bounds[0].minutes - b.bounds[0].minutes);
  return h('div', { class: 'block' },
    h('div', { class: 'fbar' },
      h('button', { 'aria-pressed': String(!!st.direct), onclick: () => { st.direct = !st.direct; render(); } }, 'Direct only'),
      h('button', { 'aria-pressed': String(st.sort !== 'time'), onclick: () => { st.sort = 'price'; render(); } }, 'Cheapest'),
      h('button', { 'aria-pressed': String(st.sort === 'time'), onclick: () => { st.sort = 'time'; render(); } }, 'Fastest'),
      h('span', { class: 'small', text: `${list.length} of ${st.fares.length} · ${st.live ? V.flights.provider : 'demo data'}` })),
    st.note ? h('p', { class: 'small', text: st.note }) : null,
    h('div', { class: 'fares' }, list.slice(0, 8).map((f) => fareCard(l, f))),
    !list.length ? h('p', { class: 'small', text: 'No fares match. Turn off “Direct only”.' }) : null);
}

function fareCard(l, f) {
  const b = f.bounds[0];
  const plus = days(String(b.departs).slice(0, 10), String(b.arrives).slice(0, 10));
  const stops = b.stops ? `${b.stops} stop${b.stops > 1 ? 's' : ''}: ${b.changes.map((c) => `${c.at} ${hm(c.minutes)}`).join(', ')}` : 'Direct';
  const nos = b.flights.map((x) => x.number).filter((n) => !/^XX/.test(n)).join(', ');
  const line = `${f.airline}${nos ? ` ${nos}` : ''}, ${clock(b.departs)} ${b.from} → ${clock(b.arrives)} ${b.to}`;
  return h('div', { class: 'fare' },
    h('div', {},
      h('div', { class: 'times' }, h('b', { text: `${clock(b.departs)} ${b.from} → ${clock(b.arrives)} ${b.to}` }), plus > 0 ? h('span', { class: 'plus', text: ` +${plus}` }) : null),
      h('div', { class: 'small', text: `${f.airline}${nos ? ` · ${nos}` : ''} · ${hm(b.minutes)} · ${stops}` }),
      h('div', { class: 'small', text: b.bags || 'Checked bags not stated' })),
    h('div', { class: 'price' }, money(f.total, f.currency), V.trip.adults > 1 && f.perAdult ? h('div', { class: 'small', text: `${money(f.perAdult, f.currency)} each` }) : null),
    h('div', { class: 'acts' },
      h('button', { disabled: busy, onclick: () => choose(l, f, line) }, 'Choose'),
      f.link ? h('button', { class: 'link', onclick: () => app.openLink({ url: f.link }) }, f.demo ? 'Check on Google Flights' : 'Book on the airline’s site') : null));
}

// ---------------------------------------------------------------- actions
function pick(next) {
  sel = next;
  pane = 'detail';
  render();
}

// From the card: open full screen at what was tapped. Hosts without full screen show the planner in place.
async function openAt(next) {
  if (next) sel = next;
  pane = 'detail';
  if (canFull() && !isFull()) await setMode('fullscreen');
  else render();
}

async function setMode(mode) {
  try {
    const r = await app.requestDisplayMode({ mode });
    ctx = { ...ctx, displayMode: r?.mode || mode };
  } catch (e) { showError(e.message || String(e)); }
  render();
}

async function save(name, args, told) {
  busy = true; render();
  try {
    const r = await app.callServerTool({ name, arguments: args });
    if (r.isError) throw new Error(textOf(r) || 'That change could not be saved.');
    take(r);
    showError('');
    if (told) await app.updateModelContext({ content: [{ type: 'text', text: `In the Pinroute planner, ${told}` }] }).catch(() => {});
    return r;
  } catch (e) { showError(e.message || String(e)); return null; }
  finally { busy = false; render(); }
}

const setNights = (x, n) => save('set_nights', { trip_id: V.trip.id, stop: x.index, nights: n }, `the traveller changed ${x.place} to ${nightsTxt(n)}; the later dates moved with it.`);
const setBooked = (l, booked) => save('mark_leg', { trip_id: V.trip.id, leg_key: l.key, booked }, `the traveller marked ${l.fromName} → ${l.toName} on ${l.date} as ${booked ? 'booked' : 'not booked yet'}.`);
// The server removes the flight saved for this hop whatever its date, so a choice left on an old date goes too
const clearFlight = (l) => save('clear_flight', { trip_id: V.trip.id, leg_key: l.key }, `the traveller removed the flight saved for ${l.fromName} → ${l.toName}.`);
const choose = (l, f, line) => save('choose_flight', { trip_id: V.trip.id, leg_key: l.key, summary: line, price: f.total, currency: f.currency, source: f.demo ? 'Demo data' : V.flights.provider, ...(f.link ? { link: f.link } : {}) },
  `the traveller chose ${line} for ${l.fromName} → ${l.toName} on ${l.date}, ${money(f.total, f.currency)} for ${V.trip.adults}.`);

async function findFlights(l) {
  fares[l.key] = { ...(fares[l.key] || {}), state: 'loading' };
  render();
  try {
    const r = await app.callServerTool({ name: 'search_flights', arguments: { origin: l.from, destination: l.to, date: l.date, adults: V.trip.adults } });
    if (r.isError) throw new Error(textOf(r) || 'The search failed.');
    const sc = r.structuredContent || {};
    fares[l.key] = { ...fares[l.key], state: 'done', fares: sc.fares || [], note: sc.note || '', live: !!sc.live };
  } catch (e) {
    fares[l.key] = { ...fares[l.key], state: 'error', error: e.message || String(e) };
  }
  render();
}

// Asking Claude: a message in the conversation, then this view watches the server for what Claude saves
async function ask(key, message, done) {
  waiting[key] = true;
  render();
  await app.sendMessage({ role: 'user', content: [{ type: 'text', text: message }] }).catch((e) => showError(e.message || String(e)));
  if (!done) return;
  let tries = 0;
  const timer = setInterval(async () => {
    tries += 1;
    await refresh(true);
    if (done() || tries >= 30) { clearInterval(timer); if (done()) delete waiting[key]; render(); }
  }, 8000);
}

function askFlights(l) {
  const n = V.trip.adults;
  const before = JSON.stringify(l.chosen);
  return ask(`flights|${l.key}`,
    `Find flights from ${l.fromName} (${l.from}) to ${l.toName} (${l.to} or another airport nearby) on ${longDay(l.date)} for ${n} adult${n === 1 ? '' : 's'}, using my flight search tools. Show me the best options, and when I pick one, save it to Pinroute with choose_flight (trip_id "${V.trip.id}", leg_key "${l.key}").`,
    () => JSON.stringify(legByKey(l.key)?.chosen) !== before);
}

function askPicks(x) {
  const before = (V.picks[x.place] || []).length;
  const where = x.region ? `${x.place} (${x.region})` : x.place;
  return ask(`picks|${x.place}`,
    `Find local favourites in ${where} for my trip: what recent Reddit threads, TikTok and Instagram posts, and food and travel blogs recommend. Choose up to 10, each with its source link, then save them with save_local_picks (place: "${x.place}").`,
    () => (V.picks[x.place] || []).length > before);
}

function askRoute(l) {
  return ask(`route|${l.key}`,
    `How do I get from ${l.fromName} to ${l.toName} on ${longDay(l.date)}? Give me the ferry or transfer options with times, journey length, price and how to book. When I've booked, mark that leg booked in Pinroute with mark_leg (trip_id "${V.trip.id}", leg_key "${l.key}").`);
}

async function refresh(quiet) {
  try {
    const r = await app.callServerTool({ name: 'open_planner', arguments: { trip_id: V.trip.id } });
    if (r.isError) throw new Error(textOf(r));
    take(r);
    render();
  } catch (e) { if (!quiet) showError(e.message || String(e)); }
}

function take(r) {
  if (r.structuredContent?.trip) V = r.structuredContent;
  if (r._meta?.map) MAP = r._meta.map;
  if (r._meta?.mini) MINI = r._meta.mini;
}

function showError(msg) { const el = $('error'); el.textContent = msg; el.hidden = !msg; }

// ---------------------------------------------------------------- host context: theme, fonts, display mode
function applyContext(next) {
  if (!next) return;
  ctx = { ...ctx, ...next };
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  render();
}

// ---------------------------------------------------------------- start
app.ontoolinput = () => {};
app.ontoolresult = (r) => {
  if (r.isError) { $('sub').textContent = ''; showError(textOf(r)); return; }
  take(r); showError(''); render();
};
app.onhostcontextchanged = (next) => applyContext(next);
window.addEventListener('resize', () => render());

app.connect()
  .then(() => { app.setupSizeChangedNotifications(); applyContext(app.getHostContext()); })
  .catch((e) => showError(`Could not connect to Claude: ${e.message || e}`));

// For tests: let a harness look at the state
window.__pinroute = { get view() { return V; }, get map() { return MAP; }, get selection() { return sel; }, fares };
