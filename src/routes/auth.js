const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma } = require('../utils/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
  path: '/',
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    // Générer le token JWT
    const expiresIn = process.env.JWT_EXPIRES_IN || '30d';
    const token = jwt.sign(
      { adminId: admin.id, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn }
    );

    // Calculer la date d'expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Sauvegarder la session en base (persistance Railway)
    await prisma.session.create({
      data: { token, adminId: admin.id, expiresAt },
    });

    // Définir le cookie httpOnly
    res.cookie('auth_token', token, COOKIE_OPTIONS);

    res.json({
      ok: true,
      admin: { id: admin.id, email: admin.email, name: admin.name },
      token, // Aussi retourné pour les clients qui préfèrent Authorization header
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await prisma.session.delete({ where: { token: req.sessionToken } });
    res.clearCookie('auth_token', COOKIE_OPTIONS);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: true }); // Toujours OK côté client
  }
});

// GET /api/auth/me - Vérifier la session courante
router.get('/me', requireAuth, (req, res) => {
  const { id, email, name } = req.admin;
  res.json({ admin: { id, email, name } });
});

// PUT /api/auth/password - Changer son mot de passe
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Champs requis' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères' });
    }

    const admin = await prisma.admin.findUnique({ where: { id: req.admin.id } });
    const valid = await bcrypt.compare(currentPassword, admin.password);
    if (!valid) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.admin.update({ where: { id: req.admin.id }, data: { password: hashed } });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
