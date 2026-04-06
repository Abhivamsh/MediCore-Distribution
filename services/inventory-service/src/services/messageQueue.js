'use strict';

const amqp = require('amqplib');

const EXCHANGE = 'medicore.events';
let channel = null;

async function connect(retries = 5) {
  for (let i = 1; i <= retries; i++) {
    try {
      const conn = await amqp.connect(process.env.RABBITMQ_URL);
      channel = await conn.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      conn.on('error', () => setTimeout(() => connect(), 3000));
      return channel;
    } catch (err) {
      if (i < retries) await new Promise((r) => setTimeout(r, 3000));
      else throw err;
    }
  }
}

async function publish(routingKey, payload) {
  if (!channel) return;
  channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify({ ...payload, timestamp: new Date().toISOString() })), {
    persistent: true, contentType: 'application/json',
  });
}

module.exports = { connect, publish };
