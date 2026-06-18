// This service's own copy of the message contract. It agrees with the API by
// the JSON shape, not by shared code — keep in sync with the monolith's
// src/modules/shared/messaging/email-commands.ts.

export const EMAIL_QUEUE = 'email_commands';
// Dead-letter topology: messages the consumer rejects are parked in the DLQ
// (via this exchange) instead of being lost.
export const EMAIL_DLX = 'email_commands.dlx';
export const EMAIL_DLQ = 'email_commands.dlq';
// Saga: the orchestrator (monolith) listens here for the result of a confirmation.
export const SAGA_REPLIES_QUEUE = 'saga_replies';

export interface ConfirmationEmailCommand {
    type: 'confirmation';
    sagaId: string;
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

// Reply the notification-service sends back to the saga orchestrator.
export interface SagaReply {
    sagaId: string;
    status: 'sent' | 'failed';
}
