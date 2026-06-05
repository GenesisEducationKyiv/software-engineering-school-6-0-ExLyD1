import type { EmailContent } from './email-content.ts';

export const releaseEmail = (
    baseUrl: string,
    repo: string,
    tag: string,
    unsubscribeToken: string,
): EmailContent => ({
    subject: `New release for ${repo}`,
    text: `A new release ${tag} is available for ${repo}.\n\nUnsubscribe: ${baseUrl}/api/unsubscribe/${unsubscribeToken}`,
});
