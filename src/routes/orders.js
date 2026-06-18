const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getOrders, updateOrderStatus } = require('../services/orderService');
const { prisma } = require('../utils/database');

const router = express.Router();

// Toutes les routes nécessitent une auth
router.use(requireAuth);

// GET /api/orders - Lister les commandes
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const result = await getOrders({
      page: parseInt(page),
      limit: parseInt(limit),
      status,
      search,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/orders/:id - Détail d'une commande
router.get('/:id', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { documents: true, conversation: true },
    });
    if (!order) return res.status(404).json({ error: 'Commande non trouvée' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/orders/:id/status - Mettre à jour le statut
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['PENDING', 'PROCESSING', 'DONE', 'CANCELLED'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }
    const order = await updateOrderStatus(req.params.id, status);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
