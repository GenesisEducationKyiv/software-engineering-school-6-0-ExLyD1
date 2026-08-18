import { http, HttpResponse } from 'msw';

const GITHUB_BASE = 'https://api.github.com';

export const githubDefaultHandlers = [
    http.get(`${GITHUB_BASE}/repos/:owner/:repo/releases/latest`, () => {
        return HttpResponse.json({ tag_name: 'v1.0.0', name: 'Release v1.0.0' });
    }),
];

export const github404Handler = http.get(
    `${GITHUB_BASE}/repos/:owner/:repo/releases/latest`,
    () => {
        return new HttpResponse(null, { status: 404 });
    },
);

export const github429Handler = http.get(
    `${GITHUB_BASE}/repos/:owner/:repo/releases/latest`,
    () => {
        return new HttpResponse(null, {
            status: 429,
            headers: { 'x-ratelimit-remaining': '0' },
        });
    },
);

export const github500Handler = http.get(
    `${GITHUB_BASE}/repos/:owner/:repo/releases/latest`,
    () => {
        return new HttpResponse(null, { status: 500 });
    },
);
