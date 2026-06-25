// routes/orders.js — migré MongoDB
const express  = require('express');
const { requireAuth }                         = require('../middleware/auth');
const { getOrders, updateOrderStatus }        = require('../services/orderService');
const { orderDb, documentDb, conversationDb } = require('../lib/db');

const router = express.Router();
router.use(requireAuth);

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const result = await getOrders({
      page:  parseInt(page),
      limit: parseInt(limit),
      status,
      search,
    });
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  try {
    const order = await orderDb.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande non trouvée' });

    const [documents, conversation] = await Promise.all([
      documentDb.findByOrderId(order.id),
      conversationDb.findById(order.conversationId),
    ]);

    res.json({ ...order, documents, conversation });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/orders/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;

    // ⚠️  'DONE' renommé en 'COMPLETED' pour aligner avec le schema MongoDB.
    //     Si le dashboard envoie encore 'DONE', on le normalise ici
    //     le temps de mettre à jour le frontend.
    const normalized = status === 'DONE' ? 'COMPLETED' : status;

    const allowed = ['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED'];
    if (!allowed.includes(normalized))
      return res.status(400).json({ error: 'Statut invalide' });

    const order = await updateOrderStatus(req.params.id, normalized);
    res.json(order);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
