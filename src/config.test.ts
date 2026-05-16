import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadConfig } from './config.ts';

const VALID_ENV = {
    DATABASE_URL: 'postgres://localhost/test',
    GITHUB_BASE_URL: 'https://api.github.com',
    RESEND_API_KEY: 'resend-key',
    SMTP_FROM: 'from@example.com',
    BASE_URL: 'http://localhost:3000',
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
        expect(config.resendApiKey).toBe(VALID_ENV.RESEND_API_KEY);
        expect(config.smtpFrom).toBe(VALID_ENV.SMTP_FROM);
        expect(config.baseUrl).toBe(VALID_ENV.BASE_URL);
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

    it('throws mentioning RESEND_API_KEY when missing', () => {
        stubValidEnv({ RESEND_API_KEY: undefined });
        expect(() => loadConfig()).toThrow('RESEND_API_KEY');
    });

    it('throws mentioning SMTP_FROM when missing', () => {
        stubValidEnv({ SMTP_FROM: undefined });
        expect(() => loadConfig()).toThrow('SMTP_FROM');
    });

    it('throws mentioning BASE_URL when missing', () => {
        stubValidEnv({ BASE_URL: undefined });
        expect(() => loadConfig()).toThrow('BASE_URL');
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
});
