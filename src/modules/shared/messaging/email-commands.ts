// Contract shared *by convention* with the notification-service. Each service
// keeps its own copy of this shape (microservices own their contracts); they
// agree on the JSON, not on shared code. Keep both copies in sync.

export const EMAIL_QUEUE = 'email_commands';
// Dead-letter topology: messages the consumer rejects are parked in the DLQ
// (via this exchange) instead of being lost.
export const EMAIL_DLX = 'email_commands.dlx';
export const EMAIL_DLQ = 'email_commands.dlq';
// Saga: the notification-service replies here with the confirmation outcome.
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
