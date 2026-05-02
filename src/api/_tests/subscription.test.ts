import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type {} from '../../plugins/mailer.ts';

vi.mock('../../services/github.ts', () => ({
    getLatestRelease: vi.fn(),
}));

vi.mock('../../services/subscription.ts', () => {
    class AlreadySubscribedError extends Error {
        constructor() {
            super('already subscribed');
            this.name = 'AlreadySubscribedError';
        }
    }
    return {
        AlreadySubscribedError,
        subscribe: vi.fn(),
        confirmSubscription: vi.fn(),
        deleteSubscription: vi.fn(),
        getSubscriptionsByEmail: vi.fn(),
    };
});

import { getLatestRelease } from '../../services/github.ts';
import { subscribe, AlreadySubscribedError } from '../../services/subscription.ts';
import routes from '../subscription.ts';

const mockGetLatestRelease = vi.mocked(getLatestRelease);
const mockSubscribe = vi.mocked(subscribe);

function buildApp(mailerOverrides?: { sendConfirmationEmail?: () => Promise<void> }) {
    const app = Fastify({ logger: false });

    app.decorate('mailer', {
        sendConfirmationEmail:
            mailerOverrides?.sendConfirmationEmail ?? vi.fn().mockResolvedValue(undefined),
        sendReleaseNotification: vi.fn().mockResolvedValue(undefined),
    });

    app.register(routes);
    return app;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('POST /api/subscribe', () => {
    it('responds 409 and does not send email when already subscribed', async () => {
        mockGetLatestRelease.mockResolvedValue({ tag_name: 'v1.0.0' } as any);
        mockSubscribe.mockRejectedValue(new AlreadySubscribedError());

        const mockSendConfirmationEmail = vi.fn().mockResolvedValue(undefined);
        const app = buildApp({ sendConfirmationEmail: mockSendConfirmationEmail });

        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { email: 'user@example.com', repo: 'org/repo' },
        });

        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ error: expect.stringContaining('already') });
        expect(mockSendConfirmationEmail).not.toHaveBeenCalled();
    });

    it('responds 404 and does not touch the database when GitHub returns no releases', async () => {
        mockGetLatestRelease.mockResolvedValue(null);

        const app = buildApp();

        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { email: 'user@example.com', repo: 'org/nonexistent' },
        });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ error: expect.stringContaining('not found') });
        expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it('responds 500 when email sending fails (subscribe rolls back and throws)', async () => {
        mockGetLatestRelease.mockResolvedValue({ tag_name: 'v1.0.0' } as any);

        const smtpError = new Error('SMTP connection refused');
        mockSubscribe.mockRejectedValue(smtpError);

        const app = Fastify({ logger: { level: 'silent' } });
        const logErrorSpy = vi.spyOn(app.log, 'error');

        app.decorate('mailer', {
            sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
            sendReleaseNotification: vi.fn().mockResolvedValue(undefined),
        });
        app.register(routes);

        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { email: 'user@example.com', repo: 'org/repo' },
        });

        expect(response.statusCode).toBe(500);
        expect(response.json()).toMatchObject({ error: 'Internal server error' });
        expect(mockSubscribe).toHaveBeenCalledOnce();
        expect(logErrorSpy).toHaveBeenCalledWith(
            expect.objectContaining({ err: smtpError }),
            expect.stringContaining('email'),
        );
    });
});
