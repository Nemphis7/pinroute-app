// A trip as a calendar (iCalendar, RFC 5545), for Apple Calendar, Google Calendar and any other calendar app:
// - each stop with nights: an all-day event from the day of arrival to the day of leaving, with the hotel saved
//   for it and the local picks there
// - each flight, ferry and drive: at its times when the chosen flight (or the leg's note) has them, else all day
// - each kept tour or activity that has a date
// Times are "floating": 21:10 is 21:10 wherever the phone is, which is how tickets give them (local at each airport).
// A trip gets a secret link (calendar_link): calendar apps subscribe to it and pick up changes by themselves.
import { createHash, randomBytes } from 'node:crypto';
import { schedule, legs, addDays } from './trips.mjs';
import { airport } from './geo.mjs';

export const newCalendarToken = () => randomBytes(18).toString('base64url');
export const TOKEN = /^[A-Za-z0-9_-]{20,40}$/;

// Where the server can be reached from outside: PUBLIC_URL, or the domain Railway generated
export function publicBase(env = process.env) {
  if (env.PUBLIC_URL) return String(env.PUBLIC_URL).replace(/\/+$/, '');
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  return null;
}

// The links for one trip's calendar: the file, the same address for Apple's "subscribe" (webcal:) and Google's
// "add by URL" page, which adds the subscription to the Google account and so to Android phones
export function calendarLinks(token, env = process.env) {
  const base = publicBase(env);
  if (!base || !token) return null;
  const ics = `${base}/calendar/${token}.ics`;
  const webcal = ics.replace(/^https?:/, 'webcal:');
  return { ics, webcal, google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}` };
}

// ---- iCalendar text
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Lines longer than 75 octets go on over the next line, which starts with a space; never inside a character
function fold(line) {
  const out = [];
  let cur = '', len = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const ymd = (iso) => iso.replace(/-/g, '');
const stamp = (when) => new Date(when || Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const uid = (tripId, what) => `${createHash('sha1').update(`${tripId}|${what}`).digest('hex').slice(0, 20)}@pinroute`;

// "21:10 FRA → 13:40 SGN", "dep 09:30 arr 11:05", "09:30–11:05": the first time is when it leaves, a second one when it arrives
export function timesIn(s) {
  const t = String(s || '');
  const pair = /\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b(?:\s*[A-Z]{3})?\s*(?:→|->|–|—|-|to|arr(?:ives?)?\.?)\s*(?:[A-Z]{3}\s*)?([01]?\d|2[0-3])[:.h]([0-5]\d)\b(\s*\(?\+\s*(\d)\)?)?/.exec(t);
  if (pair) return { dep: [Number(pair[1]), Number(pair[2])], arr: [Number(pair[3]), Number(pair[4])], plus: pair[6] ? Number(pair[6]) : null };
  const one = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(t);
  return one ? { dep: [Number(one[1]), Number(one[2])], arr: null, plus: null } : null;
}
const at = (iso, [h, m]) => `${ymd(iso)}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
const hm = ([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

function event(lines, { uid: id, dtstamp, start, end, allDay, summary, location, description, url, geo }) {
  lines.push('BEGIN:VEVENT', `UID:${id}`, `DTSTAMP:${dtstamp}`);
  if (allDay) lines.push(`DTSTART;VALUE=DATE:${ymd(start)}`, `DTEND;VALUE=DATE:${ymd(end || addDays(start, 1))}`, 'TRANSP:TRANSPARENT');
  else lines.push(`DTSTART:${start}`, `DTEND:${end}`);
  lines.push(`SUMMARY:${esc(summary)}`);
  if (location) lines.push(`LOCATION:${esc(location)}`);
  if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) lines.push(`GEO:${geo.lat.toFixed(5)};${geo.lon.toFixed(5)}`);
  if (description) lines.push(`DESCRIPTION:${esc(description)}`);
  if (url && /^https?:\/\//.test(url)) lines.push(`URL:${url}`);
  lines.push('END:VEVENT');
}

const countryOf = (s) => (s.placeId ? 'Thailand' : (s.iata && airport(s.iata)?.country) || '');
const placeLine = (s) => { const c = countryOf(s); return c && !String(s.place).toLowerCase().includes(c.toLowerCase()) ? `${s.place}, ${c}` : s.place; };
const money = (n, cur) => (n == null ? '' : `${cur || ''} ${Math.round(n).toLocaleString('en-GB')}`.trim());
const airportLine = (code) => { const a = airport(code); return a ? `${a.name}${/airport/i.test(a.name) ? '' : ' Airport'} (${a.code}), ${a.city}` : code; };
const MODE = { flight: '✈️', ferry: '⛴️', road: '🚗' };

// The events of one trip. picks: { place: [pick] } as saved; stays (the hotels chosen) are read from the trip.
export function tripEvents(trip, picks = {}) {
  const rows = schedule(trip), list = [];
  const stays = trip.stays || {};
  const marks = trip.marks || {};
  const choices = trip.choices || {};
  const end = rows.length ? rows.at(-1).depart : trip.start;

  for (const s of rows) {
    if (!s.nights) continue;
    const hotel = stays[`stay|${s.place}|${s.arrive}|${s.depart}`] || null;
    const here = (picks[s.place] || []).filter((p) => p.status !== 'skip');
    const desc = [
      `Stop ${s.i + 1} of ${rows.length} on "${trip.name}": ${s.nights} night${s.nights === 1 ? '' : 's'}.`,
      hotel ? `Hotel: ${hotel.name}${hotel.price != null ? `, ${money(hotel.price, hotel.currency)}` : ''}${hotel.booked ? ' (booked)' : ' (not booked yet)'}${hotel.note ? `. ${hotel.note}` : ''}${hotel.link ? `\n${hotel.link}` : ''}` : null,
      here.length ? `Local picks:\n${here.slice(0, 12).map((p) => `• ${p.name}${p.area ? ` (${p.area})` : ''}${p.why ? `: ${p.why}` : ''}`).join('\n')}` : null,
    ].filter(Boolean).join('\n\n');
    list.push({
      uid: uid(trip.id, `stop|${s.i}|${s.place}`), allDay: true, start: s.arrive, end: s.depart, sort: `${s.arrive}T00b`,
      summary: `📍 ${s.place}${hotel ? ` · ${hotel.name}` : ''}`,
      location: hotel ? `${hotel.name}, ${placeLine(s)}` : placeLine(s), geo: hotel ? null : s, description: desc, url: hotel?.link || null,
    });
    // Kept tours and activities with a date during this stay
    for (const p of here) {
      if (!p.date || p.date < s.arrive || p.date > s.depart) continue;
      const t = timesIn(p.time);
      const start = t ? at(p.date, t.dep) : p.date;
      const fin = t ? (t.arr ? at(p.date, t.arr) : at(p.date, [Math.min(23, t.dep[0] + 2), t.dep[1]])) : null;
      list.push({
        uid: uid(trip.id, `pick|${s.place}|${p.name.toLowerCase()}`), allDay: !t, start, end: fin, sort: t ? `${p.date}T${hm(t.dep)}` : `${p.date}T00`,
        summary: `🎟️ ${p.name}`, location: [p.area, placeLine(s)].filter(Boolean).join(', '),
        description: [p.why, p.price_from != null ? `From ${money(p.price_from, p.currency)}` : null, p.book_url ? `Book: ${p.book_url}` : null, p.source_url && p.source_url !== p.book_url ? `Source: ${p.source_url}` : null].filter(Boolean).join('\n'),
        url: p.book_url || p.source_url || null,
      });
    }
  }

  for (const l of legs(trip)) {
    const chosen = choices[l.key] || null, mark = marks[l.key] || {};
    // The flight out leaves on the fare's departure day; the trip itself starts the day it lands
    const day = l.kind === 'out' && trip.ticket?.depart ? trip.ticket.depart : l.date;
    const t = timesIn(chosen?.summary) || timesIn(mark.note);
    let start = day, fin = null;
    if (t) {
      start = at(day, t.dep);
      if (t.arr) {
        const depMin = t.dep[0] * 60 + t.dep[1], arrMin = t.arr[0] * 60 + t.arr[1];
        let arrDay = day;
        if (t.plus != null) arrDay = addDays(day, t.plus);
        else if (l.kind === 'out' && trip.ticket?.arrive && trip.ticket.arrive > day) arrDay = trip.ticket.arrive;
        else if (arrMin <= depMin) arrDay = addDays(day, 1);
        fin = at(arrDay, t.arr);
      } else fin = at(day, [Math.min(23, t.dep[0] + (l.mode === 'flight' ? 2 : 1)), t.dep[1]]);
    }
    const fromName = l.mode === 'flight' ? l.from : l.fromName, toName = l.mode === 'flight' ? l.to : l.toName;
    const what = l.mode === 'flight' ? 'Flight' : l.mode === 'ferry' ? 'Ferry' : 'By road';
    const summary = `${MODE[l.mode]} ${what} ${fromName} → ${toName}${t ? ` · ${hm(t.dep)}${t.arr ? `–${hm(t.arr)}` : ''}` : ''}`;
    const desc = [
      l.mode === 'flight' ? `${l.fromName} (${l.from}) → ${l.toName} (${l.to})` : `${l.fromName} → ${l.toName}${l.km ? `, about ${l.km} km` : ''}`,
      chosen ? `${chosen.summary}${chosen.price ? ` · ${money(chosen.price, chosen.currency)}` : ''}` : l.mode === 'flight' ? 'No flight chosen yet.' : null,
      mark.booked ? `Booked${mark.note ? `: ${mark.note}` : ''}` : mark.note ? mark.note : l.mode === 'flight' || chosen ? 'Not booked yet.' : null,
      t ? 'Times are local at each end.' : null,
      chosen?.link ? chosen.link : null,
    ].filter(Boolean).join('\n');
    list.push({
      uid: uid(trip.id, `${l.kind}|${l.after}|${l.fromName}|${l.toName}`), allDay: !t, start, end: fin, sort: t ? `${day}T${hm(t.dep)}` : `${day}T00a`,
      summary, location: l.mode === 'flight' ? airportLine(l.from) : l.fromName, description: desc, url: chosen?.link || null,
    });
  }
  list.sort((a, b) => a.sort.localeCompare(b.sort));
  return { events: list, start: trip.start, end };
}

export function tripCalendar(trip, picks = {}) {
  const { events } = tripEvents(trip, picks);
  const dtstamp = stamp(trip.updated);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pinroute//Trip planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(trip.name)}`, `X-WR-CALDESC:${esc(`Your Pinroute trip "${trip.name}": where to be when.`)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H', 'X-PUBLISHED-TTL:PT4H',
  ];
  for (const e of events) event(lines, { ...e, dtstamp });
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
