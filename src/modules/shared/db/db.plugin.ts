// ESM
import fastifyPlugin from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import fastifyPostgres from '@fastify/postgres';
import type { AppConfig } from '../config/config.ts';

const dbConnector = async (fastify: FastifyInstance, config: AppConfig) => {
    fastify.register(fastifyPostgres, {
        connectionString: config.databaseUrl,
    });
};

export default fastifyPlugin(dbConnector);
