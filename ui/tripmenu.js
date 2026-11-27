// Looking after a trip: rename it and change its details, move it to other flights, or delete it; and a question
// before anything that can't be undone. Each opens as a dialog over the planner. The trip menu sits in the trip's
// header full screen; the start screen's trip rows have Rename and Delete.
import { MoreHorizontal, Pencil, Trash2, Plane, X, MessageSquare, ArrowRight, CalendarPlus, Copy, Download } from 'lucide';
import { app, call, render, show, tell, ask, waiting, nav } from './core.js';
import { h, icon, day, money, nightsTxt, days, plural } from './dom.js';
import { dealPP } from '../src/discover.mjs';

const D = { kind: null };                       // the open dialog: 'edit', 'confirm', 'fares' or 'calendar'
const M = { open: false };                      // the trip menu
const close = () => { D.kind = null; render(); };
const busy = (on) => { D.busy = on; render(); };

// ---------------------------------------------------------------- the trip menu, in the trip's header
export function tripMenu(trip) {
  const item = (ic, label, fn) => h('button', { role: 'menuitem', class: 'mi row-mi', onclick: () => { M.open = false; fn(); } }, icon(ic), label);
  return h('div', { class: 'trips-wrap trip-menu' },
    h('button', { class: 'ghost', id: 'trip-cal', 'aria-label': 'Add to calendar', title: 'Add this trip to Apple, Google or another calendar app', onclick: () => openCalendar(trip) }, icon(CalendarPlus), 'Add to calendar'),
    h('button', { class: 'ghost', id: 'trip-menu', 'aria-haspopup': 'menu', 'aria-expanded': String(M.open), onclick: () => { M.open = !M.open; render(); } }, icon(MoreHorizontal), 'Trip'),
    M.open ? h('div', { class: 'menu right', role: 'menu', 'aria-label': 'Trip' },
      item(Pencil, 'Rename and details…', () => openEdit(trip)),
      item(CalendarPlus, 'Add to calendar…', () => openCalendar(trip)),
      trip.ticket && trip.countryId ? item(Plane, 'Change flights…', () => openFares(trip)) : null,
      item(Trash2, 'Delete trip…', () => openDelete(trip))) : null);
}
// A tap anywhere else closes the menu, on click so the button tapped still gets it (see nav.js)
document.addEventListener('click', (e) => { if (M.open && !e.target.closest('.trip-menu')) { M.open = false; render(); } });

// ---------------------------------------------------------------- rename and details
// trip: { id, name, start, adults, home, ticket? }; onDone(result) when saved
export function openEdit(trip, onDone) {
  Object.assign(D, { kind: 'edit', trip, onDone: onDone || show, busy: false, err: '', f: { name: trip.name, start: trip.start, adults: trip.adults, home: trip.home || '' } });
  render();
}
function editDialog() {
  const t = D.trip, f = D.f, detail = t.start != null;
  const set = (k) => (e) => { f[k] = e.target.value; };
  const save = async () => {
    const args = { trip_id: t.id };
    if (f.name.trim() && f.name.trim() !== t.name) args.name = f.name.trim();
    if (detail && f.start && f.start !== t.start) args.start = f.start;
    if (detail && Number(f.adults) !== t.adults) args.adults = Number(f.adults);
    if (detail && f.home.trim().toUpperCase() !== (t.home || '')) {
      if (!/^[A-Za-z]{3}$/.test(f.home.trim())) { D.err = 'The home airport is a 3-letter code, such as FRA.'; render(); return; }
      args.home_airport = f.home.trim().toUpperCase();
    }
    if (Object.keys(args).length === 1) { close(); return; }
    busy(true);
    try {
      const r = await call('update_trip', args);
      D.kind = null;
      await D.onDone(r);
      tell(`the traveller changed the trip "${t.name}" (${t.id}): ${Object.keys(args).filter((k) => k !== 'trip_id').map((k) => `${k} ${args[k]}`).join(', ')}.`);
    } catch (e) { D.err = e.message || String(e); }
    busy(false);
  };
  return box('Rename and details', [
    field('Name', h('input', { id: 'ed-name', type: 'text', maxlength: 80, value: f.name, oninput: set('name') }), 'ed-name'),
    detail ? h('div', { class: 'grid2' },
      field('First night', h('input', { id: 'ed-start', type: 'date', value: f.start, oninput: set('start') }), 'ed-start'),
      field('Travellers', h('input', { id: 'ed-adults', type: 'number', min: 1, max: 9, value: String(f.adults), oninput: set('adults') }), 'ed-adults')) : null,
    detail ? field('Home airport', h('input', { id: 'ed-home', type: 'text', maxlength: 3, value: f.home, placeholder: 'FRA', oninput: set('home') }), 'ed-home') : null,
    detail && t.ticket ? h('p', { class: 'small', text: `Your flights are for ${day(t.ticket.depart)} to ${day(t.ticket.return)}. Moving the first night moves the route but not the flights; to move to other flights, use Change flights.` }) : null,
  ], [h('button', { class: 'ghost', onclick: close }, 'Cancel'), h('button', { class: 'primary', disabled: D.busy, onclick: save }, D.busy ? 'Saving…' : 'Save')]);
}

