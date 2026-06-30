// src/lib/db.mongo.js
// ──────────────────────────────────────────────────────────────
// Remplace src/lib/db.js (Turso raw queries) par Mongoose.
// Interface IDENTIQUE : mêmes noms de fonctions, mêmes signatures,
// mêmes shapes de retour → aucun changement dans les routes/services.
//
// Différences internes notables :
//  • Les dates sont de vrais objets Date (plus des strings ISO).
//  • `data` et `extraData` sont des objets JS natifs (plus de JSON.parse).
//  • Le TTL index sur Session remplace deleteExpired() côté applicatif.
// ──────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');
const {
  Admin, Session, BotConfig,
  Conversation, Order, Document, MessageLog,
} = require('../models');
const dns = require('dns');

dns.setDefaultResultOrder('verbatim');

// ─── helper : retourne un objet JS pur depuis un doc Mongoose ──
// `.toObject()` supprime les proxies Mongoose et `_id` interne.
// On s'assure que `id` (UUID applicatif) est toujours présent.
function toPlain(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject({ versionKey: false }) : doc;
  // Normalise les dates en ISO string pour rester compatible
  // avec le reste de l'app qui peut faire .toISOString() dessus.
  return obj;
}

const now = () => new Date();

// ════════════════════════════════════════════════════════════
//  ADMIN
// ════════════════════════════════════════════════════════════

const adminDb = {

  async create({ email, password, name }) {
    const id = randomUUID();
    const doc = await Admin.create({ id, email, password, name });
    return toPlain(doc);
  },

  async findByEmail(email) {
    return toPlain(await Admin.findOne({ email: email.toLowerCase() }).lean());
  },

  async findById(id) {
    return toPlain(await Admin.findOne({ id }).lean());
  },

  async update(id, fields) {
    await Admin.updateOne({ id }, { $set: fields });
    return adminDb.findById(id);
  },
};

// ════════════════════════════════════════════════════════════
//  SESSION
// ════════════════════════════════════════════════════════════

const sessionDb = {

  async create({ token, adminId, expiresAt }) {
    const id  = randomUUID();
    const exp = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    const doc = await Session.create({ id, token, adminId, expiresAt: exp });
    return toPlain(doc);
  },

  async findByToken(token) {
    const session = await Session.findOne({ token }).lean();
    if (!session) return null;

    const admin = await Admin.findOne({ id: session.adminId })
      .select('id email name')
      .lean();

    return {
      ...session,
      admin: admin
        ? { id: admin.id, email: admin.email, name: admin.name }
        : null,
    };
  },

  async deleteByToken(token) {
    await Session.deleteOne({ token });
  },

  async deleteExpired() {
    // Le TTL index MongoDB gère ça automatiquement.
    // Cette méthode reste disponible pour un nettoyage manuel forcé.
    await Session.deleteMany({ expiresAt: { $lt: now() } });
  },

  async deleteByAdminId(adminId) {
    await Session.deleteMany({ adminId });
  },
};

// ════════════════════════════════════════════════════════════
//  BOT CONFIG
// ════════════════════════════════════════════════════════════

const botConfigDb = {

  async upsert({ key, value, description }) {
    await BotConfig.updateOne(
      { key },
      { $set: { value, description: description ?? null, updatedAt: now() },
        $setOnInsert: { id: randomUUID() } },
      { upsert: true }
    );
    return botConfigDb.findByKey(key);
  },

  async findByKey(key) {
    return toPlain(await BotConfig.findOne({ key }).lean());
  },

  async findAll() {
    return (await BotConfig.find().lean()).map(toPlain);
  },

  async delete(key) {
    await BotConfig.deleteOne({ key });
  },
};

// ════════════════════════════════════════════════════════════
//  CONVERSATION
// ════════════════════════════════════════════════════════════

