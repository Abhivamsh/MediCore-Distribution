'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { Pool } = require('pg');
const Redis = require('ioredis');
const winston = require('winston');

const userRoutes = require('./routes/users');
const branchRoutes = require('./routes/branches');

const app = express();
const PORT = process.env.PORT || 3002;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: 'user-service' },
  transports: [new winston.transports.Console()],
});

const db = new Pool({ connectionString: process.env.DB_URL, max: 10 });
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });

app.use(helmet());
app.use(express.json({ limit: '256kb' }));
app.use((req, _res, next) => { req.db = db; req.redis = redis; req.logger = logger; next(); });

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'user-service', timestamp: new Date().toISOString() })
);

app.use('/api/users', userRoutes);
app.use('/api/branches', branchRoutes);

app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
});

async function initDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS branches (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      code        VARCHAR(20) UNIQUE NOT NULL,
      address     TEXT,
      city        VARCHAR(100),
      state       VARCHAR(100),
      is_active   BOOLEAN NOT NULL DEFAULT true,
      manager_id  INTEGER,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      auth_user_id INTEGER UNIQUE NOT NULL,
      email       VARCHAR(255) UNIQUE NOT NULL,
      full_name   VARCHAR(255),
      phone       VARCHAR(20),
      role        VARCHAR(50) NOT NULL,
      branch_id   INTEGER REFERENCES branches(id),
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch_id);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  `);
  logger.info('User database initialized');
}

async function start() {
  await redis.connect().catch(() => logger.warn('Redis unavailable'));
  await initDatabase();
  app.listen(PORT, () => logger.info(`User Service running on port ${PORT}`));
}

start().catch((err) => { logger.error('Startup failed', { error: err.message }); process.exit(1); });

module.exports = app;
