// middleware/auth.js — migré Turso
const jwt            = require('jsonwebtoken');
const { sessionDb }  = require('../lib/db');

async function requireAuth(req, res, next) {
  try {
    const token =
      req.cookies?.auth_token ||
      req.headers.authorization?.replace('Bearer ', '');

    if (!token)
      return res.status(401).json({ error: 'Non authentifié' });

    // Vérifier la signature JWT
    jwt.verify(token, process.env.JWT_SECRET);

    // prisma.session.findUnique({ where: { token }, include: { admin: true } })
    const session = await sessionDb.findByToken(token);

    if (!session || new Date(session.expiresAt) < new Date()) {
      res.clearCookie('auth_token');
      return res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter' });
    }

    req.admin        = session.admin;
    req.sessionToken = token;
    next();
  } catch {
    res.clearCookie('auth_token');
    return res.status(401).json({ error: 'Token invalide' });
  }
}

module.exports = { requireAuth };