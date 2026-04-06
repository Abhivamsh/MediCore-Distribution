'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { Pool } = require('pg');
const Redis = require('ioredis');
const winston = require('winston');

const analyticsRoutes = require('./routes/analytics');
const mq = require('./services/messageQueue');

const app = express();
const PORT = process.env.PORT || 3006;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: 'analytics-service' },
  transports: [new winston.transports.Console()],
});

const db = new Pool({ connectionString: process.env.DB_URL, max: 10 });
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });

app.use(helmet());
app.use(express.json({ limit: '256kb' }));
app.use((req, _res, next) => { req.db = db; req.redis = redis; req.logger = logger; next(); });

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'analytics-service', timestamp: new Date().toISOString() })
);

app.use('/api/analytics', analyticsRoutes);

app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
});

async function initDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS daily_sales_snapshots (
      id          SERIAL PRIMARY KEY,
      branch_id   INTEGER NOT NULL,
      date        DATE NOT NULL,
      revenue     NUMERIC(12,2) NOT NULL DEFAULT 0,
      invoice_count INTEGER NOT NULL DEFAULT 0,
      top_products JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(branch_id, date)
    );
    CREATE TABLE IF NOT EXISTS inventory_snapshots (
      id              SERIAL PRIMARY KEY,
      branch_id       INTEGER NOT NULL,
      date            DATE NOT NULL,
      total_sku_count INTEGER NOT NULL DEFAULT 0,
      low_stock_count INTEGER NOT NULL DEFAULT 0,
      out_of_stock_count INTEGER NOT NULL DEFAULT 0,
      total_value     NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(branch_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_branch_date ON daily_sales_snapshots(branch_id, date);
  `);
  logger.info('Analytics database initialized');
}

async function startConsumers() {
  try {
    const channel = await mq.connect();

    // Consume billing events to record analytics
    const billingQueue = 'analytics.billing.events';
    await channel.assertQueue(billingQueue, { durable: true });
    await channel.bindQueue(billingQueue, 'medicore.events', 'billing.invoice.*');
    channel.prefetch(5);
    channel.consume(billingQueue, async (msg) => {
      if (!msg) return;
      try {
        const event = JSON.parse(msg.content.toString());
        if (msg.fields.routingKey === 'billing.invoice.created') {
          const today = new Date().toISOString().split('T')[0];
          await db.query(
            `INSERT INTO daily_sales_snapshots (branch_id, date, revenue, invoice_count)
             VALUES ($1, $2, $3, 1)
             ON CONFLICT (branch_id, date) DO UPDATE SET
               revenue = daily_sales_snapshots.revenue + EXCLUDED.revenue,
               invoice_count = daily_sales_snapshots.invoice_count + 1`,
            [event.branchId, today, event.total || 0]
          );
        }
        channel.ack(msg);
      } catch (err) {
        logger.error('Analytics consumer error', { error: err.message });
        channel.nack(msg, false, false);
      }
    });

    logger.info('Analytics event consumers started');
  } catch (err) {
    logger.warn('Could not start event consumers', { error: err.message });
  }
}

async function start() {
  await redis.connect().catch(() => logger.warn('Redis unavailable'));
  await initDatabase();
  await startConsumers();
  app.listen(PORT, () => logger.info(`Analytics Service running on port ${PORT}`));
}

start().catch((err) => { logger.error('Startup failed', { error: err.message }); process.exit(1); });

module.exports = app;
