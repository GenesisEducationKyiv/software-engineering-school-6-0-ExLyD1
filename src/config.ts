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
};

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
    };
};
