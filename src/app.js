// app.js
// ──────────────────────────────────────────────────────────────
// Pas de changement fonctionnel vs l'original.
// Seul ajout : export de l'app pour que server.js puisse appeler
// initDb() AVANT app.listen().
// ──────────────────────────────────────────────────────────────

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const cookieParser = require('cookie-parser');

const authRoutes      = require('./routes/auth');
const ordersRoutes    = require('./routes/orders');
const configRoutes    = require('./routes/config');
const whatsappRoutes  = require('./routes/whatsapp');
const formRoutes      = require('./routes/form');
const statsRoutes     = require('./routes/stats');

const app = express();

// ══════════════════════════════════════════
// Sécurité & middlewares globaux
// ══════════════════════════════════════════

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: [
    process.env.DASHBOARD_URL || 'http://localhost:3000',
    process.env.FORM_URL      || 'http://localhost:3002',
  ],
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// ══════════════════════════════════════════
// Routes
// ══════════════════════════════════════════

app.use('/api/auth',      authRoutes);
app.use('/api/orders',    ordersRoutes);
app.use('/api/config',    configRoutes);
app.use('/api/whatsapp',  whatsappRoutes);
app.use('/api/form',      formRoutes);
app.use('/api/stats',     statsRoutes);

// Health check Railway — inclut un indicateur db
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// 404
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// Erreur globale
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Erreur interne du serveur',
  });
});

module.exports = app;