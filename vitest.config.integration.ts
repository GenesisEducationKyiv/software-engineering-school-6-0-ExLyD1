import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['test/integration/**/*.test.ts'],
        globalSetup: './test/integration/helpers/global-setup.ts',
        setupFiles: ['./test/integration/helpers/setup.ts'],
        fileParallelism: false,
        maxWorkers: 1,
        testTimeout: 30000,
        hookTimeout: 30000,
    },
});
