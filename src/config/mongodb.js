// src/config/mongodb.js
// ──────────────────────────────────────────────────────────────
// Connexion Mongoose unique avec gestion des events.
// Appelé par db-init.mongo.js — ne pas appeler directement.
// ──────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const logger   = require('../utils/logger');
const dns      = require('dns');

// Force Node.js à utiliser l'ordre DNS natif (évite les bugs IPv6 de reconnexion)
dns.setDefaultResultOrder('verbatim');

async function connectMongoDB() {
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  // Si déjà connecté ou en cours de connexion, on ne fait rien
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    return mongoose.connection;
  }

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI manquant dans les variables d\'environnement');
  }

  // Configuration des écouteurs d'événements (une seule fois)
  if (mongoose.connection.listeners('connected').length === 0) {
    mongoose.connection.on('connected', () => {
      logger.info('MongoDB connecté ✓');
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB déconnecté ⚠');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB erreur:', err.message);
    });
  }

  try {
    // Optionnel mais recommandé pour éviter les avertissements de Mongoose au futur
    mongoose.set('strictQuery', true); 

    await mongoose.connect(uri, {
      dbName: process.env.MONGO_DB_NAME || 'uba_whatsapp',
      serverSelectionTimeoutMS: 5000, // 5 secondes max pour trouver le serveur
      socketTimeoutMS: 45000,         // Ferme les requêtes inactives après 45s
    });

    return mongoose.connection;
  } catch (error) {
    logger.error('Échec initial de la connexion MongoDB:', error.message);
    throw error;
  }
}

module.exports = { connectMongoDB };