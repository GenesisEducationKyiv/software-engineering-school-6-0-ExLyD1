import { describe, it, expect } from 'vitest';
import { EMAIL_REGEX, REPO_REGEX } from '../regex';

describe('REPO_REGEX', () => {
    it('accepts simple owner/repo', () => {
        expect(REPO_REGEX.test('microsoft/vscode')).toBe(true);
    });

    it('accepts single-char owner and repo', () => {
        expect(REPO_REGEX.test('a/b')).toBe(true);
    });

    it('accepts hyphens, dots, and underscores in names', () => {
        expect(REPO_REGEX.test('my-org/my.repo_name')).toBe(true);
    });

    it('rejects missing slash', () => {
        expect(REPO_REGEX.test('microsoftvscode')).toBe(false);
    });

    it('rejects empty owner', () => {
        expect(REPO_REGEX.test('/vscode')).toBe(false);
    });

    it('rejects empty repo', () => {
        expect(REPO_REGEX.test('microsoft/')).toBe(false);
    });

    it('rejects space in owner', () => {
        expect(REPO_REGEX.test('my org/repo')).toBe(false);
    });

    it('rejects space in repo', () => {
        expect(REPO_REGEX.test('org/my repo')).toBe(false);
    });

    it('rejects multiple slashes', () => {
        expect(REPO_REGEX.test('org/repo/extra')).toBe(false);
    });

    it('rejects empty string', () => {
        expect(REPO_REGEX.test('')).toBe(false);
    });
});

describe('EMAIL_REGEX', () => {
    it('accepts a standard email', () => {
        expect(EMAIL_REGEX.test('user@example.com')).toBe(true);
    });

    it('accepts plus-tagged email with subdomain', () => {
        expect(EMAIL_REGEX.test('user+tag@sub.domain.io')).toBe(true);
    });

    it('rejects missing @', () => {
        expect(EMAIL_REGEX.test('userexample.com')).toBe(false);
    });

    it('rejects missing domain', () => {
        expect(EMAIL_REGEX.test('user@')).toBe(false);
    });

    it('rejects space in local part', () => {
        expect(EMAIL_REGEX.test('user @example.com')).toBe(false);
    });

    it('rejects missing TLD', () => {
        expect(EMAIL_REGEX.test('user@example')).toBe(false);
    });

    it('rejects double @', () => {
        expect(EMAIL_REGEX.test('user@@example.com')).toBe(false);
    });

    it('rejects empty string', () => {
        expect(EMAIL_REGEX.test('')).toBe(false);
    });
});
