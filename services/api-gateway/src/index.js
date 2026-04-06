'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');

const logger = require('./utils/logger');
const { authenticate } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security & Utility Middleware ────────────────────────────────────────────
app.use(helmet());
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

app.use(cors({
  origin: allowedOrigins.length > 0
    ? (origin, callback) => {
        // Allow requests with no origin (server-to-server) or matching origin
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
      }
    : false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000,
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});
app.use('/api/', limiter);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
});

// ─── Proxy Helper ─────────────────────────────────────────────────────────────
function createProxy(target, pathRewrite = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite,
    on: {
      error: (err, req, res) => {
        logger.error('Proxy error', { target, error: err.message });
        res.status(502).json({ success: false, message: 'Service temporarily unavailable' });
      },
    },
    // Low-bandwidth: compress responses at the gateway level
    headers: { 'Accept-Encoding': 'gzip, deflate' },
  });
}

// ─── Public Routes (no auth required) ────────────────────────────────────────
app.use('/api/auth', createProxy(process.env.AUTH_SERVICE_URL, { '^/api/auth': '/api/auth' }));

// ─── Protected Routes (JWT required) ─────────────────────────────────────────
app.use('/api/users',       authenticate, createProxy(process.env.USER_SERVICE_URL,         { '^/api/users':       '/api/users'       }));
app.use('/api/inventory',   authenticate, createProxy(process.env.INVENTORY_SERVICE_URL,    { '^/api/inventory':   '/api/inventory'   }));
app.use('/api/billing',     authenticate, createProxy(process.env.BILLING_SERVICE_URL,      { '^/api/billing':     '/api/billing'     }));
app.use('/api/purchases',   authenticate, createProxy(process.env.PURCHASE_SERVICE_URL,     { '^/api/purchases':   '/api/purchases'   }));
app.use('/api/analytics',   authenticate, createProxy(process.env.ANALYTICS_SERVICE_URL,   { '^/api/analytics':   '/api/analytics'   }));
app.use('/api/ai',          authenticate, createProxy(process.env.AI_SERVICE_URL,           { '^/api/ai':          '/api/ai'          }));
app.use('/api/notifications', authenticate, createProxy(process.env.NOTIFICATION_SERVICE_URL, { '^/api/notifications': '/api/notifications' }));

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`API Gateway running on port ${PORT}`);
});

module.exports = app;
