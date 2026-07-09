export type ServiceConfig = {
    rabbitmqUrl: string;
    databaseUrl: string;
    resendApiKey: string;
    smtpFrom: string;
    baseUrl: string;
    grpcPort: number;
    httpPort: number;
};

export const loadConfig = (): ServiceConfig => {
    const required = {
        rabbitmqUrl: process.env.RABBITMQ_URL,
        databaseUrl: process.env.DATABASE_URL,
        resendApiKey: process.env.RESEND_API_KEY,
        smtpFrom: process.env.SMTP_FROM,
        baseUrl: process.env.BASE_URL,
    };

    for (const [key, value] of Object.entries(required)) {
        if (!value) {
            throw new Error(
                `Missing required env var: ${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`,
            );
        }
    }

    return {
        rabbitmqUrl: required.rabbitmqUrl!,
        databaseUrl: required.databaseUrl!,
        resendApiKey: required.resendApiKey!,
        smtpFrom: required.smtpFrom!,
        baseUrl: required.baseUrl!,
        grpcPort: Number(process.env.GRPC_PORT ?? 50051),
        httpPort: Number(process.env.HTTP_PORT ?? 8080),
    };
};
