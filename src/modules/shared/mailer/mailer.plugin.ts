import fastifyPlugin from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { ConfirmationMailer, NotificationMailer } from './mailer.types.ts';
import type { AppConfig } from '../config/config.ts';
import { connectRabbit } from '../messaging/rabbit.ts';
import { createPublishingMailer } from './mailer.publisher.ts';

declare module 'fastify' {
    interface FastifyInstance {
        mailer: ConfirmationMailer & NotificationMailer;
    }
}

const createStubMailer = (): ConfirmationMailer & NotificationMailer => ({
    sendConfirmationEmail: async () => {},
    sendReleaseNotification: async () => {},
});

const mailerConnector = async (fastify: FastifyInstance, config: AppConfig) => {
    if (process.env.MAILER_MODE === 'stub') {
        fastify.log.warn('Mailer running in STUB mode — no commands will be published');
        fastify.decorate('mailer', createStubMailer());
        return;
    }

    const { connection, channel } = await connectRabbit(config.rabbitmqUrl);
    fastify.decorate('mailer', createPublishingMailer(channel));

    let intentionalClose = false;

    // Surface broker errors instead of letting them crash as an unhandled
    // 'error' event, and if the connection drops unexpectedly exit so the
    // orchestrator restarts the app and it reconnects via the startup retry.
    connection.on('error', (err: unknown) => {
        fastify.log.error({ err }, 'RabbitMQ connection error');
    });
    connection.on('close', () => {
        if (intentionalClose) {
            return;
        }
        fastify.log.error('RabbitMQ connection closed unexpectedly — exiting to be restarted');
        process.exit(1);
    });

    fastify.addHook('onClose', async () => {
        intentionalClose = true;
        await channel.close();
        await connection.close();
    });
};

export default fastifyPlugin(mailerConnector);
