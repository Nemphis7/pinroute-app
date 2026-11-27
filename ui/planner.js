// The Pinroute planner, shown inside Claude. Three screens share one view:
//   the start screen (home.js): the two ways to plan a new trip and the traveller's trips;
//   the new-trip planner (newtrip.js): When → Where → Flights, or Country → Best time → Flights;
//   a trip (this file): in the chat a compact card with the nights strip, how much is settled, a small map and one
//   action; full screen the route on the left and the selected stop or leg on the right (one pane on phones).
// It talks to the Pinroute server through the host (callServerTool), asks Claude, on the traveller's own plan, for the
// work that needs a model (sendMessage), and tells Claude what changed (updateModelContext).
import { applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from '@modelcontextprotocol/ext-apps';
import { Plane, Ship, Car, MapPin, Check, Plus, Minus, ExternalLink, ChevronLeft, ChevronRight, Maximize2, MessageSquare, Route, Utensils, Wine, Umbrella, Mountain, Compass, BedDouble, ShoppingBag, Sparkles, PartyPopper, Ticket, Star, ArrowRight, CircleCheck, Play } from 'lucide';
import { app, ui, $, onRender, onShow, canFull, isFull, layout, narrow, textOf, showError, call, go, setMode, setHere, tell, ask, waiting, loadAnswers } from './core.js';
import { answerBlock } from './answer.js';
import { h, s, icon, day, longDay, span, days, nightsTxt, money, hm, clock, today } from './dom.js';
import { takeHome, homeCard, homeScreen } from './home.js';
import { takeNew, newCard, newSteps, newScreen, newKey, openFlightLink, commissionNote, refresh as refreshNew } from './newtrip.js';
import { navBar, navTabs } from './nav.js';
import { airMapDialog } from './airmap.js';
import { tripMenu, tripDialog } from './tripmenu.js';
import { applyInsets } from './keyboard.js';
import { scene, kindOf } from './scene.js';
import { stageEl, updateStage } from './stage.js';
import { filtered, filterBar, quotes, dateStrip } from './fares.js';

let screen = null;         // 'home', 'new' or 'trip'
let V = null;              // the trip as the server sent it
let MAP = null;            // its map (coastline and stop positions), from the result's _meta, shaped like the trip
let MINI = null;           // the same, small and wide, for the card in the chat
let sel = null;            // { kind: 'stop', index } or { kind: 'leg', key }
let pane = 'list';         // one-pane layouts: 'list' or 'detail'
const tours = {};          // trip id|stop|place → { state, list, more, error, kept }
const fares = {};          // leg key → { state, fares, note, live, error, filter, sort, facets, calendar, compare }

const KIND = { food: 'Food', drink: 'Drinks', beach: 'Beach', view: 'View', activity: 'Activity', stay: 'Stay', shop: 'Shopping', other: 'Other' };
const KIND_ICON = { food: Utensils, drink: Wine, beach: Umbrella, view: Mountain, activity: Compass, stay: BedDouble, shop: ShoppingBag, other: Sparkles };
const MODE = { flight: Plane, ferry: Ship, road: Car };
const legByKey = (k) => V.legs.find((l) => l.key === k);
const route = (k) => String(k).split('|').slice(0, 3).join('|');          // a leg without its date
const isSel = (kind, id) => sel && sel.kind === kind && (kind === 'stop' ? sel.index === id : sel.key === id);

// ---------------------------------------------------------------- the whole view
// Each screen and layout has its own frame, built once; renders fill it, so scroll positions and focus stay put.
function frame(kind, build) {
  const el = $('screen');
  if (el.dataset.kind !== kind) { el.dataset.kind = kind; el.replaceChildren(...build()); }
  return el;
}
// A postcard on top: the picture, the name over it, a small map or the trip's menu on the right
const cardFrame = () => [
  h('header', { class: 'top hero', id: 'hero' }, h('div', { class: 'hero-art', id: 'hero-art' }), h('div', { class: 'hero-shade' }),
    h('div', { class: 'titles' }, h('p', { id: 'eyebrow', class: 'eyebrow', hidden: true }), h('h1', { id: 'name' }), h('p', { id: 'sub', class: 'meta' })),
    h('div', { id: 'side', class: 'side' }), h('div', { id: 'hero-progress', class: 'progress in-hero', hidden: true })),
  h('div', { id: 'progress', class: 'progress', hidden: true }), h('p', { id: 'status', class: 'meta', hidden: true }), h('div', { id: 'next', class: 'next-wrap', hidden: true }),
  h('div', { id: 'strip' }), h('div', { id: 'open-row', class: 'open-row', hidden: true }),
];
// A wide banner gets a wide drawing, so the picture isn't blown up to fill it
const artSize = (L) => (L === 'card' ? { w: 760, h: 170 } : narrow() ? { w: 480, h: 150 } : { w: 1200, h: 130 });
// The postcard's picture changes only with what it shows, so it isn't drawn again on every render
function art(key, make) {
  const el = $('hero-art');
  if (el && el.dataset.key !== key) { el.dataset.key = key; el.replaceChildren(make()); }
}

function render() {
  if (!screen) return;
  const focus = document.activeElement?.id, caret = document.activeElement?.selectionStart;
  const L = layout();
  const root = $('app');
  root.dataset.layout = L;
  root.dataset.screen = screen;
  root.dataset.narrow = String(L !== 'card' && narrow());
  root.dataset.pane = pane;
  bar(L);
  if (screen === 'trip') renderTrip(L);
  else if (L === 'card') fillCard(screen === 'home' ? homeCard() : newCard());
  else {
    frame(`${screen}|${L}`, () => [h('div', { id: 'body', class: 'body' })]);
    const body = $('body'), key = screen === 'home' ? 'home' : newKey();
    body.replaceChildren(screen === 'home' ? homeScreen() : newScreen());
    if (body.dataset.key !== key) { body.dataset.key = key; body.scrollTop = 0; if (L === 'stacked') $('app').scrollIntoView?.({ block: 'start' }); }
  }
  const dialog = airMapDialog() || tripDialog();
  $('overlay').replaceChildren(...[dialog].filter(Boolean));
  if (dialog && !dialog.contains(document.getElementById(focus))) (dialog.querySelector('input:not([type="checkbox"]), #dlg-keep') || dialog.querySelector('#am-close, #dlg-close'))?.focus();
  const f = focus && document.getElementById(focus);
  if (f && f !== document.activeElement) { f.focus(); try { if (caret != null) f.setSelectionRange(caret, caret); } catch { /* not a text field */ } }
}
onRender(render);

// Full screen and in hosts without it: Back, Home, New trip, Trips and the way back to the chat (nav.js). On a phone
// full screen, Home, New trip and Trips are tabs along the bottom.
function bar(L) {
  const el = $('bar'), tabs = $('tabs');
  el.hidden = L === 'card';
  const phone = L === 'app' && window.innerWidth < 720;
  tabs.hidden = !phone;
  if (el.hidden) { tabs.replaceChildren(); return; }
  const trip = screen === 'trip' && V ? V.trip : null;
  const where = { where: screen, tripName: trip?.name, tripId: trip?.id };
  const title = screen === 'trip' ? trip?.name : screen === 'new' ? 'New trip' : 'Pinroute';
  // One pane at a time: Back on top goes from a stop or leg to the route first
  const toList = screen === 'trip' && narrow() && pane === 'detail' ? () => { pane = 'list'; render(); } : null;
  el.replaceChildren(...navBar({ layout: L, phone, title, steps: screen === 'new' ? newSteps() : null, onBack: toList, ...where }));
  tabs.replaceChildren(...(phone ? navTabs(where) : []));
}

// The start screen and the new-trip planner in the chat: a title, a line or two, a small map and one main action
function fillCard(c) {
  frame(`${screen}|card`, cardFrame);
  art(`${screen}|${c.title}`, () => scene(c.art?.seed || c.title, c.art?.kind || 'island', { sky: c.art?.sky || 'golden', ...artSize('card') }));
  $('eyebrow').hidden = !c.eyebrow;
  $('eyebrow').textContent = c.eyebrow || '';
  $('name').textContent = c.title;
  $('sub').textContent = c.sub;
  $('progress').hidden = true;
  $('next').hidden = true;
  $('status').textContent = c.status || '';
  $('status').hidden = !c.status;
  $('side').replaceChildren(...[c.side].filter(Boolean));
  $('strip').replaceChildren();
  $('open-row').hidden = false;
  $('open-row').replaceChildren(h('div', { class: 'acts' }, ...(c.actions || [h('button', { class: 'primary', onclick: () => (canFull() ? setMode('fullscreen') : render()) }, icon(Maximize2), 'Open planner')])));
}

function renderTrip(L) {
  // A leg whose date moved keeps its selection; anything else that's gone falls back to the starting point
  if (sel?.kind === 'leg' && !legByKey(sel.key)) { const same = V.legs.find((l) => route(l.key) === route(sel.key)); sel = same ? { kind: 'leg', key: same.key } : null; }
  if (!sel || (sel.kind === 'stop' && !V.stops[sel.index])) sel = startingPoint();
  frame(`trip|${L}`, () => [...cardFrame(), h('main', { id: 'panes', class: 'panes', hidden: true }, h('nav', { id: 'list', class: 'list', 'aria-label': 'Route' }), h('section', { id: 'detail', class: 'detail', 'aria-live': 'polite' }), stageEl())]);
  art(`trip|${V.trip.id}|${V.trip.name}|${L}`, () => scene(V.trip.name, tripKind(), { sky: 'golden', ...artSize(L) }));
  $('name').textContent = V.trip.name;
  const total = days(V.trip.start, V.trip.end);
  $('eyebrow').hidden = false;
  $('eyebrow').textContent = tripWhen();
  $('sub').textContent = `${span(V.trip.start, V.trip.end)} · ${V.trip.adults} traveller${V.trip.adults === 1 ? '' : 's'} · ${nightsTxt(total)}`;
  const st = $('status');
  st.textContent = [L === 'card' ? nowAndNext() : null, tally(), unplanned() && L === 'card' ? 'Route not planned yet' : null].filter(Boolean).join('\n');
  st.hidden = !st.textContent;
  const inHero = L !== 'card' && !narrow();
  $('progress').hidden = inHero;
  $('progress').replaceChildren(...(inHero ? [] : progress()));
  $('hero-progress').hidden = !inHero;
  $('hero-progress').replaceChildren(...(inHero ? progress() : []));
  const nx = L === 'card' ? nextCard() : null;
  $('next').hidden = !nx;
  $('next').replaceChildren(...[nx].filter(Boolean));
  $('side').replaceChildren(...(L === 'card' ? [h('div', { class: 'mini-map' }, mapSvg({ mini: true }))] : [tripMenu(V.trip)]).filter(Boolean));
  $('strip').replaceChildren(strip());
  $('open-row').hidden = L !== 'card';
  $('open-row').replaceChildren(h('div', { class: 'acts' }, h('button', { class: 'primary', onclick: () => openAt(null) }, icon(Maximize2), 'Open planner'),
    canFull() ? h('button', { onclick: () => go('open_planner', {}) }, 'All trips') : null));
  $('panes').hidden = L === 'card';
  if (L !== 'card') {
    $('list').replaceChildren(...listView());
    const det = $('detail'), key = JSON.stringify(sel);
    det.replaceChildren(...detailView());
    updateStage({ V, M: MAP, sel, settled, onPick: pick, onHover: (i, on, k) => link(i, on, k) });
    if (det.dataset.sel !== key) { det.dataset.sel = key; det.classList.remove('enter'); void det.offsetWidth; det.classList.add('enter'); det.scrollTop = 0; }
    // Phone full screen scrolls as one page: a stop or leg opens at its top, the route comes back where it was
    const scr = $('screen');
    if (L === 'app' && narrow() && scr.dataset.pane !== pane) {
      if (pane === 'detail') { scr.dataset.listAt = String(scr.scrollTop); scr.scrollTop = Math.max(0, $('panes').offsetTop - 8); }
      else scr.scrollTop = Number(scr.dataset.listAt || 0);
      scr.dataset.pane = pane;
    }
  }
}

// A trip started from a flight is one stop (or two) until its route is planned
const unplanned = () => !!V.trip.ticket && V.stops.filter((x) => x.nights > 0).length <= 1;

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

// The trip's picture: the kind most of its nights are spent in
function tripKind() {
  const n = {};
  V.stops.forEach((x, i) => { const k = kindOf(x, i, V.stops.length); n[k] = (n[k] || 0) + (x.nights || 0); });
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || 'island';
}
function tripWhen() {
  const t = today();
  if (t >= V.trip.end) return 'Trip done';
  if (t >= V.trip.start) { const here = V.stops.find((x) => x.arrive <= t && t < x.depart); return here ? `Under way · today in ${here.place}` : 'Under way'; }
  const n = days(t, V.trip.start);
  return n <= 1 ? 'Starts tomorrow' : n < 14 ? `Starts in ${n} days` : n < 60 ? `Starts in ${Math.round(n / 7)} weeks` : `Starts in ${Math.round(n / 30)} months`;
}
const settled = (l) => (l.mode === 'flight' ? !!(l.chosen || l.booked) : !!l.booked);
// What is settled: a ring for the share, and a chip each for flights, ferries and drives, and local picks
function progress() {
  const done = V.legs.filter(settled).length, all = V.legs.length || 1, f = done / all;
  const R = 15, C = 2 * Math.PI * R;
  const ring = s('svg', { class: 'ring', viewBox: '0 0 36 36', 'aria-hidden': 'true' });
  ring.append(s('circle', { cx: 18, cy: 18, r: R, class: 'ring-bg' }), s('circle', { cx: 18, cy: 18, r: R, class: 'ring-fg', 'stroke-dasharray': `${C * f} ${C}`, transform: 'rotate(-90 18 18)' }));
  const fl = V.legs.filter((l) => l.mode === 'flight'), tr = V.legs.filter((l) => l.mode !== 'flight');
  const chip = (ic, a, b, label) => h('span', { class: `pchip${a === b ? ' all' : ''}`, title: label, 'aria-label': `${label}: ${a} of ${b}` }, icon(ic), h('b', { text: String(a) }), h('span', { text: `/${b}` }));
  return [h('span', { class: 'pring', title: `${done} of ${all} legs settled` }, ring, h('span', { class: 'pct', text: `${Math.round(f * 100)}%` })),
    h('span', { class: 'plabel' }, h('b', { text: done === all ? 'All settled' : `${all - done} to settle` }), h('span', { class: 'small', text: `${done} of ${all} legs ready` })),
    h('span', { class: 'pchips' },
      fl.length ? chip(Plane, fl.filter(settled).length, fl.length, 'Flights chosen') : null,
      tr.length ? chip(Ship, tr.filter(settled).length, tr.length, 'Ferries and drives booked') : null,
      chip(MapPin, V.stops.filter((x) => x.nights > 0 && (V.picks[x.place] || []).length).length, V.stops.filter((x) => x.nights > 0).length, 'Stops with local picks'))];
}
// The next thing to settle, in travel order, from today on
function nextTodo() {
  const t = today();
  return V.legs.filter((l) => l.date >= t || t < V.trip.start).find((l) => !settled(l)) || null;
}
const doWhat = (l) => (l.mode === 'flight' ? (l.stale ? 'Choose a new flight' : 'Choose flight') : l.mode === 'ferry' ? 'Book ferry' : 'Book transfer');
function nextCard() {
  if (unplanned()) return h('button', { class: 'next', onclick: () => openAt(null) }, h('span', { class: 'next-ic' }, icon(Route)),
    h('span', { class: 'next-t' }, h('span', { class: 'small', text: 'Next up' }), h('b', { text: 'Plan the route between your flights' })), icon(ChevronRight));
  const l = nextTodo();
  if (!l) return h('div', { class: 'next done' }, h('span', { class: 'next-ic' }, icon(PartyPopper)), h('span', { class: 'next-t' }, h('span', { class: 'small', text: 'All set' }), h('b', { text: 'Every flight and transfer is settled' })));
  return h('button', { class: 'next', onclick: () => openAt({ kind: 'leg', key: l.key }) },
    h('span', { class: 'next-ic' }, icon(MODE[l.mode] || Plane)),
    h('span', { class: 'next-t' }, h('span', { class: 'small', text: `Next up · ${day(l.date)}` }), h('b', { text: `${doWhat(l)}: ${l.mode === 'flight' ? `${l.from} → ${l.to}` : `${l.fromName} → ${l.toName}`}` })),
    icon(ChevronRight));
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
let mapN = 0;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function mapSvg({ mini = false } = {}) {
  const M = mini ? MINI : MAP;
  if (!M) return null;
  const id = `m${++mapN}`;
  const svg = s('svg', { class: `map${mini ? ' mini' : ''}`, viewBox: `0 0 ${M.w} ${M.h}`, role: 'img', 'aria-label': `Map of the route: ${V.stops.map((x) => x.place).join(', ')}` });
  // The sea darker toward the edges, the land lifted off it with a soft shadow
  const defs = s('defs');
  const sea = s('radialGradient', { id: `${id}sea`, cx: '50%', cy: '40%', r: '75%' });
  sea.append(s('stop', { offset: 0, class: 'sea-0' }), s('stop', { offset: 1, class: 'sea-1' }));
  const sh = s('filter', { id: `${id}sh`, x: '-5%', y: '-5%', width: '110%', height: '110%' });
  sh.append(s('feDropShadow', { dx: 0, dy: mini ? 0.5 : 1.5, stdDeviation: mini ? 0.8 : 2, 'flood-opacity': 0.18 }));
  const grid = s('pattern', { id: `${id}grid`, width: 40, height: 40, patternUnits: 'userSpaceOnUse' });
  grid.append(s('path', { d: 'M40 0 L0 0 0 40', class: 'grid' }));
  defs.append(sea, sh, grid);
  svg.append(defs, s('rect', { class: 'sea', width: M.w, height: M.h, fill: `url(#${id}sea)` }));
  if (!mini) svg.append(s('rect', { width: M.w, height: M.h, fill: `url(#${id}grid)` }));
  svg.append(s('path', { class: 'land', d: M.land, filter: `url(#${id}sh)` }));
  const routes = s('g', { class: 'routes' });
  let selPath = null;
  for (const l of V.legs) {
    if (l.after < 0 || l.after >= V.stops.length - 1) continue;           // flights from and to home are off this map
    const a = M.points[l.after], b = M.points[l.after + 1];
    if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
    const on = isSel('leg', l.key);
    const cls = `route ${l.mode === 'flight' ? 'flight' : 'ground'}${on ? ' sel' : ''}${settled(l) ? ' ok' : ''}`;
    let d;
    if (l.mode === 'flight') {                                                // flights as arcs, the way they are drawn on route maps
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), k = Math.min(48, len * 0.2);
      d = `M${a[0]},${a[1]} Q${(a[0] + b[0]) / 2 - (dy / len) * k},${(a[1] + b[1]) / 2 + (dx / len) * k} ${b[0]},${b[1]}`;
    } else d = `M${a[0]},${a[1]} L${b[0]},${b[1]}`;
    if (!mini) routes.append(s('path', { class: 'route-halo', d }));
    routes.append(s('path', { class: cls, d, 'data-leg': l.key, ...(l.mode === 'flight' ? { pathLength: 100 } : {}) }));
    if (on && !mini) selPath = { d, mode: l.mode };
  }
  svg.append(routes);
  // On the card, a small traveller goes round the whole route
  if (mini && !reduced()) {
    const d = V.legs.filter((l) => l.after >= 0 && l.after < V.stops.length - 1).map((l) => { const a = M.points[l.after], b = M.points[l.after + 1]; return a && b ? `M${a[0]},${a[1]} L${b[0]},${b[1]}` : ''; }).join(' ');
    if (d) { const g = s('g', { class: 'mover mini-mover' }); g.append(s('circle', { r: 4 }), s('animateMotion', { dur: `${Math.max(6, V.stops.length * 1.4)}s`, repeatCount: 'indefinite', path: d })); svg.append(g); }
  }
  // On the selected leg, a plane or a boat travels along it
  if (selPath && !reduced()) {
    const g = s('g', { class: 'mover' });
    g.append(s('circle', { r: 9 }));
    const ic = icon(selPath.mode === 'flight' ? Plane : selPath.mode === 'ferry' ? Ship : Car);
    ic.setAttribute('x', -6); ic.setAttribute('y', -6); ic.setAttribute('width', 12); ic.setAttribute('height', 12);
    if (selPath.mode === 'flight') ic.setAttribute('transform', 'rotate(45)');
    g.append(ic, s('animateMotion', { dur: '3.2s', repeatCount: 'indefinite', path: selPath.d, keyPoints: '0;1', keyTimes: '0;1', calcMode: 'linear' }));
    svg.append(g);
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
    const g = s('g', { class: `pin${on ? ' sel' : ''}${mini ? '' : ' go'}`, transform: `translate(${p[0]},${p[1]})`, 'data-stop': i });
    if (on && !mini) g.append(s('circle', { class: 'pulse', r: 11 }));
    g.append(s('circle', { class: 'dot', r: mini ? 5 : 11 }));
    if (!mini) {
      g.append(s('text', { 'text-anchor': 'middle', dy: '0.35em' }, String(i + 1)));
      g.append(s('text', { class: 'label', x: 16, y: 4 }, x.place));
      g.append(s('title', {}, x.place));
      g.addEventListener('click', () => pick({ kind: 'stop', index: i }));
      g.addEventListener('mouseenter', () => link(i, true));
      g.addEventListener('mouseleave', () => link(i, false));
    }
    svg.append(g);
  }
  return svg;
}

// Hovering a row lights its pin and its line on the map, and hovering a pin lights its row
function link(stop, on, leg) {
  for (const el of document.querySelectorAll(stop != null ? `.map [data-stop="${stop}"], .list [data-stop="${stop}"]` : `.map [data-leg="${CSS.escape(leg)}"], .list [data-leg="${CSS.escape(leg)}"]`)) el.classList.toggle('hl', on);
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
  return [unplanned() ? planCallout() : null, h('ol', { class: 'rail', onkeydown: moveWithKeys }, rows),
    narrow() ? null : h('p', { class: 'hint small' }, h('kbd', { text: '↑' }), ' ', h('kbd', { text: '↓' }), ' move along the route')].filter(Boolean);
}

function planCallout() {
  const t = V.trip.ticket;
  return h('div', { class: 'callout' },
    h('p', { class: 'meta', text: `You land in ${V.stops[0].place} and fly home from ${V.stops.at(-1).place}. Claude can suggest the stops in between.` }),
    waiting.plan ? skeleton('Claude is planning; the route appears here once saved.', 2) : null,
    answerBlock('plan', { poll: refresh }),
    h('button', { class: 'primary', disabled: !t, onclick: askPlan }, icon(Route), 'Ask Claude to plan the route'));
}
function askPlan() {
  const t = V.trip.ticket, first = V.stops[0].place, last = V.stops.at(-1).place;
  const before = V.stops.map((x) => `${x.place}:${x.nights}`).join();
  const area = V.trip.area ? ` Keep the route in ${V.trip.area}.` : '', wish = V.trip.wishes ? ` What I have in mind: "${V.trip.wishes}".` : '';
  return ask('plan', `Plan the route for my Pinroute trip "${V.trip.name}" (trip_id "${V.trip.id}")${V.trip.country ? ` in ${V.trip.country}` : ''}: I land in ${first} (${t.to}) on ${longDay(V.trip.start)} and fly home from ${last} (${t.back_from || t.to}) on ${longDay(V.trip.end)}, ${nightsTxt(days(V.trip.start, V.trip.end))}, ${V.trip.adults} adult${V.trip.adults === 1 ? '' : 's'}.${area}${wish} Suggest the stops in travel order with the nights at each, at a relaxed pace, and say in a few lines why. Then save it with update_trip: keep ${first} first, end with ${last} with 0 nights, and give every stop its nearest airport code, its lat and lon, and island true for islands.`,
    { poll: refresh, done: () => V.stops.map((x) => `${x.place}:${x.nights}`).join() !== before, tries: 60 });
}

// Each stop's postcard: the same place always gets the same picture
const stopArt = (x, w = 400, hgt = 200) => scene(x.place, kindOf(x, x.index, V.stops.length), { w, h: hgt });
const thumb = (x) => stopArt(x, 120, 120);

function stopRow(x) {
  const picks = V.picks[x.place] || [];
  const on = isSel('stop', x.index);
  return h('li', { class: 'rl rl-stop' }, h('button', { class: `row stop${on ? ' sel' : ''}`, 'aria-current': on ? 'true' : null, 'data-stop': x.index, id: `row-stop-${x.index}`, onclick: () => pick({ kind: 'stop', index: x.index }),
    onmouseenter: () => link(x.index, true), onmouseleave: () => link(x.index, false) },
    h('span', { class: 'badge-n', text: String(x.index + 1) }),
    h('span', { class: 'thumb' }, thumb(x)),
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
  const on = isSel('leg', l.key), st = legState(l), up = nextTodo()?.key === l.key;
  return h('li', { class: `rl rl-leg ${st.tone}${l.mode === 'flight' ? ' fly' : ''}${up ? ' up' : ''}` }, h('button', { class: `row leg${on ? ' sel' : ''}`, 'aria-current': on ? 'true' : null, 'data-leg': l.key, id: `row-leg-${l.key}`, onclick: () => pick({ kind: 'leg', key: l.key }),
    onmouseenter: () => link(null, true, l.key), onmouseleave: () => link(null, false, l.key) },
    h('span', { class: 'leg-ic' }, icon(MODE[l.mode] || Plane)),
    h('span', { class: 'main' }, h('span', { text: legLine(l) })),
    up ? h('span', { class: 'up-badge', 'aria-hidden': 'true', text: 'Next' }) : null,
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
  if (narrow()) return [h('button', { class: 'ghost back', onclick: () => { pane = 'list'; render(); } }, icon(ChevronLeft), 'Route'), ...body, guide()].filter(Boolean);
  return [h('div', { class: 'content' }, body, guide())];
}

function stopDetail(x) {
  const picks = V.picks[x.place] || [];
  const where = [x.region, x.iata && `nearest airport ${x.iata}`].filter(Boolean).join(' · ');
  const nights = x.nights || 0, first = x.index === 0, last = x.index === V.stops.length - 1;
  return [
    h('div', { class: 'dhead stop-hero' },
      h('div', { class: 'sh-art' }, stopArt(x, 640, 240)), h('div', { class: 'hero-shade' }),
      h('div', { class: 'sh-text' },
        h('span', { class: 'eyebrow', text: `Stop ${x.index + 1} of ${V.stops.length}${first ? ' · start' : last ? ' · end' : ''}` }),
        h('h2', { text: x.place }),
        h('p', { class: 'meta', text: x.nights ? `${day(x.arrive)} to ${day(x.depart)}` : `Arrive ${day(x.arrive)}` })),
      h('div', { class: 'stepper', role: 'group', 'aria-label': `Nights in ${x.place}` },
        h('button', { class: 'icon', 'aria-label': 'One night fewer', disabled: ui.busy || x.nights === 0, onclick: () => setNights(x, x.nights - 1) }, icon(Minus)),
        h('span', { class: 'val', text: nightsTxt(x.nights) }),
        h('button', { class: 'icon', 'aria-label': 'One night more', disabled: ui.busy || x.nights >= 60, onclick: () => setNights(x, x.nights + 1) }, icon(Plus)))),
    nights ? h('div', { class: 'moons', 'aria-hidden': 'true' }, Array.from({ length: Math.min(nights, 21) }, (_, i) => h('i', { style: `animation-delay:${i * 40}ms` }))) : null,
    where ? h('p', { class: 'small where', text: where }) : null,
    hotelBlock(x),
    h('section', { class: 'block' },
      h('div', { class: 'block-head' }, h('h3', { text: picks.length ? `Local picks (${picks.length})` : 'Local picks' }),
        picks.length ? h('span', { class: 'small', text: 'What locals and recent travellers recommend' }) : null),
      picks.length ? h('ul', { class: 'picks' }, picks.map((p, i) => h('li', { class: `pick k-${KIND[p.kind] ? p.kind : 'other'}`, style: `animation-delay:${i * 50}ms` },
        h('div', { class: 'pick-head' }, h('span', { class: 'kind-ic' }, icon(KIND_ICON[p.kind] || Sparkles)),
          h('span', { class: 'pick-t' }, h('span', { class: 'pname', text: p.name }), h('span', { class: 'kind', text: [KIND[p.kind] || p.kind, p.area].filter(Boolean).join(' · ') })),
          p.source_url ? h('button', { class: 'icon ghost', title: 'Source', 'aria-label': `Source for ${p.name}`, onclick: () => app.openLink({ url: p.source_url }) }, icon(ExternalLink)) : null),
        h('p', { class: 'why', text: p.why })))) : waiting[`picks|${x.place}`] ? null : h('div', { class: 'empty-state' }, h('span', { class: 'kind-ic' }, icon(Sparkles)),
        h('p', { class: 'meta', text: `No picks for ${x.place} yet. Claude can look through recent Reddit threads, Instagram posts and travel blogs for the places locals love.` })),
      waiting[`picks|${x.place}`] ? skeleton(`Claude is researching picks for ${x.place}`) : null,
      answerBlock(`picks|${x.place}`, { poll: refresh }),
      h('div', { class: 'acts' }, h('button', { class: picks.length ? '' : 'primary', onclick: () => askPicks(x) }, icon(MessageSquare), picks.length ? 'Ask Claude for more' : 'Ask Claude for local picks'))),
    V.activities?.on ? toursBlock(x, picks) : null,
  ];
}

// ---- tours and activities at a stop: found with Amadeus, booked on GetYourGuide or Klook
const tourKey = (x) => `${V.trip.id}|${x.index}|${x.place}`;
function toursBlock(x, picks) {
  const t = tours[tourKey(x)] || {};
  const kept = new Set(picks.map((p) => p.name.toLowerCase()));
  const facts = (a) => [a.priceFrom != null ? `from ${money(a.priceFrom, a.currency)}${a.perPerson ? ' pp' : ''}` : null, a.duration].filter(Boolean).join(' · ');
  return h('section', { class: 'block tours' },
    h('div', { class: 'block-head' }, h('h3', { text: t.list?.length ? `Tours & activities (${t.list.length})` : 'Tours & activities' }),
      h('span', { class: 'small', text: 'Popular with travellers, to book on GetYourGuide or Klook' })),
    t.state === 'loading' ? h('div', { class: 'skel', role: 'status' }, h('p', { class: 'small skel-line' }, h('span', { class: 'spark' }, icon(Sparkles)), `Finding tours in ${x.place}`),
      Array.from({ length: 2 }, () => h('div', { class: 'skel-row' }, h('i', { class: 'a' }), h('i', { class: 'b' }), h('i', { class: 'c' }), h('i', { class: 'd' })))) : null,
    t.state === 'error' ? h('p', { class: 'note warn', text: t.error }) : null,
    t.state === 'done' && !t.list.length ? h('p', { class: 'meta', text: `No tours found around ${x.place}.` }) : null,
    t.list?.length ? h('ul', { class: 'picks' }, t.list.map((a, i) => h('li', { class: 'pick k-activity tour', style: `animation-delay:${i * 50}ms` },
      a.image ? h('img', { class: 'tour-img', src: a.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.currentTarget.remove() }) : null,
      h('div', { class: 'pick-head' }, h('span', { class: 'kind-ic' }, icon(Ticket)),
        h('span', { class: 'pick-t' }, h('span', { class: 'pname', text: a.title }), h('span', { class: 'kind', text: facts(a) }))),
      a.rating ? h('p', { class: 'small rating' }, icon(Star), ` ${a.rating.toFixed(1)}${a.reviews ? ` (${a.reviews.toLocaleString('en-GB')} reviews)` : ''}`) : null,
      a.summary ? h('p', { class: 'why', text: a.summary }) : null,
      h('div', { class: 'acts tour-acts' },
        a.links.map((l, j) => h('button', { class: j ? 'ghost' : '', onclick: () => app.openLink({ url: l.url }) }, icon(ExternalLink), l.site)),
        kept.has(a.title.toLowerCase()) ? h('span', { class: 'small kept' }, icon(Check), ' Kept')
          : h('button', { class: 'ghost', disabled: ui.busy, onclick: () => keepTour(x, a) }, icon(Plus), 'Keep'))))) : null,
    t.more?.length ? h('p', { class: 'small' }, `More in ${x.place}: `, t.more.flatMap((l, j) => [j ? ' · ' : '', h('button', { class: 'link', text: l.site, onclick: () => app.openLink({ url: l.url }) })])) : null,
    t.state === 'done' && V.activities.partnerLinks ? h('p', { class: 'small foot', text: 'GetYourGuide and Klook links carry Pinroute\'s partner ID: Pinroute may earn a commission on a booking. The price you pay is the same.' }) : null,
    t.state === 'loading' ? null : h('div', { class: 'acts' }, h('button', { class: t.list?.length ? '' : 'primary', onclick: () => findTours(x) }, icon(Ticket), t.list ? 'Search again' : `Find tours in ${x.place}`)));
}

async function findTours(x) {
  const k = tourKey(x);
  tours[k] = { ...(tours[k] || {}), state: 'loading' };
  render();
  try {
    const r = await app.callServerTool({ name: 'find_activities', arguments: { trip_id: V.trip.id, stop: x.index, limit: 6 } });
    if (r.isError) throw new Error(textOf(r) || 'The search failed.');
    tours[k] = { state: 'done', list: r.structuredContent?.activities || [], more: r.structuredContent?.more || [] };
  } catch (e) {
    tours[k] = { ...tours[k], state: 'error', error: e.message || String(e) };
  }
  render();
}

// Keeps a tour with the stop's local picks, with its first booking link
async function keepTour(x, a) {
  const url = a.links[0]?.url;
  if (!url) return;
  ui.busy = true; render();
  try {
    const r = await app.callServerTool({ name: 'save_local_picks', arguments: { place: x.place, picks: [{
      name: a.title.slice(0, 80), kind: 'activity', why: (a.summary || a.title).slice(0, 300), source_url: url, book_url: url,
      ...(a.priceFrom != null ? { price_from: a.priceFrom, currency: a.currency } : {}) }] } });
    if (r.isError) throw new Error(textOf(r) || 'Could not save it.');
    V.picks[x.place] = r.structuredContent?.picks || V.picks[x.place];
    showError('');
  } catch (e) { showError(e.message || String(e)); }
  finally { ui.busy = false; render(); }
}

// ---------------------------------------------------------------- the guide: what to do after this, one or two steps
// The route in travel order: the flight out, then each stop and the leg after it
function order() {
  const out = [];
  const first = V.legs.find((l) => l.after === -1);
  if (first) out.push({ kind: 'leg', key: first.key });
  for (const x of V.stops) { out.push({ kind: 'stop', index: x.index }); for (const l of V.legs.filter((m) => m.after === x.index)) out.push({ kind: 'leg', key: l.key }); }
  return out;
}
const sameSel = (a, b) => a && b && a.kind === b.kind && (a.kind === 'stop' ? a.index === b.index : a.key === b.key);
// The next leg still to settle after this point on the route, else the first one left anywhere
function nextAfter(cur) {
  const all = order(), at = all.findIndex((o) => sameSel(o, cur));
  const legs = [...all.slice(at + 1), ...all.slice(0, Math.max(0, at))].filter((o) => o.kind === 'leg').map((o) => legByKey(o.key));
  return legs.find((l) => l && !settled(l)) || null;
}
const legTitle = (l) => `${doWhat(l)}: ${l.mode === 'flight' ? `${l.from} → ${l.to}` : `${l.fromName} → ${l.toName}`}`;
function nextStopAfter(cur) {
  const all = order(), at = all.findIndex((o) => sameSel(o, cur));
  const o = all.slice(at + 1).find((x) => x.kind === 'stop' && V.stops[x.index].nights > 0);
  return o ? V.stops[o.index] : null;
}
function guide() {
  if (!sel || unplanned()) return null;
  const cur = sel.kind === 'leg' ? legByKey(sel.key) : null;
  if (cur && !settled(cur)) {                                  // the step on screen comes first; offer only to skip it
    const nx = nextAfter(sel);
    return nx ? h('div', { class: 'guide quiet' }, h('span', { class: 'small', text: 'Not now?' }),
      h('button', { class: 'ghost', onclick: () => pick({ kind: 'leg', key: nx.key }) }, `Skip to: ${legTitle(nx)}`, icon(ArrowRight))) : null;
  }
  const nx = nextAfter(sel), ns = nextStopAfter(sel);
  const done = V.legs.filter(settled).length, all = V.legs.length;
  if (!nx) {
    return h('div', { class: 'guide done' }, h('span', { class: 'guide-ic' }, icon(PartyPopper)),
      h('div', { class: 'guide-t' }, h('b', { text: 'Your whole route is settled' }), h('span', { class: 'small', text: 'Every flight and transfer is chosen or booked. Watch the trip on the map, or keep adding local picks.' })),
      h('div', { class: 'acts' }, h('button', { class: 'primary', onclick: () => document.querySelector('.stage .stage-btn')?.click() }, icon(Play), 'Play your trip'),
        ns ? h('button', { onclick: () => pick({ kind: 'stop', index: ns.index }) }, `Next stop: ${ns.place}`) : null));
  }
  return h('div', { class: 'guide' },
    h('span', { class: 'guide-ic' }, icon(cur ? CircleCheck : MODE[nx.mode] || Plane)),
    h('div', { class: 'guide-t' }, h('span', { class: 'small', text: `${cur ? 'Settled. ' : ''}Next up · ${day(nx.date)} · ${done} of ${all} legs ready` }), h('b', { text: legTitle(nx) })),
    h('div', { class: 'acts' },
      h('button', { class: 'primary', onclick: () => pick({ kind: 'leg', key: nx.key }) }, 'Go to it', icon(ArrowRight)),
      ns && sel.kind === 'stop' ? h('button', { class: 'ghost', onclick: () => pick({ kind: 'stop', index: ns.index }) }, `Next stop: ${ns.place}`) : null));
}

// A moment when something is settled: a check, what it was, and the one next step
let toastTimer = 0;
function celebrate(what, after) {
  const nx = nextAfter(after);
  const el = h('div', { class: 'toast', role: 'status' },
    h('span', { class: 'toast-ic' }, icon(Check)),
    h('span', { class: 'toast-t' }, h('b', { text: what }), nx ? h('span', { class: 'small', text: `Next: ${legTitle(nx)}` }) : h('span', { class: 'small', text: 'Everything on the route is settled' })),
    nx ? h('button', { class: 'primary', onclick: () => { el.remove(); pick({ kind: 'leg', key: nx.key }); } }, 'Next', icon(ArrowRight)) : null);
  document.querySelector('.toast')?.remove();
  $('app').append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 6500);
}

// Where to sleep: the stop's nights as a Booking.com search, the hotel picked (from any hotel search) and whether it's booked
const stayOf = (x) => (V.stays || []).find((st) => st.stop === x.index) || null;
function stayState(st) {
  if (st.chosen?.booked) return { text: 'Booked', tone: 'done' };
  if (st.chosen) return { text: 'Chosen', tone: 'done' };
  if (st.stale) return { text: 'Dates moved', tone: 'warn' };
  return { text: 'To choose', tone: 'todo' };
}
function hotelBlock(x) {
  const st = stayOf(x);
  if (!st) return null;
  const state = stayState(st), c = st.chosen, key = `stay|${st.key}`;
  return h('section', { class: 'block stay' },
    h('div', { class: 'block-head' }, h('h3', { text: 'Where to stay' }),
      h('span', { class: `pill ${state.tone}` }, state.tone === 'done' ? icon(Check) : null, state.text),
      h('span', { class: 'small', text: `${day(st.checkin)} to ${day(st.checkout)} · ${nightsTxt(st.nights)}` })),
    st.stale ? h('div', { class: 'note warn' }, `${st.stale.name} was saved for ${day(st.stale.checkin)} to ${day(st.stale.checkout)}, before the dates moved. Choose a place for the new dates. `,
      h('button', { class: 'link', disabled: ui.busy, onclick: () => clearStay(st, st.stale) }, 'Remove it')) : null,
    c ? h('div', { class: 'ticket stay-ticket' },
      h('div', { class: 'tmain' },
        h('p', { class: 'tsum' }, h('span', { class: 'kind-ic' }, icon(BedDouble)), c.name),
        h('p', { class: 'small', text: [c.note, c.source ? `via ${c.source}` : null].filter(Boolean).join(' · ') || ' ' })),
      h('div', { class: 'tside' }, c.price != null ? h('span', { class: 'price', text: money(c.price, c.currency) }) : null,
        h('span', { class: 'small', text: nightsTxt(st.nights) }))) : null,
    waiting[key] ? skeleton(`Claude is looking for places to stay in ${x.place}`, 2) : null,
    answerBlock(key, { poll: refresh }),
    h('div', { class: 'acts' },
      h('button', { class: c ? '' : 'primary', onclick: () => app.openLink({ url: c?.link || st.link }) }, icon(ExternalLink), c?.link ? 'Booking page' : 'Find hotels on Booking.com'),
      c ? h('button', { 'aria-pressed': String(!!c.booked), disabled: ui.busy, onclick: () => setStayBooked(st, !c.booked) }, icon(Check), c.booked ? 'Booked' : 'Mark booked') : null,
      c?.link ? h('button', { class: 'ghost', onclick: () => app.openLink({ url: st.link }) }, icon(ExternalLink), 'Compare on Booking.com') : null,
      h('button', { class: 'ghost', onclick: () => askStay(x, st) }, icon(MessageSquare), c ? 'Ask Claude again' : 'Ask Claude'),
      c ? h('button', { class: 'ghost', disabled: ui.busy, onclick: () => clearStay(st, c) }, 'Remove') : null),
    V.hotels?.partnerLinks ? h('p', { class: 'small foot', text: 'Booking.com links carry Pinroute\'s partner ID: Pinroute may earn a commission on a booking. The price you pay is the same.' }) : null);
}
const clearStay = (st, c) => save('clear_stay', { trip_id: V.trip.id, stay_key: c === st.stale ? `stay|${st.place}|${st.stale.checkin}|${st.stale.checkout}` : st.key }, `the traveller removed ${c.name} from ${st.place}.`);
const setStayBooked = (st, booked) => save('choose_stay', { trip_id: V.trip.id, stay_key: st.key, ...Object.fromEntries(Object.entries(st.chosen).filter(([k, v]) => v != null && ['name', 'price', 'currency', 'link', 'source', 'note'].includes(k))), booked },
  `the traveller marked ${st.chosen.name} in ${st.place} as ${booked ? 'booked' : 'not booked yet'}.`);
function askStay(x, st) {
  const n = V.trip.adults;
  const before = JSON.stringify(st.chosen);
  const where = x.region ? `${x.place} (${x.region})` : x.place;
  return ask(`stay|${st.key}`,
    `Find places to stay in ${where} from ${longDay(st.checkin)} to ${longDay(st.checkout)} (${nightsTxt(st.nights)}) for ${n} adult${n === 1 ? '' : 's'}, using my hotel search tools. Show me a few good options with price, rating and location, and when I pick one, save it to Pinroute with choose_stay (trip_id "${V.trip.id}", stay_key "${st.key}").`,
    { poll: refresh, done: () => JSON.stringify(stayOf(x)?.chosen) !== before });
}

// While Claude works: a line saying so, and grey rows where the answer will appear; Refresh only after a while
function skeleton(line, rows = 3) {
  return h('div', { class: 'skel', role: 'status' },
    h('p', { class: 'small skel-line' }, h('span', { class: 'spark' }, icon(Sparkles)), line),
    Array.from({ length: rows }, () => h('div', { class: 'skel-row' }, h('i', { class: 'a' }), h('i', { class: 'b' }), h('i', { class: 'c' }), h('i', { class: 'd' }))),
    h('button', { class: 'link skel-refresh', text: 'Refresh', onclick: () => refresh() }));
}

function legDetail(l) {
  const what = l.mode === 'flight' ? `Flight · ${longDay(l.date)} · ${l.from} → ${l.to}` : `${l.mode === 'ferry' ? 'Ferry' : 'By road'} · ${longDay(l.date)}${l.km ? ` · about ${l.km} km` : ''}`;
  const a = l.after >= 0 ? V.stops[l.after] : null, b = V.stops[l.after + 1] || null;
  const st = legState(l);
  return [h('div', { class: `dhead leg-hero m-${l.mode}` },
    h('div', { class: 'lh-ends' },
      h('span', { class: 'lh-end' }, h('span', { class: 'lh-art' }, a ? stopArt(a, 160, 160) : scene(l.fromName, 'city', { w: 160, h: 160 })), h('b', { text: l.mode === 'flight' ? l.from : '' }), h('span', { class: 'small', text: l.fromName })),
      h('span', { class: 'lh-path' }, h('i'), h('span', { class: 'lh-ic' }, icon(MODE[l.mode] || Plane)), h('i')),
      h('span', { class: 'lh-end' }, h('span', { class: 'lh-art' }, b ? stopArt(b, 160, 160) : scene(l.toName, 'city', { w: 160, h: 160 })), h('b', { text: l.mode === 'flight' ? l.to : '' }), h('span', { class: 'small', text: l.toName }))),
    h('div', { class: 'lh-text' },
      h('span', { class: `pill ${st.tone}` }, st.tone === 'done' ? icon(Check) : null, st.text),
      h('h2', { text: `${l.fromName} → ${l.toName}` }), h('p', { class: 'meta', text: what }))),
  ...(l.mode === 'flight' ? flightBlock(l) : transferBlock(l))];
}

const bookedButton = (l) => h('button', { 'aria-pressed': String(l.booked), disabled: ui.busy, onclick: () => setBooked(l, !l.booked) }, icon(Check), l.booked ? 'Booked' : 'Mark booked');

// A leg as an Aviasales search: the flight out of a return fare is searched as the return trip it is
const leg = (l) => {
  const t = V.trip.ticket;
  if (l.kind === 'out' && t && l.chosen?.part === 'out') return { from: t.from, to: t.to, depart: t.depart, return: t.return, adults: V.trip.adults };
  return { from: l.from, to: l.to, depart: l.date, adults: V.trip.adults };
};

function flightBlock(l) {
  if (l.chosen) {
    return [ticket(l.chosen),
      l.note ? h('p', { class: 'meta', text: l.note }) : null,
      h('div', { class: 'acts' },
        bookedButton(l),
        l.chosen.link ? h('button', { onclick: () => app.openLink({ url: l.chosen.link }) }, icon(ExternalLink), 'Booking page') : null,
        l.chosen.part === 'return' ? null : h('button', { class: 'ghost', onclick: () => openFlightLink(leg(l)) }, icon(ExternalLink), 'Compare on Aviasales'),
        h('button', { class: 'ghost', onclick: () => askFlights(l) }, icon(MessageSquare), 'Ask Claude again'),
        h('button', { class: 'ghost', disabled: ui.busy, onclick: () => clearFlight(l) }, 'Remove')),
      waiting[`flights|${l.key}`] ? skeleton('Claude is searching with your flight tools; the options show here.', 2) : null,
      answerBlock(`flights|${l.key}`, { poll: refresh }),
      V.flights.partnerLinks && l.chosen.part !== 'return' ? commissionNote() : null].filter(Boolean);
  }
  const st = fares[l.key] || {};
  const label = st.state === 'loading' ? 'Searching…' : st.state === 'done' ? 'Search again' : V.flights.live ? 'Airline fares' : 'Demo fares';
  return [
    l.stale ? h('div', { class: 'note warn' }, `A flight was chosen for ${day(l.stale.date)}, before the dates moved: ${l.stale.summary}, ${money(l.stale.price, l.stale.currency)}. Choose one for ${day(l.date)}. `,
      h('button', { class: 'link', disabled: ui.busy, onclick: () => clearFlight(l) }, 'Remove it')) : null,
    h('div', { class: 'acts' },
      h('button', { class: 'primary', onclick: () => askFlights(l) }, icon(MessageSquare), 'Ask Claude to find flights'),
      h('button', { disabled: st.state === 'loading', onclick: () => findFlights(l) }, label),
      h('button', { class: 'ghost', onclick: () => openFlightLink(leg(l)) }, icon(ExternalLink), 'Compare on Aviasales')),
    V.flights.partnerLinks ? commissionNote() : null,
    waiting[`flights|${l.key}`] ? skeleton('Claude is searching with your flight tools; the options show here.', 2) : null,
    answerBlock(`flights|${l.key}`, { poll: refresh }),
    st.state === 'loading' ? skeleton('Searching airline fares for the day and the days around it, and Aviasales…', 3) : null,
    st.state === 'error' ? h('p', { class: 'note warn', text: st.error }) : null,
    st.state === 'done' ? faresBlock(l, st) : null,
  ].filter(Boolean);
}

// A chosen flight as a stub: codes and times when the summary carries them ("11:40 KBV → 12:55 DMK")
function ticket(c) {
  const m = /(\d{1,2}:\d{2})\s*([A-Z]{3})\s*→\s*(\d{1,2}:\d{2})\s*([A-Z]{3})/.exec(c.summary || '');
  const airline = (c.summary || '').split(',')[0].trim().replace(/\b([A-Z0-9]{2}) (\d)/g, '$1\u00a0$2');   // "Thai AirAsia FD 3104": the flight number never breaks
  return h('div', { class: 'ticket' },
    h('div', { class: 'tmain' },
      m ? h('div', { class: 'troute' },
        h('span', { class: 'code' }, h('b', { text: m[2] }), h('span', { class: 'time', text: m[1] })),
        h('span', { class: 'line' }, icon(Plane)),
        h('span', { class: 'code' }, h('b', { text: m[4] }), h('span', { class: 'time', text: m[3] }))) : h('p', { class: 'tsum', text: c.summary }),
      h('p', { class: 'small', text: [m ? airline : null, c.source ? `via ${c.source}` : null].filter(Boolean).join(' · ') || ' ' })),
    c.part === 'return'
      ? h('div', { class: 'tside' }, h('span', { class: 'small', text: 'In the return fare' }))
      : h('div', { class: 'tside' }, h('span', { class: 'price', text: money(c.price, c.currency) }), h('span', { class: 'small', text: c.part === 'out' ? `for ${V.trip.adults}, return` : `for ${V.trip.adults}` })));
}

function transferBlock(l) {
  return [
    l.booked && l.note ? h('p', { class: 'meta', text: l.note }) : null,
    h('div', { class: 'acts' },
      h('button', { class: l.booked ? '' : 'primary', onclick: () => askRoute(l) }, icon(MessageSquare), 'Ask Claude how to get there'),
      bookedButton(l)),
    waiting[`route|${l.key}`] ? skeleton('Claude is looking up the ferries and transfers; the answer shows here.', 2) : null,
    answerBlock(`route|${l.key}`, { poll: refresh }),
  ].filter(Boolean);
}

function faresBlock(l, st) {
  const top = [quotes(st, (url) => app.openLink({ url }), (url) => app.openLink({ url })), dateStrip(st, l.date)].filter(Boolean);
  if (!st.fares.length) {
    return h('div', { class: 'block' }, ...top,
      h('p', { class: 'note' }, `No offers from ${st.live ? 'the airlines Amadeus covers' : 'this source'} on this day. `,
        h('button', { class: 'link', onclick: () => askFlights(l) }, 'Ask Claude to search with your flight tools')));
  }
  const list = filtered(st);
  return h('div', { class: 'block' },
    ...top,
    filterBar(st, render, V.flights.provider),
    st.note ? h('p', { class: 'small', text: st.note }) : null,
    h('div', { class: 'fares' }, list.slice(0, 8).map((f) => fareCard(l, f))),
    !list.length ? h('p', { class: 'small', text: 'No fares match these filters.' }) : null);
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
      h('button', { disabled: ui.busy, onclick: () => choose(l, f, line) }, 'Choose'),
      f.link ? h('button', { class: 'link', onclick: () => app.openLink({ url: f.link }) }, f.demo ? 'Check on Google Flights' : 'Book on the airline’s site') : null));
}

// ---------------------------------------------------------------- actions
function pick(next) {
  sel = next;
  pane = 'detail';
  render();
}

// From the card: open full screen at what was tapped. Hosts without full screen show the planner in place.
// On a phone, Open planner starts on the route; a tap on a stop, a leg or the next step opens that.
async function openAt(next) {
  if (next) sel = next;
  pane = next || window.innerWidth >= 720 ? 'detail' : 'list';
  if (canFull() && !isFull()) await setMode('fullscreen');
  else render();
}

async function save(name, args, told) {
  ui.busy = true; render();
  try {
    const r = await call(name, args);
    take(r);
    showError('');
    if (told) await tell(told);
    return r;
  } catch (e) { showError(e.message || String(e)); return null; }
  finally { ui.busy = false; render(); }
}

const setNights = (x, n) => save('set_nights', { trip_id: V.trip.id, stop: x.index, nights: n }, `the traveller changed ${x.place} to ${nightsTxt(n)}; the later dates moved with it.`);
const setBooked = async (l, booked) => {
  const r = await save('mark_leg', { trip_id: V.trip.id, leg_key: l.key, booked }, `the traveller marked ${l.fromName} → ${l.toName} on ${l.date} as ${booked ? 'booked' : 'not booked yet'}.`);
  if (r && booked) celebrate(`${l.mode === 'flight' ? 'Flight' : l.mode === 'ferry' ? 'Ferry' : 'Transfer'} booked: ${l.fromName} → ${l.toName}`, { kind: 'leg', key: l.key });
  return r;
};
// The server removes the flight saved for this hop whatever its date, so a choice left on an old date goes too
const clearFlight = (l) => save('clear_flight', { trip_id: V.trip.id, leg_key: l.key }, `the traveller removed the flight saved for ${l.fromName} → ${l.toName}.`);
const choose = (l, f, line) => save('choose_flight', { trip_id: V.trip.id, leg_key: l.key, summary: line, price: f.total, currency: f.currency, source: f.demo ? 'Demo data' : V.flights.provider, ...(f.link ? { link: f.link } : {}) },
  `the traveller chose ${line} for ${l.fromName} → ${l.toName} on ${l.date}, ${money(f.total, f.currency)} for ${V.trip.adults}.`)
  .then((r) => { if (r) celebrate(`Flight chosen: ${l.from} → ${l.to}, ${money(f.total, f.currency)}`, { kind: 'leg', key: l.key }); return r; });

async function findFlights(l) {
  fares[l.key] = { ...(fares[l.key] || {}), state: 'loading' };
  render();
  try {
    // Two days either side too, so the strip can show when a nearby day is cheaper; only the leg's own day can be chosen
    const r = await app.callServerTool({ name: 'search_flights', arguments: { origin: l.from, destination: l.to, date: l.date, adults: V.trip.adults, flex_days: 2 } });
    if (r.isError) throw new Error(textOf(r) || 'The search failed.');
    const sc = r.structuredContent || {};
    fares[l.key] = { ...fares[l.key], state: 'done', fares: (sc.fares || []).filter((f) => !f.date || f.date === l.date), note: sc.note || '', live: !!sc.live,
      facets: sc.facets || null, calendar: sc.calendar || null, compare: sc.compare || null };
  } catch (e) {
    fares[l.key] = { ...fares[l.key], state: 'error', error: e.message || String(e) };
  }
  render();
}

function askFlights(l) {
  const n = V.trip.adults;
  const before = JSON.stringify(l.chosen);
  return ask(`flights|${l.key}`,
    `Find flights from ${l.fromName} (${l.from}) to ${l.toName} (${l.to} or another airport nearby) on ${longDay(l.date)} for ${n} adult${n === 1 ? '' : 's'}, using my flight search tools. Show me the best options, and when I pick one, save it to Pinroute with choose_flight (trip_id "${V.trip.id}", leg_key "${l.key}").`,
    { poll: refresh, done: () => JSON.stringify(legByKey(l.key)?.chosen) !== before, then: () => celebrate(`Claude saved a flight: ${l.from} → ${l.to}`, { kind: 'leg', key: l.key }) });
}

function askPicks(x) {
  const before = (V.picks[x.place] || []).length;
  const where = x.region ? `${x.place} (${x.region})` : x.place;
  return ask(`picks|${x.place}`,
    `Find local favourites in ${where} for my trip: what recent Reddit threads, TikTok and Instagram posts, and food and travel blogs recommend. Choose up to 10, each with its source link, then save them with save_local_picks (place: "${x.place}").`,
    { poll: refresh, done: () => (V.picks[x.place] || []).length > before });
}

function askRoute(l) {
  return ask(`route|${l.key}`,
    `How do I get from ${l.fromName} to ${l.toName} on ${longDay(l.date)}? Give me the ferry or transfer options with times, journey length, price and how to book. When I've booked, mark that leg booked in Pinroute with mark_leg (trip_id "${V.trip.id}", leg_key "${l.key}").`);
}

// Redraws only when something changed, so a refresh in the background leaves the screen as it is
async function refresh(quiet) {
  try {
    const was = JSON.stringify(V);
    take(await call('open_planner', { trip_id: V.trip.id }));
    if (JSON.stringify(V) !== was) render();
  } catch (e) { if (!quiet) showError(e.message || String(e)); }
}

function take(r) {
  if (r.structuredContent?.trip) V = r.structuredContent;
  if (r._meta?.map) MAP = r._meta.map;
  if (r._meta?.mini) MINI = r._meta.mini;
}

// A tool result picks the screen: the start screen, the new-trip planner, or a trip
function showResult(r) {
  const sc = r.structuredContent || {};
  if (sc.screen === 'home') { takeHome(sc); screen = 'home'; ui.scope = ''; setHere({ name: 'open_planner', args: {} }); }
  else if (sc.screen === 'new') { takeNew(sc); screen = 'new'; ui.scope = 'new|'; setHere({ name: 'plan_new_trip', args: {} }); }
  else if (sc.trip) {
    if (V?.trip.id !== sc.trip.id) { sel = null; pane = 'list'; }
    take(r); screen = 'trip'; ui.scope = `${sc.trip.id}|`; setHere({ name: 'open_planner', args: { trip_id: sc.trip.id } });
  }
  render();
  loadAnswers().then((fresh) => { if (fresh) render(); });
}

// The open planner follows what Claude saves from the chat: while it is on screen it looks again every LIVE_MS, and
// redraws only when the trip, the draft or an answer changed. So Claude doesn't need to show another planner card.
const LIVE_MS = 15000;
let live = false;
async function follow() {
  if (live || document.visibilityState === 'hidden' || ui.busy || !screen || screen === 'home') return;
  live = true;
  try {
    const [, fresh] = await Promise.all([screen === 'trip' ? refresh(true) : refreshNew(true), loadAnswers()]);
    if (fresh) render();
  } finally { live = false; }
}
setInterval(follow, LIVE_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') follow(); });
onShow(showResult);

// ---------------------------------------------------------------- host context: theme, fonts, display mode
function applyContext(next) {
  if (!next) return;
  ui.ctx = { ...ui.ctx, ...next };
  if (ui.ctx.theme) applyDocumentTheme(ui.ctx.theme);
  if (ui.ctx.styles?.variables) applyHostStyleVariables(ui.ctx.styles.variables);
  if (ui.ctx.styles?.css?.fonts) applyHostFonts(ui.ctx.styles.css.fonts);
  applyInsets(ui.ctx.safeAreaInsets);
  render();
}

// ---------------------------------------------------------------- start
app.ontoolinput = () => {};
app.ontoolresult = (r) => {
  if (r.isError) { $('screen').replaceChildren(); showError(textOf(r)); return; }
  showError(''); showResult(r);
};
app.onhostcontextchanged = (next) => applyContext(next);
window.addEventListener('resize', () => render());

app.connect()
  .then(() => { app.setupSizeChangedNotifications(); applyContext(app.getHostContext()); })
  .catch((e) => showError(`Could not connect to Claude: ${e.message || e}`));

// For tests: let a harness look at the state
window.__pinroute = { get screen() { return screen; }, get view() { return V; }, get map() { return MAP; }, get selection() { return sel; }, fares };
