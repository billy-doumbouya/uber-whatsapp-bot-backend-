const jwt = require('jsonwebtoken');
const { prisma } = require('../utils/database');

async function requireAuth(req, res, next) {
  try {
    // Lire le token depuis le cookie httpOnly (Railway persistant) ou header Authorization
    const token =
      req.cookies?.auth_token ||
      req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    // Vérifier la signature JWT
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Vérifier que la session existe en base (persistance Railway)
    const session = await prisma.session.findUnique({
      where: { token },
      include: { admin: true },
    });

    if (!session || session.expiresAt < new Date()) {
      // Nettoyer les cookies si session expirée
      res.clearCookie('auth_token');
      return res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter' });
    }

    req.admin = session.admin;
    req.sessionToken = token;
    next();
  } catch (err) {
    res.clearCookie('auth_token');
    return res.status(401).json({ error: 'Token invalide' });
  }
}

module.exports = { requireAuth };
