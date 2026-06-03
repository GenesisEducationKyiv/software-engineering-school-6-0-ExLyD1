import type { LogLevel } from 'fastify';

export type AppConfig = {
    databaseUrl: string;
    githubBaseUrl: string;
    githubToken?: string;
    resendApiKey: string;
    smtpFrom: string;
    baseUrl: string;
    apiKey: string;
    scannerIntervalMs: number;
    port: number;
    logLevel: LogLevel;
};

const VALID_LOG_LEVELS = new Set<LogLevel>([
    'trace',
    'debug',
    'info',
    'warn',
    'error',
    'fatal',
    'silent',
]);

const isLogLevel = (value: string): value is LogLevel => VALID_LOG_LEVELS.has(value as LogLevel);

export const loadConfig = (): AppConfig => {
    const required = {
        databaseUrl: process.env.DATABASE_URL,
        githubBaseUrl: process.env.GITHUB_BASE_URL,
        resendApiKey: process.env.RESEND_API_KEY,
        smtpFrom: process.env.SMTP_FROM,
        baseUrl: process.env.BASE_URL,
        apiKey: process.env.API_KEY,
    };

    for (const [key, value] of Object.entries(required)) {
        if (!value) {
            throw new Error(
                `Missing required env var: ${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`,
            );
        }
    }

    const scannerIntervalMs = parseInt(process.env.SCANNER_INTERVAL_MS ?? '', 10);
    if (isNaN(scannerIntervalMs)) {
        throw new Error(
            'Missing or invalid env var: SCANNER_INTERVAL_MS must be a valid integer (milliseconds)',
        );
    }

    const logLevel = process.env.LOG_LEVEL || 'info';
    if (!isLogLevel(logLevel)) {
        throw new Error(
            `Invalid env var: LOG_LEVEL must be one of ${[...VALID_LOG_LEVELS].join(', ')}`,
        );
    }

    return {
        databaseUrl: required.databaseUrl!,
        githubBaseUrl: required.githubBaseUrl!,
        githubToken: process.env.GITHUB_TOKEN || undefined,
        resendApiKey: required.resendApiKey!,
        smtpFrom: required.smtpFrom!,
        baseUrl: required.baseUrl!,
        apiKey: required.apiKey!,
        scannerIntervalMs,
        port: parseInt(process.env.PORT || '3000', 10),
        logLevel,
    };
};
