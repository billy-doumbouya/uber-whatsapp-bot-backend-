// routes/stats.js — migré MongoDB
const express         = require('express');
const { requireAuth } = require('../middleware/auth');
const { Order, Conversation } = require('../models');

const router = express.Router();
router.use(requireAuth);

// GET /api/stats
router.get('/', async (req, res) => {
  try {
    const now   = new Date();
    const ago24h = new Date(now - 1 * 24 * 60 * 60 * 1000);
    const ago7d  = new Date(now - 7 * 24 * 60 * 60 * 1000);

    // ── Tous les counts en parallèle ─────────────────────────
    const [
      totalOrders,
      pendingOrders,
      processingOrders,
      doneOrders,
      cancelledOrders,
      totalConversations,
      activeConversations,
      recentOrders,
      ordersPerDayRaw,
    ] = await Promise.all([

      // 0 — total orders
      Order.countDocuments(),

      // 1 — pending
      Order.countDocuments({ status: 'PENDING' }),

      // 2 — processing
      Order.countDocuments({ status: 'PROCESSING' }),

      // 3 — done / completed
      Order.countDocuments({ status: 'COMPLETED' }),

      // 4 — cancelled
      Order.countDocuments({ status: 'CANCELLED' }),

      // 5 — total conversations
      Conversation.countDocuments(),

      // 6 — conversations actives (hors IDLE/DONE, updatedAt < 24h)
      Conversation.countDocuments({
        state:     { $nin: ['IDLE', 'DONE'] },
        updatedAt: { $gte: ago24h },
      }),

      // 7 — 5 dernières commandes
      Order.find()
        .select('id firstName lastName cardType status createdAt')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),

      // 8 — commandes 7 derniers jours groupées par jour
      Order.aggregate([
        { $match: { createdAt: { $gte: ago7d } } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            n: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, day: '$_id', count: '$n' } },
      ]),
    ]);

    res.json({
      orders: {
        total:      totalOrders,
        pending:    pendingOrders,
        processing: processingOrders,
        done:       doneOrders,
        cancelled:  cancelledOrders,
      },
      conversations: {
        total:  totalConversations,
        active: activeConversations,
      },
      recentOrders,
      ordersPerDay: ordersPerDayRaw,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
