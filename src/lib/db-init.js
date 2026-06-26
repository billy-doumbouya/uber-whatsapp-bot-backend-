// src/lib/db-init.mongo.js
// ──────────────────────────────────────────────────────────────
// Remplace db-init.js (lecture schema.sql Turso).
// Avec Mongoose, pas besoin de CREATE TABLE manuels :
// les schemas définissent la structure, les indexes sont
// créés automatiquement via syncIndexes().
// ──────────────────────────────────────────────────────────────

const { connectMongoDB } = require('../config/mongodb');
const logger = require('../utils/logger');

// Import des models pour déclencher leur enregistrement Mongoose
// et la création des indexes au premier démarrage.
require('../models');

async function initDb() {
  await connectMongoDB();

  // Synchronise les indexes définis dans les schemas
  // (TTL Session, unique email Admin, index phone Conversation, etc.)
  // En production, désactiver après le premier déploiement
  // ou utiliser { background: true } pour ne pas bloquer.
  const mongoose = require('mongoose');
  const models = Object.values(mongoose.models);

  for (const model of models) {
    try {
      await model.syncIndexes();
      logger.info(`[db-init] Index sync OK → ${model.modelName}`);
    } catch (err) {
      logger.warn(`[db-init] Index sync warning (${model.modelName}): ${err.message}`);
    }
  }

  logger.info('[db-init] MongoDB schema applied ✓');
}

module.exports = { initDb };
