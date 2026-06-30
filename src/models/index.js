// src/models/index.js
// ──────────────────────────────────────────────────────────────
// Centralise tous les Mongoose models.
// Import unique dans toute l'app :
//   const { Admin, Session, Order, ... } = require('./models')
// ──────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ════════════════════════════════════════════════════════════
//  ADMIN
// ════════════════════════════════════════════════════════════

const AdminSchema = new Schema(
  {
    // On conserve `id` (UUID string) comme champ applicatif
    // pour ne pas casser les routes qui retournent { id } au lieu de { _id }.
    id:       { type: String, required: true, unique: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    name:     { type: String, required: true, trim: true },
  },
  { timestamps: true }   // createdAt + updatedAt gérés par Mongoose
);

// ════════════════════════════════════════════════════════════
//  SESSION
// ════════════════════════════════════════════════════════════

const SessionSchema = new Schema(
  {
    id:        { type: String, required: true, unique: true },
    token:     { type: String, required: true, unique: true, index: true },
    adminId:   { type: String, required: true, index: true },   // UUID string → ref logique
    expiresAt: { type: Date,   required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Index TTL : MongoDB supprime automatiquement les sessions expirées
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ════════════════════════════════════════════════════════════
//  BOT CONFIG
// ════════════════════════════════════════════════════════════

const BotConfigSchema = new Schema(
  {
    id:          { type: String, required: true, unique: true },
    key:         { type: String, required: true, unique: true, index: true },
    value:       { type: String, required: true },
    description: { type: String, default: null },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

// ════════════════════════════════════════════════════════════
//  CONVERSATION
// ════════════════════════════════════════════════════════════

const ConversationSchema = new Schema(
  {
    id:          { type: String, required: true, unique: true },
    phone:       { type: String, required: true, unique: true, index: true },
    state:       {
      type: String,
      enum: ['IDLE', 'COLLECTING', 'WAITING_FORM', 'DONE', 'COLLECT_FIRST_NAME' ],
      default: 'IDLE',
    },
    data:        { type: Schema.Types.Mixed, default: {} },
    startedAt:   { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

// ════════════════════════════════════════════════════════════
//  ORDER
// ════════════════════════════════════════════════════════════

const OrderSchema = new Schema(
  {
    id:             { type: String, required: true, unique: true },
    conversationId: { type: String, required: true, index: true },
    firstName:      { type: String, required: true },
    lastName:       { type: String, required: true },
    phone:          { type: String, required: true },
    email:          { type: String, default: null },
    address:        { type: String, default: null },
    cardType:       {
      type: String,
      enum: ['VISA_CLASSIC', 'VISA_GOLD', 'VISA_BUSINESS'],
      default: 'VISA_CLASSIC',
    },
    extraData:      { type: Schema.Types.Mixed, default: {} },
    status:         {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    driveFolderId:  { type: String, default: null },
    driveFolderUrl: { type: String, default: null },
  },
  { timestamps: true }
);

// ════════════════════════════════════════════════════════════
//  DOCUMENT
// ════════════════════════════════════════════════════════════

const DocumentSchema = new Schema(
  {
    id:          { type: String, required: true, unique: true },
    orderId:     { type: String, required: true, index: true },
    fileName:    { type: String, required: true },
    mimeType:    { type: String, required: true },
    driveFileId: { type: String, default: null },
    source:      {
      type: String,
      enum: ['WHATSAPP', 'UPLOAD', 'EMAIL'],
      default: 'WHATSAPP',
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// ════════════════════════════════════════════════════════════
//  MESSAGE LOG
// ════════════════════════════════════════════════════════════

const MessageLogSchema = new Schema(
  {
    id:        { type: String, required: true, unique: true },
    phone:     { type: String, required: true, index: true },
    direction: { type: String, enum: ['IN', 'OUT'], required: true },
    content:   { type: String, required: true },
    type:      { type: String, enum: ['text', 'image', 'document', 'audio'], default: 'text' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Index compound pour requêtes fréquentes
MessageLogSchema.index({ phone: 1, createdAt: -1 });

// ════════════════════════════════════════════════════════════
//  EXPORTS
// ════════════════════════════════════════════════════════════

module.exports = {
  Admin:       mongoose.model('Admin',       AdminSchema),
  Session:     mongoose.model('Session',     SessionSchema),
  BotConfig:   mongoose.model('BotConfig',   BotConfigSchema),
  Conversation:mongoose.model('Conversation',ConversationSchema),
  Order:       mongoose.model('Order',       OrderSchema),
  Document:    mongoose.model('Document',    DocumentSchema),
  MessageLog:  mongoose.model('MessageLog',  MessageLogSchema),
};
