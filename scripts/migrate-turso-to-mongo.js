// scripts/migrate-turso-to-mongo.js
// ──────────────────────────────────────────────────────────────
// Script one-shot de migration des données Turso → MongoDB.
// Lance UNE SEULE FOIS avec les deux bases actives.
//
// Usage :
//   node scripts/migrate-turso-to-mongo.js
//
// Pré-requis :
//   • TURSO_DATABASE_URL + TURSO_AUTH_TOKEN dans .env (Turso)
//   • MONGO_URI dans .env (MongoDB)
//   • Les deux bases accessibles simultanément
// ──────────────────────────────────────────────────────────────

require('dotenv').config();

const turso  = require('../src/lib/turso');          // client Turso existant
const mongo  = require('../src/lib/db');       // couche MongoDB
const { initDb } = require('../src/lib/db-init');

// ─── Compteurs globaux ───────────────────────────────────────
const stats = {
  Admin: { ok: 0, skip: 0, err: 0 },
  Session: { ok: 0, skip: 0, err: 0 },
  BotConfig: { ok: 0, skip: 0, err: 0 },
  Conversation: { ok: 0, skip: 0, err: 0 },
  Order: { ok: 0, skip: 0, err: 0 },
  Document: { ok: 0, skip: 0, err: 0 },
  MessageLog: { ok: 0, skip: 0, err: 0 },
};

function log(collection, status, detail = '') {
  stats[collection][status]++;
  if (status === 'err') console.error(`  ❌ [${collection}] ${detail}`);
}

// ════════════════════════════════════════════════════════════
//  MIGRATION PAR COLLECTION
// ════════════════════════════════════════════════════════════

async function migrateAdmins() {
  console.log('\n📦 Migration Admin...');
  const res = await turso.execute({ sql: 'SELECT * FROM Admin', args: [] });
  for (const r of res.rows) {
    try {
      const existing = await mongo.adminDb.findByEmail(r.email);
      if (existing) { log('Admin', 'skip'); continue; }
      const { Admin } = require('../src/models');
      await Admin.create({
        id: r.id, email: r.email, password: r.password, name: r.name,
        createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt),
      });
      log('Admin', 'ok');
    } catch (err) { log('Admin', 'err', `${r.email} — ${err.message}`); }
  }
}

async function migrateSessions() {
  console.log('\n📦 Migration Session...');
  const res = await turso.execute({ sql: 'SELECT * FROM Session', args: [] });
  for (const r of res.rows) {
    try {
      const { Session } = require('../src/models');
      const existing = await Session.findOne({ token: r.token });
      if (existing) { log('Session', 'skip'); continue; }
      await Session.create({
        id: r.id, token: r.token, adminId: r.adminId,
        expiresAt: new Date(r.expiresAt),
        createdAt: new Date(r.createdAt),
      });
      log('Session', 'ok');
    } catch (err) { log('Session', 'err', `${r.id} — ${err.message}`); }
  }
}

async function migrateBotConfig() {
  console.log('\n📦 Migration BotConfig...');
  const res = await turso.execute({ sql: 'SELECT * FROM BotConfig', args: [] });
  for (const r of res.rows) {
    try {
      await mongo.botConfigDb.upsert({
        key: r.key, value: r.value, description: r.description,
      });
      log('BotConfig', 'ok');
    } catch (err) { log('BotConfig', 'err', `${r.key} — ${err.message}`); }
  }
}

async function migrateConversations() {
  console.log('\n📦 Migration Conversation...');
  const res = await turso.execute({ sql: 'SELECT * FROM Conversation', args: [] });
  for (const r of res.rows) {
    try {
      const { Conversation } = require('../src/models');
      const existing = await Conversation.findOne({ phone: r.phone });
      if (existing) { log('Conversation', 'skip'); continue; }
      await Conversation.create({
        id: r.id, phone: r.phone, state: r.state,
        data: JSON.parse(r.data ?? '{}'),
        startedAt:   r.startedAt   ? new Date(r.startedAt)   : new Date(),
        completedAt: r.completedAt ? new Date(r.completedAt) : null,
        updatedAt:   r.updatedAt   ? new Date(r.updatedAt)   : new Date(),
      });
      log('Conversation', 'ok');
    } catch (err) { log('Conversation', 'err', `${r.phone} — ${err.message}`); }
  }
}

