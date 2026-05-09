import fastifyPlugin from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Resend } from 'resend';
import { createMailer } from '../services/mailer.ts';
import type { Mailer } from '../types/index.ts';
import type { AppConfig } from '../config.ts';

declare module 'fastify' {
    interface FastifyInstance {
        mailer: Mailer;
    }
}

const mailerConnector = async (fastify: FastifyInstance, config: AppConfig) => {
    const resend = new Resend(config.resendApiKey);
    fastify.decorate('mailer', createMailer(resend, config.baseUrl, config.smtpFrom));
};

export default fastifyPlugin(mailerConnector);
