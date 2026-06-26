// app.js
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

// ── Parser les URLs multiples séparées par des virgules ──────
// DASHBOARD_URL=http://localhost:3000,https://dashboard.vercel.app
// → ['http://localhost:3000', 'https://dashboard.vercel.app']
function parseUrls(envVar, fallback) {
  if (!envVar) return [fallback];
  return envVar.split(',').map(u => u.trim()).filter(Boolean);
}

const allowedOrigins = [
  ...parseUrls(process.env.DASHBOARD_URL, 'http://localhost:3000'),
  ...parseUrls(process.env.FORM_URL,      'http://localhost:3002'),
];

// Dédupliquer au cas où une URL apparaît dans les deux variables
const origins = [...new Set(allowedOrigins)];

// ══════════════════════════════════════════
// Sécurité & middlewares globaux
// ══════════════════════════════════════════

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: (origin, callback) => {
    // Autoriser les requêtes sans origin (Postman, curl, mobile apps)
    if (!origin) return callback(null, true);
    if (origins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS bloqué: ${origin}`));
  },
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), origins });
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