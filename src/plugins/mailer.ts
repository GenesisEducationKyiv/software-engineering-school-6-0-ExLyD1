import fastifyPlugin from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Resend } from 'resend';
import { createMailer } from '../notifier/index.ts';
import type { Mailer } from '../types/index.ts';

declare module 'fastify' {
    interface FastifyInstance {
        mailer: Mailer;
    }
}

async function mailerConnector(fastify: FastifyInstance) {
    const resend = new Resend(process.env.RESEND_API_KEY!);

    fastify.decorate('mailer', createMailer(resend, process.env.BASE_URL!, process.env.SMTP_FROM!));
}

export default fastifyPlugin(mailerConnector);
