const { prisma } = require('../utils/database');

// Lire une valeur de config du bot
async function getBotConfig(key) {
  const config = await prisma.botConfig.findUnique({ where: { key } });
  return config ? config.value : null;
}

// Lire toute la config
async function getAllBotConfig() {
  const configs = await prisma.botConfig.findMany({ orderBy: { key: 'asc' } });
  const result = {};
  for (const c of configs) {
    result[c.key] = { value: c.value, description: c.description };
  }
  return result;
}

// Mettre à jour une valeur
async function setBotConfig(key, value) {
  return prisma.botConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

module.exports = { getBotConfig, getAllBotConfig, setBotConfig };
