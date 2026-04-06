'use strict';

const amqp = require('amqplib');
const logger = require('./logger');

let connection = null;
let channel = null;

const EXCHANGE = 'medicore.events';
const EXCHANGE_TYPE = 'topic';

async function connect(retries = 5, delay = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      connection = await amqp.connect(process.env.RABBITMQ_URL);
      channel = await connection.createChannel();
      await channel.assertExchange(EXCHANGE, EXCHANGE_TYPE, { durable: true });

      connection.on('error', (err) => {
        logger.error('RabbitMQ connection error', { error: err.message });
      });
      connection.on('close', () => {
        logger.warn('RabbitMQ connection closed, reconnecting...');
        setTimeout(() => connect(), delay);
      });

      logger.info('Connected to RabbitMQ');
      return channel;
    } catch (err) {
      logger.warn(`RabbitMQ connection attempt ${attempt} failed`, { error: err.message });
      if (attempt < retries) {
        await new Promise((res) => setTimeout(res, delay));
      } else {
        throw new Error('Failed to connect to RabbitMQ after multiple attempts');
      }
    }
  }
}

/**
 * Publish an event to the exchange.
 * @param {string} routingKey - e.g. 'inventory.updated'
 * @param {object} payload
 */
async function publish(routingKey, payload) {
  if (!channel) throw new Error('Message queue not connected');
  const message = Buffer.from(JSON.stringify({ ...payload, timestamp: new Date().toISOString() }));
  channel.publish(EXCHANGE, routingKey, message, {
    persistent: true,
    contentType: 'application/json',
  });
  logger.debug('Event published', { routingKey, payload });
}

/**
 * Subscribe to events matching a routing key pattern.
 * @param {string} queueName - unique queue name for this service
 * @param {string} routingKey - e.g. 'inventory.*' or '#'
 * @param {Function} handler - async function(msg)
 */
async function subscribe(queueName, routingKey, handler) {
  if (!channel) throw new Error('Message queue not connected');

  await channel.assertQueue(queueName, { durable: true });
  await channel.bindQueue(queueName, EXCHANGE, routingKey);
  channel.prefetch(1);

  channel.consume(queueName, async (msg) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      await handler(payload, msg.fields.routingKey);
      channel.ack(msg);
    } catch (err) {
      logger.error('Error processing message', { error: err.message, queue: queueName });
      // Reject and re-queue once, then discard
      channel.nack(msg, false, false);
    }
  });

  logger.info('Subscribed to queue', { queueName, routingKey });
}

async function close() {
  if (channel) await channel.close();
  if (connection) await connection.close();
}

module.exports = { connect, publish, subscribe, close, EXCHANGE };
