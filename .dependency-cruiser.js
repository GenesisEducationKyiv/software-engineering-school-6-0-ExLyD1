/**
 * Architectural fitness functions for the layered modular monolith.
 * Rules encode the dependency rule: dependencies point one way only, and
 * modules talk to each other exclusively through their public `index.ts`.
 * See docs/ADR-005-layered-architecture.md for the reasoning.
 *
 * ESM config (project is "type": "module"), typed via JSDoc — same style as eslint.config.js.
 * @type {import('dependency-cruiser').IConfiguration}
 */
export default {
    forbidden: [
        {
            name: 'no-circular',
            comment:
                'No dependency cycles (the saga<->subscriptions cycle we inverted must not return).',
            severity: 'error',
            from: {},
            to: { circular: true },
        },
        {
            name: 'shared-not-to-modules',
            comment:
                'Infrastructure (shared) must not depend on domain modules; dependencies point inward.',
            severity: 'error',
            from: { path: 'src/modules/shared/' },
            to: { path: 'src/modules/(subscriptions|scanner|saga)/' },
        },
        {
            name: 'repository-not-upward',
            comment:
                'The data layer (*.repository) must not know about the layers above it (service/controller).',
            severity: 'error',
            from: { path: '\\.repository\\.ts$' },
            to: { path: '\\.(service|controller)\\.ts$' },
        },
        {
            name: 'controller-not-to-repository',
            comment:
                'A controller must go through the service layer, never straight into a repository.',
            severity: 'error',
            from: { path: '\\.controller\\.ts$' },
            to: { path: '\\.repository\\.ts$' },
        },
        {
            name: 'cross-module-only-via-index',
            comment:
                'Domain modules may reach another module only through its public index.ts, never its internals. ' +
                'The composition root (src/app.ts) is exempt by construction (it lives outside src/modules).',
            severity: 'error',
            from: { path: 'src/modules/(subscriptions|scanner|saga)/', pathNot: '_tests' },
            to: {
                path: 'src/modules/(subscriptions|scanner|saga)/',
                pathNot: ['/index\\.ts$', '^src/modules/$1/'],
            },
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        exclude: { path: '(node_modules|/generated/)' },
        tsPreCompilationDeps: true,
        tsConfig: { fileName: 'tsconfig.json' },
        enhancedResolveOptions: { extensions: ['.ts', '.js'] },
    },
};
