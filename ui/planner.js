// The Pinroute planner, shown inside Claude. It talks to the Pinroute server through the host (callServerTool),
// and asks Claude, on the traveller's own plan, for the work that needs a model (sendMessage).
import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from '@modelcontextprotocol/ext-apps';

// Size reports start once the host has answered (see connect below), so none is sent into a closed channel
const app = new App({ name: 'Pinroute planner', version: '0.1.0' }, {}, { autoResize: false });
const $ = (id) => document.getElementById(id);

let V = null;                       // the trip as the server sent it
const legs = {};                    // leg key → { state, fares, note, live, error, direct, sort }
const asked = {};                   // place → true once Claude was asked for picks

// Small DOM helper: text always goes through textContent, never through HTML
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

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const day = (iso) => DAY.format(new Date(`${iso}T00:00:00Z`));
const hm = (m) => (m == null ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`);
const money = (n, c) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: c || 'EUR', maximumFractionDigits: 0 }).format(n);
const local = (s) => String(s || '').slice(11, 16);          // times are local at each airport, shown as given
const dayShift = (a, b) => Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 864e5);
const textOf = (r) => (r?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

// ---------------------------------------------------------------- host context: theme, fonts, display mode
function applyContext(ctx) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  const fs = $('fs');
  const canFull = (ctx.availableDisplayModes || []).includes('fullscreen');
  fs.hidden = !canFull || ctx.displayMode === 'fullscreen';
}

// ---------------------------------------------------------------- rendering
function render() {
  if (!V) return;
  $('name').textContent = V.trip.name;
  $('sub').textContent = `${day(V.trip.start)} to ${day(V.trip.end)} · ${V.trip.adults} traveller${V.trip.adults === 1 ? '' : 's'}${V.trip.home ? ` · from ${V.trip.home}` : ''}`;
  const src = $('source');
  src.hidden = false;
  src.textContent = V.flights.live ? `Live fares: ${V.flights.provider}` : 'Demo fares';
  src.className = `badge ${V.flights.live ? 'live' : 'demo'}`;

  const items = [];
  const legAfter = (i) => V.legs.find((l) => l.kind !== 'out' && l.kind !== 'home' && l.fromName === V.stops[i]?.place && l.toName === V.stops[i + 1]?.place);
  const outLeg = V.legs.find((l) => l.kind === 'out'), homeLeg = V.legs.find((l) => l.kind === 'home');
  if (outLeg) items.push(legRow(outLeg));
  V.stops.forEach((s, i) => {
    items.push(stopCard(s, i));
    const l = legAfter(i);
    if (l) items.push(legRow(l));
  });
  if (homeLeg) items.push(legRow(homeLeg));
  $('route').replaceChildren(...items);
}

function stopCard(s, i) {
  const picks = V.picks[s.place] || [];
  const nights = `${s.nights} night${s.nights === 1 ? '' : 's'}`;
  return h('li', { class: 'stop' },
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    h('div', { class: 'card' },
      h('div', { class: 'head' },
        h('span', { class: 'place', text: s.place }),
        h('span', { class: 'quiet small', text: s.nights ? `${day(s.arrive)} to ${day(s.depart)} · ${nights}` : day(s.arrive) })),
      s.region ? h('p', { class: 'quiet small', text: `${s.region}${s.iata ? ` · nearest airport ${s.iata}` : ''}` }) : null,
      s.nights ? picksBlock(s, picks) : null));
}

function picksBlock(s, picks) {
  const list = picks.length ? h('ul', {}, picks.map((p) => h('li', {},
    h('b', { text: p.name }), h('span', { class: 'kind', text: p.kind }),
    h('div', { class: 'quiet', text: `${p.why}${p.area ? ` · ${p.area}` : ''}` }),
    p.source_url ? h('button', { class: 'link small', text: 'Source', onclick: () => app.openLink({ url: p.source_url }) }) : null))) : null;
  return h('div', { class: 'picks' },
    h('div', { class: 'head' }, h('span', { class: 'small', text: picks.length ? `Local picks (${picks.length})` : 'No local picks yet' })),
    list,
    h('div', { class: 'pbar' },
      h('button', { text: picks.length ? 'Ask Claude for more' : 'Ask Claude for local picks', onclick: () => askPicks(s) }),
      asked[s.place] ? h('button', { class: 'ghost', text: 'Refresh', onclick: () => refreshPicks(s.place) }) : null,
      asked[s.place] ? h('span', { class: 'quiet small', text: 'Claude is researching; picks appear here once saved.' }) : null));
}

function legRow(l) {
  const st = legs[l.key] || {};
  const chosen = V.trip.choices?.[l.key];
  const label = l.kind === 'ground' ? `${l.fromName} → ${l.toName}: by road or ferry${l.km ? `, about ${l.km} km` : ''}` : `${l.fromName} → ${l.toName} · flight ${l.from} → ${l.to} · ${day(l.date)}`;
  const row = h('div', { class: 'row' },
    h('span', { class: 'what quiet', text: label }),
    l.kind !== 'ground' ? h('button', { class: st.state === 'done' ? 'ghost' : 'primary', disabled: st.state === 'loading', text: st.state === 'loading' ? 'Searching…' : st.state === 'done' ? 'Search again' : 'Find flights', onclick: () => findFlights(l) }) : null);
  return h('li', { class: 'leg', 'data-leg': l.key },
    row,
    chosen ? h('p', { class: 'chosen', text: `Chosen: ${chosen.summary} · ${money(chosen.price, chosen.currency)}` }) : null,
    st.state === 'error' ? h('p', { class: 'note warn', text: st.error }) : null,
    st.state === 'done' ? faresBlock(l, st) : null);
}

function faresBlock(l, st) {
  let list = st.fares.slice();
  if (st.direct) list = list.filter((f) => f.bounds.every((b) => b.stops === 0));
  if (st.sort === 'time') list.sort((a, b) => a.bounds[0].minutes - b.bounds[0].minutes);
  const bar = h('div', { class: 'fbar' },
    h('button', { 'aria-pressed': String(!!st.direct), text: 'Direct only', onclick: () => { st.direct = !st.direct; render(); } }),
    h('button', { 'aria-pressed': String(st.sort !== 'time'), text: 'Cheapest', onclick: () => { st.sort = 'price'; render(); } }),
    h('button', { 'aria-pressed': String(st.sort === 'time'), text: 'Fastest', onclick: () => { st.sort = 'time'; render(); } }),
    h('span', { class: 'quiet small', text: `${list.length} of ${st.fares.length}` }));
  return h('div', {},
    bar,
    st.note ? h('p', { class: 'quiet small', text: st.note }) : null,
    h('div', { class: 'fares' }, list.slice(0, 8).map((f) => fareCard(l, f))),
    !list.length ? h('p', { class: 'quiet small', text: 'No fares match. Turn off “Direct only”.' }) : null);
}

function fareCard(l, f) {
  const b = f.bounds[0];
  const plus = dayShift(b.departs, b.arrives);
  const stops = b.stops ? `${b.stops} stop${b.stops > 1 ? 's' : ''}: ${b.changes.map((c) => `${c.at} ${hm(c.minutes)}`).join(', ')}` : 'Direct';
  const nos = b.flights.map((x) => x.number).filter((n) => !/^XX/.test(n)).join(', ');
  const summaryLine = `${f.airline}${nos ? ` ${nos}` : ''}, ${local(b.departs)} ${b.from} → ${local(b.arrives)} ${b.to}`;
  return h('div', { class: 'fare' },
    h('div', {},
      h('div', { class: 'times' }, h('b', { text: `${local(b.departs)} ${b.from} → ${local(b.arrives)} ${b.to}` }), plus > 0 ? h('span', { class: 'plus', text: ` +${plus}` }) : null),
      h('div', { class: 'quiet small', text: `${f.airline}${nos ? ` · ${nos}` : ''} · ${hm(b.minutes)} · ${stops}` }),
      h('div', { class: 'small', text: b.bags || 'Checked bags not stated' }),
      f.seatsLeft && f.seatsLeft <= 3 ? h('div', { class: 'small warnc', text: `${f.seatsLeft} seat${f.seatsLeft > 1 ? 's' : ''} left at this price` }) : null),
    h('div', { class: 'price' }, money(f.total, f.currency),
      V.trip.adults > 1 && f.perAdult ? h('div', { class: 'quiet small', text: `${money(f.perAdult, f.currency)} each` }) : null),
    h('div', { class: 'acts' },
      h('button', { text: 'Choose', onclick: () => choose(l, f, summaryLine) }),
      f.link ? h('button', { class: 'link', text: f.demo ? 'Check on Google Flights' : 'Book on the airline’s site', onclick: () => app.openLink({ url: f.link }) }) : null));
}

// ---------------------------------------------------------------- actions
async function findFlights(l) {
  legs[l.key] = { ...(legs[l.key] || {}), state: 'loading' };
  render();
  try {
    const r = await app.callServerTool({ name: 'search_flights', arguments: { origin: l.from, destination: l.to, date: l.date, adults: V.trip.adults } });
    if (r.isError) throw new Error(textOf(r) || 'The search failed.');
    const sc = r.structuredContent || {};
    legs[l.key] = { ...legs[l.key], state: 'done', fares: sc.fares || [], note: sc.note || '', live: !!sc.live };
  } catch (e) {
    legs[l.key] = { ...legs[l.key], state: 'error', error: e.message || String(e) };
  }
  render();
}

async function choose(l, f, line) {
  const r = await app.callServerTool({ name: 'choose_flight', arguments: { trip_id: V.trip.id, leg_key: l.key, summary: line, price: f.total, currency: f.currency, ...(f.link ? { link: f.link } : {}) } });
  if (r.isError) { showError(textOf(r)); return; }
  V = r.structuredContent;
  render();
  // Let Claude know, so the conversation can carry on from the choice
  await app.updateModelContext({ content: [{ type: 'text', text: `In the Pinroute planner the traveller chose ${line} for ${l.fromName} → ${l.toName} on ${l.date}, ${money(f.total, f.currency)} for ${V.trip.adults}.` }] }).catch(() => {});
}

async function askPicks(s) {
  asked[s.place] = true;
  render();
  const where = s.region ? `${s.place} (${s.region})` : s.place;
  await app.sendMessage({ role: 'user', content: [{ type: 'text', text: `Find local favourites in ${where} for my trip: what recent Reddit threads, TikTok and Instagram posts, and food and travel blogs recommend. Choose up to 10, each with its source link, then save them with save_local_picks (place: "${s.place}").` }] }).catch((e) => showError(e.message || String(e)));
  // Claude saves the picks through its own tool call, which this view isn't told about: look again for two minutes
  let n = 0;
  const timer = setInterval(async () => {
    n += 1;
    const before = (V.picks[s.place] || []).length;
    await refreshPicks(s.place, true);
    if ((V.picks[s.place] || []).length > before || n >= 15) clearInterval(timer);
  }, 8000);
}

async function refreshPicks(place, quiet) {
  try {
    const r = await app.callServerTool({ name: 'get_local_picks', arguments: { place } });
    if (!r.isError) { V.picks[place] = r.structuredContent?.picks || []; render(); }
  } catch (e) { if (!quiet) showError(e.message || String(e)); }
}

function showError(msg) { const el = $('error'); el.textContent = msg; el.hidden = !msg; }

// ---------------------------------------------------------------- start
app.ontoolinput = () => {};
app.ontoolresult = (r) => {
  if (r.isError) { $('sub').textContent = ''; showError(textOf(r)); return; }
  V = r.structuredContent; showError(''); render();
};
app.onhostcontextchanged = (ctx) => applyContext({ ...(app.getHostContext() || {}), ...ctx });
$('fs').addEventListener('click', () => app.requestDisplayMode({ mode: 'fullscreen' }).catch(() => {}));

app.connect()
  .then(() => { app.setupSizeChangedNotifications(); applyContext(app.getHostContext()); })
  .catch((e) => showError(`Could not connect to Claude: ${e.message || e}`));

// For tests: let a harness look at the state
window.__pinroute = { get view() { return V; }, legs };
