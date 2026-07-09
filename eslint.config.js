import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

const tsconfigRootDir = import.meta.dirname;

export default [
    // ── 1. Global ignores
    // ────────────────────────────────────────────────────
    {
        ignores: ['dist/**', 'node_modules/**', 'eslint.config.js', '**/generated/**'],
    },

    // ── 2. TypeScript — recommended rules for .ts files
    // ────────────────────────────────────────────────────
    ...tsPlugin.configs['flat/recommended'].map((config) => ({
        ...config,
        files: ['**/*.ts'],
    })),

    // ── 3. TypeScript — project-aware rules
    // ───────────────────────────────────────────────
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.config.ts', '*.config.js'],
                },
                tsconfigRootDir,
            },
        },
    },

    // ── 4. All files — Prettier + project rules
    // ───────────────────────────────────────────────
    {
        files: ['**/*.{js,ts}'],
        plugins: {
            prettier: prettierPlugin,
        },
        rules: {
            ...prettierConfig.rules,
            'prettier/prettier': 'error',
            'arrow-body-style': 'off',
            'prefer-arrow-callback': 'off',

            // ── General
            // ────────────────────────────
            'no-console': 'error',
            'no-debugger': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            eqeqeq: ['error', 'always'],
            curly: ['error', 'all'],
            'no-duplicate-imports': 'error',
            'no-useless-return': 'error',
            'prefer-template': 'error',
            'object-shorthand': ['error', 'always'],
            'no-unused-vars': 'off',
            'no-shadow': 'off',
            'no-use-before-define': 'off',
            'no-redeclare': 'off',
            'no-undef': 'off',
        },
    },

    // ── 5. TypeScript — all rules
    // ───────────────────────────────────────────────
    {
        files: ['**/*.{ts}'],
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-shadow': 'error',
            '@typescript-eslint/no-use-before-define': 'error',
            '@typescript-eslint/no-redeclare': 'error',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unsafe-assignment': 'error',
            '@typescript-eslint/no-unsafe-member-access': 'error',
            '@typescript-eslint/no-unsafe-call': 'error',
            '@typescript-eslint/no-unsafe-return': 'error',
            '@typescript-eslint/no-unsafe-argument': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/no-non-null-assertion': 'error',
            '@typescript-eslint/no-unnecessary-condition': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/prefer-nullish-coalescing': 'error',
            '@typescript-eslint/prefer-optional-chain': 'error',
            '@typescript-eslint/restrict-template-expressions': 'error',
            '@typescript-eslint/only-throw-error': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
        },
    },
];
