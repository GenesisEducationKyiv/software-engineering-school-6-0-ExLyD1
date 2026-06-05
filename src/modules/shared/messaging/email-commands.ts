// Contract shared *by convention* with the notification-service. Each service
// keeps its own copy of this shape (microservices own their contracts); they
// agree on the JSON, not on shared code. Keep both copies in sync.

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
