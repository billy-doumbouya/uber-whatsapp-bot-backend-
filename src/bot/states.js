// États de la machine à états du bot
// Chaque état définit quoi demander et vers quel état aller ensuite

const STATES = {
  IDLE: 'IDLE',
  GREETING: 'GREETING',
  COLLECT_FIRST_NAME: 'COLLECT_FIRST_NAME',
  COLLECT_LAST_NAME: 'COLLECT_LAST_NAME',
  COLLECT_PHONE: 'COLLECT_PHONE',
  COLLECT_EMAIL: 'COLLECT_EMAIL',
  COLLECT_ADDRESS: 'COLLECT_ADDRESS',
  COLLECT_CARD_TYPE: 'COLLECT_CARD_TYPE',
  SEND_FORM_LINK: 'SEND_FORM_LINK',
  AWAIT_DOCUMENTS: 'AWAIT_DOCUMENTS',
  COMPLETED: 'COMPLETED',
};

// Ordre des étapes de collecte via WhatsApp
const COLLECT_STEPS = [
  {
    state: STATES.COLLECT_FIRST_NAME,
    field: 'firstName',
    question: '👤 Quel est votre *prénom* ?',
    next: STATES.COLLECT_LAST_NAME,
  },
  {
    state: STATES.COLLECT_LAST_NAME,
    field: 'lastName',
    question: '👤 Quel est votre *nom de famille* ?',
    next: STATES.COLLECT_PHONE,
  },
  {
    state: STATES.COLLECT_PHONE,
    field: 'phone',
    question: '📱 Quel numéro de téléphone souhaitez-vous associer à votre carte ?\n_(Entrez le numéro avec indicatif, ex: +224 621 000 000)_',
    next: STATES.COLLECT_EMAIL,
    validate: (val) => /^\+?[\d\s\-]{8,15}$/.test(val.replace(/\s/g, '')),
    errorMsg: '❌ Numéro invalide. Veuillez entrer un numéro valide (ex: +224 621 000 000)',
  },
  {
    state: STATES.COLLECT_EMAIL,
    field: 'email',
    question: '📧 Quelle est votre adresse *email* ? _(Tapez "passer" si vous n\'en avez pas)_',
    next: STATES.COLLECT_ADDRESS,
    optional: true,
  },
  {
    state: STATES.COLLECT_ADDRESS,
    field: 'address',
    question: '🏠 Quelle est votre *adresse complète* ?',
    next: STATES.COLLECT_CARD_TYPE,
  },
  {
    state: STATES.COLLECT_CARD_TYPE,
    field: 'cardType',
    question: '💳 Quel type de carte souhaitez-vous ?\n\n1️⃣ Visa Classic - 15 000 GNF\n2️⃣ Visa Gold - 25 000 GNF\n3️⃣ Visa Business - 35 000 GNF\n\n_Répondez avec le numéro (1, 2 ou 3)_',
    next: STATES.SEND_FORM_LINK,
    transform: (val) => {
      const map = { '1': 'VISA_CLASSIC', '2': 'VISA_GOLD', '3': 'VISA_BUSINESS' };
      return map[val.trim()] || null;
    },
    validate: (val) => ['1', '2', '3'].includes(val.trim()),
    errorMsg: '❌ Choix invalide. Veuillez répondre avec *1*, *2* ou *3*.',
  },
];

module.exports = { STATES, COLLECT_STEPS };
