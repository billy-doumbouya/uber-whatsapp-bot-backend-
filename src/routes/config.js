const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getAllBotConfig, setBotConfig } = require('../services/configService');

const router = express.Router();
router.use(requireAuth);

// GET /api/config - Toute la config du bot
router.get('/', async (req, res) => {
  try {
    const config = await getAllBotConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/config/:key - Modifier une valeur de config
router.put('/:key', async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: 'Valeur requise' });
    }
    const updated = await setBotConfig(req.params.key, String(value));
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/config - Modifier plusieurs valeurs en une fois
router.put('/', async (req, res) => {
  try {
    const updates = req.body; // { key: value, key2: value2 }
    const results = [];
    for (const [key, value] of Object.entries(updates)) {
      const updated = await setBotConfig(key, String(value));
      results.push(updated);
    }
    res.json({ ok: true, updated: results.length });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
