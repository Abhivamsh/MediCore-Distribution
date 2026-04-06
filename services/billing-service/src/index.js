'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { Pool } = require('pg');
const Redis = require('ioredis');
const winston = require('winston');

const billingRoutes = require('./routes/billing');
const mq = require('./services/messageQueue');

const app = express();
const PORT = process.env.PORT || 3004;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: 'billing-service' },
  transports: [new winston.transports.Console()],
});

const db = new Pool({ connectionString: process.env.DB_URL, max: 10 });
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });

app.use(helmet());
app.use(express.json({ limit: '256kb' }));
app.use((req, _res, next) => { req.db = db; req.redis = redis; req.logger = logger; req.mq = mq; next(); });

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'billing-service', timestamp: new Date().toISOString() })
);

app.use('/api/billing', billingRoutes);

app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
});

async function initDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id              SERIAL PRIMARY KEY,
      invoice_number  VARCHAR(50) UNIQUE NOT NULL,
      branch_id       INTEGER NOT NULL,
      customer_name   VARCHAR(255),
      customer_phone  VARCHAR(20),
      subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount        NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax             NUMERIC(12,2) NOT NULL DEFAULT 0,
      total           NUMERIC(12,2) NOT NULL DEFAULT 0,
      payment_method  VARCHAR(50) NOT NULL DEFAULT 'cash',
      payment_status  VARCHAR(50) NOT NULL DEFAULT 'pending',
      status          VARCHAR(50) NOT NULL DEFAULT 'draft',
      created_by      INTEGER,
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS invoice_items (
      id              SERIAL PRIMARY KEY,
      invoice_id      INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_id      INTEGER NOT NULL,
      product_name    VARCHAR(255) NOT NULL,
      quantity        INTEGER NOT NULL,
      unit_price      NUMERIC(12,2) NOT NULL,
      discount        NUMERIC(12,2) NOT NULL DEFAULT 0,
      total           NUMERIC(12,2) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_branch ON invoices(branch_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
  `);
  logger.info('Billing database initialized');
}

async function start() {
  await redis.connect().catch(() => logger.warn('Redis unavailable'));
  await initDatabase();
  await mq.connect().catch((err) => logger.warn('RabbitMQ unavailable', { error: err.message }));
  app.listen(PORT, () => logger.info(`Billing Service running on port ${PORT}`));
}

start().catch((err) => { logger.error('Startup failed', { error: err.message }); process.exit(1); });

module.exports = app;
