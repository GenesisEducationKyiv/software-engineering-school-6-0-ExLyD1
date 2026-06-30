import { describe, it, expect } from 'vitest';
import { confirmationEmail } from '../templates/confirmation.ts';
import { releaseEmail } from '../templates/release.ts';

const BASE_URL = 'https://notifier.example.com';

describe('confirmationEmail', () => {
    it('uses the confirmation subject', () => {
        expect(confirmationEmail(BASE_URL, 'tok').subject).toBe('Confirm your email');
    });

    it('contains the confirmation link with the token', () => {
        expect(confirmationEmail(BASE_URL, 'tok-123').text).toContain(
            `${BASE_URL}/api/confirm/tok-123`,
        );
    });
});

describe('releaseEmail', () => {
    it('mentions the repo in the subject', () => {
        expect(releaseEmail(BASE_URL, 'org/repo', 'v2.0.0', 'u').subject).toContain('org/repo');
    });

    it('contains the new tag', () => {
        expect(releaseEmail(BASE_URL, 'org/repo', 'v2.0.0', 'u').text).toContain('v2.0.0');
    });

    it('contains the unsubscribe link with the token', () => {
        expect(releaseEmail(BASE_URL, 'org/repo', 'v2.0.0', 'unsub-1').text).toContain(
            `${BASE_URL}/api/unsubscribe/unsub-1`,
        );
    });
});
