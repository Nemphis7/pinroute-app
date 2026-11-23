// Trips, chosen flights, the new-trip draft, local picks and search counts in one SQLite file on the server's disk (the Railway volume).
// Every row belongs to an owner: the signed-in person's id, or "local" while sign-in is off (one person, or Claude
// Desktop on your own computer). Callers always pass the owner, so one person never reads another's rows.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export const LOCAL = 'local';

// DATA_DIR if set; on a host with a volume (Railway sets RAILWAY_VOLUME_MOUNT_PATH) that volume; otherwise data/.
// Worked out on first use, after .env has been read.
export const dataDir = () => resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || new URL('../data', import.meta.url).pathname);

let db = null;
function open() {
  if (db) return db;
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(join(dir, 'pinroute.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS trips_by_owner ON trips (owner, updated);
    CREATE TABLE IF NOT EXISTS picks (owner TEXT NOT NULL, place TEXT NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY (owner, place));
    CREATE TABLE IF NOT EXISTS usage (owner TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (owner, day, kind));
    CREATE TABLE IF NOT EXISTS drafts (owner TEXT PRIMARY KEY, data TEXT NOT NULL, updated TEXT NOT NULL);
  `);
  importJson(dir);
  return db;
}

function tx(fn) {
  const d = open();
  d.exec('BEGIN IMMEDIATE');
  try { const r = fn(d); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; }
}

// Version 0.1 kept everything in store.json. Its trips and picks move in once, as the local owner's,
// and the file is kept beside the database as store.json.imported.
function importJson(dir) {
  const file = join(dir, 'store.json');
  if (!existsSync(file)) return;
  let old;
  try { old = JSON.parse(readFileSync(file, 'utf8')); } catch { return; }
  tx((d) => {
    const putT = d.prepare('INSERT OR IGNORE INTO trips (id, owner, data, created, updated) VALUES (?, ?, ?, ?, ?)');
    for (const t of Object.values(old.trips || {})) {
      const now = t.updated || new Date().toISOString();
      putT.run(t.id, LOCAL, JSON.stringify(t), t.created || now, now);
    }
    const putP = d.prepare('INSERT OR IGNORE INTO picks (owner, place, data, updated) VALUES (?, ?, ?, ?)');
    for (const [place, list] of Object.entries(old.picks || {})) putP.run(LOCAL, place, JSON.stringify(list), new Date().toISOString());
  });
  renameSync(file, `${file}.imported`);
}

export const newId = (p) => `${p}_${randomBytes(6).toString('base64url')}`;
export const placeKey = (place) => String(place || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const row2trip = (r) => (r ? { ...JSON.parse(r.data), id: r.id, updated: r.updated } : null);

// ---- trips
export function getTrip(owner, id) {
  return row2trip(open().prepare('SELECT id, data, updated FROM trips WHERE id = ? AND owner = ?').get(id, owner));
}
export function listTrips(owner) {
  return open().prepare('SELECT id, data, updated FROM trips WHERE owner = ? ORDER BY updated DESC, id').all(owner).map(row2trip);
}
export function countTrips(owner) {
  return open().prepare('SELECT COUNT(*) AS n FROM trips WHERE owner = ?').get(owner).n;
}
export function putTrip(owner, trip) {
  const now = new Date().toISOString();
  const data = { ...trip, updated: now };
  delete data.owner;
  // ON CONFLICT only updates the owner's own row: an id that belongs to someone else changes nothing
  const r = open().prepare(`INSERT INTO trips (id, owner, data, created, updated) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated = excluded.updated WHERE trips.owner = excluded.owner`)
    .run(trip.id, owner, JSON.stringify(data), trip.created || now, now);
  if (!r.changes) throw new Error(`Trip ${trip.id} could not be saved.`);
  return getTrip(owner, trip.id);
}
export function deleteTrip(owner, id) {
  return open().prepare('DELETE FROM trips WHERE id = ? AND owner = ?').run(id, owner).changes > 0;
}

// ---- local picks, per owner and place
export function getPicks(owner, place) {
  const r = open().prepare('SELECT data FROM picks WHERE owner = ? AND place = ?').get(owner, placeKey(place));
  return r ? JSON.parse(r.data) : [];
}
// Adds new picks and updates ones with the same name; never drops what was saved before.
export function mergePicks(owner, place, picks) {
  const key = placeKey(place), now = new Date().toISOString();
  return tx((d) => {
    const r = d.prepare('SELECT data FROM picks WHERE owner = ? AND place = ?').get(owner, key);
    const byName = new Map((r ? JSON.parse(r.data) : []).map((p) => [p.name.toLowerCase(), p]));
    for (const p of picks) byName.set(p.name.toLowerCase(), { ...byName.get(p.name.toLowerCase()), ...p, saved: now });
    const list = [...byName.values()];
    d.prepare('INSERT INTO picks (owner, place, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT (owner, place) DO UPDATE SET data = excluded.data, updated = excluded.updated')
      .run(owner, key, JSON.stringify(list), now);
    return list;
  });
}

// ---- the new-trip draft: one per owner, the trip being looked for before it exists
export function getDraft(owner) {
  const r = open().prepare('SELECT data, updated FROM drafts WHERE owner = ?').get(owner);
  return r ? { ...JSON.parse(r.data), updated: r.updated } : null;
}
// Read, change and write in one transaction, so the planner and Claude saving at the same moment don't lose a change
export function updateDraft(owner, fn, fresh) {
  return tx((d) => {
    const r = d.prepare('SELECT data FROM drafts WHERE owner = ?').get(owner);
    const next = fn(r ? JSON.parse(r.data) : fresh());
    const now = new Date().toISOString();
    delete next.updated;
    d.prepare('INSERT INTO drafts (owner, data, updated) VALUES (?, ?, ?) ON CONFLICT (owner) DO UPDATE SET data = excluded.data, updated = excluded.updated')
      .run(owner, JSON.stringify(next), now);
    return { ...next, updated: now };
  });
}

// ---- daily counters, for limits such as flight searches per person
export function bumpUsage(owner, kind, day = new Date().toISOString().slice(0, 10)) {
  return tx((d) => {
    d.prepare('INSERT INTO usage (owner, day, kind, n) VALUES (?, ?, ?, 1) ON CONFLICT (owner, day, kind) DO UPDATE SET n = n + 1').run(owner, day, kind);
    d.prepare('DELETE FROM usage WHERE day < ?').run(new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10));
    return d.prepare('SELECT n FROM usage WHERE owner = ? AND day = ? AND kind = ?').get(owner, day, kind).n;
  });
}
export function usage(owner, kind, day = new Date().toISOString().slice(0, 10)) {
  return open().prepare('SELECT n FROM usage WHERE owner = ? AND day = ? AND kind = ?').get(owner, day, kind)?.n || 0;
}

// ---- everything one person has saved
export function deleteOwner(owner) {
  return tx((d) => ({
    trips: d.prepare('DELETE FROM trips WHERE owner = ?').run(owner).changes,
    picks: d.prepare('DELETE FROM picks WHERE owner = ?').run(owner).changes,
    drafts: d.prepare('DELETE FROM drafts WHERE owner = ?').run(owner).changes,
    usage: d.prepare('DELETE FROM usage WHERE owner = ?').run(owner).changes,
  }));
}

// When sign-in is switched on, the trips saved before it belong to "local". With ADOPT_LOCAL_DATA=true the first
// signed-in person who has nothing saved takes them over (meant for the developer; switch it off afterwards).
export function adoptLocal(owner) {
  if (owner === LOCAL) return 0;
  return tx((d) => {
    if (d.prepare('SELECT 1 FROM trips WHERE owner = ? LIMIT 1').get(owner)) return 0;
    const n = d.prepare('UPDATE trips SET owner = ? WHERE owner = ?').run(owner, LOCAL).changes;
    d.prepare('UPDATE OR IGNORE picks SET owner = ? WHERE owner = ?').run(owner, LOCAL);
    d.prepare('UPDATE OR IGNORE drafts SET owner = ? WHERE owner = ?').run(owner, LOCAL);
    return n;
  });
}

// For tests: start from an empty store
export function _reset() { open().exec('DELETE FROM trips; DELETE FROM picks; DELETE FROM usage; DELETE FROM drafts;'); }
