'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { Pool } = require('pg');
const Redis = require('ioredis');
const winston = require('winston');
const purchaseRoutes = require('./routes/purchases');
const supplierRoutes = require('./routes/suppliers');
const mq = require('./services/messageQueue');

const app = express();
const PORT = process.env.PORT || 3005;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: 'purchase-service' },
  transports: [new winston.transports.Console()],
});

const db = new Pool({ connectionString: process.env.DB_URL, max: 10 });
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });

app.use(helmet());
app.use(express.json({ limit: '256kb' }));
app.use((req, _res, next) => { req.db = db; req.redis = redis; req.logger = logger; req.mq = mq; next(); });

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'purchase-service', timestamp: new Date().toISOString() })
);

app.use('/api/purchases', purchaseRoutes);
app.use('/api/purchases/suppliers', supplierRoutes);

app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
});

async function initDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(255) NOT NULL,
      contact_name  VARCHAR(255),
      email         VARCHAR(255),
      phone         VARCHAR(20),
      address       TEXT,
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id              SERIAL PRIMARY KEY,
      po_number       VARCHAR(50) UNIQUE NOT NULL,
      supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
      branch_id       INTEGER NOT NULL,
      status          VARCHAR(50) NOT NULL DEFAULT 'draft',
      subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax             NUMERIC(12,2) NOT NULL DEFAULT 0,
      total           NUMERIC(12,2) NOT NULL DEFAULT 0,
      expected_date   DATE,
      received_date   DATE,
      created_by      INTEGER,
      approved_by     INTEGER,
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id            SERIAL PRIMARY KEY,
      po_id         INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      product_id    INTEGER NOT NULL,
      product_name  VARCHAR(255) NOT NULL,
      quantity      INTEGER NOT NULL,
      unit_price    NUMERIC(12,2) NOT NULL,
      total         NUMERIC(12,2) NOT NULL,
      received_qty  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_po_branch ON purchase_orders(branch_id);
    CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
  `);
  logger.info('Purchase database initialized');
}

async function start() {
  await redis.connect().catch(() => logger.warn('Redis unavailable'));
  await initDatabase();
  await mq.connect().catch((err) => logger.warn('RabbitMQ unavailable', { error: err.message }));
  app.listen(PORT, () => logger.info(`Purchase Service running on port ${PORT}`));
}

start().catch((err) => { logger.error('Startup failed', { error: err.message }); process.exit(1); });

module.exports = app;
