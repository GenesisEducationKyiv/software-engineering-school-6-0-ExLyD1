import { Resend } from 'resend';
import { loadConfig } from './config.ts';
import { connectRabbit } from './rabbit.ts';
import { createMailer } from './mailer.ts';
import { handleCommand } from './handler.ts';
import { logger } from './logger.ts';
import { EMAIL_QUEUE, type EmailCommand } from './contract.ts';

const main = async () => {
    const config = loadConfig();
    const resend = new Resend(config.resendApiKey);
    const mailer = createMailer(resend, config.smtpFrom);

    const { connection, channel } = await connectRabbit(config.rabbitmqUrl);

    logger.info(`Connected, consuming "${EMAIL_QUEUE}"`);

    await channel.consume(EMAIL_QUEUE, (msg) => {
        if (!msg) {
            return;
        }
        void (async () => {
            try {
                const command = JSON.parse(msg.content.toString()) as EmailCommand;
                await handleCommand(mailer, config.baseUrl, command);
                channel.ack(msg);
                logger.info(
                    { emailType: command.type, recipient: command.email },
                    'Email delivered',
                );
            } catch (err) {
                logger.error({ err }, 'Failed to process message');
                // Drop the poison message instead of requeuing it forever.
                channel.nack(msg, false, false);
            }
        })();
    });

    const shutdown = async () => {
        try {
            await channel.close();
            await connection.close();
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
