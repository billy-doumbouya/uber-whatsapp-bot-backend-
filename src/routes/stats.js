const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../utils/database');

const router = express.Router();
router.use(requireAuth);

// GET /api/stats - Métriques pour le dashboard
router.get('/', async (req, res) => {
  try {
    const [
      totalOrders,
      pendingOrders,
      processingOrders,
      doneOrders,
      cancelledOrders,
      totalConversations,
      activeConversations,
      recentOrders,
    ] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.order.count({ where: { status: 'PROCESSING' } }),
      prisma.order.count({ where: { status: 'DONE' } }),
      prisma.order.count({ where: { status: 'CANCELLED' } }),
      prisma.conversation.count(),
      prisma.conversation.count({
        where: {
          state: { notIn: ['IDLE', 'COMPLETED'] },
          updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          cardType: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    // Commandes des 7 derniers jours par jour
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const ordersPerDay = await prisma.order.groupBy({
      by: ['createdAt'],
      where: { createdAt: { gte: sevenDaysAgo } },
      _count: true,
    });

    res.json({
      orders: {
        total: totalOrders,
        pending: pendingOrders,
        processing: processingOrders,
        done: doneOrders,
        cancelled: cancelledOrders,
      },
      conversations: {
        total: totalConversations,
        active: activeConversations,
      },
      recentOrders,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
