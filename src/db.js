import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS filters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  olx_url       TEXT NOT NULL,
  api_query     TEXT NOT NULL,
  location_id   TEXT,
  location_name TEXT,
  scope         TEXT NOT NULL DEFAULT 'city',
  chat_id       TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  initialized   INTEGER NOT NULL DEFAULT 0,
  fail_count    INTEGER NOT NULL DEFAULT 0,
  empty_count   INTEGER NOT NULL DEFAULT 0,
  last_count    INTEGER,
  last_checked  TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (olx_url, chat_id)
);

CREATE TABLE IF NOT EXISTS listings (
  ad_id        TEXT NOT NULL,
  filter_id    INTEGER NOT NULL REFERENCES filters(id) ON DELETE CASCADE,
  title        TEXT,
  price        INTEGER,
  year         INTEGER,
  km           INTEGER,
  fuel         TEXT,
  transmission TEXT,
  owner        TEXT,
  city         TEXT,
  locality     TEXT,
  is_dealer    INTEGER,
  seller_name  TEXT,
  image_url    TEXT,
  url          TEXT,
  posted_at    TEXT,
  first_seen   TEXT NOT NULL DEFAULT (datetime('now')),
  notified     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ad_id, filter_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_filter_seen ON listings (filter_id, first_seen DESC);
`);

export const ALERT = { PENDING: 0, SENT: 1, SILENT: 2 };

const stmt = {
  addFilter: db.prepare(`INSERT INTO filters (name, olx_url, api_query, location_id, location_name, scope, chat_id)
    VALUES (@name, @olx_url, @api_query, @location_id, @location_name, @scope, @chat_id)`),
  findFilterByUrl: db.prepare('SELECT * FROM filters WHERE olx_url = ? AND chat_id = ?'),
  getFilter: db.prepare('SELECT * FROM filters WHERE id = ? AND chat_id = ?'),
  listFilters: db.prepare(`SELECT f.*, (SELECT COUNT(*) FROM listings l WHERE l.filter_id = f.id) AS listing_count
    FROM filters f WHERE chat_id = ? ORDER BY id`),
  activeFilters: db.prepare('SELECT * FROM filters WHERE active = 1 ORDER BY id'),
  setActive: db.prepare('UPDATE filters SET active = ?, fail_count = 0 WHERE id = ? AND chat_id = ?'),
  setScope: db.prepare('UPDATE filters SET scope = ?, initialized = 0 WHERE id = ? AND chat_id = ?'),
  deleteFilter: db.prepare('DELETE FROM filters WHERE id = ? AND chat_id = ?'),
  markInitialized: db.prepare('UPDATE filters SET initialized = 1 WHERE id = ?'),
  recordSuccess: db.prepare(`UPDATE filters SET fail_count = 0, last_error = NULL, last_checked = datetime('now'),
    last_count = @count, empty_count = CASE WHEN @count = 0 THEN empty_count + 1 ELSE 0 END WHERE id = @id`),
  recordFailure: db.prepare(`UPDATE filters SET fail_count = fail_count + 1, last_error = ?, last_checked = datetime('now')
    WHERE id = ?`),
  knownIds: db.prepare('SELECT ad_id FROM listings WHERE filter_id = ?'),
  insertListing: db.prepare(`INSERT OR IGNORE INTO listings
    (ad_id, filter_id, title, price, year, km, fuel, transmission, owner, city, locality, is_dealer, seller_name,
     image_url, url, posted_at, notified)
    VALUES (@adId, @filterId, @title, @price, @year, @km, @fuel, @transmission, @owner, @city, @locality, @isDealer,
     @sellerName, @imageUrl, @url, @postedAt, @notified)`),
  pending: db.prepare('SELECT * FROM listings WHERE filter_id = ? AND notified = 0 ORDER BY posted_at DESC'),
  markNotified: db.prepare('UPDATE listings SET notified = ? WHERE ad_id = ? AND filter_id = ?'),
  latest: db.prepare('SELECT * FROM listings WHERE filter_id = ? ORDER BY posted_at DESC LIMIT ?'),
  resendNewest: db.prepare(`UPDATE listings SET notified = 0 WHERE rowid IN
    (SELECT rowid FROM listings WHERE filter_id = ? ORDER BY posted_at DESC LIMIT ?)`),
  totals: db.prepare(`SELECT (SELECT COUNT(*) FROM filters WHERE active = 1) AS active_filters,
    (SELECT COUNT(*) FROM listings) AS listings,
    (SELECT COUNT(*) FROM listings WHERE first_seen >= datetime('now', '-1 day') AND notified = 1) AS alerts_24h`),
};

export const repo = {
  addFilter: (f) => stmt.addFilter.run(f).lastInsertRowid,
  findFilterByUrl: (url, chatId) => stmt.findFilterByUrl.get(url, String(chatId)),
  getFilter: (id, chatId) => stmt.getFilter.get(id, String(chatId)),
  listFilters: (chatId) => stmt.listFilters.all(String(chatId)),
  activeFilters: () => stmt.activeFilters.all(),
  setActive: (id, chatId, active) => stmt.setActive.run(active ? 1 : 0, id, String(chatId)).changes > 0,
  setScope: (id, chatId, scope) => stmt.setScope.run(scope, id, String(chatId)).changes > 0,
  deleteFilter: (id, chatId) => stmt.deleteFilter.run(id, String(chatId)).changes > 0,
  markInitialized: (id) => stmt.markInitialized.run(id),
  recordSuccess: (id, count) => stmt.recordSuccess.run({ id, count }),
  recordFailure: (id, message) => stmt.recordFailure.run(message, id),
  knownIds: (filterId) => new Set(stmt.knownIds.all(filterId).map((r) => r.ad_id)),
  insertListings: db.transaction((filterId, listings, status) => {
    for (const l of listings) {
      const { locationIds, ...row } = l;
      stmt.insertListing.run({ ...row, filterId, isDealer: l.isDealer ? 1 : 0, notified: status });
    }
  }),
  pending: (filterId) => stmt.pending.all(filterId),
  markNotified: (adId, filterId, status = ALERT.SENT) => stmt.markNotified.run(status, adId, filterId),
  latest: (filterId, n) => stmt.latest.all(filterId, n),
  resendNewest: (filterId, n) => stmt.resendNewest.run(filterId, n).changes,
  totals: () => stmt.totals.get(),
};
