import type { EmailCommand } from './contract.ts';
import type { Mailer } from './mailer.ts';
import type { EmailContent } from './templates/email-content.ts';
import { confirmationEmail } from './templates/confirmation.ts';
import { releaseEmail } from './templates/release.ts';

const render = (baseUrl: string, command: EmailCommand): { to: string; content: EmailContent } => {
    switch (command.type) {
        case 'confirmation':
            return { to: command.email, content: confirmationEmail(baseUrl, command.token) };
        case 'release':
            return {
                to: command.email,
                content: releaseEmail(baseUrl, command.repo, command.tag, command.unsubscribeToken),
            };
        default: {
            // Exhaustiveness guard: a new command type added to the contract must
            // be handled here, or this fails at compile time.
            const exhaustive: never = command;
            throw new Error(`Unknown email command: ${JSON.stringify(exhaustive)}`);
        }
    }
};

export const handleCommand = async (
    mailer: Mailer,
    baseUrl: string,
    command: EmailCommand,
): Promise<void> => {
    const { to, content } = render(baseUrl, command);
    await mailer.send(to, content);
};
