// Picking departure airports on a map, as in Pinroute's artifact: the map opens around the traveller's main airport,
// a tap moves the pin, the slider sets how far they would travel to an airport, and every airport with scheduled
// flights inside the circle is listed, busiest first, the bigger ones ticked. "Add" puts the ticked ones in the list.
// The map comes from the server (find_airports with near_lat and near_lon); the circle and the airports are drawn here.
import { X, MapPin } from 'lucide';
import { call, render } from './core.js';
import { h, s, icon } from './dom.js';

const MAX = 6;
const P = { open: false, pin: null, km: 250, intl: true, list: [], map: null, sel: new Set(), have: [], onAdd: null, busy: false, err: '' };
const rad = (d) => (d * Math.PI) / 180;
const project = (m, lat, lon) => [m.k * rad(lon) + m.tx, m.ty - m.k * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))];
const invert = (m, x, y) => ({ lon: (((x - m.tx) / m.k) * 180) / Math.PI, lat: ((2 * Math.atan(Math.exp((m.ty - y) / m.k)) - Math.PI / 2) * 180) / Math.PI });
// The points `d` km from the centre all around, for the range circle
function circle(c, d) {
  const R = 6371, a = d / R, la = rad(c.lat), lo = rad(c.lon), pts = [];
  for (let b = 0; b <= 360; b += 6) {
    const br = rad(b), lat2 = Math.asin(Math.sin(la) * Math.cos(a) + Math.cos(la) * Math.sin(a) * Math.cos(br));
    const lon2 = lo + Math.atan2(Math.sin(br) * Math.sin(a) * Math.cos(la), Math.cos(a) - Math.sin(la) * Math.sin(lat2));
    pts.push([(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI]);
  }
  return pts;
}
const fits = (m, c, d) => m && circle(c, d).every(([la, lo]) => { const [x, y] = project(m, la, lo); return x >= 0 && x <= m.w && y >= 0 && y <= m.h; });

// have: the airports already in the list ({ code, lat, lon }); onAdd(list) gets the airports to add
export function openAirMap(have, onAdd) {
  P.open = true; P.have = have; P.onAdd = onAdd; P.sel = new Set(); P.map = null; P.err = '';
  const first = have.find((a) => a.lat != null);
  P.pin = first ? { lat: first.lat, lon: first.lon } : { lat: 50.1, lon: 8.7 };
  load(true);
}
const close = () => { P.open = false; render(); document.getElementById('w-air')?.focus() || document.getElementById('s-air')?.focus(); };

async function load(preselect) {
  P.busy = true; render();
  try {
    const r = await call('find_airports', { near_lat: P.pin.lat, near_lon: P.pin.lon, within_km: P.km, international: P.intl, limit: 30 });
    P.list = r.structuredContent?.airports || [];
    if (!fits(P.map, P.pin, P.km)) P.map = r._meta?.map || P.map;      // keep the map still while the circle fits on it
    P.err = '';
    if (preselect) {
      const room = Math.max(0, MAX - P.have.length), codes = P.have.map((a) => a.code);
      P.sel = new Set(P.list.filter((a) => !codes.includes(a.code)).slice(0, Math.min(room, 3)).map((a) => a.code));
    } else P.sel = new Set([...P.sel].filter((c) => P.list.some((a) => a.code === c)));
  } catch (e) { P.err = e.message || String(e); }
  P.busy = false; render();
}

const circlePath = (m) => `M${circle(P.pin, P.km).map(([la, lo]) => project(m, la, lo).map((v) => v.toFixed(1)).join(',')).join('L')}Z`;

function mapSvg() {
  const m = P.map;
  if (!m) return h('div', { class: 'am-map am-empty' }, h('p', { class: 'meta busy', text: 'Loading the map…' }));
  const svg = s('svg', { class: 'am-svg', viewBox: `0 0 ${m.w} ${m.h}`, role: 'img', 'aria-label': 'Map around the pin; tap to move it' });
  svg.append(s('rect', { class: 'am-sea', width: m.w, height: m.h }), s('path', { class: 'am-land', d: m.land }), s('path', { class: 'am-border', d: m.borders }));
  svg.append(s('path', { class: 'am-circle', id: 'am-circle', d: circlePath(m) }));
  const codes = P.have.map((a) => a.code);
  for (const a of [...P.list].reverse()) {
    const [x, y] = project(m, a.lat, a.lon), on = P.sel.has(a.code) || codes.includes(a.code);
    const g = s('g', { class: `am-dot${on ? ' on' : ''}${a.international ? '' : ' dom'}`, transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` });
    g.append(s('circle', { r: a.served > 60 ? 6 : 4.5 }), s('text', { x: 9, y: 4 }, a.code), s('title', {}, `${a.code} ${a.name}, ${a.km} km`));
    svg.append(g);
  }
  const [px, py] = project(m, P.pin.lat, P.pin.lon);
  svg.append(s('path', { class: 'am-pin', d: 'M0,0 C-6,-9 -9,-14 -9,-19 A9,9 0 1 1 9,-19 C9,-14 6,-9 0,0 Z', transform: `translate(${px.toFixed(1)},${py.toFixed(1)})` }));
  svg.addEventListener('click', (e) => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    P.pin = invert(m, p.x, p.y);
    load(false);
  });
  return h('div', { class: 'am-map' }, svg);
}

function listView() {
  const codes = P.have.map((a) => a.code), room = MAX - P.have.length;
  if (!P.list.length) return h('p', { class: 'meta', text: P.busy ? 'Looking for airports…' : `No ${P.intl ? 'international ' : ''}airports within ${P.km} km of the pin. Make the range bigger${P.intl ? ' or include airports with domestic flights only' : ''}.` });
  return h('ul', { class: 'am-list' }, P.list.map((a) => {
    const have = codes.includes(a.code), on = have || P.sel.has(a.code);
    return h('li', {}, h('label', { class: `am-row${have ? ' have' : ''}` },
      h('input', { type: 'checkbox', id: `am-${a.code}`, checked: on, disabled: have || (!on && P.sel.size >= room), onchange: (e) => { if (e.target.checked) P.sel.add(a.code); else P.sel.delete(a.code); render(); } }),
      h('b', { class: 'code', text: a.code }),
      h('span', { class: 'am-nm' }, h('span', { text: a.name }), h('span', { class: 'small', text: [a.city !== a.name ? a.city : null, a.country, a.served ? `flies to ${a.served} airports` : null, a.international ? null : 'domestic only', have ? 'already in your list' : null].filter(Boolean).join(' · ') })),
      h('span', { class: 'small num', text: `${a.km} km` })));
  }));
}

export function airMapDialog() {
  if (!P.open) return null;
  const room = MAX - P.have.length, n = P.sel.size;
  // While the slider moves only its number and the circle change; the airports are looked up when it is let go
  const range = h('input', { id: 'am-km', type: 'range', min: 25, max: 900, step: 25, value: String(P.km), 'aria-label': 'Range in km',
    oninput: (e) => {
      P.km = Number(e.target.value);
      document.getElementById('am-kmv').textContent = `${P.km} km`;
      if (P.map) document.getElementById('am-circle')?.setAttribute('d', circlePath(P.map));
    },
    onchange: () => load(false) });
  return h('div', { class: 'am-wrap', onclick: (e) => { if (e.target === e.currentTarget) close(); } },
    h('section', { class: 'am-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'am-title', onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } } },
      h('header', { class: 'am-head' },
        h('div', {}, h('h2', { id: 'am-title', text: 'Departure airports' }), h('p', { class: 'meta', text: 'Tap the map to move the pin, then set how far you would travel to an airport.' })),
        h('button', { class: 'ghost icon', id: 'am-close', 'aria-label': 'Close', onclick: close }, icon(X))),
      mapSvg(),
      h('div', { class: 'am-ctl' },
        h('label', { class: 'am-range', for: 'am-km' }, h('span', {}, 'Range ', h('b', { class: 'num', id: 'am-kmv', text: `${P.km} km` })), range),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: P.intl, onchange: (e) => { P.intl = e.target.checked; load(false); } }), 'Flights abroad only')),
      P.err ? h('p', { class: 'note warn', text: P.err }) : null,
      listView(),
      h('footer', { class: 'am-foot' },
        h('span', { class: 'small', text: room > 0 ? `${n} ticked · room for ${room} more (up to ${MAX})` : `Your list is full (${MAX} airports). Remove one to add another.` }),
        h('button', { class: 'primary', disabled: !n, onclick: () => { const add = P.list.filter((a) => P.sel.has(a.code)); P.open = false; P.onAdd(add); } }, icon(MapPin), n ? `Add ${n} airport${n === 1 ? '' : 's'}` : 'Add airports'))));
}
export const airMapOpen = () => P.open;