// ---------------------------------------------------------------- a question before something that can't be undone
export function openConfirm({ title, text, action, run }) {
  Object.assign(D, { kind: 'confirm', title, text, action, run, busy: false, err: '' });
  render();
}
function confirmDialog() {
  const go = async () => {
    busy(true);
    try { await D.run(); D.kind = null; } catch (e) { D.err = e.message || String(e); }
    busy(false);
  };
  return box(D.title, [h('p', { class: 'meta', text: D.text })],
    [h('button', { class: 'ghost', id: 'dlg-keep', onclick: close }, 'Keep'), h('button', { class: 'danger', disabled: D.busy, onclick: go }, D.busy ? 'Working…' : D.action)]);
}
export function openDelete(trip, after) {
  openConfirm({
    title: `Delete "${trip.name}"?`,
    text: 'Its route, the flights chosen for it and the bookings marked go for good. Local picks for its places stay.',
    action: 'Delete trip',
    run: async () => {
      await call('delete_trip', { trip_id: trip.id });
      nav.back = nav.back.filter((p) => p.args?.trip_id !== trip.id);      // Back never leads to a deleted trip
      tell(`the traveller deleted the trip "${trip.name}" (${trip.id}).`);
      if (after) await after(); else show(await call('open_planner', {}));
    },
  });
}

