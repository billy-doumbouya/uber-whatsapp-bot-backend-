const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getSock } = require('../bot/whatsappClient');

const router = express.Router();
router.use(requireAuth);

// GET /api/whatsapp/status - Statut de la connexion WhatsApp
router.get('/status', (req, res) => {
  const sock = getSock();
  const connected = sock && sock.user ? true : false;
  res.json({
    connected,
    phone: sock?.user?.id?.replace(':0@s.whatsapp.net', '') || null,
    name: sock?.user?.name || null,
  });
});

// POST /api/whatsapp/logout - Déconnecter le compte WhatsApp
router.post('/logout', async (req, res) => {
  try {
    const sock = getSock();
    if (sock) {
      await sock.logout();
    }
    res.json({ ok: true, message: 'Déconnecté. Scanner le QR code pour reconnecter.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la déconnexion' });
  }
});

module.exports = router;
