import { Resend } from 'resend';
import { loadConfig } from './config.ts';
import { connectRabbit, type RabbitChannel } from './rabbit.ts';
import { createMailer } from './mailer.ts';
import { handleCommand } from './handler.ts';
import { processConfirmation } from './saga.ts';
import { createDb, initDb } from './db.ts';
import { logger } from './logger.ts';
import { EMAIL_QUEUE, SAGA_REPLIES_QUEUE, type EmailCommand, type SagaReply } from './contract.ts';

const publishReply = (channel: RabbitChannel, reply: SagaReply): void => {
    channel.sendToQueue(SAGA_REPLIES_QUEUE, Buffer.from(JSON.stringify(reply)), {
        persistent: true,
    });
};

const main = async () => {
    const config = loadConfig();
    const db = createDb(config.databaseUrl);
    await initDb(db);

    const resend = new Resend(config.resendApiKey);
    const mailer = createMailer(resend, config.smtpFrom);

    const { connection, channel } = await connectRabbit(config.rabbitmqUrl);
    await channel.assertQueue(SAGA_REPLIES_QUEUE, { durable: true });

    logger.info(`Connected, consuming "${EMAIL_QUEUE}"`);

    let shuttingDown = false;
    const onConnectionLost = (err?: unknown) => {
        if (shuttingDown) {
            return;
        }
        logger.error({ err }, 'RabbitMQ connection lost — exiting to be restarted');
        process.exit(1);
    };
    connection.on('error', (err: unknown) => onConnectionLost(err));
    connection.on('close', () => onConnectionLost());

    await channel.consume(EMAIL_QUEUE, (msg) => {
        if (!msg) {
            return;
        }
        void (async () => {
            try {
                const command = JSON.parse(msg.content.toString()) as EmailCommand;

                if (command.type === 'confirmation') {
                    // Saga step: try once, report the outcome to the orchestrator.
                    const status = await processConfirmation(
                        { db, mailer, baseUrl: config.baseUrl, log: logger },
                        command,
                    );
                    publishReply(channel, { sagaId: command.sagaId, status });
                    channel.ack(msg);
                    logger.info({ sagaId: command.sagaId, status }, 'Saga confirmation processed');
                    return;
                }

                // Release notification: plain fire-and-forget, not part of a saga.
                await handleCommand(mailer, config.baseUrl, command);
                channel.ack(msg);
                logger.info(
                    { emailType: command.type, recipient: command.email },
                    'Email delivered',
                );
            } catch (err) {
                logger.error({ err }, 'Failed to process message');
                // Malformed/unexpected → park in the DLQ.
                channel.nack(msg, false, false);
            }
        })();
    });

    const shutdown = async () => {
        shuttingDown = true;
        try {
            await channel.close();
            await connection.close();
            await db.end();
        } finally {
            process.exit(0);
        }
    };
    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());
};

main().catch((err: unknown) => {
    logger.error({ err }, 'Fatal startup error');
    process.exit(1);
});
