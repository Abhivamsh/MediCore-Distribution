'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { Pool } = require('pg');
const Redis = require('ioredis');
const winston = require('winston');
const nodemailer = require('nodemailer');
const amqp = require('amqplib');

const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3008;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: 'notification-service' },
  transports: [new winston.transports.Console()],
});

// Notification service shares the analytics database (medicore_analytics) to avoid
// provisioning a dedicated database for a lightweight table. The DB_URL env var
// points to the analytics database connection string.
const db = new Pool({ connectionString: process.env.DB_URL, max: 5 });
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });

// Email transport
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

app.use(helmet());
app.use(express.json({ limit: '256kb' }));
app.use((req, _res, next) => { req.db = db; req.redis = redis; req.logger = logger; req.mailer = mailer; next(); });

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'notification-service', timestamp: new Date().toISOString() })
);

app.use('/api/notifications', notificationRoutes);

app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
});

async function initDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER,
      branch_id   INTEGER,
      type        VARCHAR(50) NOT NULL,
      channel     VARCHAR(20) NOT NULL DEFAULT 'in_app',
      title       VARCHAR(255) NOT NULL,
      message     TEXT NOT NULL,
      is_read     BOOLEAN NOT NULL DEFAULT false,
      metadata    JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_branch ON notifications(branch_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);
  `);
  logger.info('Notification database initialized');
}

async function startConsumers() {
  try {
    let connection = null;
    for (let i = 1; i <= 5; i++) {
      try {
        connection = await amqp.connect(process.env.RABBITMQ_URL);
        break;
      } catch (err) {
        if (i < 5) await new Promise((r) => setTimeout(r, 3000));
        else { logger.warn('RabbitMQ unavailable for consumers'); return; }
      }
    }

    const channel = await connection.createChannel();
    await channel.assertExchange('medicore.events', 'topic', { durable: true });

    // Low-stock alerts
    const lowStockQueue = 'notifications.inventory.alerts';
    await channel.assertQueue(lowStockQueue, { durable: true });
    await channel.bindQueue(lowStockQueue, 'medicore.events', 'inventory.updated');
    channel.prefetch(5);
    channel.consume(lowStockQueue, async (msg) => {
      if (!msg) return;
      try {
        const event = JSON.parse(msg.content.toString());
        if (event.quantity !== undefined && event.branchId) {
          // Create in-app low-stock notification if threshold crossed
          await db.query(
            `INSERT INTO notifications (branch_id, type, channel, title, message, metadata)
             VALUES ($1, 'low_stock', 'in_app', 'Low Stock Alert',
               'Product ID ' || $2 || ' stock is at ' || $3 || ' units.',
               $4::jsonb)`,
            [event.branchId, event.productId, event.quantity, JSON.stringify(event)]
          );
        }
        channel.ack(msg);
      } catch (err) {
        logger.error('Notification consumer error', { error: err.message });
        channel.nack(msg, false, false);
      }
    });

    logger.info('Notification event consumers started');
  } catch (err) {
    logger.warn('Could not start event consumers', { error: err.message });
  }
}

async function start() {
  await redis.connect().catch(() => logger.warn('Redis unavailable'));
  await initDatabase();
  await startConsumers();
  app.listen(PORT, () => logger.info(`Notification Service running on port ${PORT}`));
}

start().catch((err) => { logger.error('Startup failed', { error: err.message }); process.exit(1); });

module.exports = app;
