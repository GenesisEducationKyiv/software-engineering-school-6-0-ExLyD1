import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCommand } from '../handler.ts';
import type { Mailer } from '../mailer.ts';

const BASE_URL = 'https://notifier.example.com';

function buildMailer(): Mailer {
    return { send: vi.fn().mockResolvedValue(undefined) };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleCommand', () => {
    it('sends a confirmation email to the command recipient', async () => {
        const mailer = buildMailer();

        await handleCommand(mailer, BASE_URL, {
            type: 'confirmation',
            sagaId: 'saga-x',
            email: 'user@example.com',
            token: 'tok-123',
        });

        expect(mailer.send).toHaveBeenCalledOnce();
        const [to, content] = vi.mocked(mailer.send).mock.calls[0];
        expect(to).toBe('user@example.com');
        expect(content.subject).toBe('Confirm your email');
        expect(content.text).toContain('tok-123');
    });

    it('sends a release email to the command recipient', async () => {
        const mailer = buildMailer();

        await handleCommand(mailer, BASE_URL, {
            type: 'release',
            email: 'user@example.com',
            repo: 'org/repo',
            tag: 'v2.0.0',
            unsubscribeToken: 'unsub-1',
        });

        const [to, content] = vi.mocked(mailer.send).mock.calls[0];
        expect(to).toBe('user@example.com');
        expect(content.subject).toContain('org/repo');
        expect(content.text).toContain('v2.0.0');
        expect(content.text).toContain('unsub-1');
    });
});