async function migrateOrders() {
  console.log('\n📦 Migration Order...');
  const res = await turso.execute({ sql: 'SELECT * FROM "Order"', args: [] });
  for (const r of res.rows) {
    try {
      const { Order } = require('../src/models');
      const existing = await Order.findOne({ id: r.id });
      if (existing) { log('Order', 'skip'); continue; }
      await Order.create({
        id: r.id, conversationId: r.conversationId,
        firstName: r.firstName, lastName: r.lastName,
        phone: r.phone, email: r.email ?? null, address: r.address ?? null,
        cardType: r.cardType, extraData: JSON.parse(r.extraData ?? '{}'),
        status: r.status,
        driveFolderId:  r.driveFolderId  ?? null,
        driveFolderUrl: r.driveFolderUrl ?? null,
        createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt),
      });
      log('Order', 'ok');
    } catch (err) { log('Order', 'err', `${r.id} — ${err.message}`); }
  }
}

async function migrateDocuments() {
  console.log('\n📦 Migration Document...');
  const res = await turso.execute({ sql: 'SELECT * FROM Document', args: [] });
  for (const r of res.rows) {
    try {
      const { Document } = require('../src/models');
      const existing = await Document.findOne({ id: r.id });
      if (existing) { log('Document', 'skip'); continue; }
      await Document.create({
        id: r.id, orderId: r.orderId, fileName: r.fileName,
        mimeType: r.mimeType, driveFileId: r.driveFileId ?? null,
        source: r.source || 'WHATSAPP',
        createdAt: new Date(r.createdAt),
      });
      log('Document', 'ok');
    } catch (err) { log('Document', 'err', `${r.id} — ${err.message}`); }
  }
}

async function migrateMessageLogs() {
  console.log('\n📦 Migration MessageLog...');
  const res = await turso.execute({
    sql: 'SELECT * FROM MessageLog ORDER BY createdAt ASC', args: [],
  });
  for (const r of res.rows) {
    try {
      const { MessageLog } = require('../src/models');
      const existing = await MessageLog.findOne({ id: r.id });
      if (existing) { log('MessageLog', 'skip'); continue; }
      await MessageLog.create({
        id: r.id, phone: r.phone, direction: r.direction,
        content: r.content, type: r.type || 'text',
        createdAt: new Date(r.createdAt),
      });
      log('MessageLog', 'ok');
    } catch (err) { log('MessageLog', 'err', `${r.id} — ${err.message}`); }
  }
}

// ════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════

async function migrate() {
  console.log('🚀 Démarrage migration Turso → MongoDB\n');

  // Init MongoDB
  await initDb();

  // Ordre respectant les dépendances logiques
  await migrateAdmins();
  await migrateSessions();       // dépend de Admin (adminId)
  await migrateBotConfig();
  await migrateConversations();
  await migrateOrders();         // dépend de Conversation (conversationId)
  await migrateDocuments();      // dépend de Order (orderId)
  await migrateMessageLogs();

  // ── Rapport final ─────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  RAPPORT DE MIGRATION');
  console.log('══════════════════════════════════════');
  for (const [col, s] of Object.entries(stats)) {
    console.log(`  ${col.padEnd(14)} ✅ ${s.ok} | ⏭️  ${s.skip} | ❌ ${s.err}`);
  }
  console.log('══════════════════════════════════════\n');

  const totalErrors = Object.values(stats).reduce((acc, s) => acc + s.err, 0);
  if (totalErrors > 0) {
    console.error(`⚠️  Migration terminée avec ${totalErrors} erreur(s). Vérifier les logs ci-dessus.`);
    process.exit(1);
  } else {
    console.log('✅ Migration terminée sans erreur.');
    process.exit(0);
  }
}

migrate().catch((err) => {
  console.error('❌ Erreur fatale migration:', err);
  process.exit(1);
});
