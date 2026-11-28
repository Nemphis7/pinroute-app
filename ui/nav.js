// Getting around Pinroute when it is open full screen, the way an app does: Back to the screen before, three places
// that are always one tap away (Home, New trip, Trips) and the way back to the chat. On a computer they sit in a bar
// along the top; on a phone the bar on top keeps Back, the title and the way out, and the three places move to tabs
// at the bottom, in thumb reach. Trips opens a list of the traveller's trips, the one under way first.
import { House, Plus, Luggage, ChevronLeft, ChevronDown, Minimize2, Pin } from 'lucide';
import { nav, go, goBack, setMode, canPip, call, render } from './core.js';
import { h, icon, span, today } from './dom.js';

const M = { open: false, trips: null, error: '' };

const stateOf = (t, now = today()) => (t.start <= now && now < t.end ? 'now' : t.start > now ? 'ahead' : 'done');
const ORDER = { now: 0, ahead: 1, done: 2 };
const STATE = { now: 'Under way', ahead: 'Coming up', done: 'Done' };
function ordered(trips) {
  return trips.map((t) => ({ ...t, state: stateOf(t) }))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.state === 'done' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)));
}

async function toggleTrips() {
  M.open = !M.open;
  render();
  if (!M.open) return;
  try { M.trips = ordered((await call('list_trips')).structuredContent?.trips || []); M.error = ''; }
  catch (e) { M.error = e.message || String(e); }
  render();
  document.querySelector('#trips-menu [role="menuitem"]')?.focus();
}
function closeTrips(focus) {
  if (!M.open) return;
  M.open = false;
  render();
  if (focus) document.getElementById('trips-tab')?.focus();
}
const goPlace = (name, args) => { M.open = false; return go(name, args); };

function tripsMenu(tripId) {
  const items = M.trips == null
    ? [h('p', { class: 'meta busy', text: 'Loading your trips…' })]
    : M.trips.length
      ? M.trips.map((t) => h('button', { role: 'menuitem', class: 'mi', 'aria-current': t.id === tripId ? 'true' : null, onclick: () => goPlace('open_planner', { trip_id: t.id }) },
        h('span', { class: 'mi-t', text: t.name }),
        h('span', { class: 'small', text: `${span(t.start, t.end)} · ${STATE[t.state]}` })))
      : [h('p', { class: 'meta', text: 'No trips yet. Plan one from New trip.' })];
  return h('div', { class: 'menu', id: 'trips-menu', role: 'menu', 'aria-label': 'Your trips',
    onkeydown: (e) => {
      const all = [...e.currentTarget.querySelectorAll('[role="menuitem"]')], i = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus(); }
    } },
  M.error ? h('p', { class: 'note warn', text: M.error }) : null, ...items);
}

// The three places. `where` is 'home', 'new' or 'trip'; on a trip the Trips tab carries the trip's name.
function places(where, tripName, tripId, phone) {
  const tab = (id, ic, label, onclick, extra = {}) => h('button', { class: `tab${phone ? ' bottom' : ''}`, 'aria-label': label, title: label, 'aria-current': where === id ? 'page' : null, onclick, ...extra },
    icon(ic), h('span', { class: 'tab-l', text: label }), extra['aria-haspopup'] && !phone ? icon(ChevronDown) : null);
  return [
    tab('home', House, 'Home', () => goPlace('open_planner', {})),
    tab('new', Plus, 'New trip', () => goPlace('plan_new_trip', {})),
    h('div', { class: 'trips-wrap' },
      tab('trip', Luggage, where === 'trip' && tripName && !phone ? tripName : 'Trips', toggleTrips,
        { id: 'trips-tab', 'aria-haspopup': 'menu', 'aria-expanded': String(M.open), 'aria-controls': 'trips-menu', title: where === 'trip' ? tripName : 'Your trips' }),
      M.open ? tripsMenu(tripId) : null),
  ];
}

// layout: 'app' (full screen) or 'stacked' (a host without full screen); phone: narrow full screen
export function navBar({ layout, phone, where, title, tripName, tripId, steps, onBack }) {
  const back = h('button', { class: `ghost back${phone ? ' icon' : ''}`, 'aria-label': 'Back', title: 'Back (Alt+←)', disabled: !onBack && !nav.back.length, onclick: () => (onBack ? onBack() : goBack()) },
    icon(ChevronLeft), phone ? null : 'Back');
  const out = layout === 'app'
    ? h('button', { class: phone ? 'ghost icon' : 'ghost', 'aria-label': 'Back to chat', title: 'Back to chat', onclick: () => setMode('inline') }, icon(Minimize2), phone ? null : 'Back to chat')
    : null;
  // Where the host offers picture-in-picture: shrink the planner to a small window that stays on screen over the chat
  const pin = layout === 'app' && canPip()
    ? h('button', { class: phone ? 'ghost icon' : 'ghost', 'aria-label': 'Pin', title: 'Keep a small planner on screen while you chat', onclick: () => setMode('pip') }, icon(Pin), phone ? null : 'Pin')
    : null;
  const row = phone
    ? h('div', { class: 'bar-row' }, back, h('span', { class: 'bar-title', text: title }), pin, out)
    : h('div', { class: 'bar-row' }, back, h('span', { class: 'sep', 'aria-hidden': 'true' }), h('nav', { class: 'places', 'aria-label': 'Pinroute' }, places(where, tripName, tripId, false)), h('span', { class: 'grow' }), pin, out);
  return [row, steps ? h('div', { class: 'bar-row sub' }, steps) : null].filter(Boolean);
}

// The tabs along the bottom of a phone
export const navTabs = ({ where, tripName, tripId }) => places(where, tripName, tripId, true);

// Closing the trips list: Escape, or a tap anywhere else. Alt+← goes back, as in a browser. The tap closes the list
// on click, after the tapped button has had it: closing on pointerdown redraws the bar under the pointer, and the
// button the traveller pressed is gone before the click lands (Home did nothing while the list was open).
document.addEventListener('click', (e) => { if (M.open && !e.target.closest('.trips-wrap')) closeTrips(false); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && M.open) { e.preventDefault(); closeTrips(true); }
  if (e.altKey && e.key === 'ArrowLeft' && nav.back.length && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { e.preventDefault(); goBack(); }
});