// ---------------------------------------------------------------- change flights: another fare for the trip
export async function openFares(trip) {
  Object.assign(D, { kind: 'fares', trip, busy: false, err: '', fares: null, scanning: false, flights: {} });
  render();
  await loadFares();
}
async function loadFares(quiet) {
  try {
    const sc = (await call('plan_new_trip', {})).structuredContent;
    D.fares = sc.deals?.[D.trip.countryId] || [];
    D.flights = sc.flights || {};
  } catch (e) { if (!quiet) D.err = e.message || String(e); D.fares = D.fares || []; }
  render();
}
function faresDialog() {
  const t = D.trip, k = t.ticket, nights = days(k.arrive || k.depart, k.return);
  const same = (x) => x.from === k.from && x.to === k.to && x.depart === k.depart && x.return === k.return && x.price === k.price && x.airline === k.airline;
  const list = (D.fares || []).filter((x) => !same(x))
    .sort((a, b) => (Math.abs(days(k.depart, a.depart)) - Math.abs(days(k.depart, b.depart))) || dealPP(a) - dealPP(b)).slice(0, 12);
  const use = async (x) => {
    busy(true);
    try {
      const r = await call('set_trip_fare', { trip_id: t.id, deal_id: x.id });
      D.kind = null;
      show(r);
      tell(`the traveller moved the trip "${t.name}" to the fare ${x.from} → ${x.to} on ${x.depart}, back ${x.return} (${x.airline}, ${money(x.price, x.currency)} for ${x.adults}).`);
    } catch (e) { D.err = e.message || String(e); }
    busy(false);
  };
  const scanSame = async () => {
    D.scanning = true; render();
    try { await call('scan_flight_deals', { country: t.countryId, origins: [k.from], destinations: [k.to], depart: k.depart, return: k.return, ...(D.flights.recent ? { source: 'recent' } : {}) }); }
    catch (e) { D.err = e.message || String(e); }
    D.scanning = false;
    await loadFares(true);
  };
  const askClaude = () => {
    const since = new Date().toISOString();
    ask('fares', `Find other return flights for my Pinroute trip "${t.name}": from ${k.from} to ${k.to}, around ${day(k.depart)} and back around ${day(k.return)} (a few days either way is fine), for ${plural(t.adults, 'adult')}. Search only with Pinroute's own scan_flight_deals (Amadeus airline fares and Aviasales prices), which saves the fares it finds; don't use other flight tools or sites. Then I can pick one in the planner's Change flights.`,
      { poll: async () => loadFares(true), done: () => (D.fares || []).some((x) => x.at > since) || D.kind !== 'fares', tries: 75 });
  };
  const row = (x) => {
    const n = days(x.arrive || x.depart, x.return), dn = n - nights;
    return h('li', { class: 'fare-row' },
      h('div', { class: 'fr-main' },
        h('b', { class: 'pp', text: money(dealPP(x), x.currency) }), h('span', { class: 'small', text: ` per person · ${money(x.price, x.currency)} for ${x.adults}` }),
        h('p', { class: 'meta', text: `${day(x.depart)} → ${day(x.return)} · ${nightsTxt(n)}${dn ? ` (${dn > 0 ? '+' : '−'}${Math.abs(dn)})` : ''} · ${x.from} → ${x.to}` }),
        h('p', { class: 'small', text: `${x.airline}${x.stops == null ? '' : x.stops ? ` · ${plural(x.stops, 'change')}` : ' · direct'} · via ${x.source}${x.recent ? ' · a recent price' : ''}` })),
      h('button', { disabled: D.busy, onclick: () => use(x) }, 'Use this fare', icon(ArrowRight)));
  };
  return box('Change flights', [
    h('p', { class: 'meta', text: `Now: ${k.from} → ${k.to} ${day(k.depart)}, back ${day(k.return)} · ${k.airline} · ${money(k.price, k.currency)} for ${t.adults}` }),
    h('p', { class: 'small', text: 'The trip moves to the fare you pick: nights go to or come from the longest stays, and a new arrival or departure airport joins the route.' }),
    D.fares == null ? h('p', { class: 'meta busy', text: 'Loading the fares you have saved…' })
      : list.length ? h('ul', { class: 'fare-list' }, list.map(row))
        : h('p', { class: 'meta', text: `No other fares saved for ${t.country} yet.` }),
    waiting.fares && D.kind === 'fares' ? h('p', { class: 'note', text: 'Claude is searching with Pinroute; the fares appear here as Claude saves them.' }) : null,
  ], [
    h('button', { disabled: D.scanning, onclick: scanSame }, D.scanning ? 'Looking…' : 'Other fares, same dates'),
    h('button', { class: 'ghost', onclick: askClaude }, icon(MessageSquare), 'Ask Claude'),
    h('span', { class: 'grow' }),
    h('button', { class: 'ghost', onclick: close }, 'Close'),
  ]);
}

