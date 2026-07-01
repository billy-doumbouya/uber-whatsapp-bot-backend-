// src/bot/messageHandler.js — ajout de provide_form_link (lien à la demande)

const { conversationDb, messageLogDb } = require("../lib/db");
const { getBotConfig } = require("../services/configService");
const { runAI } = require("../services/aiService");
const { createOrderFromConversation } = require("../services/orderService");
const logger = require("../utils/logger");

const REQUIRED_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "address",
  "cardType",
];

function extractText(message) {
  const msg = message.message;
  if (!msg) return "";
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.documentMessage?.caption ||
    ""
  ).trim();
}

function extractPhone(jid) {
  return jid.replace("@s.whatsapp.net", "").replace("@c.us", "");
}

async function isBotActive() {
  const config = await getBotConfig("bot_active");
  return config === "true";
}

async function handleMessage(sock, message) {
  const jid = message.key.remoteJid;
  const phone = extractPhone(jid);
  const text = extractText(message);
  const isMedia = !!(
    message.message?.imageMessage || message.message?.documentMessage
  );

  logger.info({ phone, text, isMedia }, "Message reçu");

  await messageLogDb.create({
    phone,
    direction: "IN",
    content: text || "[media]",
    type: isMedia ? "image" : "text",
  });

  if (!(await isBotActive())) {
    logger.info("Bot inactif, message ignoré");
    return;
  }

  let conv = await conversationDb.findByPhone(phone);
  if (!conv) {
    conv = await conversationDb.upsert({
      phone,
      state: "IN_PROGRESS",
      data: { collectedFields: {} },
    });
  }

  if (conv.state === "AWAIT_DOCUMENTS") {
    return handleDocumentUpload(phone, conv, message, isMedia, text);
  }

  if (isMedia) {
    return reply(
      phone,
      "Je note bien votre pièce jointe 📎 — terminons d'abord vos informations ensemble, je vous guiderai ensuite pour l'envoi des documents.",
    );
  }

  return runConversationTurn(phone, conv);
}

async function runConversationTurn(phone, conv) {
  const { text: aiText, calls } = await runAI(phone, conv);

  const data = conv.data || {};
  data.collectedFields = data.collectedFields || {};

  let readyForDocuments = false;
  let linkRequested = false;

  for (const call of calls) {
    if (call.name === "update_customer_info") {
      Object.assign(data.collectedFields, sanitizeFields(call.args));
    }
    if (call.name === "provide_form_link") linkRequested = true;
    if (call.name === "request_documents") readyForDocuments = true;
  }

  if (aiText) await reply(phone, aiText);

  if (readyForDocuments && hasRequiredFields(data.collectedFields)) {
    await sendFormLinkWithRecap(phone, conv.id, data.collectedFields);
    await conversationDb.update(phone, { state: "AWAIT_DOCUMENTS", data });
    return;
  }

  if (linkRequested) {
    await sendRawFormLink(phone, conv.id);
  }

  await conversationDb.update(phone, { state: "IN_PROGRESS", data });
}

function sanitizeFields(args) {
  const out = {};
  for (const f of [
    "firstName",
    "lastName",
    "phone",
    "email",
    "address",
    "cardType",
  ]) {
    if (args?.[f]) out[f] = args[f];
  }
  return out;
}

function hasRequiredFields(fields) {
  return REQUIRED_FIELDS.every((f) => fields[f]);
}

async function buildFormUrl(convId) {
  const formBaseUrl = await getBotConfig("form_url");
  return `${formBaseUrl}?conv=${convId}`;
}

// Lien donné sur demande, avant que toutes les infos soient réunies.
async function sendRawFormLink(phone, convId) {
  const formUrl = await buildFormUrl(convId);
  await reply(phone, `🔗 Voici le lien du formulaire : ${formUrl}`);
}

// Lien + récapitulatif complet, une fois la collecte terminée.
async function sendFormLinkWithRecap(phone, convId, fields) {
  const formUrl = await buildFormUrl(convId);
  const msg =
    `✅ Merci ! Voici le récapitulatif :\n\n` +
    `👤 ${fields.firstName} ${fields.lastName}\n` +
    `📱 ${fields.phone}\n` +
    `📧 ${fields.email || "Non renseigné"}\n` +
    `🏠 ${fields.address}\n` +
    `💳 ${fields.cardType}\n\n` +
    `Pour finaliser, complétez le formulaire et joignez vos pièces justificatives :\n\n🔗 ${formUrl}\n\n` +
    `_Vous pouvez aussi envoyer vos photos directement ici sur WhatsApp._\n\n` +
    `Tapez *TERMINER* une fois vos documents envoyés.`;
  await reply(phone, msg);
}

async function handleDocumentUpload(phone, conv, message, isMedia, text) {
  if (text.trim().toLowerCase() === "terminer") {
    return finalizeOrder(phone, conv);
  }

  if (isMedia) {
    const data = { ...(conv.data ?? {}) };
    data.pendingMedia = data.pendingMedia || [];
    data.pendingMedia.push({
      messageId: message.key.id,
      type: message.message?.imageMessage ? "image" : "document",
      timestamp: Date.now(),
    });
    await conversationDb.update(phone, { state: "AWAIT_DOCUMENTS", data });
    await reply(
      phone,
      "📎 Document reçu ✅\n\nEnvoyez d'autres pièces ou tapez *TERMINER* pour finaliser.",
    );
  } else {
    await reply(
      phone,
      "Merci ! Envoyez vos photos ou tapez *TERMINER* pour finaliser votre dossier.",
    );
  }
}

async function finalizeOrder(phone, conv) {
  await reply(phone, "⏳ Création de votre dossier en cours...");

  try {
    const order = await createOrderFromConversation({
      ...conv,
      data: { ...conv.data, ...conv.data.collectedFields },
    });
    const closingMsg = await getBotConfig("closing_message");

    await conversationDb.complete(phone);

    await reply(
      phone,
      closingMsg ||
        "✅ Votre dossier a été créé avec succès ! Notre équipe vous contactera bientôt.",
    );
    logger.info({ orderId: order.id, phone }, "Commande créée avec succès");
  } catch (err) {
    logger.error({ err, phone }, "Erreur création commande");
    await reply(
      phone,
      "❌ Une erreur est survenue lors de la création de votre dossier. Notre équipe va vous contacter manuellement.",
    );
  }
}

async function reply(phone, text) {
  try {
    const { sendMessage } = require("./whatsappClient");
    await sendMessage(phone, text);
    await messageLogDb.create({
      phone,
      direction: "OUT",
      content: text,
      type: "text",
    });
  } catch (err) {
    logger.error({ err, phone }, "Erreur envoi message");
  }
}

module.exports = { handleMessage };
