
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import amqp from 'amqplib';
import { executeCode } from './judge.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/assessment_db';
const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://user:password@rabbitmq:5672';
const QUEUE_NAME = 'submission_queue';

async function main() {
    // 1. Connect to MongoDB
    try {
        await mongoose.connect(MONGO_URI, { dbName: 'assessment_db' });
        console.log('✅ Judge service connected to MongoDB');
    } catch (err) {
        console.error('❌ Judge service MongoDB connection error:', err);
        process.exit(1);
    }

    // 2. Connect to RabbitMQ and start worker with retry loop
    let attempts = 0;
    while (true) {
        try {
            const connection = await amqp.connect(RABBITMQ_URI);
            const channel = await connection.createChannel();

            await channel.assertQueue(QUEUE_NAME, { durable: true });
            console.log(`✅ Judge service waiting for messages in queue: ${QUEUE_NAME}`);

            channel.consume(QUEUE_NAME, async (msg) => {
                if (msg !== null) {
                    const submissionId = msg.content.toString();
                    console.log(`📥 Received submission ID: ${submissionId}`);
                    try {
                        await executeCode(submissionId);
                        console.log(`✅ Successfully processed submission ID: ${submissionId}`);
                    } catch (err) {
                        console.error(`❌ Error processing submission ${submissionId}:`, err);
                    }
                    channel.ack(msg);
                }
            });

            break; // connected and consuming
        } catch (err) {
            attempts += 1;
            console.error(`❌ Judge service RabbitMQ connection error (attempt ${attempts}):`, err && err.message ? err.message : err);
            if (attempts >= 10) {
                console.error('Exceeded max RabbitMQ connection attempts, exiting');
                process.exit(1);
            }
            console.log('Retrying RabbitMQ connection in 3s...');
            await new Promise((r) => setTimeout(r, 3000));
        }
    }
}

main();
