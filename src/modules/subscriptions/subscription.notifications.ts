import type { FastifyBaseLogger } from 'fastify';
import type { DbPool } from '../shared/db/db.types.ts';
import type { NotificationMailer } from '../shared/mailer/mailer.types.ts';
import { getConfirmedSubscribers } from './subscription.repository.ts';

/**
 * Reacts to a "new release detected" signal from the scanner.
 *
 * The subscriptions module owns the subscriber data, so it is the one that
 * looks up who is interested and fans the notification out — the scanner never
 * touches subscribers or the mailer.
 */
export const notifyRelease = async (
    db: DbPool,
    mailer: NotificationMailer,
    log: FastifyBaseLogger,
    repoId: number,
    ownerRepo: string,
    tag: string,
): Promise<void> => {
    const subscribers = await getConfirmedSubscribers(db, repoId);

    log.info(
        { repository: ownerRepo, subscriberCount: subscribers.length },
        'Notifying subscribers of new release',
    );

    for (const sub of subscribers) {
        try {
            await mailer.sendReleaseNotification(sub.email, ownerRepo, tag, sub.unsubscribe_token);
        } catch (err) {
            log.error({ err, repository: ownerRepo }, 'Failed to notify subscriber');
        }
    }
};
