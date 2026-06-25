// src/bot/messageHandler.js — migré MongoDB
// ──────────────────────────────────────────────────────────────
// Remplace toutes les API Prisma native par la couche db.mongo :
//   prisma.conversation.*  → conversationDb.*
//   prisma.messageLog.*    → messageLogDb.*
// ──────────────────────────────────────────────────────────────

const { conversationDb, messageLogDb } = require('../lib/db');
const { STATES, COLLECT_STEPS }        = require('./states');
const { getBotConfig }                 = require('../services/configService');
const { createOrderFromConversation }  = require('../services/orderService');
const logger                           = require('../utils/logger');

// ─── Helpers Baileys ────────────────────────────────────────

function extractText(message) {
  const msg = message.message;
  if (!msg) return '';
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.documentMessage?.caption ||
    ''
  ).trim();
}

function extractPhone(jid) {
  return jid.replace('@s.whatsapp.net', '').replace('@c.us', '');
}

async function isBotActive() {
  const config = await getBotConfig('bot_active');
  return config === 'true';
}

// ─── Point d'entrée principal ────────────────────────────────

async function handleMessage(sock, message) {
  const jid     = message.key.remoteJid;
  const phone   = extractPhone(jid);
  const text    = extractText(message);
  const isMedia = !!(
    message.message?.imageMessage ||
    message.message?.documentMessage
  );

  logger.info({ phone, text, isMedia }, 'Message reçu');

  // Log du message entrant
  await messageLogDb.create({
    phone,
    direction: 'IN',
    content:   text || '[media]',
    type:      isMedia ? 'image' : 'text',
  });

  if (!(await isBotActive())) {
    logger.info('Bot inactif, message ignoré');
    return;
  }

  // Récupérer ou créer la conversation
  // conversationDb.upsert fait un INSERT ... ON CONFLICT (phone) DO UPDATE
  // → idempotent, remplace prisma.conversation.findUnique + create
  let conv = await conversationDb.findByPhone(phone);
  if (!conv) {
    conv = await conversationDb.upsert({ phone, state: STATES.IDLE, data: {} });
  }

  // `data` est déjà un objet JS (conversationDb désérialise le JSON automatiquement)
  const convData = conv.data ?? {};

  // ── ROUTING PAR ÉTAT ──────────────────────────────────────

  if (conv.state === STATES.IDLE || conv.state === STATES.COMPLETED) {
    const trigger = text.toLowerCase();
    if (
      trigger.includes('commencer') ||
      trigger.includes('bonjour')   ||
      trigger.includes('salut')     ||
      trigger.includes('visa')      ||
      trigger.includes('carte')     ||
      trigger.includes('hello')     ||
      trigger.includes('start')     ||
      conv.state === STATES.IDLE
    ) {
      return await startConversation(phone, conv, sock);
    }
    const closing = await getBotConfig('closing_message');
    return await reply(phone, `Votre commande est déjà enregistrée. ✅\n\nPour une nouvelle commande, tapez *COMMENCER*.\n\n${closing}`);
  }

  if (conv.state === STATES.AWAIT_DOCUMENTS) {
    return await handleDocumentUpload(phone, conv, message, isMedia, text, sock);
  }

  const step = COLLECT_STEPS.find((s) => s.state === conv.state);
  if (step) {
    return await handleCollectStep(phone, conv, convData, step, text, sock);
  }

  if (conv.state === STATES.SEND_FORM_LINK) {
    return await handleFormLinkState(phone, conv, convData, text, sock);
  }

  await reply(phone, 'Désolé, je n\'ai pas compris. Tapez *COMMENCER* pour recommencer.');
}

// ─── Démarrer la conversation ────────────────────────────────

async function startConversation(phone, conv, sock) {
  const welcome   = await getBotConfig('welcome_message');
  await reply(phone, welcome);

  const firstStep = COLLECT_STEPS[0];
  await updateConversation(conv.id, firstStep.state, {});
  await reply(phone, firstStep.question);
}

// ─── Étape de collecte ───────────────────────────────────────

async function handleCollectStep(phone, conv, convData, step, text, sock) {
  if (step.validate && !step.validate(text)) {
    if (step.optional && text.toLowerCase() === 'passer') {
      convData[step.field] = null;
    } else {
      return await reply(phone, step.errorMsg || '❌ Valeur invalide, veuillez réessayer.');
    }
  } else {
    const value = step.transform ? step.transform(text) : text;
    if (value === null) {
      return await reply(phone, step.errorMsg || '❌ Valeur invalide, veuillez réessayer.');
    }
    convData[step.field] = value;
  }

  await updateConversation(conv.id, step.next, convData);

  if (step.next === STATES.SEND_FORM_LINK) {
    return await sendFormLink(phone, conv.id, convData);
  }

  const nextStep = COLLECT_STEPS.find((s) => s.state === step.next);
  if (nextStep) {
    await reply(phone, nextStep.question);
  }
}

// ─── Envoi du lien formulaire ────────────────────────────────

