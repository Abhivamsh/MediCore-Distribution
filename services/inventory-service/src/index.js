'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { Pool } = require('pg');
const Redis = require('ioredis');
const winston = require('winston');

const inventoryRoutes = require('./routes/inventory');
const transferRoutes = require('./routes/transfers');
const mq = require('./services/messageQueue');

const app = express();
const PORT = process.env.PORT || 3003;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: 'inventory-service' },
  transports: [new winston.transports.Console()],
});

const db = new Pool({ connectionString: process.env.DB_URL, max: 10 });
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });

app.use(helmet());
app.use(express.json({ limit: '256kb' }));
app.use((req, _res, next) => { req.db = db; req.redis = redis; req.logger = logger; req.mq = mq; next(); });

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'inventory-service', timestamp: new Date().toISOString() })
);

app.use('/api/inventory', inventoryRoutes);
app.use('/api/inventory/transfers', transferRoutes);

app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
});

async function initDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS products (
      id              SERIAL PRIMARY KEY,
      sku             VARCHAR(100) UNIQUE NOT NULL,
      name            VARCHAR(255) NOT NULL,
      category        VARCHAR(100),
      manufacturer    VARCHAR(255),
      unit            VARCHAR(50) DEFAULT 'units',
      unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
      reorder_level   INTEGER NOT NULL DEFAULT 10,
      is_active       BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS stock (
      id              SERIAL PRIMARY KEY,
      product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      branch_id       INTEGER NOT NULL,
      quantity        INTEGER NOT NULL DEFAULT 0,
      batch_number    VARCHAR(100),
      expiry_date     DATE,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, branch_id, batch_number)
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id              SERIAL PRIMARY KEY,
      product_id      INTEGER NOT NULL REFERENCES products(id),
      branch_id       INTEGER NOT NULL,
      movement_type   VARCHAR(50) NOT NULL,
      quantity        INTEGER NOT NULL,
      reference_id    VARCHAR(255),
      reference_type  VARCHAR(50),
      notes           TEXT,
      created_by      INTEGER,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS stock_transfers (
      id              SERIAL PRIMARY KEY,
      product_id      INTEGER NOT NULL REFERENCES products(id),
      from_branch_id  INTEGER NOT NULL,
      to_branch_id    INTEGER NOT NULL,
      quantity        INTEGER NOT NULL,
      status          VARCHAR(50) NOT NULL DEFAULT 'pending',
      notes           TEXT,
      created_by      INTEGER,
      approved_by     INTEGER,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_stock_product_branch ON stock(product_id, branch_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_branch ON stock_movements(branch_id);
  `);
  logger.info('Inventory database initialized');
}

async function start() {
  await redis.connect().catch(() => logger.warn('Redis unavailable'));
  await initDatabase();
  await mq.connect().catch((err) => logger.warn('RabbitMQ unavailable', { error: err.message }));
  app.listen(PORT, () => logger.info(`Inventory Service running on port ${PORT}`));
}

start().catch((err) => { logger.error('Startup failed', { error: err.message }); process.exit(1); });

module.exports = app;
