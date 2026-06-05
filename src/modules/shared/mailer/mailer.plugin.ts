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

    fastify.addHook('onClose', async () => {
        await channel.close();
        await connection.close();
    });
};

export default fastifyPlugin(mailerConnector);
