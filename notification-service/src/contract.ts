// This service's own copy of the message contract. It agrees with the API by
// the JSON shape, not by shared code — keep in sync with the monolith's
// src/modules/shared/messaging/email-commands.ts.

export const EMAIL_QUEUE = 'email_commands';

export interface ConfirmationEmailCommand {
    type: 'confirmation';
    email: string;
    token: string;
}

export interface ReleaseEmailCommand {
    type: 'release';
    email: string;
    repo: string;
    tag: string;
    unsubscribeToken: string;
}

export type EmailCommand = ConfirmationEmailCommand | ReleaseEmailCommand;

/**
 * Validates a decoded message against the contract. The transport gives us
 * arbitrary JSON; a blind `as EmailCommand` cast would let malformed data reach
 * the email handler. Throws on anything that does not match — the caller treats
 * that as a poison message and drops it.
 */
export const parseEmailCommand = (raw: unknown): EmailCommand => {
    if (typeof raw !== 'object' || raw === null) {
        throw new Error('command is not an object');
    }
    const c = raw as Record<string, unknown>;

    if (c.type === 'confirmation') {
        if (typeof c.email !== 'string' || typeof c.token !== 'string') {
            throw new Error('invalid confirmation command');
        }
        return { type: 'confirmation', email: c.email, token: c.token };
    }

    if (c.type === 'release') {
        if (
            typeof c.email !== 'string' ||
            typeof c.repo !== 'string' ||
            typeof c.tag !== 'string' ||
            typeof c.unsubscribeToken !== 'string'
        ) {
            throw new Error('invalid release command');
        }
        return {
            type: 'release',
            email: c.email,
            repo: c.repo,
            tag: c.tag,
            unsubscribeToken: c.unsubscribeToken,
        };
    }

    throw new Error(`unknown command type: ${String(c.type)}`);
};
