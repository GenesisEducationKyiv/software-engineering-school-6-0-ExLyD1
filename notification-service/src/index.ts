import { Resend } from 'resend';
import { loadConfig } from './config.ts';
import { connectRabbit } from './rabbit.ts';
import { createMailer } from './mailer.ts';
import { handleCommand } from './handler.ts';
import { EMAIL_QUEUE, type EmailCommand } from './contract.ts';

const main = async () => {
    const config = loadConfig();
    const resend = new Resend(config.resendApiKey);
    const mailer = createMailer(resend, config.smtpFrom);

    const { connection, channel } = await connectRabbit(config.rabbitmqUrl);

    // eslint-disable-next-line no-console
    console.log(`notification-service: connected, consuming "${EMAIL_QUEUE}"`);

    await channel.consume(EMAIL_QUEUE, (msg) => {
        if (!msg) {
            return;
        }
        void (async () => {
            try {
                const command = JSON.parse(msg.content.toString()) as EmailCommand;
                await handleCommand(mailer, config.baseUrl, command);
                channel.ack(msg);
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error('notification-service: failed to process message', err);
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
    // eslint-disable-next-line no-console
    console.error('notification-service: fatal startup error', err);
    process.exit(1);
});
