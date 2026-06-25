import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadConfig } from '../config.ts';

const VALID_ENV = {
    DATABASE_URL: 'postgres://localhost/test',
    GITHUB_BASE_URL: 'https://api.github.com',
    RABBITMQ_URL: 'amqp://localhost:5672',
    API_KEY: 'api-key',
    SCANNER_INTERVAL_MS: '60000',
};

afterEach(() => {
    vi.unstubAllEnvs();
});

function stubValidEnv(overrides: Record<string, string | undefined> = {}) {
    const env = { ...VALID_ENV, ...overrides };
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) {
            vi.stubEnv(key, '');
        } else {
            vi.stubEnv(key, value);
        }
    }
}

describe('loadConfig', () => {
    it('returns full AppConfig when all required vars present', () => {
        stubValidEnv();
        const config = loadConfig();
        expect(config.databaseUrl).toBe(VALID_ENV.DATABASE_URL);
        expect(config.githubBaseUrl).toBe(VALID_ENV.GITHUB_BASE_URL);
        expect(config.rabbitmqUrl).toBe(VALID_ENV.RABBITMQ_URL);
        expect(config.apiKey).toBe(VALID_ENV.API_KEY);
        expect(config.scannerIntervalMs).toBe(60000);
    });

    it('throws mentioning DATABASE_URL when missing', () => {
        stubValidEnv({ DATABASE_URL: undefined });
        expect(() => loadConfig()).toThrow('DATABASE_URL');
    });

    it('throws mentioning GITHUB_BASE_URL when missing', () => {
        stubValidEnv({ GITHUB_BASE_URL: undefined });
        expect(() => loadConfig()).toThrow('GITHUB_BASE_URL');
    });

    it('throws mentioning RABBITMQ_URL when missing', () => {
        stubValidEnv({ RABBITMQ_URL: undefined });
        expect(() => loadConfig()).toThrow('RABBITMQ_URL');
    });

    it('throws mentioning API_KEY when missing', () => {
        stubValidEnv({ API_KEY: undefined });
        expect(() => loadConfig()).toThrow('API_KEY');
    });

    it('throws mentioning SCANNER_INTERVAL_MS when missing', () => {
        stubValidEnv({ SCANNER_INTERVAL_MS: undefined });
        expect(() => loadConfig()).toThrow('SCANNER_INTERVAL_MS');
    });

    it('does not throw when GITHUB_TOKEN is missing', () => {
        stubValidEnv();
        vi.stubEnv('GITHUB_TOKEN', '');
        expect(() => loadConfig()).not.toThrow();
    });

    it('githubToken is undefined when GITHUB_TOKEN is not set', () => {
        stubValidEnv();
        vi.stubEnv('GITHUB_TOKEN', '');
        const config = loadConfig();
        expect(config.githubToken).toBeUndefined();
    });

    it('port defaults to 3000 when PORT is not set', () => {
        stubValidEnv();
        vi.stubEnv('PORT', '');
        const config = loadConfig();
        expect(config.port).toBe(3000);
    });

    it('throws when SCANNER_INTERVAL_MS is not a valid integer', () => {
        stubValidEnv({ SCANNER_INTERVAL_MS: 'abc' });
        expect(() => loadConfig()).toThrow('SCANNER_INTERVAL_MS');
    });

    it('logLevel defaults to info when LOG_LEVEL is not set', () => {
        stubValidEnv();
        vi.stubEnv('LOG_LEVEL', '');
        const config = loadConfig();
        expect(config.logLevel).toBe('info');
    });

    it('throws when LOG_LEVEL is not a recognised level', () => {
        stubValidEnv({ LOG_LEVEL: 'verbose' });
        expect(() => loadConfig()).toThrow('LOG_LEVEL');
    });
});
