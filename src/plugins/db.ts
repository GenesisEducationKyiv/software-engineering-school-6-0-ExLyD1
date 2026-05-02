// ESM
import fastifyPlugin from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import fastifyPostgres from '@fastify/postgres';

async function dbConnector(fastify: FastifyInstance) {
    fastify.register(fastifyPostgres, {
        connectionString: process.env.DATABASE_URL,
    });
}

export default fastifyPlugin(dbConnector);
