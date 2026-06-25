// services/configService.js — migré Turso
const { botConfigDb } = require('../lib/db');

// prisma.botConfig.findUnique({ where: { key } })
async function getBotConfig(key) {
  const config = await botConfigDb.findByKey(key);
  return config ? config.value : null;
}

// prisma.botConfig.findMany({ orderBy: { key: 'asc' } })
async function getAllBotConfig() {
  const configs = await botConfigDb.findAll();
  // findAll() ne trie pas — on trie côté JS (évite une requête SQL supplémentaire)
  configs.sort((a, b) => a.key.localeCompare(b.key));
  const result = {};
  for (const c of configs) {
    result[c.key] = { value: c.value, description: c.description };
  }
  return result;
}

// prisma.botConfig.upsert({ where: { key }, update: { value }, create: { key, value } })
async function setBotConfig(key, value) {
  return botConfigDb.upsert({ key, value });
}

module.exports = { getBotConfig, getAllBotConfig, setBotConfig };