// ---------------------------------------------------------------- the trip in the traveller's own calendar app
// One secret link per trip: Apple Calendar subscribes to it as webcal:, Google Calendar (and so Android) adds it by URL,
// any other app takes the .ics file. Subscribed calendars follow later changes to the trip by themselves.
export async function openCalendar(trip) {
  Object.assign(D, { kind: 'calendar', trip, busy: true, err: '', links: null, copied: false, off: false });
  render();
  await calendarCall('get');
}
async function calendarCall(action) {
  D.busy = true; D.err = ''; render();
  try {
    const r = await call('calendar_link', { trip_id: D.trip.id, action });
    D.links = r.structuredContent?.links || null;
    D.off = action === 'stop';
    if (!D.links && !D.off) D.err = 'This Pinroute server has no public address yet, so it can\'t give a calendar link. Ask Claude for the trip as an .ics file instead.';
    if (action !== 'get') tell(`the traveller ${action === 'new' ? 'made a new calendar link (the old one stopped working)' : 'switched off the calendar link'} for "${D.trip.name}" (${D.trip.id}).`);
  } catch (e) { D.err = e.message || String(e); }
  D.busy = false; render();
}
function calendarDialog() {
  const L = D.links, t = D.trip;
  const open = async (url, what) => {
    try { await app.openLink({ url }); tell(`the traveller added "${t.name}" (${t.id}) to ${what}.`); } catch (e) { D.err = e.message || String(e); render(); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(L.ics); D.copied = true; } catch { document.getElementById('cal-url')?.select(); }
    render();
  };
  const opt = (id, ic, title, sub, url, what) => h('button', { class: 'cal-opt', id, disabled: D.busy, onclick: () => open(url, what) },
    h('span', { class: 'kind-ic' }, icon(ic)), h('span', { class: 'pick-t' }, h('span', { class: 'pname', text: title }), h('span', { class: 'kind', text: sub })));
  return box('Add to your calendar', [
    h('p', { class: 'meta', text: `Every stop of "${t.name}" with its dates and hotel, each flight, ferry and drive, and the tours you planned for a day, as events in your own calendar.` }),
    L ? h('div', { class: 'cal-opts' },
      opt('cal-apple', CalendarPlus, 'Apple Calendar', 'iPhone, iPad and Mac', L.webcal, 'Apple Calendar'),
      opt('cal-google', CalendarPlus, 'Google Calendar', 'Android phones and the web', L.google, 'Google Calendar'),
      opt('cal-file', Download, 'Calendar file (.ics)', 'Outlook and other apps', L.ics, 'a calendar file')) : null,
    L ? field('Calendar address', h('div', { class: 'cal-url' },
      h('input', { id: 'cal-url', type: 'text', readonly: true, value: L.ics, onfocus: (e) => e.target.select() }),
      h('button', { class: 'ghost', onclick: copy }, icon(Copy), D.copied ? 'Copied' : 'Copy')), 'cal-url') : null,
    L ? h('p', { class: 'small', text: 'Your calendar follows the trip: changes you make in Pinroute show up there by themselves, usually within a few hours. Anyone with this address can see the trip.' }) : null,
    D.off ? h('p', { class: 'note', text: 'The calendar link is off. Calendars that subscribed to it stop updating.' }) : null,
    !L && !D.off && D.busy ? h('p', { class: 'meta busy', text: 'Making your calendar link…' }) : null,
  ], [
    L ? h('button', { class: 'ghost', disabled: D.busy, onclick: () => calendarCall('new') }, 'New link') : null,
    L ? h('button', { class: 'ghost', disabled: D.busy, onclick: () => calendarCall('stop') }, 'Turn off') : D.off ? h('button', { class: 'ghost', disabled: D.busy, onclick: () => calendarCall('get') }, 'Turn on again') : null,
    h('span', { class: 'grow' }),
    h('button', { class: 'primary', onclick: close }, 'Done'),
  ].filter(Boolean));
}

// ---------------------------------------------------------------- the dialog frame
const field = (label, control, id) => h('label', { class: 'field', for: id }, h('span', { text: label }), control);
function box(title, body, actions) {
  return h('div', { class: 'am-wrap', onclick: (e) => { if (e.target === e.currentTarget && !D.busy) close(); } },
    h('section', { class: 'am-box dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title', onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } } },
      h('header', { class: 'am-head' }, h('h2', { id: 'dlg-title', text: title }), h('button', { class: 'ghost icon', id: 'dlg-close', 'aria-label': 'Close', onclick: close }, icon(X))),
      h('div', { class: 'dlg-body' }, ...body.filter(Boolean)),
      D.err ? h('p', { class: 'note warn', text: D.err }) : null,
      h('footer', { class: 'am-foot' }, ...actions)));
}
export function tripDialog() {
  if (D.kind === 'edit') return editDialog();
  if (D.kind === 'confirm') return confirmDialog();
  if (D.kind === 'fares') return faresDialog();
  if (D.kind === 'calendar') return calendarDialog();
  return null;
}
