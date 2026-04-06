'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { Pool } = require('pg');
const Redis = require('ioredis');
const winston = require('winston');

const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Logger ───────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: 'auth-service' },
  transports: [new winston.transports.Console()],
});

// ─── Database ─────────────────────────────────────────────────────────────────
const db = new Pool({
  connectionString: process.env.DB_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// ─── Redis ────────────────────────────────────────────────────────────────────
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 3000),
  lazyConnect: true,
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({ limit: '256kb' }));

// Attach db/redis to request context
app.use((req, _res, next) => {
  req.db = db;
  req.redis = redis;
  req.logger = logger;
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'auth-service', timestamp: new Date().toISOString() })
);
app.use('/api/auth', authRoutes);

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
});

// ─── DB Migrations ────────────────────────────────────────────────────────────
async function initDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      email       VARCHAR(255) UNIQUE NOT NULL,
      password    VARCHAR(255) NOT NULL,
      role        VARCHAR(50)  NOT NULL DEFAULT 'pharmacist',
      branch_id   INTEGER,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      last_login  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  VARCHAR(255) NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);
  logger.info('Auth database initialized');
}

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await redis.connect().catch(() => logger.warn('Redis unavailable, continuing without cache'));
  await initDatabase();
  app.listen(PORT, () => logger.info(`Auth Service running on port ${PORT}`));
}

start().catch((err) => {
  logger.error('Failed to start auth service', { error: err.message });
  process.exit(1);
});

module.exports = app;
