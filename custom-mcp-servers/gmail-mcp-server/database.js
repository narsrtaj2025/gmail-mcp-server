/**
 * custom-mcp-servers/gmail-mcp-server/database.js
 *
 *  • Multi-provider OAuth token storage layer (SQLite)
 *  • PRIMARY KEY (user_id, provider) ‑ one refresh token per user/provider
 *  • Designed for reuse by any future MCP server: gmail, calendar, teams …
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH =
  process.env.OAUTH_DB_PATH ||
  path.join(process.cwd(), 'tokens.db');

// Ensure directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Open / create DB file
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    user_id       TEXT NOT NULL,
    provider      TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    access_token  TEXT,
    expires_at    INTEGER,
    scopes        TEXT,
    created_at    INTEGER DEFAULT (strftime('%s','now')),
    updated_at    INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, provider)
  );
`);

/* ------------------------------------------------------------------ */
/*                               API                                  */
/* ------------------------------------------------------------------ */

export function saveTokens(userId, provider, { refresh_token, access_token, expires_in }, scopes = []) {
  if (!refresh_token) {
    throw new Error('saveTokens: refresh_token is required');
  }

  const expiresAt = access_token && expires_in ? Date.now() + expires_in * 1000 : null;

  const stmt = db.prepare(`
    INSERT INTO oauth_tokens (user_id, provider, refresh_token, access_token, expires_at, scopes, updated_at)
    VALUES                (?,       ?,         ?,             ?,            ?,          ?,     strftime('%s','now'))
    ON CONFLICT(user_id, provider) DO UPDATE SET
      refresh_token = excluded.refresh_token,
      access_token  = excluded.access_token,
      expires_at    = excluded.expires_at,
      scopes        = excluded.scopes,
      updated_at    = strftime('%s','now');
  `);

  stmt.run(userId, provider, refresh_token, access_token ?? null, expiresAt, scopes.join(','));
}

export function getTokenRecord(userId, provider) {
  const stmt = db.prepare(`
    SELECT * FROM oauth_tokens WHERE user_id = ? AND provider = ? LIMIT 1;
  `);
  return stmt.get(userId, provider) || null;
}

export function hasRefreshToken(userId, provider) {
  const row = db.prepare(`
    SELECT 1 FROM oauth_tokens WHERE user_id = ? AND provider = ? LIMIT 1;
  `).get(userId, provider);
  return !!row;
}

export function updateAccessToken(userId, provider, access_token, expires_in) {
  const expiresAt = Date.now() + expires_in * 1000;
  db.prepare(`
    UPDATE oauth_tokens SET access_token = ?, expires_at = ?, updated_at = strftime('%s','now')
    WHERE user_id = ? AND provider = ?;
  `).run(access_token, expiresAt, userId, provider);
}

export function deleteTokens(userId, provider) {
  db.prepare(`DELETE FROM oauth_tokens WHERE user_id = ? AND provider = ?;`).run(userId, provider);
}

export function getValidAccessToken(userId, provider) {
  const rec = getTokenRecord(userId, provider);
  if (!rec || !rec.access_token) return null;
  if (rec.expires_at && Date.now() > rec.expires_at) return null;
  return rec.access_token;
}
