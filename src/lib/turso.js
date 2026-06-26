// src/lib/turso.js
// ──────────────────────────────────────────────────────────────
// Client Turso (libSQL) — singleton
// Dépendances : @libsql/client
//   npm install @libsql/client
// Variables d'environnement requises :
//   TURSO_DATABASE_URL  ex: libsql://your-db-org.turso.io
//   TURSO_AUTH_TOKEN    token généré via `turso db tokens create <db>`
// ──────────────────────────────────────────────────────────────

const { createClient } = require('@libsql/client');

if (!process.env.TURSO_DATABASE_URL) {
  throw new Error('TURSO_DATABASE_URL is not defined');
}
if (!process.env.TURSO_AUTH_TOKEN) {
  throw new Error('TURSO_AUTH_TOKEN is not defined');
}

const turso = createClient({
  url:       process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

module.exports = turso;