async function sendFormLink(phone, convId, convData) {
  const formBaseUrl = await getBotConfig('form_url');
  const formUrl     = `${formBaseUrl}?conv=${convId}`;

  const msg =
    `✅ Parfait ! Voici un récapitulatif de vos informations :\n\n` +
    `👤 Prénom : *${convData.firstName}*\n` +
    `👤 Nom : *${convData.lastName}*\n` +
    `📱 Tél. carte : *${convData.phone}*\n` +
    `📧 Email : *${convData.email || 'Non renseigné'}*\n` +
    `🏠 Adresse : *${convData.address}*\n` +
    `💳 Carte : *${convData.cardType}*\n\n` +
    `Pour finaliser votre commande, veuillez compléter le formulaire et *joindre vos pièces justificatives* (pièce d'identité recto/verso) :\n\n` +
    `🔗 ${formUrl}\n\n` +
    `_Vous pouvez aussi envoyer directement vos photos ici sur WhatsApp après avoir rempli le formulaire._`;

  await reply(phone, msg);
}

// ─── État SEND_FORM_LINK ─────────────────────────────────────

async function handleFormLinkState(phone, conv, convData, text, sock) {
  const lower = text.toLowerCase();
  if (lower.includes('ok') || lower.includes('fait') || lower.includes('envoy')) {
    await updateConversation(conv.id, STATES.AWAIT_DOCUMENTS, convData);
    await reply(
      phone,
      '📎 Parfait ! Envoyez maintenant vos *pièces justificatives* directement ici (photos de votre pièce d\'identité recto et verso).\n\nTapez *TERMINER* quand vous avez tout envoyé.'
    );
  } else {
    const formBaseUrl = await getBotConfig('form_url');
    const formUrl     = `${formBaseUrl}?conv=${conv.id}`;
    await reply(phone, `Avez-vous complété le formulaire ? 🔗 ${formUrl}\n\nRépondez *OK* quand c'est fait.`);
  }
}

// ─── Réception des documents ─────────────────────────────────

async function handleDocumentUpload(phone, conv, message, isMedia, text, sock) {
  if (text.toLowerCase() === 'terminer') {
    return await finalizeOrder(phone, conv);
  }

  if (isMedia) {
    // conv.data est déjà un objet JS — pas besoin de JSON.parse
    const convData = { ...(conv.data ?? {}) };
    if (!convData.pendingMedia) convData.pendingMedia = [];
    convData.pendingMedia.push({
      messageId: message.key.id,
      type:      message.message?.imageMessage ? 'image' : 'document',
      timestamp: Date.now(),
    });
    await updateConversation(conv.id, STATES.AWAIT_DOCUMENTS, convData);
    await reply(phone, '📎 Document reçu ✅\n\nEnvoyez d\'autres pièces ou tapez *TERMINER* pour finaliser.');
  } else {
    await reply(phone, 'Merci ! Envoyez vos photos ou tapez *TERMINER* pour finaliser votre dossier.');
  }
}

// ─── Finalisation de la commande ─────────────────────────────

async function finalizeOrder(phone, conv) {
  await reply(phone, '⏳ Création de votre dossier en cours...');

  try {
    // conv.data est un objet JS — createOrderFromConversation l'accepte tel quel
    const order      = await createOrderFromConversation(conv);
    const closingMsg = await getBotConfig('closing_message');

    // Marquer la conversation comme terminée
    // conversationDb.complete() fait : state = 'DONE', completedAt = now()
    await conversationDb.complete(phone);

    await reply(phone, closingMsg || '✅ Votre dossier a été créé avec succès ! Notre équipe vous contactera bientôt.');
    logger.info({ orderId: order.id, phone }, 'Commande créée avec succès');
  } catch (err) {
    logger.error({ err, phone }, 'Erreur création commande');
    await reply(
      phone,
      '❌ Une erreur est survenue lors de la création de votre dossier. Notre équipe va vous contacter manuellement.'
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────

async function reply(phone, text) {
  try {
    const { sendMessage } = require('./whatsappClient');
    await sendMessage(phone, text);
    await messageLogDb.create({ phone, direction: 'OUT', content: text, type: 'text' });
  } catch (err) {
    logger.error({ err, phone }, 'Erreur envoi message');
  }
}

// Remplace prisma.conversation.update({ where: { id }, data: { state, data } })
// conversationDb.update(phone) n'existe qu'avec phone comme clé —
// on passe par upsert via phone pour les updates intermédiaires,
// mais on a besoin du phone ici. On enrichit en récupérant la conv par id.
async function updateConversation(id, state, data, completedAt = null) {
  // Récupérer le phone depuis l'id (nécessaire car conversationDb.update() prend phone)
  const conv = await conversationDb.findById(id);
  if (!conv) {
    logger.warn(`updateConversation: conversation ${id} introuvable`);
    return;
  }

  if (completedAt) {
    // complete() gère state = 'DONE' + completedAt
    await conversationDb.complete(conv.phone);
  } else {
    await conversationDb.update(conv.phone, { state, data });
  }
}

module.exports = { handleMessage };
