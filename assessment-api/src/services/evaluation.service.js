import amqp from "amqplib";
import { getChannel } from "../config/rabbit.js";
import { env } from "../config/env.js";

const QUEUE_NAME = "submission_queue";

export async function publishSubmissionMessage(messageBody) {
  const existingChannel = getChannel();
  const connection = existingChannel ? null : await amqp.connect(env.RABBITMQ_URI);
  const channel = existingChannel || await connection.createChannel();

  await channel.assertQueue(QUEUE_NAME, { durable: true });
  channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(messageBody)), { persistent: true });

  if (!existingChannel) {
    await channel.close();
    await connection.close();
  }
}
