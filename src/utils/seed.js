require('dotenv').config();
const bcrypt = require('bcryptjs');
const { prisma } = require('./database');
const logger = require('./logger');

const DEFAULT_BOT_CONFIG = [
  {
    key: 'welcome_message',
    value: 'Bonjour ! 👋 Bienvenue chez *UBA*.\n\nJe suis votre assistant virtuel pour la commande de cartes Visa.\n\nTapez *COMMENCER* pour démarrer votre demande.',
    description: 'Message de bienvenue envoyé au premier contact',
  },
  {
    key: 'card_types',
    value: JSON.stringify([
      { id: 'VISA_CLASSIC', label: 'Visa Classic', price: '15 000 GNF' },
      { id: 'VISA_GOLD', label: 'Visa Gold', price: '25 000 GNF' },
      { id: 'VISA_BUSINESS', label: 'Visa Business', price: '35 000 GNF' },
    ]),
    description: 'Types de cartes disponibles (JSON)',
  },
  {
    key: 'form_url',
    value: process.env.FORM_URL || 'http://localhost:3002',
    description: 'URL du formulaire client',
  },
  {
    key: 'bot_active',
    value: 'true',
    description: 'Active ou désactive le bot (true/false)',
  },
  {
    key: 'notify_email',
    value: process.env.NOTIFY_EMAIL || 'responsable@uba.com',
    description: 'Email de notification pour les nouvelles commandes',
  },
  {
    key: 'closing_message',
    value: 'Merci pour votre commande ! ✅\n\nVotre dossier a bien été enregistré. Notre équipe vous contactera dans les *48h* ouvrables.\n\nPour toute question, répondez à ce message.',
    description: 'Message de clôture après commande complète',
  },
];

async function seed() {
  logger.info('Démarrage du seed...');

  // Créer l'admin par défaut
  const existingAdmin = await prisma.admin.findUnique({
    where: { email: process.env.ADMIN_EMAIL || 'admin@uba.com' },
  });

  if (!existingAdmin) {
    const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@2024!', 12);
    await prisma.admin.create({
      data: {
        email: process.env.ADMIN_EMAIL || 'admin@uba.com',
        password: hashed,
        name: process.env.ADMIN_NAME || 'Administrateur UBA',
      },
    });
    logger.info(`Admin créé: ${process.env.ADMIN_EMAIL || 'admin@uba.com'}`);
  } else {
    logger.info('Admin déjà existant, ignoré');
  }

  // Créer la config par défaut
  for (const config of DEFAULT_BOT_CONFIG) {
    await prisma.botConfig.upsert({
      where: { key: config.key },
      update: {},
      create: config,
    });
  }
  logger.info('Configuration bot initialisée');

  logger.info('Seed terminé avec succès ✅');
  await prisma.$disconnect();
}

seed().catch((err) => {
  logger.error('Erreur seed:', err);
  process.exit(1);
});
