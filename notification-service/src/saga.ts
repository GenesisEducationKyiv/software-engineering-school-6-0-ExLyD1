import type { Logger } from 'pino';
import type { Db } from './db.ts';
import type { Mailer } from './mailer.ts';
import type { ConfirmationEmailCommand } from './contract.ts';
import { handleCommand } from './handler.ts';
import { findSentBySaga, recordSent } from './notifications.repository.ts';

export type ConfirmationDeps = {
    db: Db;
    mailer: Mailer;
    baseUrl: string;
    log: Logger;
};

/**
 * Saga participant step: send the confirmation email and report the outcome.
 *
 * Idempotent on purpose — the orchestrator retries by re-delivering the same
 * command (same sagaId). If we already sent it, we must NOT send again; we just
 * report success. This is only possible because the service now has its own DB.
 */
export const processConfirmation = async (
    deps: ConfirmationDeps,
    command: ConfirmationEmailCommand,
): Promise<'sent' | 'failed'> => {
    if (await findSentBySaga(deps.db, command.sagaId)) {
        return 'sent';
    }

    try {
        await handleCommand(deps.mailer, deps.baseUrl, command);
        await recordSent(deps.db, command.sagaId, 'confirmation', command.email);
        return 'sent';
    } catch (err) {
        deps.log.error({ err, sagaId: command.sagaId }, 'Confirmation send failed');
        return 'failed';
    }
};
