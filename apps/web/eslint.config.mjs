import { nextJsConfig } from '@repo/eslint-config/next-js';

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: ['*.config.mjs', 'next.config.js', 'eslint.config.mjs', 'postcss.config.mjs'],
  },
  ...nextJsConfig,
];
