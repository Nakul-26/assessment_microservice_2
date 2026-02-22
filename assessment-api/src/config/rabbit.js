import amqp from "amqplib";
import { env } from "./env.js";

let connection;
let channel;

export async function initRabbit() {
  if (channel) return channel;
  connection = await amqp.connect(env.RABBITMQ_URI);
  channel = await connection.createChannel();
  console.log("✅ RabbitMQ connected");
  return channel;
}

export function getChannel() {
  return channel;
}
