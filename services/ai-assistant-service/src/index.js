'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const { Pool } = require('pg');
const Redis = require('ioredis');
const winston = require('winston');
const aiRoutes = require('./routes/ai');

const app = express();
const PORT = process.env.PORT || 3007;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: 'ai-assistant-service' },
  transports: [new winston.transports.Console()],
});

const db = new Pool({ connectionString: process.env.DB_URL, max: 5 });
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });

app.use(helmet());
app.use(express.json({ limit: '512kb' }));
app.use((req, _res, next) => { req.db = db; req.redis = redis; req.logger = logger; next(); });

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'ai-assistant-service', timestamp: new Date().toISOString() })
);

app.use('/api/ai', aiRoutes);

app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
});

async function initDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_query_log (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER,
      branch_id   INTEGER,
      query       TEXT NOT NULL,
      response    TEXT,
      tokens_used INTEGER,
      duration_ms INTEGER,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_query_log_user ON ai_query_log(user_id);
  `);
  logger.info('AI service database initialized');
}

async function start() {
  await redis.connect().catch(() => logger.warn('Redis unavailable'));
  await initDatabase();
  app.listen(PORT, () => logger.info(`AI Assistant Service running on port ${PORT}`));
}

start().catch((err) => { logger.error('Startup failed', { error: err.message }); process.exit(1); });

module.exports = app;
