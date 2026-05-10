export interface ConfirmationMailer {
    sendConfirmationEmail: (email: string, token: string) => Promise<void>;
}

export interface NotificationMailer {
    sendReleaseNotification: (
        email: string,
        repo: string,
        tag: string,
        unsubscribeToken: string,
    ) => Promise<void>;
}
