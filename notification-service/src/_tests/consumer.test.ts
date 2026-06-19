import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConsumeMessage } from 'amqplib';
import type { Logger } from 'pino';
import { processMessage } from '../consumer.ts';
import type { Mailer } from '../mailer.ts';

function msgOf(payload: unknown): ConsumeMessage {
    return { content: Buffer.from(JSON.stringify(payload)) } as ConsumeMessage;
}

function buildDeps() {
    const channel = { ack: vi.fn(), nack: vi.fn() };
    const mailer: Mailer = { send: vi.fn().mockResolvedValue(undefined) };
    const log = { info: vi.fn(), error: vi.fn() } as unknown as Logger;
    return { channel, mailer, baseUrl: 'https://x.example', log };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('processMessage', () => {
    it('sends the email and acks a valid command', async () => {
        const deps = buildDeps();
        const msg = msgOf({ type: 'confirmation', email: 'user@example.com', token: 'tok-1' });

        await processMessage(deps, msg);

        expect(deps.mailer.send).toHaveBeenCalledOnce();
        expect(deps.channel.ack).toHaveBeenCalledWith(msg);
        expect(deps.channel.nack).not.toHaveBeenCalled();
    });

    it('drops (nack, no requeue) a malformed JSON message and does not send', async () => {
        const deps = buildDeps();
        const msg = { content: Buffer.from('not json') } as ConsumeMessage;

        await processMessage(deps, msg);

        expect(deps.mailer.send).not.toHaveBeenCalled();
        expect(deps.channel.nack).toHaveBeenCalledWith(msg, false, false);
        expect(deps.channel.ack).not.toHaveBeenCalled();
    });

    it('drops a structurally invalid command (missing fields)', async () => {
        const deps = buildDeps();
        const msg = msgOf({ type: 'confirmation', email: 'user@example.com' }); // no token

        await processMessage(deps, msg);

        expect(deps.mailer.send).not.toHaveBeenCalled();
        expect(deps.channel.nack).toHaveBeenCalledWith(msg, false, false);
    });

    it('drops the message (nack) when sending throws, without acking', async () => {
        const deps = buildDeps();
        vi.mocked(deps.mailer.send).mockRejectedValueOnce(new Error('resend down'));
        const msg = msgOf({ type: 'confirmation', email: 'user@example.com', token: 'tok-1' });

        await processMessage(deps, msg);

        expect(deps.channel.ack).not.toHaveBeenCalled();
        expect(deps.channel.nack).toHaveBeenCalledWith(msg, false, false);
    });
});
