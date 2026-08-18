export class GitHubApiError extends Error {
    constructor(public readonly status: number) {
        super(`GitHub API error: ${status}`);
    }
}

export class InvalidRepoFormatError extends Error {
    constructor() {
        super('Invalid repository format');
    }
}
