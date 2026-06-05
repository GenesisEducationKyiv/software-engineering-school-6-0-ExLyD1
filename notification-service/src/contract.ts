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
