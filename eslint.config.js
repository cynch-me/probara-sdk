import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'packages/*/src/generated/**',
      // Byte-exact tool output and the projects that produced it.
      'packages/cli/test/fixtures/**',
      // The Playwright project the reporter's end-to-end tests run.
      'packages/playwright-reporter/test/fixtures/**',
      // The Jest projects the reporter's end-to-end tests run.
      'packages/jest-reporter/test/fixtures/**',
      // The fetch redirect the docs tests load with `node --import`: plain JavaScript for Node.
      'packages/test-support/src/docs/redirect-fetch.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
