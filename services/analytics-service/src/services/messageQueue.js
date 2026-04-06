'use strict';

const amqp = require('amqplib');
const EXCHANGE = 'medicore.events';
let connection = null;
let channel = null;

async function connect(retries = 5) {
  for (let i = 1; i <= retries; i++) {
    try {
      connection = await amqp.connect(process.env.RABBITMQ_URL);
      channel = await connection.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      connection.on('error', () => setTimeout(() => connect(), 3000));
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
