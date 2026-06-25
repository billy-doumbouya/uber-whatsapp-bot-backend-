// routes/form.js — migré Turso
const express  = require('express');
const multer   = require('multer');
const { createOrderFromForm }  = require('../services/orderService');
const { conversationDb }       = require('../lib/db');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Seuls les fichiers JPEG, PNG, WEBP et PDF sont acceptés'));
  },
});

// GET /api/form/prefill?conv=xxx
router.get('/prefill', async (req, res) => {
  try {
    const { conv } = req.query;
    if (!conv) return res.json({});

    // prisma.conversation.findUnique({ where: { id: conv } })
    const conversation = await conversationDb.findById(conv);
    if (!conversation) return res.json({});

    // data est déjà désérialisé par le DAO (JSON.parse fait dans findById)
    const data = conversation.data;
    res.json({
      firstName: data.firstName || '',
      lastName:  data.lastName  || '',
      phone:     data.phone     || '',
      email:     data.email     || '',
      address:   data.address   || '',
      cardType:  data.cardType  || 'VISA_CLASSIC',
    });
  } catch {
    res.json({});
  }
});

// POST /api/form/submit
router.post('/submit', upload.array('documents', 5), async (req, res) => {
  try {
    const { firstName, lastName, phone, email, address, cardType, convId } = req.body;
    if (!firstName || !lastName || !phone)
      return res.status(400).json({ error: 'Prénom, nom et téléphone sont requis' });

    const order = await createOrderFromForm(
      { firstName, lastName, phone, email, address, cardType, convId },
      req.files || []
    );
    res.json({ ok: true, orderId: order.id, message: 'Votre dossier a été créé avec succès.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de votre dossier' });
  }
});

module.exports = router;