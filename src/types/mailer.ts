export interface Mailer {
    sendConfirmationEmail: (email: string, token: string) => Promise<void>;
    sendReleaseNotification: (
        email: string,
        repo: string,
        tag: string,
        unsubscribeToken: string,
    ) => Promise<void>;
}
