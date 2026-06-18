const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const path = require('path');
const { handleMessage } = require('./messageHandler');
const logger = require('../utils/logger');

// Dossier de persistance des credentials WhatsApp
// Sur Railway, monter un volume sur /data
const AUTH_FOLDER = path.join(process.env.AUTH_PATH || '/data/wa_auth');

let sock = null;
let io = null;

async function initBot(socketIo) {
  io = socketIo;
  await connect();
}

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: logger.child({ module: 'baileys' }),
    browser: ['UBA Bot', 'Chrome', '1.0.0'],
    syncFullHistory: false,
  });

  // Sauvegarder les credentials à chaque mise à jour
  sock.ev.on('creds.update', saveCreds);

  // Gestion de la connexion
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Envoyer le QR code au dashboard via Socket.IO
    if (qr && io) {
      require('qrcode').toDataURL(qr, (err, url) => {
        if (!err) {
          io.emit('whatsapp:qr', { qr: url });
          logger.info('QR code émis vers le dashboard');
        }
      });
    }

    if (connection === 'open') {
      logger.info('WhatsApp connecté avec succès ✅');
      if (io) io.emit('whatsapp:status', { status: 'connected' });
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      logger.warn(`WhatsApp déconnecté. Reconnexion: ${shouldReconnect}`);
      if (io) io.emit('whatsapp:status', { status: 'disconnected' });

      if (shouldReconnect) {
        // Reconnexion avec délai exponentiel simple
        setTimeout(connect, 5000);
      } else {
        logger.error('Session expirée - scanner à nouveau le QR code');
        if (io) io.emit('whatsapp:status', { status: 'logged_out' });
      }
    }
  });

  // Écouter les messages entrants
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      // Ignorer nos propres messages
      if (message.key.fromMe) continue;
      // Ignorer les messages de groupe
      if (message.key.remoteJid.endsWith('@g.us')) continue;

      try {
        await handleMessage(sock, message);
      } catch (err) {
        logger.error('Erreur traitement message:', err);
      }
    }
  });
}

function getSock() {
  return sock;
}

async function sendMessage(phone, text) {
  if (!sock) throw new Error('Bot WhatsApp non connecté');
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text });
}

async function sendImage(phone, buffer, caption) {
  if (!sock) throw new Error('Bot WhatsApp non connecté');
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  await sock.sendMessage(jid, { image: buffer, caption });
}

module.exports = { initBot, getSock, sendMessage, sendImage };
