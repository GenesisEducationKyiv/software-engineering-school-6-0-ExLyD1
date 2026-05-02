import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const runMigrations = async (fastify: FastifyInstance) => {
    const sqlFiles = fs
        .readdirSync(join(__dirname, 'migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort();

    const client = await fastify.pg.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS migrations (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);

        const { rows } = await client.query('SELECT name FROM migrations');
        const executedMigrations = new Set(rows.map((row: { name: string }) => row.name));

        for (const file of sqlFiles) {
            if (executedMigrations.has(file)) {
                fastify.log.info(`Migration already applied, skipping: ${file}`);
                continue;
            }
            const sqlQuery = fs.readFileSync(join(__dirname, 'migrations', file), 'utf-8');
            try {
                await client.query('BEGIN');
                await client.query(sqlQuery);
                await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
                fastify.log.info(`Migration applied: ${file}`);
            } catch (err) {
                await client.query('ROLLBACK');
                fastify.log.error(`Migration failed: ${file}`);
                throw err;
            }
        }
    } finally {
        client.release();
    }
};
