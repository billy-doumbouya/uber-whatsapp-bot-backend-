// src/utils/database.js
// ──────────────────────────────────────────────────────────────
// Point d'entrée unique pour la base de données.
// Interface d'export INCHANGÉE :
//   const { db, prisma, initDatabase } = require('./utils/database')
//
// `prisma` reste aliasé vers `db` pour la compatibilité
// avec les anciens imports non encore migrés.
// ──────────────────────────────────────────────────────────────

const { initDb } = require('../lib/db-init');
const db         = require('../lib/db');
const logger     = require('./logger');

async function initDatabase() {
  try {
    await initDb();
    logger.info('Connexion base de données MongoDB OK');
  } catch (err) {
    logger.error('Impossible de se connecter à MongoDB:', err);
    process.exit(1);
  }
}

// `prisma` aliasé vers `db` — compatibilité ascendante conservée.
module.exports = { db, prisma: db, initDatabase };
