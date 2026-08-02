import amqplib, { type ChannelModel, type Channel } from 'amqplib';
import { logger } from '../../logger/winston.logger';

let connection: ChannelModel | undefined;
let channel: Channel | undefined;

export async function connectRabbitMQ(): Promise<Channel> {
  const url = process.env.RABBITMQ_URL;

  if (!url) {
    throw new Error('RABBITMQ_URL is not defined');
  }

  connection = await amqplib.connect(url);
  channel = await connection.createChannel();

  connection.on('error', (error) => {
    logger.error('RabbitMQ connection error', { error: error.message });
  });

  connection.on('close', () => {
    logger.warn('RabbitMQ connection closed');
  });

  logger.info('RabbitMQ connection established');

  return channel;
}

export function getRabbitMQChannel(): Channel {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized. Call connectRabbitMQ() first.');
  }

  return channel;
}

export async function closeRabbitMQ(): Promise<void> {
  if (channel) {
    await channel.close();
    channel = undefined;
  }

  if (connection) {
    await connection.close();
    connection = undefined;
  }

  logger.info('RabbitMQ connection closed');
}
