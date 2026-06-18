const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

async function initDatabase() {
  try {
    await prisma.$connect();
    logger.info('Connexion base de données OK');
  } catch (err) {
    logger.error('Impossible de se connecter à la base de données:', err);
    process.exit(1);
  }
}

module.exports = { prisma, initDatabase };
