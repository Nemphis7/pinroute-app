// Trips, chosen flights and local picks, kept in one JSON file.
// Good enough for a prototype with one owner; swap for a real database (with one row per user) before other people sign in.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

// Where the file lives: DATA_FILE if set; on a host with a volume (Railway sets RAILWAY_VOLUME_MOUNT_PATH) on that volume,
// so trips survive restarts; otherwise data/store.json. Worked out on first use, after .env has been read.
let FILE = null;
const file = () => (FILE ||= resolve(process.env.DATA_FILE
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'store.json') : new URL('../data/store.json', import.meta.url).pathname)));
let db = null;

function load() {
  if (db) return db;
  try { db = JSON.parse(readFileSync(file(), 'utf8')); } catch { db = {}; }
  db.trips ||= {}; db.picks ||= {};
  return db;
}
function save() {
  mkdirSync(dirname(file()), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 1));
  renameSync(tmp, file());                    // atomic on the same disk: a crash never leaves half a file
}

export const newId = (p) => `${p}_${randomBytes(6).toString('base64url')}`;
export const placeKey = (place) => String(place || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function getTrip(id) { return load().trips[id] || null; }
export function listTrips() { return Object.values(load().trips).sort((a, b) => String(b.updated).localeCompare(a.updated)); }
export function putTrip(trip) {
  load().trips[trip.id] = { ...trip, updated: new Date().toISOString() };
  save();
  return db.trips[trip.id];
}

export function getPicks(place) { return load().picks[placeKey(place)] || []; }
// Adds new picks and updates ones with the same name; never drops what was saved before.
export function mergePicks(place, picks) {
  const key = placeKey(place), now = new Date().toISOString();
  const byName = new Map((load().picks[key] || []).map((p) => [p.name.toLowerCase(), p]));
  for (const p of picks) byName.set(p.name.toLowerCase(), { ...byName.get(p.name.toLowerCase()), ...p, saved: now });
  db.picks[key] = [...byName.values()];
  save();
  return db.picks[key];
}

// For tests: start from an empty store
export function _reset() { db = { trips: {}, picks: {} }; save(); }
