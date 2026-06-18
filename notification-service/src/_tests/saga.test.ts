import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { processConfirmation } from '../saga.ts';
import type { Db } from '../db.ts';
import type { Mailer } from '../mailer.ts';
import type { ConfirmationEmailCommand } from '../contract.ts';

vi.mock('../notifications.repository.ts', () => ({
    findSentBySaga: vi.fn(),
    recordSent: vi.fn(),
}));

import { findSentBySaga, recordSent } from '../notifications.repository.ts';

const mockFindSent = vi.mocked(findSentBySaga);
const mockRecordSent = vi.mocked(recordSent);

const command: ConfirmationEmailCommand = {
    type: 'confirmation',
    sagaId: 'saga-1',
    email: 'user@example.com',
    token: 'tok-1',
};

function buildDeps() {
    const mailer: Mailer = { send: vi.fn().mockResolvedValue(undefined) };
    const log = { error: vi.fn() } as unknown as Logger;
    const db = {} as Db;
    return { db, mailer, baseUrl: 'https://x.example', log };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('processConfirmation', () => {
    it('is idempotent: if already sent for this saga, does not send again', async () => {
        mockFindSent.mockResolvedValue(true);
        const deps = buildDeps();

        const result = await processConfirmation(deps, command);

        expect(result).toBe('sent');
        expect(deps.mailer.send).not.toHaveBeenCalled();
        expect(mockRecordSent).not.toHaveBeenCalled();
    });

    it('sends and records on first attempt, returns sent', async () => {
        mockFindSent.mockResolvedValue(false);
        const deps = buildDeps();

        const result = await processConfirmation(deps, command);

        expect(result).toBe('sent');
        expect(deps.mailer.send).toHaveBeenCalledOnce();
        expect(mockRecordSent).toHaveBeenCalledWith(deps.db, 'saga-1', 'confirmation', command.email);
    });

    it('returns failed and does not record when sending throws', async () => {
        mockFindSent.mockResolvedValue(false);
        const deps = buildDeps();
        vi.mocked(deps.mailer.send).mockRejectedValueOnce(new Error('resend down'));

        const result = await processConfirmation(deps, command);

        expect(result).toBe('failed');
        expect(mockRecordSent).not.toHaveBeenCalled();
    });
});