const conversationDb = {

  async upsert({ phone, state = 'IDLE', data = {} }) {
    await Conversation.updateOne(
      { phone },
      { $set: { state, data, updatedAt: now() },
        $setOnInsert: { id: randomUUID(), startedAt: now() } },
      { upsert: true }
    );
    return conversationDb.findByPhone(phone);
  },

  async findByPhone(phone) {
    return toPlain(await Conversation.findOne({ phone }).lean());
  },

  async findById(id) {
    return toPlain(await Conversation.findOne({ id }).lean());
  },

  async update(phone, fields) {
    await Conversation.updateOne({ phone }, { $set: { ...fields, updatedAt: now() } });
    return conversationDb.findByPhone(phone);
  },

  async complete(phone) {
    await Conversation.updateOne(
      { phone },
      { $set: { state: 'DONE', completedAt: now(), updatedAt: now() } }
    );
  },

  async findAll({ limit = 50, offset = 0 } = {}) {
    return (
      await Conversation.find()
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
    ).map(toPlain);
  },
};

// ════════════════════════════════════════════════════════════
//  ORDER
// ════════════════════════════════════════════════════════════

const orderDb = {

  async create({
    conversationId,
    firstName, lastName, phone, email, address,
    cardType = 'VISA_CLASSIC',
    extraData = {},
  }) {
    const id  = randomUUID();
    const doc = await Order.create({
      id, conversationId,
      firstName, lastName, phone,
      email:     email   ?? null,
      address:   address ?? null,
      cardType,
      extraData,
      status: 'PENDING',
    });
    return toPlain(doc);
  },

  async findById(id) {
    return toPlain(await Order.findOne({ id }).lean());
  },

  async findByConversationId(conversationId) {
    return (
      await Order.find({ conversationId }).sort({ createdAt: -1 }).lean()
    ).map(toPlain);
  },

  async update(id, fields) {
    await Order.updateOne({ id }, { $set: { ...fields, updatedAt: now() } });
    return orderDb.findById(id);
  },

  async updateDrive(id, { driveFolderId, driveFolderUrl }) {
    return orderDb.update(id, { driveFolderId, driveFolderUrl });
  },

  async updateStatus(id, status) {
    return orderDb.update(id, { status });
  },

  async findAll({ status, limit = 50, offset = 0 } = {}) {
    const filter = status ? { status } : {};
    return (
      await Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
    ).map(toPlain);
  },
};

// ════════════════════════════════════════════════════════════
//  DOCUMENT
// ════════════════════════════════════════════════════════════

const documentDb = {

  async create({ orderId, fileName, mimeType, driveFileId, source = 'WHATSAPP' }) {
    const id  = randomUUID();
    const doc = await Document.create({
      id, orderId, fileName, mimeType,
      driveFileId: driveFileId ?? null,
      source,
    });
    return toPlain(doc);
  },

  async findByOrderId(orderId) {
    return (
      await Document.find({ orderId }).sort({ createdAt: 1 }).lean()
    ).map(toPlain);
  },

  async updateDriveFileId(id, driveFileId) {
    await Document.updateOne({ id }, { $set: { driveFileId } });
  },
};

// ════════════════════════════════════════════════════════════
//  MESSAGE LOG
// ════════════════════════════════════════════════════════════

const messageLogDb = {

  async create({ phone, direction, content, type = 'text' }) {
    const id  = randomUUID();
    const doc = await MessageLog.create({ id, phone, direction, content, type });
    return toPlain(doc);
  },

  async findByPhone(phone, { limit = 100 } = {}) {
    return (
      await MessageLog.find({ phone })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
    ).map(toPlain);
  },

  async findRecent({ limit = 200 } = {}) {
    return (
      await MessageLog.find()
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
    ).map(toPlain);
  },
};

// ════════════════════════════════════════════════════════════
//  EXPORTS — identiques à db.js (Turso)
// ════════════════════════════════════════════════════════════

module.exports = {
  adminDb,
  sessionDb,
  botConfigDb,
  conversationDb,
  orderDb,
  documentDb,
  messageLogDb,
};
