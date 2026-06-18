const { prisma } = require('../utils/database');
const { STATES, COLLECT_STEPS } = require('./states');
const { getBotConfig } = require('../services/configService');
const { createOrderFromConversation } = require('../services/orderService');
const { sendMessage } = require('./whatsappClient');
const logger = require('../utils/logger');

// Extraire le texte brut d'un message Baileys
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

// Extraire le numéro de téléphone propre depuis le JID Baileys
function extractPhone(jid) {
  return jid.replace('@s.whatsapp.net', '').replace('@c.us', '');
}

// Vérifier si le bot est actif
async function isBotActive() {
  const config = await getBotConfig('bot_active');
  return config === 'true';
}

// Point d'entrée principal pour chaque message reçu
async function handleMessage(sock, message) {
  const jid = message.key.remoteJid;
  const phone = extractPhone(jid);
  const text = extractText(message);
  const isMedia = !!(
    message.message?.imageMessage ||
    message.message?.documentMessage
  );

  logger.info({ phone, text, isMedia }, 'Message reçu');

  // Log en base
  await prisma.messageLog.create({
    data: {
      phone,
      direction: 'IN',
      content: text || '[media]',
      type: isMedia ? 'image' : 'text',
    },
  });

  // Vérifier si le bot est actif
  if (!(await isBotActive())) {
    logger.info('Bot inactif, message ignoré');
    return;
  }

  // Récupérer ou créer la conversation
  let conv = await prisma.conversation.findUnique({ where: { phone } });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: { phone, state: STATES.IDLE, data: '{}' },
    });
  }

  const convData = JSON.parse(conv.data);

  // --- ROUTING PAR ÉTAT ---

  // État IDLE ou COMPLETED : accueillir si l'utilisateur écrit
  if (conv.state === STATES.IDLE || conv.state === STATES.COMPLETED) {
    const trigger = text.toLowerCase();
    if (
      trigger.includes('commencer') ||
      trigger.includes('bonjour') ||
      trigger.includes('salut') ||
      trigger.includes('visa') ||
      trigger.includes('carte') ||
      trigger.includes('hello') ||
      trigger.includes('start') ||
      conv.state === STATES.IDLE
    ) {
      return await startConversation(phone, conv, sock);
    }
    // Message quelconque sur une conv terminée
    const closing = await getBotConfig('closing_message');
    return await reply(phone, `Votre commande est déjà enregistrée. ✅\n\nPour une nouvelle commande, tapez *COMMENCER*.\n\n${closing}`);
  }

  // État AWAIT_DOCUMENTS : recevoir les pièces jointes
  if (conv.state === STATES.AWAIT_DOCUMENTS) {
    return await handleDocumentUpload(phone, conv, message, isMedia, text, sock);
  }

  // États de collecte des informations
  const step = COLLECT_STEPS.find((s) => s.state === conv.state);
  if (step) {
    return await handleCollectStep(phone, conv, convData, step, text, sock);
  }

  // État SEND_FORM_LINK : attendre confirmation
  if (conv.state === STATES.SEND_FORM_LINK) {
    return await handleFormLinkState(phone, conv, convData, text, sock);
  }

  // Fallback
  await reply(phone, 'Désolé, je n\'ai pas compris. Tapez *COMMENCER* pour recommencer.');
}

// Démarrer la conversation : envoyer le message de bienvenue
async function startConversation(phone, conv, sock) {
  const welcome = await getBotConfig('welcome_message');
  await reply(phone, welcome);

  const firstStep = COLLECT_STEPS[0];
  await updateConversation(conv.id, firstStep.state, {});
  await reply(phone, firstStep.question);
}

// Traiter une étape de collecte
async function handleCollectStep(phone, conv, convData, step, text, sock) {
  // Valider si une règle de validation existe
  if (step.validate && !step.validate(text)) {
    // Champ optionnel : accepter "passer"
    if (step.optional && text.toLowerCase() === 'passer') {
      convData[step.field] = null;
    } else {
      return await reply(phone, step.errorMsg || '❌ Valeur invalide, veuillez réessayer.');
    }
  } else {
    // Transformer la valeur si nécessaire
    const value = step.transform ? step.transform(text) : text;
    if (value === null) {
      return await reply(phone, step.errorMsg || '❌ Valeur invalide, veuillez réessayer.');
    }
    convData[step.field] = value;
  }

  // Passer à l'étape suivante
  await updateConversation(conv.id, step.next, convData);

  // Si l'étape suivante est l'envoi du lien formulaire
  if (step.next === STATES.SEND_FORM_LINK) {
    return await sendFormLink(phone, conv.id, convData);
  }

  // Sinon poser la prochaine question
  const nextStep = COLLECT_STEPS.find((s) => s.state === step.next);
  if (nextStep) {
    await reply(phone, nextStep.question);
  }
}

// Envoyer le lien vers le formulaire complet
async function sendFormLink(phone, convId, convData) {
  const formBaseUrl = await getBotConfig('form_url');
  const formUrl = `${formBaseUrl}?conv=${convId}`;

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

// État intermédiaire après envoi du lien
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
    const formUrl = `${formBaseUrl}?conv=${conv.id}`;
    await reply(phone, `Avez-vous complété le formulaire ? 🔗 ${formUrl}\n\nRépondez *OK* quand c'est fait.`);
  }
}

// Recevoir les documents / photos WhatsApp
async function handleDocumentUpload(phone, conv, message, isMedia, text, sock) {
  if (text.toLowerCase() === 'terminer') {
    return await finalizeOrder(phone, conv);
  }

  if (isMedia) {
    // Stocker une référence (le téléchargement réel se fait dans orderService)
    const convData = JSON.parse(conv.data);
    if (!convData.pendingMedia) convData.pendingMedia = [];
    convData.pendingMedia.push({
      messageId: message.key.id,
      type: message.message?.imageMessage ? 'image' : 'document',
      timestamp: Date.now(),
    });
    await updateConversation(conv.id, STATES.AWAIT_DOCUMENTS, convData);
    await reply(phone, '📎 Document reçu ✅\n\nEnvoyez d\'autres pièces ou tapez *TERMINER* pour finaliser.');
  } else {
    await reply(phone, 'Merci ! Envoyez vos photos ou tapez *TERMINER* pour finaliser votre dossier.');
  }
}

// Finaliser la commande et créer le dossier Google Drive
async function finalizeOrder(phone, conv) {
  await reply(phone, '⏳ Création de votre dossier en cours...');

  try {
    const order = await createOrderFromConversation(conv);
    const closingMsg = await getBotConfig('closing_message');

    await updateConversation(conv.id, STATES.COMPLETED, JSON.parse(conv.data), new Date());

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

// Helpers
async function reply(phone, text) {
  try {
    const { sendMessage } = require('./whatsappClient');
    await sendMessage(phone, text);
    await prisma.messageLog.create({
      data: { phone, direction: 'OUT', content: text, type: 'text' },
    });
  } catch (err) {
    logger.error({ err, phone }, 'Erreur envoi message');
  }
}

async function updateConversation(id, state, data, completedAt = null) {
  await prisma.conversation.update({
    where: { id },
    data: {
      state,
      data: JSON.stringify(data),
      ...(completedAt ? { completedAt } : {}),
    },
  });
}

module.exports = { handleMessage };
