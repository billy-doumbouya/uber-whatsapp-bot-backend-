require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const { initBot } = require('./bot/whatsappClient');
const { initDatabase } = require('./utils/database');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3001;

// ── Parser les URLs multiples séparées par des virgules ──────
// Même logique que app.js pour garder la cohérence
function parseUrls(envVar, fallback) {
  if (!envVar) return [fallback];
  return envVar.split(',').map(u => u.trim()).filter(Boolean);
}

const allowedOrigins = [
  ...new Set([
    ...parseUrls(process.env.DASHBOARD_URL, 'http://localhost:3000'),
    ...parseUrls(process.env.FORM_URL,      'http://localhost:3002'),
  ])
];

async function main() {
  // 1. Initialiser la base de données
  await initDatabase();
  logger.info('Base de données initialisée');

  // 2. Créer le serveur HTTP
  const server = http.createServer(app);

  // 3. Initialiser Socket.IO
  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  logger.info(`Origins autorisées: ${allowedOrigins.join(', ')}`);

  app.set('io', io);

  io.on('connection', (socket) => {
    logger.info(`Dashboard connecté: ${socket.id}`);
    socket.on('disconnect', () => {
      logger.info(`Dashboard déconnecté: ${socket.id}`);
    });
  });

  // 4. Démarrer le serveur
  server.listen(PORT, () => {
    logger.info(`Serveur démarré sur le port ${PORT}`);
    logger.info(`Environnement: ${process.env.NODE_ENV}`);
  });

  // 5. Démarrer le bot WhatsApp
  try {
    await initBot(io);
    logger.info('Bot WhatsApp initialisé');
  } catch (err) {
    logger.error('Erreur démarrage bot WhatsApp:', err);
  }

  // Gestion propre de l'arrêt
  process.on('SIGTERM', () => {
    logger.info('SIGTERM reçu, arrêt propre...');
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  logger.error('Erreur fatale au démarrage:', err);
  process.exit(1);
});